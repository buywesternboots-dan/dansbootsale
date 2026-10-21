import { gateFromReq, readJson, sameOrigin, sendJson, serviceFetch } from '../lib/http.js';
import { SB_URL } from '../lib/catalog.js';
import { safeRecord } from '../lib/csv-import.js';

function staffRecord(input) {
  const src = input || {};
  const photos = Array.isArray(src.photos) ? src.photos.filter(u => /^https:\/\//.test(u)).slice(0, 30) : [];
  const ws = Number(src.wholesale_price);
  const wholesale_price = Number.isFinite(ws) && ws > 0 ? Math.round(ws * 100) / 100 : null;
  const size = src.size == null || src.size === '' ? null : Number(src.size);
  const record = safeRecord({
    gender: src.gender === 'W' || src.gender === 'M' ? src.gender : null,
    brand: String(src.brand || '').slice(0, 120) || null,
    title: String(src.title || '').slice(0, 300) || null,
    size: Number.isFinite(size) ? size : null,
    width: String(src.width || '').slice(0, 20),
    no_width: !!src.no_width,
    material: String(src.material || '').slice(0, 120) || null,
    price: null,
    notes: String(src.notes || '').slice(0, 8000) || null,
    photos,
    women_size: null,
    women_width: null,
    suggest: [],
    missing: [],
    status: 'draft',
    wholesale: true,
    wholesale_price
  });
  record.condition = [1, 2, 3, 4, 5].includes(Number(src.condition)) ? Number(src.condition) : null;
  return record;
}

export default async function handler(req, res) {
  if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Bad origin' });
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  const gate = gateFromReq(req);
  if (!gate?.staff) return sendJson(res, 401, { error: 'Enter the staff password first.' });
  const body = await readJson(req);
  try {
    if (body.action === 'list') {
      const rows = await serviceFetch('/rest/v1/products?select=id,gender,brand,title,size,width,no_width,material,notes,photos,wholesale_price,condition,status,wholesale,updated_at,created_at&status=eq.draft&wholesale=eq.true&order=updated_at.desc&limit=500');
      return sendJson(res, 200, { products: rows || [] });
    }
    if (body.action === 'save') {
      const record = staffRecord(body.record);
      record.updated_at = new Date().toISOString();
      const id = Number(body.id);
      if (Number.isFinite(id) && id > 0) {
        const rows = await serviceFetch(`/rest/v1/products?id=eq.${Number(body.id)}&status=eq.draft&wholesale=eq.true`, {
          method: 'PATCH',
          body: record
        });
        return sendJson(res, 200, { ok: true, rows });
      }
      const rows = await serviceFetch('/rest/v1/products', { method: 'POST', body: record });
      return sendJson(res, 200, { ok: true, rows });
    }
    if (body.action === 'signUpload') {
      const name = String(body.filename || 'photo.jpg').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
      const path = `staff/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${name}`;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const base = process.env.SUPABASE_URL || SB_URL;
      if (!key) {
        return sendJson(res, 503, { error: 'Photo upload needs SUPABASE_SERVICE_ROLE_KEY in Vercel. See supabase/APPLY.md.' });
      }
      const sign = await fetch(`${base}/storage/v1/object/upload/sign/wholesale-photos/${path}`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: '{}'
      });
      const data = await sign.json().catch(() => ({}));
      if (!sign.ok) return sendJson(res, 502, { error: data.message || data.error || 'Could not start the upload.' });
      const signedUrl = new URL(data.url, `${base}/storage/v1`).toString();
      const publicUrl = `${base}/storage/v1/object/public/wholesale-photos/${path}`;
      return sendJson(res, 200, { signedUrl, publicUrl, path });
    }
    return sendJson(res, 400, { error: 'Unknown action' });
  } catch (err) {
    const code = err.code === 'NO_SERVICE_ROLE' ? 503 : 502;
    return sendJson(res, code, { error: err.code === 'NO_SERVICE_ROLE'
      ? 'Staff tools need SUPABASE_SERVICE_ROLE_KEY in Vercel. See supabase/APPLY.md.'
      : err.message });
  }
}
