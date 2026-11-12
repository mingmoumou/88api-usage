// 88api-usage/report.mjs
// 把 logs.jsonl 聚合成「按模型 / 按 Key / 按天」的用量报表，并生成自包含 HTML 看板。
import fs from 'node:fs';
import path from 'node:path';

const TZ = 'Asia/Shanghai';

export function money(quota, st) {
  const per = st?.quotaPerUnit || 500000;
  const price = st?.price || 1;
  const rate = st?.exchangeRate || 1;
  return (quota / per) * price * rate;
}

export function ymd(ts) {
  // 固定按东八区切天，避免跨时区把「今天」算错
  const d = new Date((ts + 8 * 3600) * 1000);
  return d.toISOString().slice(0, 10);
}

export function fmtTime(ts) {
  const d = new Date((ts + 8 * 3600) * 1000);
  return d.toISOString().slice(5, 16).replace('T', ' ');
}

export function aggregate(rows, st) {
  const total = { requests: 0, prompt: 0, completion: 0, cache: 0, quota: 0 };
  const byModel = new Map();
  const byModelToday = new Map();
  const byKey = new Map();
  const byDay = new Map();
  const today = ymd(Math.floor(Date.now() / 1000));
  const todayAgg = { requests: 0, prompt: 0, completion: 0, cache: 0, quota: 0 };
  const day14 = [];

  for (const r of rows) {
    const d = ymd(r.ts);
    const day = ymd(Math.floor(Date.now() / 1000));
    for (const bucket of [total, d === day ? todayAgg : null]) {
      if (!bucket) continue;
      bucket.requests += 1;
      bucket.prompt += r.promptTokens;
      bucket.completion += r.completionTokens;
      bucket.cache += r.cacheTokens + r.cacheCreationTokens;
      bucket.quota += r.quota;
    }
    const m = byModel.get(r.model) || { model: r.model, requests: 0, prompt: 0, completion: 0, cache: 0, quota: 0, last: 0 };
    m.requests++; m.prompt += r.promptTokens; m.completion += r.completionTokens;
    m.cache += r.cacheTokens + r.cacheCreationTokens; m.quota += r.quota; m.last = Math.max(m.last, r.ts);
    byModel.set(r.model, m);

    if (d === today) {
      const mt = byModelToday.get(r.model) || { model: r.model, requests: 0, quota: 0 };
      mt.requests++;
      mt.quota += r.quota;
      byModelToday.set(r.model, mt);
    }

    const k = byKey.get(r.keyName || '(未命名 Key)') || { key: r.keyName || '(未命名 Key)', requests: 0, prompt: 0, completion: 0, cache: 0, quota: 0 };
    k.requests++; k.prompt += r.promptTokens; k.completion += r.completionTokens;
    k.cache += r.cacheTokens + r.cacheCreationTokens; k.quota += r.quota; k.last = 0;
    byKey.set(k.key, k);

    const dd = byDay.get(d) || { day: d, requests: 0, prompt: 0, completion: 0, cache: 0, quota: 0 };
    dd.requests++; dd.prompt += r.promptTokens; dd.completion += r.completionTokens;
    dd.cache += r.cacheTokens + r.cacheCreationTokens; dd.quota += r.quota;
    byDay.set(d, dd);
  }

  for (let i = 13; i >= 0; i--) {
    const t = Math.floor(Date.now() / 1000) - i * 86400;
    const d = ymd(t);
    day14.push(byDay.get(d) || { day: d, requests: 0, prompt: 0, completion: 0, cache: 0, quota: 0 });
  }

  const models = [...byModel.values()].sort((a, b) => b.quota - a.quota);
  const modelsToday = [...byModelToday.values()].sort((a, b) => b.requests - a.requests);
  const keys = [...byKey.values()].sort((a, b) => b.quota - a.quota);
  const recent = rows.slice(-25).reverse();
  const avgCost = total.requests ? total.quota / total.requests : 0;
  return { total, today: todayAgg, models, modelsToday, keys, days: day14, recent, avgCost, todayDate: today, firstDay: rows.length ? ymd(rows[0].ts) : null };
}

// ---------- 控制台 ----------
const wide = (s) => [...String(s)].reduce((n, ch) => n + (/[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1), 0);
const pad = (s, n, right = false) => { s = String(s); const w = wide(s); const fill = ' '.repeat(Math.max(0, n - w)); return right ? fill + s : s + fill; };
const nf = (n) => n.toLocaleString('en-US');
const tok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n));
const cost = (q, st, digits = 4) => (st?.symbol || '¥') + money(q, st).toFixed(digits);

