import crypto from 'node:crypto';
import { SB_URL, SB_KEY, PUBLIC_COLUMNS, allowedImageUrl } from './catalog.js';

export function sbHeaders(key = SB_KEY) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: 'application/json',
    'Content-Type': 'application/json'
  };
}

/* Load the public catalog. Prefers the security-definer RPC (post-migration).
   Falls back to an explicit column list that excludes sku, notes, wholesale_price, and cost
   so a pre-migration deploy still renders. That fallback cannot see the description text. */
export async function loadPublicProducts({ url = SB_URL, key = SB_KEY, fetchImpl = fetch } = {}) {
  const headers = sbHeaders(key);
  try {
    const rpc = await fetchImpl(`${url}/rest/v1/rpc/public_catalog`, { method: 'POST', headers, body: '{}' });
    if (rpc.ok) {
      const data = await rpc.json();
      if (Array.isArray(data)) return { products: data, source: 'rpc' };
    }
  } catch {
    /* network or DNS; caller handles an empty list */
  }
  const select = PUBLIC_COLUMNS.join(',');
  try {
    const res = await fetchImpl(
      `${url}/rest/v1/products?select=${select}&status=in.(published,sold)&price=gt.0&limit=1000`,
      { headers }
    );
    if (!res.ok) return { products: [], source: 'error', status: res.status };
    const data = await res.json();
    return { products: Array.isArray(data) ? data : [], source: 'table' };
  } catch (err) {
    return { products: [], source: 'error', error: String(err && err.message || err) };
  }
}

export async function readJson(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string' && req.body) {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; }
}

export function sameOrigin(req) {
  const origin = req.headers.origin || req.headers.Origin;
  if (!origin) return true;
  const host = req.headers.host || req.headers.Host || '';
  try { return new URL(origin).host === host; } catch { return false; }
}

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For'] || '';
  return String(fwd).split(',')[0].trim() || req.socket?.remoteAddress || 'local';
}

const hits = new Map();
export function rateLimit(ip, limit = 8, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const row = hits.get(ip) || [];
  const fresh = row.filter(t => now - t < windowMs);
  if (fresh.length >= limit) {
    hits.set(ip, fresh);
    return false;
  }
  fresh.push(now);
  hits.set(ip, fresh);
  return true;
}

export function passwordsEqual(input, expected) {
  const ha = crypto.createHash('sha256').update(String(input), 'utf8').digest();
  const hb = crypto.createHash('sha256').update(String(expected), 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

function sessionSecret() {
  return process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

export function signGate(payload) {
  const secret = sessionSecret();
  if (!secret) return null;
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function readGate(token) {
  const secret = sessionSecret();
  if (!secret || !token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expect = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!data || typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

export function gateFromReq(req) {
  const raw = req.headers.cookie || req.headers.Cookie || '';
  const m = String(raw).match(/(?:^|;\s*)dbs_gate=([^;]+)/);
  return readGate(m ? decodeURIComponent(m[1]) : '');
}

export function gateCookie(payload, req) {
  const token = signGate(payload);
  if (!token) return null;
  const host = String(req?.headers?.host || '');
  const secure = process.env.VERCEL || host.endsWith('dansbootsale.com') ? '; Secure' : '';
  return `dbs_gate=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${secure}`;
}

export function clearGateCookie(req) {
  const host = String(req?.headers?.host || '');
  const secure = process.env.VERCEL || host.endsWith('dansbootsale.com') ? '; Secure' : '';
  return `dbs_gate=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

export async function serviceFetch(path, { method = 'GET', body } = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.SUPABASE_URL || SB_URL;
  if (!key) {
    const err = new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
    err.code = 'NO_SERVICE_ROLE';
    throw err;
  }
  const res = await fetch(`${url}${path}`, {
    method,
    headers: { ...sbHeaders(key), Prefer: 'return=representation' },
    body: body == null ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const err = new Error(typeof data === 'object' && data && data.message ? data.message : `Supabase ${res.status}`);
    err.status = res.status;
    err.detail = data;
    throw err;
  }
  return data;
}

export function sendJson(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

export function queryOf(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  try {
    const u = new URL(req.url || '/', 'http://localhost');
    return Object.fromEntries(u.searchParams);
  } catch {
    return {};
  }
}

let catalogCache = { at: 0, products: [] };
export async function cachedPublicProducts() {
  if (catalogCache.products.length && Date.now() - catalogCache.at < 60_000) return catalogCache.products;
  const { products } = await loadPublicProducts();
  catalogCache = { at: Date.now(), products: products || [] };
  return catalogCache.products;
}

export { allowedImageUrl };
