// 88api-usage/widget/main.js — 桌面挂件（Electron 主进程）
// 自己完成：轮询 88API 日志 → 落盘 → 聚合 → 推给渲染层；同时刷新 dashboard.html。
// 形态状态机：card（常驻卡片）↔ island（灵动岛胶囊，吸附顶部居中）↔ expanded（悬停展开）。
const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, shell, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..');
const STORE = process.env.API88_USAGE_DIR ? path.resolve(process.env.API88_USAGE_DIR) : path.join(ROOT, 'data');
const LOG = path.join(STORE, 'logs.jsonl');
const STATE_FILE = path.join(HERE, 'window.json');
const SHOT = process.env.API88_WIDGET_SHOT || '';
const DEMO = !!process.env.API88_WIDGET_DEMO;
const TZ = 'Asia/Shanghai';

// 灵动岛尺寸（胶囊 / 悬停展开态）。卡片尺寸用 state.w × state.h（用户可拖角改）。
const ISLAND = { w: 250, h: 52 };
const EXPANDED = { w: 384, h: 340 };

const DBG = path.join(HERE, 'debug.log');
function log(...a) {
  try {
    fs.appendFileSync(DBG, `[${new Date().toISOString()}] ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}\n`);
  } catch { /* ignore */ }
}
process.on('uncaughtException', (e) => log('uncaught', (e && e.stack) || String(e)));
process.on('unhandledRejection', (e) => log('unhandled', (e && e.stack) || String(e)));
log('boot', { shot: !!SHOT, electron: process.versions.electron, node: process.versions.node });

let win = null;
let tray = null;
let settings = null;
let timer = null;
let busy = false;
let lastGood = null;
let tickAt = 0;

// ---- 形态状态 ----
let mode = 'card';          // 'card' | 'island' | 'expanded'
let hover = false;
let cardPos = null;         // 吸附前卡片的位置（从灵动岛恢复用）
let animTimer = null;
let animating = false;

let state = { x: null, y: null, w: 384, h: 340, poll: 15, pinned: true };
try { Object.assign(state, JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))); } catch { /* 首次运行用默认值 */ }
if (state.h < 340) state.h = 340; // 旧配置高度不足，升级以容纳模型轮播

function persist() {
  try {
    // 只有卡片模式才把位置/尺寸写回（灵动岛/展开态的窗口几何是临时的，不污染启动状态）
    if (mode === 'card' && win && !win.isDestroyed() && !win.isMinimized()) {
      const b = win.getBounds();
      state.x = b.x; state.y = b.y; state.w = b.width; state.h = b.height;
    }
    state.pinned = win ? win.isAlwaysOnTop() : state.pinned;
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch { /* 位置存不下不影响使用 */ }
}

// ---------- 数据 ----------
let mods = null;
async function loadMods() {
  if (!mods) {
    mods = {
      sync: await import(pathToFileURL(path.join(ROOT, 'sync.mjs')).href),
      report: await import(pathToFileURL(path.join(ROOT, 'report.mjs')).href),
    };
  }
  return mods;
}

// 示例数据（脱敏预览图用）：不拉真实接口，不泄露真实余额/账户/消费
function demoData() {
  const settings = {
    quotaPerUnit: 500000, displayInCurrency: false, symbol: '¥',
    price: 1, exchangeRate: 1, retentionDays: 7, version: 'demo', systemName: '88API',
  };
  const account = { quota: 64250000, usedQuota: 13130000, username: 'demo' };
  const total = { requests: 198, prompt: 12345678, completion: 234567, cache: 0, quota: 13130000 };
  const today = { requests: 12, prompt: 480000, completion: 32400, cache: 0, quota: 430000 };
  const models = [
    { model: 'gpt-4o-mini', requests: 128, quota: 5600000 },
    { model: 'claude-3.5-sonnet', requests: 45, quota: 4300000 },
    { model: 'gemini-1.5-pro', requests: 25, quota: 3200000 },
  ];
  const modelsToday = [
    { model: 'gpt-4o-mini', requests: 6, quota: 180000 },
    { model: 'claude-3.5-sonnet', requests: 3, quota: 150000 },
    { model: 'gemini-1.5-pro', requests: 3, quota: 100000 },
  ];
  const hourly = [0.1, 0, 0.2, 0, 0.05, 0.3, 0, 0.1, 0.15, 0, 0, 0.25, 0, 0.1, 0.2, 0, 0.05, 0.3, 0.15, 0, 0.1, 0.2, 0.25, 0.43];
  const daily = [0.5, 0.3, 0.8, 0.2, 0.6, 0.4, 0.43];
  return {
    ok: true, settings, account, mode: 'card',
    updatedAt: new Date().toISOString(),
    today, total, avgCost: total.requests ? total.quota / total.requests : 0,
    models, modelsToday, recent: [],
    hourly, daily, rows: 198, added: 0, pinned: true, pollSec: 15,
  };
}

function hourly(rows, st) {
  const now = Math.floor(Date.now() / 1000);
  const cur = Math.floor(now / 3600) * 3600;
  const buckets = Array.from({ length: 24 }, (_, i) => {
    const from = cur - (23 - i) * 3600;
    return { from, to: from + 3600, quota: 0, n: 0 };
  });
  for (const r of rows) {
    if (r.ts < buckets[0].from) continue;
    const i = Math.min(23, Math.max(0, Math.floor((r.ts - buckets[0].from) / 3600)));
    buckets[i].quota += r.quota;
    buckets[i].n++;
  }
  const per = (st && st.quotaPerUnit) || 500000;
  return buckets.map(b => +(b.quota / per).toFixed(6));
}

function daily(rows, st) {
  const per = (st && st.quotaPerUnit) || 500000;
  const day = (ts) => new Date((ts + 8 * 3600) * 1000).toISOString().slice(0, 10);
  const now = Math.floor(Date.now() / 1000);
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const d = day(now - i * 86400);
    let quota = 0;
    for (const r of rows) if (day(r.ts) === d) quota += r.quota;
    out.push(+(quota / per).toFixed(6));
  }
  return out;
}