export function printConsole(agg, st, meta = {}) {
  const L = [];
  const line = '─'.repeat(78);
  L.push('', `  88API 用量看板  ${meta.updatedAt ? '更新于 ' + new Date(meta.updatedAt).toLocaleString('zh-CN', { timeZone: TZ }) : ''}`);
  L.push('  ' + line);
  L.push(`  余额 ${cost(meta.account?.quota || 0, st, 2)}   累计消费 ${cost(meta.account?.usedQuota || 0, st, 2)}   （日志累计 ${cost(agg.total.quota, st, 2)}）`);
  L.push(`  今日消费 ${cost(agg.today.quota, st, 4)}   今日请求 ${agg.today.requests} 次   今日 Token 入 ${tok(agg.today.prompt)} / 出 ${tok(agg.today.completion)}`);
  L.push(`  历史合计 ${nf(agg.total.requests)} 次请求   入 ${tok(agg.total.prompt)} / 出 ${tok(agg.total.completion)} token   单次均价 ${cost(agg.avgCost, st, 5)}`);
  L.push('  ' + line);
  L.push('  按模型');
  L.push('  ' + pad('模型', 26) + pad('请求', 7, true) + pad('输入tok', 10, true) + pad('输出tok', 10, true) + pad('费用', 11, true) + pad('占比', 8, true));
  for (const m of agg.models.slice(0, 12)) {
    const pct = agg.total.quota ? (m.quota / agg.total.quota * 100).toFixed(1) + '%' : '-';
    L.push('  ' + pad(m.model, 26) + pad(m.requests, 7, true) + pad(tok(m.prompt), 10, true) + pad(tok(m.completion), 10, true) + pad(cost(m.quota, st), 11, true) + pad(pct, 8, true));
  }
  L.push('  ' + line);
  L.push('  按 Key / 分组');
  for (const k of agg.keys.slice(0, 6)) {
    L.push('  ' + pad(k.key, 22) + pad(k.requests + ' 次', 8, true) + pad(cost(k.quota, st), 12, true));
  }
  L.push('  ' + line);
  L.push('  最近请求');
  for (const r of agg.recent.slice(0, 10)) {
    L.push(`  ${fmtTime(r.ts)}  ${pad(r.model, 24)}${pad(r.keyName, 12)}入 ${pad(tok(r.promptTokens), 7, true)} 出 ${pad(tok(r.completionTokens), 7, true)} ${pad(r.useTime + 's', 6, true)} ${pad(cost(r.quota, st), 10, true)}`);
  }
  L.push('');
  console.log(L.join('\n'));
}

