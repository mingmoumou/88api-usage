// apimart.mjs — APIMart 数据源（OpenAI 兼容网关）
// 只读：用 API Key 查余额 + 用量聚合，不产生费用。
// 与 88api 的差异：不提供逐条消费日志，只有「按模型 / 按天」聚合；余额单位是 credits（1 credit = 0.1 USD）。
export const APIMART_BASE = (process.env.APIAPIMART_BASE || 'https://api.apimart.ai').replace(/\/$/, '');

async function apimartJSON(pathname, apiKey) {
  const res = await fetch(APIMART_BASE + pathname, {
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`HTTP ${res.status} 非 JSON: ${text.slice(0, 200)}`); }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${json.error?.message || json.message || ''}`.trim());
  return json;
}

/** 余额：GET /v1/user/balance → remain_credits / used_credits */
export async function fetchApimartBalance(apiKey) {
  const j = await apimartJSON('/v1/user/balance', apiKey);
  if (j.success === false) throw new Error('余额查询失败：' + (j.message || 'record not found'));
  return {
    remainBalance: Number(j.remain_balance) || 0,
    remainCredits: Number(j.remain_credits) || 0,
    usedBalance: Number(j.used_balance) || 0,
    usedCredits: Number(j.used_credits) || 0,
  };
}

/** 用量：GET /v1/usage，按模型/天/总量聚合 */
export async function fetchApimartUsage(apiKey, { start, end, groupBy, scope = 'key' } = {}) {
  const q = new URLSearchParams();
  if (start != null) q.set('start', String(start));
  if (end != null) q.set('end', String(end));
  if (groupBy) q.set('group_by', groupBy);
  q.set('scope', scope);
  const j = await apimartJSON('/v1/usage?' + q.toString(), apiKey);
  if (j.success === false) throw new Error('用量查询失败：' + (j.error?.message || j.message || ''));
  const d = j.data || {};
  return {
    total: d.total || { amount_usd: 0, credits: 0, requests: 0, prompt_tokens: 0, completion_tokens: 0 },
    items: d.items || [],
  };
}

// 东八区今天 0 点的 Unix 秒
function dayStartShanghai(nowSec) {
  const d = new Date((nowSec + 8 * 3600) * 1000);
  const ymd = d.toISOString().slice(0, 10);
  return Math.floor(new Date(ymd + 'T00:00:00+08:00').getTime() / 1000);
}

function sum(items, key) {
  return items.reduce((a, m) => a + (Number(m[key]) || 0), 0);
}

function buildDaily(items, weekAgo, now) {
  const map = {};
  for (const it of items) map[it.date] = Number(it.credits) || 0;
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date((now - i * 86400 + 8 * 3600) * 1000).toISOString().slice(0, 10);
    out.push(map[d] || 0);
  }
  return out;
}

/** 拉全部，转成与 88api 相同的 lastGood 格式（site 字段区分） */
export async function pullApimart(apiKey) {
  const bal = await fetchApimartBalance(apiKey);
  const now = Math.floor(Date.now() / 1000);
  const dayStart = dayStartShanghai(now);
  const monthAgo = now - 31 * 86400;
  const weekAgo = now - 7 * 86400;

  const [todayU, modelU, todayModelU, dayU] = await Promise.all([
    fetchApimartUsage(apiKey, { start: dayStart, end: now, groupBy: 'none' }),
    fetchApimartUsage(apiKey, { start: monthAgo, end: now, groupBy: 'model' }),
    fetchApimartUsage(apiKey, { start: dayStart, end: now, groupBy: 'model' }),
    fetchApimartUsage(apiKey, { start: weekAgo, end: now, groupBy: 'date' }),
  ]);

  const t = todayU.total;
  const mkModel = (m) => ({ model: m.model, requests: Number(m.requests) || 0, quota: Number(m.credits) || 0 });

  return {
    site: 'apimart',
    ok: true,
    settings: { quotaPerUnit: 1, symbol: 'C', price: 1, exchangeRate: 1, displayInCurrency: false, retentionDays: 0, version: '', systemName: 'APIMart' },
    account: { quota: bal.remainCredits, usedQuota: bal.usedCredits, username: '' },
    updatedAt: new Date().toISOString(),
    today: { requests: Number(t.requests) || 0, prompt: Number(t.prompt_tokens) || 0, completion: Number(t.completion_tokens) || 0, cache: 0, quota: Number(t.credits) || 0 },
    total: {
      requests: sum(modelU.items, 'requests'),
      prompt: sum(modelU.items, 'prompt_tokens'),
      completion: sum(modelU.items, 'completion_tokens'),
      cache: 0,
      quota: sum(modelU.items, 'credits'),
    },
    models: modelU.items.map(mkModel).slice(0, 4),
    modelsToday: todayModelU.items.map(mkModel).slice(0, 3),
    daily: buildDaily(dayU.items, weekAgo, now),
    hourly: [],
    rows: 0,
    added: 0,
  };
}
