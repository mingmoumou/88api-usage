// 临时自检 2：在 node 里用假 DOM 跑 index.html 的渲染脚本，验证数字/文案/结构不报错
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { loadAuth, loadSettings, loadAccount, loadStore, fetchConsumption } from './sync.mjs';
import { aggregate } from './report.mjs';

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const headers = loadAuth().headers;
const settings = await loadSettings(headers);
const account = await loadAccount(headers);
const all = loadStore(path.join(ROOT, 'data', 'logs.jsonl'));
const agg = aggregate(all, settings);

function hourly(rs) {
  const cur = Math.floor(Date.now() / 1000 / 3600) * 3600;
  const b = Array.from({ length: 24 }, (_, i) => ({ from: cur - (23 - i) * 3600, quota: 0 }));
  for (const r of rs) {
    if (r.ts < b[0].from) continue;
    const i = Math.min(23, Math.max(0, Math.floor((r.ts - b[0].from) / 3600)));
    b[i].quota += r.quota;
  }
  return b.map((x) => +(x.quota / settings.quotaPerUnit).toFixed(6));
}
function daily(rs) {
  const day = (ts) => new Date((ts + 8 * 3600) * 1000).toISOString().slice(0, 10);
  const now = Math.floor(Date.now() / 1000);
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const d = day(now - i * 86400);
    let q = 0;
    for (const r of rs) if (day(r.ts) === d) q += r.quota;
    out.push(+(q / settings.quotaPerUnit).toFixed(6));
  }
  return out;
}

const payload = {
  ok: true, settings, account, updatedAt: new Date().toISOString(),
  today: agg.today, total: agg.total, avgCost: agg.avgCost,
  models: agg.models.slice(0, 4), modelsToday: agg.modelsToday.slice(0, 3), recent: agg.recent.slice(0, 2),
  hourly: hourly(all), daily: daily(all), rows: all.length, added: 0, pinned: true, pollSec: 15,
};

// ---- 假 DOM ----
const els = new Map();
function el(id) {
  if (!els.has(id)) {
    els.set(id, {
      id, textContent: '', innerHTML: '', title: '', dataset: {}, style: {},
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      attrs: {},
      setAttribute(k, v) { this.attrs[k] = v; },
      getAttribute(k) { return this.attrs[k]; },
      addEventListener() {},
    });
  }
  return els.get(id);
}
const sandbox = {
  console,
  document: {
    getElementById: (id) => el(id),
    querySelectorAll: () => [],
    body: { addEventListener() {}, setAttribute() {}, getAttribute() { return null; } },
  },
  window: { widget: { onData: (cb) => { sandbox.__cb = cb; }, onPinned: () => {}, onMode: () => {}, act: () => {} } },
  Date, Math,
  setTimeout: () => 0, clearTimeout: () => {},
  setInterval: () => 0, clearInterval: () => {},
};
sandbox.globalThis = sandbox;

const html = fs.readFileSync(path.join(ROOT, 'widget', 'index.html'), 'utf8');
const code = html.split('<script>')[1].split('</script>')[0];
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const render = sandbox.render;
if (typeof render !== 'function') throw new Error('render 未定义');

render(payload);
const out = {
  cur: el('cur').textContent,
  bal: el('bal').textContent,
  cum: el('cum').textContent,
  todayCost: el('todayCost').textContent,
  todayReq: el('todayReq').textContent,
  todayTok: el('todayTok').textContent,
  cap: el('cap').textContent,
  last: el('last').textContent,
  upd: el('upd').textContent,
  modelsFound: (el('mListTotal').innerHTML.match(/class="mrow"/g) || []).length,
  modelsHead: el('mListTotal').innerHTML.slice(0, 160).replace(/\s+/g, ' '),
  lineD: el('line').getAttribute('d') ? 'set' : 'MISSING',
  iBal: el('iBal').textContent,
  iTok: el('iTok').textContent,
  iCur: el('iCur').textContent,
  mTodayRows: (el('mListToday').innerHTML.match(/class="mrow"/g) || []).length,
  mTodayHead: el('mListToday').innerHTML.slice(0, 220).replace(/\s+/g, ' '),
  mTotalRows: (el('mListTotal').innerHTML.match(/class="mrow"/g) || []).length,
  mTotalHead: el('mListTotal').innerHTML.slice(0, 220).replace(/\s+/g, ' '),
};

render({ ...payload, ok: false, error: 'HTTP 500 测试错误' });
out.errUpd = el('upd').textContent;
out.errLive = el('liveTxt').textContent;
render({ ok: false, empty: true, error: '缺少 88API 访问令牌' });
out.emptyModels = el('mListToday').innerHTML;
console.log(JSON.stringify(out, null, 2));
