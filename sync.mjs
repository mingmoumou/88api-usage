// 88api-usage/sync.mjs
// 从 88API（new-api 内核）后台拉取消费日志，落盘为 JSONL。
// 只读：使用站点「访问令牌」(Authorization: Bearer)，不碰 API Key，不产生费用。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const BASE = (process.env.API88_BASE || 'https://88api.ai').replace(/\/$/, '');
const TOKEN_FILE = path.join(os.homedir(), '.88api', 'video-studio.json');

export function loadAuth() {
  let token = String(process.env.API88_ACCESS_TOKEN || '').trim();
  let userId = String(process.env.API88_USER_ID || '').trim();
  if (!token && fs.existsSync(TOKEN_FILE)) {
    const cfg = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    token = String(cfg.accessToken || '').trim();
    userId = userId || String(cfg.userId || '').trim();
  }
  if (!token) throw new Error('缺少 88API 访问令牌：请设置 API88_ACCESS_TOKEN，或在 ~/.88api/video-studio.json 中配置 accessToken');
  return { token, userId, headers: { Authorization: 'Bearer ' + token, 'New-API-User': userId, 'Content-Type': 'application/json' } };
}

export async function getJSON(pathname, { headers, timeout = 20000 } = {}) {
  const res = await fetch(BASE + pathname, { headers, signal: AbortSignal.timeout(timeout) });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`HTTP ${res.status} 非 JSON 响应: ${text.slice(0, 200)}`); }
  if (!res.ok || json.success === false) throw new Error(`HTTP ${res.status} ${json.message || json.code || ''}`.trim());
  return json;
}

/** 站点计费参数：额度换算成货币金额 */
export async function loadSettings(headers) {
  const s = await getJSON('/api/status', { headers });
  const d = s.data || {};
  return {
    quotaPerUnit: Number(d.quota_per_unit) || 500000,
    displayInCurrency: !!d.display_in_currency,
    symbol: d.quota_display_type === 'CNY' ? '¥' : (d.custom_currency_symbol || '$'),
    price: Number(d.price) || 1,
    exchangeRate: Number(d.usd_exchange_rate) || 1,
    retentionDays: Number(d.log_max_range_days) || 0,
    version: d.version || '',
    systemName: d.system_name || '88API',
  };
}

/** 账户余额（与站点「钱包」页一致） */
export async function loadAccount(headers) {
  const j = await getJSON('/api/user/self', { headers });
  const u = j.data || {};
  return { id: u.id, username: u.username, quota: Number(u.quota) || 0, usedQuota: Number(u.used_quota) || 0, requestCount: Number(u.request_count) || 0, group: u.group || '' };
}

/**
 * 增量拉取消费日志。
 * @param sinceTs 只取 created_at >= sinceTs 的记录（0 = 全量）
 */
export async function fetchConsumption(headers, sinceTs = 0, { pageSize = 100, maxPages = 400, onPage } = {}) {
  // 注意：该站点的 p 是「页码」，从 1 开始（offset = (p-1)*page_size），
  // p=0 与 p=1 都返回第一页——所以必须从 1 开始，并按 id 在本次抓取内去重。
  const all = [];
  const seen = new Set();
  for (let p = 1; p <= maxPages; p++) {
    const q = new URLSearchParams({ p: String(p), page_size: String(pageSize), type: '2' });
    if (sinceTs > 0) q.set('start_timestamp', String(sinceTs));
    const j = await getJSON('/api/log/self?' + q.toString(), { headers });
    const items = j.data?.items || [];
    const total = Number(j.data?.total) || 0;
    let added = 0;
    for (const it of items) {
      const key = it.request_id || it.id;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(normalizeLog(it));
      added++;
    }
    onPage?.(p - 1, items.length, total, all.length);
    if (!items.length || items.length < pageSize || all.length >= total || added === 0) break;
  }
  return all;
}

export function normalizeLog(it) {
  let other = {};
  try { other = JSON.parse(it.other || '{}'); } catch { /* 保持空对象 */ }
  return {
    id: it.id,
    ts: it.created_at,
    model: it.model_name || '(unknown)',
    quota: Number(it.quota) || 0,
    promptTokens: Number(it.prompt_tokens) || 0,
    completionTokens: Number(it.completion_tokens) || 0,
    cacheTokens: Number(other.cache_tokens) || 0,
    cacheCreationTokens: Number(other.cache_creation_tokens) || 0,
    useTime: Number(it.use_time) || 0,
    stream: !!it.is_stream,
    channel: it.channel,
    keyName: it.token_name || '',
    keyId: it.token_id,
    group: it.group || '',
    requestId: it.request_id || '',
    path: (other.request_conversion || []).join(',') || other.request_path || '',
    billingUnit: other.billing_unit || 'token',
    modelPrice: Number(other.model_price) || 0,
    groupRatio: Number(other.group_ratio) || 0,
  };
}

/** 读取本地日志（去重后按时间升序） */
export function loadStore(file) {
  if (!fs.existsSync(file)) return [];
  const seen = new Set();
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const s = line.trim();
    if (!s) continue;
    let row; try { row = JSON.parse(s); } catch { continue; }
    const key = row.requestId || row.id;
    if (seen.has(key)) continue;
    seen.add(key); out.push(row);
  }
  return out.sort((a, b) => a.ts - b.ts);
}

export function appendStore(file, rows) {
  if (!rows.length) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
}

/**
 * 一轮同步：全量首次 / 增量之后。
 * 返回 { added, total, account, settings }
 */
export async function syncOnce({ storeDir, overlapSeconds = 300, log = () => {} }) {
  const auth = loadAuth();
  const headers = auth.headers;
  const logFile = path.join(storeDir, 'logs.jsonl');
  const stateFile = path.join(storeDir, 'state.json');

  const existing = loadStore(logFile);
  const known = new Set(existing.map(r => r.requestId || r.id));
  const lastTs = existing.length ? existing[existing.length - 1].ts : 0;
  const since = existing.length ? Math.max(0, lastTs - overlapSeconds) : 0;

  const fetched = await fetchConsumption(headers, since, {
    onPage: (p, n, total, got) => log(`  第 ${p + 1} 页: ${n} 条 (累计 ${got}/${total})`),
  });
  const fresh = fetched.filter(r => !known.has(r.requestId || r.id));
  appendStore(logFile, fresh);

  const [settings, account] = await Promise.all([loadSettings(headers), loadAccount(headers)]);
  const all = existing.concat(fresh).sort((a, b) => a.ts - b.ts);
  const state = {
    updatedAt: new Date().toISOString(),
    since: lastTs,
    totalRows: all.length,
    newestTs: all.length ? all[all.length - 1].ts : 0,
    oldestTs: all.length ? all[0].ts : 0,
    account,
    settings,
  };
  fs.mkdirSync(storeDir, { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  return { added: fresh.length, total: all.length, account, settings, rows: all };
}