async function pull() {
  const { sync } = await loadMods();
  const headers = sync.loadAuth().headers;
  if (!settings) settings = await sync.loadSettings(headers);

  const rows = sync.loadStore(LOG);
  const known = new Set(rows.map(r => r.requestId || r.id));
  const since = rows.length ? Math.max(0, rows[rows.length - 1].ts - 120) : 0;
  const fetched = await sync.fetchConsumption(headers, since);
  const fresh = fetched.filter(r => !known.has(r.requestId || r.id));
  if (fresh.length) sync.appendStore(LOG, fresh);

  const account = await sync.loadAccount(headers);
  const all = fresh.length ? sync.loadStore(LOG) : rows;
  return { all, account, added: fresh.length };
}

let shotDone = false;
async function capture() {
  if (shotDone || !SHOT || !win || win.isDestroyed()) return;
  shotDone = true;
  try {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(SHOT, img.toPNG());
  } catch (e) {
    console.error('capture failed', e);
  }
  app.quit();
}

async function tick() {
  if (busy) return;
  busy = true;
  tickAt = Date.now();
  try {
    if (DEMO) {
      lastGood = demoData();
      if (win && !win.isDestroyed()) win.webContents.send('data', lastGood);
      if (SHOT) setTimeout(() => capture(), 800);
      return;
    }
    const { report } = await loadMods();
    const { all, account, added } = await pull();
    const agg = report.aggregate(all, settings);
    const meta = { updatedAt: new Date().toISOString(), totalRows: all.length, account };
    report.writeAll(STORE, all, settings, meta, { html: true, refreshSec: 30 });

    lastGood = {
      ok: true,
      settings,
      account,
      mode,
      updatedAt: meta.updatedAt,
      today: agg.today,
      total: agg.total,
      avgCost: agg.avgCost,
      models: agg.models.slice(0, 4),
      modelsToday: agg.modelsToday.slice(0, 3),
      recent: agg.recent.slice(0, 2),
      hourly: hourly(all, settings),
      daily: daily(all, settings),
      rows: all.length,
      added,
      pinned: win ? win.isAlwaysOnTop() : true,
      pollSec: state.poll,
    };
    if (win && !win.isDestroyed()) win.webContents.send('data', lastGood);
    if (SHOT) setTimeout(() => capture(), 1200);
  } catch (e) {
    const payload = lastGood
      ? { ...lastGood, ok: false, error: String(e && e.message || e) }
      : { ok: false, mode, error: String(e && e.message || e), empty: true };
    if (win && !win.isDestroyed()) win.webContents.send('data', payload);
  } finally {
    busy = false;
  }
}

function schedule() {
  clearInterval(timer);
  timer = setInterval(tick, Math.max(5, state.poll) * 1000);
}

// ---------- 形态状态机 ----------
function workArea() {
  try { return screen.getPrimaryDisplay().workArea; }
  catch { return { x: 0, y: 0, width: 1920, height: 1040 }; }
}

