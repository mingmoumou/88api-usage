// 88api-usage/run.mjs — 命令行入口
//   node run.mjs sync            增量同步一次，打印报表，生成 dashboard.html
//   node run.mjs watch [秒]      常驻轮询（默认 10 秒），实时刷新报表与 HTML
//   node run.mjs serve [端口]    本地实时看板 http://127.0.0.1:8788（自动轮询同步）
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { syncOnce, loadStore } from './sync.mjs';
import { printConsole, writeAll, renderHTML, aggregate } from './report.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STORE = path.join(HERE, 'data');
const STORE_DIR = path.resolve(process.env.API88_USAGE_DIR || DEFAULT_STORE);
const LOG_FILE = path.join(STORE_DIR, 'logs.jsonl');

const [, , cmd = 'sync', arg1] = process.argv;
const say = (m) => console.log(m);
let last = { added: 0, total: 0 };

async function once({ quiet = false } = {}) {
  const t0 = Date.now();
  const r = await syncOnce({ storeDir: STORE_DIR, log: quiet ? () => {} : (m) => say(m) });
  const meta = {
    updatedAt: new Date().toISOString(),
    totalRows: r.total,
    account: r.account,
  };
  const agg = writeAll(STORE_DIR, r.rows, r.settings, meta, { refreshSec: 15 });
  if (!quiet) {
    printConsole(agg, r.settings, meta);
    say(`  同步完成：新增 ${r.added} 条，本地共 ${r.total} 条，用时 ${Date.now() - t0}ms`);
    say(`  看板：${path.join(HERE, 'dashboard.html')}`);
  }
  last = { added: r.added, total: r.total, at: Date.now() };
  return { ...r, agg, meta };
}

function serve(port = 8788, intervalSec = 10) {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  let state = { settings: { quotaPerUnit: 500000, symbol: '¥', price: 1, exchangeRate: 1, retentionDays: 365, version: '', systemName: '88API' }, account: {}, updatedAt: new Date().toISOString() };
  let syncing = false;

  async function tick() {
    if (syncing) return;
    syncing = true;
    try {
      const r = await syncOnce({ storeDir: STORE_DIR, log: () => {} });
      state = { settings: r.settings, account: r.account, updatedAt: new Date().toISOString(), totalRows: r.total, added: r.added };
      if (r.added) say(`[${new Date().toLocaleTimeString('zh-CN')}] +${r.added} 条（共 ${r.total}）`);
    } catch (e) {
      say(`[同步失败] ${e.message}`);
    } finally {
      syncing = false;
    }
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/snapshot.json') {
      const rows = loadStore(LOG_FILE);
      const agg = aggregate(rows, state.settings);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ updatedAt: state.updatedAt, account: state.account, settings: state.settings, total: agg.total, today: agg.today, models: agg.models, keys: agg.keys, days: agg.days }));
    }
    const rows = loadStore(LOG_FILE);
    const agg = aggregate(rows, state.settings);
    const html = renderHTML(agg, state.settings, { ...state, totalRows: rows.length }, { refreshSec: intervalSec });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  });

  server.listen(port, '127.0.0.1', () => {
    say(`看板已启动： http://127.0.0.1:${port}  （每 ${intervalSec}s 拉取一次，Ctrl+C 退出）`);
    say(`本地日志：${LOG_FILE}`);
  });
  tick();
  setInterval(tick, intervalSec * 1000);
}

if (cmd === 'sync') {
  once().catch((e) => { console.error('同步失败：' + e.message); process.exit(1); });
} else if (cmd === 'watch') {
  const sec = Math.max(3, Number(arg1) || 10);
  say(`每 ${sec}s 同步一次，Ctrl+C 退出`);
  const loop = async () => {
    try { await once(); } catch (e) { console.error('同步失败：' + e.message); }
    setTimeout(loop, sec * 1000);
  };
  loop();
} else if (cmd === 'serve') {
  serve(Number(arg1) || 8788, Number(process.env.API88_POLL) || 10);
} else {
  say('用法: node run.mjs sync | watch [秒] | serve [端口]');
}
