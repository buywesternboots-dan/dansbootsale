import { clearGateCookie, clientIp, gateCookie, gateFromReq, passwordsEqual, rateLimit, readJson, sameOrigin, sendJson } from '../lib/http.js';

function configured() {
  return Boolean(process.env.SESSION_SECRET && (process.env.CORRAL_PASSWORD || process.env.STAFF_PASSWORD));
}

export default async function handler(req, res) {
  if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Bad origin' });
  if (req.method === 'GET') {
    const gate = gateFromReq(req) || {};
    return sendJson(res, 200, { corral: !!gate.corral, staff: !!gate.staff, configured: configured() });
  }
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  const body = await readJson(req);
  if (body.logout) {
    return sendJson(res, 200, { ok: true, corral: false, staff: false }, { 'Set-Cookie': clearGateCookie(req) });
  }
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return sendJson(res, 503, { error: 'Sign-in is not configured yet. Add SESSION_SECRET, CORRAL_PASSWORD, and STAFF_PASSWORD in Vercel. See supabase/APPLY.md.' });
  }
  const ip = clientIp(req);
  if (!rateLimit(ip)) return sendJson(res, 429, { error: 'Too many tries. Wait a few minutes and try again.' });
  const area = body.area === 'staff' ? 'staff' : body.area === 'corral' ? 'corral' : '';
  const expected = area === 'staff' ? process.env.STAFF_PASSWORD : process.env.CORRAL_PASSWORD;
  if (!area || !expected) {
    return sendJson(res, 503, { error: area === 'staff'
      ? 'Staff sign-in is not configured yet. Set STAFF_PASSWORD in Vercel. See supabase/APPLY.md.'
      : 'Corral sign-in is not configured yet. Set CORRAL_PASSWORD in Vercel. See supabase/APPLY.md.' });
  }
  if (!passwordsEqual(String(body.password || ''), expected)) {
    return sendJson(res, 401, { error: 'That password is not right.' });
  }
  const prev = gateFromReq(req) || {};
  const next = {
    corral: area === 'corral' ? true : !!prev.corral,
    staff: area === 'staff' ? true : !!prev.staff,
    exp: Date.now() + 12 * 60 * 60 * 1000
  };
  if (area === 'staff') next.corral = true;
  const cookie = gateCookie(next, req);
  if (!cookie) return sendJson(res, 503, { error: 'Could not start a session.' });
  return sendJson(res, 200, { ok: true, corral: next.corral, staff: next.staff }, { 'Set-Cookie': cookie });
}