function islandBounds() {
  const a = workArea();
  return { x: Math.round(a.x + (a.width - ISLAND.w) / 2), y: Math.round(a.y + 8), width: ISLAND.w, height: ISLAND.h };
}
function expandedBounds() {
  const a = workArea();
  return { x: Math.round(a.x + (a.width - EXPANDED.w) / 2), y: Math.round(a.y + 8), width: EXPANDED.w, height: EXPANDED.h };
}

function pushMode() {
  if (win && !win.isDestroyed()) win.webContents.send('mode', mode);
}

function setResizableForMode() {
  if (!win || win.isDestroyed()) return;
  const r = mode === 'card';
  if (win.isResizable() !== r) win.setResizable(r);
}

// 平滑补间窗口 bounds（easeOutCubic），动画期间不触发吸附检测
function animateBounds(to, dur = 240) {
  if (!win || win.isDestroyed()) { return; }
  const from = win.getBounds();
  const t0 = Date.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  clearInterval(animTimer);
  animating = true;
  animTimer = setInterval(() => {
    const p = Math.min(1, (Date.now() - t0) / dur);
    const e = ease(p);
    if (win && !win.isDestroyed()) {
      win.setBounds({
        x: Math.round(from.x + (to.x - from.x) * e),
        y: Math.round(from.y + (to.y - from.y) * e),
        width: Math.round(from.width + (to.width - from.width) * e),
        height: Math.round(from.height + (to.height - from.height) * e),
      });
    }
    if (p >= 1) { clearInterval(animTimer); animating = false; }
  }, 16);
}

// 拖动检测：拖到屏幕顶部中间 → 吸附成灵动岛；灵动岛拖离顶部 → 恢复卡片
function maybeSnap() {
  if (animating || !win || win.isDestroyed()) return;
  const a = workArea();
  const b = win.getBounds();
  const cx = b.x + b.width / 2;
  const acx = a.x + a.width / 2;
  const nearTop = b.y <= a.y + 48;
  const nearCenter = Math.abs(cx - acx) <= 200;

  if (mode === 'card' && nearTop && nearCenter) {
    cardPos = { x: b.x, y: b.y };
    mode = 'island'; hover = false;
    pushMode(); setResizableForMode();
    animateBounds(islandBounds(), 240);
  } else if ((mode === 'island' || mode === 'expanded') && b.y > a.y + 130) {
    restoreCard();
  }
}

function restoreCard() {
  mode = 'card'; hover = false;
  const w = state.w || 384, h = state.h || 280;
  const a = workArea();
  let x, y;
  if (cardPos) {
    x = cardPos.x; y = cardPos.y; // 回到吸附前的位置
  } else {
    const b = win.getBounds();
    x = Math.round(b.x + b.width / 2 - w / 2);
    y = Math.round(b.y + b.height / 2 - h / 2);
  }
  x = Math.min(Math.max(x, a.x), a.x + a.width - w);
  y = Math.min(Math.max(y, a.y), a.y + a.height - h);
  cardPos = { x, y };
  pushMode(); setResizableForMode();
  animateBounds({ x, y, width: w, height: h }, 240);
}

function setHover(v) {
  if (mode === 'card') return; // 卡片模式没有悬停展开
  hover = !!v;
  if (mode === 'island' || mode === 'expanded') {
    if (v && mode !== 'expanded') {
      mode = 'expanded'; pushMode(); setResizableForMode();
      animateBounds(expandedBounds(), 240);
    } else if (!v && mode !== 'island') {
      mode = 'island'; pushMode(); setResizableForMode();
      animateBounds(islandBounds(), 240);
    }
  }
}

function snapToIsland() {
  if (mode !== 'card' || !win || win.isDestroyed()) return;
  const b = win.getBounds();
  cardPos = { x: b.x, y: b.y };
  mode = 'island'; hover = false;
  pushMode(); setResizableForMode();
  animateBounds(islandBounds(), 240);
}

// ---------- 窗口 ----------
function defaultPos(w, h) {
  const a = workArea();
  return { x: a.x + a.width - w - 28, y: a.y + 28 };
}