// ---------- HTML ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function renderHTML(agg, st, meta, { refreshSec = 15 } = {}) {
  const sym = st?.symbol || '¥';
  const c = (q, d = 4) => sym + money(q, st).toFixed(d);
  const maxDay = Math.max(...agg.days.map(d => money(d.quota, st)), 0.000001);
  const maxModel = Math.max(...agg.models.map(m => m.quota), 1);

  const kpis = [
    ['账户余额', c(meta.account?.quota || 0, 2), `累计消费 ${c(meta.account?.usedQuota || 0, 2)}`, 'gold'],
    ['今日消费', c(agg.today.quota), `${agg.today.requests} 次请求`, 'red'],
    ['今日 Token', `${tok(agg.today.prompt)} in`, `${tok(agg.today.completion)} out · 缓存 ${tok(agg.today.cache)}`, 'blue'],
    ['历史累计', `${nf(agg.total.requests)} 次`, `${tok(agg.total.prompt)} in / ${tok(agg.total.completion)} out`, 'purple'],
    ['单次均价', c(agg.avgCost, 5), `覆盖 ${agg.firstDay || '—'} 至今`, 'green'],
    ['本地记录', `${nf(meta.totalRows || agg.total.requests)} 条`, `站点保留 ${st?.retentionDays || '?'} 天`, 'gray'],
  ];

  const bars = agg.days.map(d => {
    const v = money(d.quota, st);
    const h = Math.max(2, (v / maxDay) * 100);
    const show = d.quota > 0;
    return `<div class="bar-wrap" title="${d.day} · ${c(d.quota)} · ${d.requests} 次">
      <div class="bar-val">${show ? (v >= 0.01 ? v.toFixed(2) : v.toFixed(4)) : ''}</div>
      <div class="bar" style="height:${h}%"></div>
      <div class="bar-day">${d.day.slice(5)}</div>
    </div>`;
  }).join('');

  const modelRows = agg.models.map(m => `
    <tr>
      <td class="mono">${esc(m.model)}</td>
      <td class="num">${nf(m.requests)}</td>
      <td class="num">${nf(m.prompt)}</td>
      <td class="num">${nf(m.completion)}</td>
      <td class="num">${nf(m.cache)}</td>
      <td class="num strong">${c(m.quota)}</td>
      <td class="share"><span style="width:${(m.quota / maxModel * 100).toFixed(1)}%"></span><i>${(m.quota / (agg.total.quota || 1) * 100).toFixed(1)}%</i></td>
    </tr>`).join('');

  const keyRows = agg.keys.map(k => `
    <tr>
      <td class="mono">${esc(k.key)}</td>
      <td class="num">${nf(k.requests)}</td>
      <td class="num">${nf(k.prompt)}</td>
      <td class="num">${nf(k.completion)}</td>
      <td class="num strong">${c(k.quota)}</td>
    </tr>`).join('');

  const recentRows = agg.recent.map(r => `
    <tr>
      <td class="mono dim">${fmtTime(r.ts)}</td>
      <td class="mono">${esc(r.model)}</td>
      <td>${esc(r.keyName)}</td>
      <td class="num">${nf(r.promptTokens)}</td>
      <td class="num">${nf(r.completionTokens)}</td>
      <td class="num dim">${r.useTime}s${r.stream ? ' · 流式' : ''}</td>
      <td class="num strong">${c(r.quota, 5)}</td>
    </tr>`).join('');

  const updated = meta.updatedAt ? new Date(meta.updatedAt).toLocaleString('zh-CN', { timeZone: TZ }) : '—';

  return `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${refreshSec ? `<meta http-equiv="refresh" content="${refreshSec}">` : ''}
<title>${esc(st?.systemName || '88API')} 用量看板</title>
<style>
:root{--bg:#0b0d12;--card:#12151d;--card2:#171b25;--line:#232838;--txt:#e8ecf5;--dim:#8b94a8;--gold:#f5c451;--red:#ff6b6b;--blue:#5aa9ff;--purple:#b18cff;--green:#3ddc97}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(1200px 600px at 20% -10%,#1a2033 0%,#0b0d12 55%);color:var(--txt);font:14px/1.5 -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;padding:22px}
.wrap{max-width:1180px;margin:0 auto}
header{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin-bottom:18px}
h1{font-size:20px;margin:0;letter-spacing:.5px}
.tag{font-size:12px;color:var(--dim)}
.dot{width:7px;height:7px;border-radius:50%;background:var(--green);display:inline-block;margin-right:6px;box-shadow:0 0 10px var(--green)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px}
.kpi{background:linear-gradient(180deg,var(--card2),var(--card));border:1px solid var(--line);border-radius:14px;padding:14px 16px}
.kpi .k{font-size:12px;color:var(--dim);margin-bottom:6px}
.kpi .v{font-size:22px;font-weight:650;letter-spacing:.3px}
.kpi .s{font-size:12px;color:var(--dim);margin-top:4px}
.gold .v{color:var(--gold)} .red .v{color:var(--red)} .blue .v{color:var(--blue)} .purple .v{color:var(--purple)} .green .v{color:var(--green)} .gray .v{color:#c8d0e0}
.grid{display:grid;grid-template-columns:1.15fr .85fr;gap:14px}
@media(max-width:900px){.grid{grid-template-columns:1fr}}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px;margin-bottom:14px}
.card h2{font-size:13px;margin:0 0 14px;color:var(--dim);font-weight:600;letter-spacing:1px;text-transform:uppercase}
.chart{display:flex;align-items:flex-end;gap:8px;height:170px;padding-top:16px}
.bar-wrap{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%;position:relative}
.bar{width:100%;border-radius:5px 5px 2px 2px;background:linear-gradient(180deg,#6ea8ff,#3b5bdb);min-height:2px;transition:.3s}
.bar-wrap:hover .bar{background:linear-gradient(180deg,#ffd479,#f5a623)}
.bar-val{font-size:10px;color:var(--dim);margin-bottom:5px;white-space:nowrap}
.bar-day{font-size:10px;color:var(--dim);margin-top:6px}
table{width:100%;border-collapse:collapse}
th{font-size:11px;color:var(--dim);font-weight:600;text-align:left;padding:0 10px 9px;border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:8px 10px;border-bottom:1px solid rgba(35,40,56,.55);font-size:13px}
tbody tr:hover{background:rgba(90,169,255,.05)}
.num{text-align:right;font-variant-numeric:tabular-nums}
.mono{font-family:ui-monospace,"SF Mono",Consolas,monospace;font-size:12.5px}
.dim{color:var(--dim)} .strong{color:var(--gold);font-weight:600}
.share{position:relative;min-width:90px}
.share span{position:absolute;left:0;top:50%;transform:translateY(-50%);height:6px;border-radius:3px;background:linear-gradient(90deg,#f5c451,#ff8a5b);opacity:.5;max-width:100%}
.share i{position:relative;font-size:11px;color:var(--dim);font-style:normal;padding-left:6px}
footer{color:var(--dim);font-size:12px;margin:18px 0 8px;line-height:1.8}
code{background:#1b2030;padding:1px 6px;border-radius:5px;font-size:12px}
</style></head><body><div class="wrap">
<header>
  <h1>${esc(st?.systemName || '88API')} 用量看板</h1>
  <span class="tag"><span class="dot"></span>每 ${refreshSec || 15}s 自动刷新 · 数据更新于 ${esc(updated)}</span>
  <span class="tag">内核 ${esc(st?.version || '')} · 用户 ${esc(meta.account?.username || '')}</span>
</header>
<div class="kpis">${kpis.map(([k, v, s, cls]) => `<div class="kpi ${cls}"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="s">${esc(s)}</div></div>`).join('')}</div>

<div class="card"><h2>近 14 天每日消费（${sym}）</h2><div class="chart">${bars}</div></div>

<div class="grid">
  <div class="card"><h2>模型消耗</h2>
    <table><thead><tr><th>模型</th><th class="num">请求</th><th class="num">输入</th><th class="num">输出</th><th class="num">缓存</th><th class="num">费用</th><th>占比</th></tr></thead>
    <tbody>${modelRows || '<tr><td colspan="7" class="dim">暂无数据</td></tr>'}</tbody></table>
  </div>
  <div class="card"><h2>Key / 分组消耗</h2>
    <table><thead><tr><th>Key</th><th class="num">请求</th><th class="num">输入</th><th class="num">输出</th><th class="num">费用</th></tr></thead>
    <tbody>${keyRows || '<tr><td colspan="5" class="dim">暂无数据</td></tr>'}</tbody></table>
    <div style="margin-top:14px;color:var(--dim);font-size:12px;line-height:1.9">
      额度换算：<code>1 ${sym} = ${nf(st?.quotaPerUnit || 500000)} quota</code><br>
      单次价格 = 日志 quota ÷ ${nf(st?.quotaPerUnit || 500000)}，与站点账单一致。
    </div>
  </div>
</div>

<div class="card"><h2>最近请求</h2>
  <table><thead><tr><th>时间</th><th>模型</th><th>Key</th><th class="num">输入</th><th class="num">输出</th><th class="num">耗时</th><th class="num">费用</th></tr></thead>
  <tbody>${recentRows || '<tr><td colspan="7" class="dim">暂无数据</td></tr>'}</tbody></table>
</div>

<footer>
  数据源：88API 只读接口 <code>/api/log/self</code>（消费明细）与 <code>/api/user/self</code>（余额），本地落盘 <code>logs.jsonl</code>；<br>
  站点日志保留 ${st?.retentionDays || '?'} 天，本地记录自首次同步起长期保存；费用按站点 quota 口径换算，最终以官方账单为准；<br>
  「日志累计」与「累计消费」若有差额，通常来自失败请求退款：日志仍留在明细里，钱包已扣回。
</footer>
</div></body></html>`;
}

export function writeAll(storeDir, rows, st, meta, { html = true, refreshSec = 15 } = {}) {
  const agg = aggregate(rows, st);
  fs.mkdirSync(storeDir, { recursive: true });
  fs.writeFileSync(path.join(storeDir, 'snapshot.json'), JSON.stringify({
    updatedAt: meta.updatedAt, totalRows: meta.totalRows, account: meta.account, settings: st,
    total: agg.total, today: agg.today, models: agg.models, keys: agg.keys, days: agg.days,
  }, null, 2));
  if (html) fs.writeFileSync(path.join(storeDir, '..', 'dashboard.html'), renderHTML(agg, st, meta, { refreshSec }));
  return agg;
}
