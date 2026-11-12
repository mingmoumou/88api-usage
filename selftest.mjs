// 临时自检：用纯 node 跑挂件的数据链路（与 widget/main.js 中 tick() 同一套调用）
import fs from 'node:fs';
import path from 'node:path';
import { loadAuth, loadSettings, loadAccount, fetchConsumption, loadStore, appendStore } from './sync.mjs';
import { aggregate, writeAll, money } from './report.mjs';

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const STORE = path.join(ROOT, 'data');
const LOG = path.join(STORE, 'logs.jsonl');

const headers = loadAuth().headers;
const settings = await loadSettings(headers);
const rows = loadStore(LOG);
const known = new Set(rows.map((r) => r.requestId || r.id));
const since = rows.length ? Math.max(0, rows[rows.length - 1].ts - 120) : 0;
const fetched = await fetchConsumption(headers, since);
const fresh = fetched.filter((r) => !known.has(r.requestId || r.id));
if (fresh.length) appendStore(LOG, fresh);
const account = await loadAccount(headers);
const all = fresh.length ? loadStore(LOG) : rows;
const agg = aggregate(all, settings);
const meta = { updatedAt: new Date().toISOString(), totalRows: all.length, account };
writeAll(STORE, all, settings, meta, { html: true, refreshSec: 30 });

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

const payload = {
  ok: true, updatedAt: meta.updatedAt, account, today: agg.today, total: agg.total,
  avgCost: agg.avgCost, models: agg.models.slice(0, 4), recent: agg.recent.slice(0, 2),
  hourly: hourly(all), rows: all.length, added: fresh.length,
};
console.log('rows', all.length, 'added', fresh.length);
console.log('balance', money(account.quota, settings).toFixed(2), 'used', money(account.usedQuota, settings).toFixed(2));
console.log('today', JSON.stringify(agg.today), 'cost', money(agg.today.quota, settings).toFixed(4));
console.log('models', payload.models.map((m) => `${m.model}/${m.requests}/${money(m.quota, settings).toFixed(4)}`).join(' | '));
console.log('recent', payload.recent.map((r) => `${new Date(r.ts * 1000).toISOString()} ${r.model}`).join(' | '));
console.log('hourly', payload.hourly.join(','));
console.log('dashboard bytes', fs.statSync(path.join(ROOT, 'dashboard.html')).size);
console.log('PAYLOAD_BYTES', JSON.stringify(payload).length);