function createWindow() {
  const w = state.w, h = state.h;

  // 截图自检可指定初始形态（仅 SHOT 模式生效）
  let initMode = 'card';
  if (SHOT) {
    const m = process.env.API88_WIDGET_MODE;
    if (m === 'island' || m === 'expanded') initMode = m;
  }
  mode = initMode;

  let pos, size;
  if (mode === 'island') { const b = islandBounds(); pos = { x: b.x, y: b.y }; size = { w: b.width, h: b.height }; }
  else if (mode === 'expanded') { const b = expandedBounds(); pos = { x: b.x, y: b.y }; size = { w: b.width, h: b.height }; }
  else { pos = state.x === null ? defaultPos(w, h) : { x: state.x, y: state.y }; size = { w, h }; }

  win = new BrowserWindow({
    width: size.w, height: size.h, x: pos.x, y: pos.y,
    frame: false, transparent: true, resizable: mode === 'card', maximizable: false, minimizable: false,
    skipTaskbar: true, alwaysOnTop: state.pinned, hasShadow: false,
    fullscreenable: false, show: false,
    icon: path.join(HERE, 'icon.png'),
    webPreferences: {
      preload: path.join(HERE, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });
  win.setAlwaysOnTop(state.pinned, 'floating');
  win.loadFile(path.join(HERE, 'index.html'));
  win.once('ready-to-show', () => { win.show(); });
  // 页面加载完可能还没等到第一轮数据，补推一次已有结果
  win.webContents.on('did-finish-load', () => {
    if (lastGood) win.webContents.send('data', lastGood);
    pushMode();
  });
  win.on('moved', () => { persist(); maybeSnap(); });
  win.on('resized', persist);
  win.on('closed', () => { win = null; });
  win.on('blur', persist);

  win.webContents.on('context-menu', () => openMenu());
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') app.quit();
  });

  if (SHOT) {
    // 视觉自检：等首帧数据渲染完成再截图，最多等 25 秒
    win.webContents.once('did-finish-load', () => {
      setTimeout(() => capture(), 25000).unref?.();
    });
  }
}

function openMenu() {
  Menu.buildFromTemplate([
    { label: win && win.isAlwaysOnTop() ? '取消置顶' : '窗口置顶', click: () => togglePin() },
    { type: 'separator' },
    {
      label: `刷新间隔（当前 ${state.poll}s）`,
      submenu: [5, 10, 15, 30, 60].map(s => ({
        label: `${s} 秒`, type: 'radio', checked: state.poll === s,
        click: () => { state.poll = s; persist(); schedule(); tick(); },
      })),
    },
    { label: '立即刷新', click: () => tick() },
    { type: 'separator' },
    { label: mode === 'card' ? '收起为灵动岛' : '恢复为卡片', click: () => { if (mode === 'card') snapToIsland(); else restoreCard(); } },
    { label: '打开完整看板', click: () => shell.openPath(path.join(ROOT, 'dashboard.html')) },
    { label: '打开数据目录', click: () => shell.openPath(STORE) },
    { type: 'separator' },
    { label: '退出挂件', click: () => app.quit() },
  ]).popup({ window: win });
}

function togglePin() {
  if (!win) return;
  const next = !win.isAlwaysOnTop();
  win.setAlwaysOnTop(next, 'floating');
  persist();
  win.webContents.send('pinned', next);
}

ipcMain.on('action', (_e, name, arg) => {
  if (name === 'pin') togglePin();
  else if (name === 'refresh') tick();
  else if (name === 'dashboard') shell.openPath(path.join(ROOT, 'dashboard.html'));
  else if (name === 'quit') app.quit();
  else if (name === 'menu') openMenu();
  else if (name === 'hover') setHover(!!arg);
  else if (name === 'restore') restoreCard();
});

// ---------- 托盘 ----------
function createTray() {
  try {
    const icon = nativeImage.createFromPath(path.join(HERE, 'icon.png')).resize({ width: 16, height: 16 });
    tray = new Tray(icon);
    tray.setToolTip('88API 用量挂件');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示 / 隐藏', click: () => { if (!win) return; win.isVisible() ? win.hide() : win.show(); } },
      { label: '立即刷新', click: () => tick() },
      { label: '打开完整看板', click: () => shell.openPath(path.join(ROOT, 'dashboard.html')) },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() },
    ]));
    tray.on('click', () => { if (win) win.isVisible() ? win.hide() : win.show(); });
  } catch { /* 没有托盘也能用 */ }
}

app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling');
app.setAppUserModelId('ai.88api.usage.widget');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });
  app.whenReady().then(() => {
    log('ready');
    createWindow();
    if (!SHOT) createTray();
    tick();
    schedule();
  });
  app.on('window-all-closed', () => { log('all-closed'); app.quit(); });
  app.on('render-process-gone', (_e, _wc, d) => log('render-gone', d));
  app.on('child-process-gone', (_e, d) => log('child-gone', d));
  app.on('before-quit', () => { log('before-quit'); persist(); clearInterval(timer); clearInterval(animTimer); });
}
