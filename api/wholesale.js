import { gateFromReq, sendJson, serviceFetch } from '../lib/http.js';

const COLS = 'id,gender,brand,title,size,width,no_width,material,price,photos,women_size,women_width,status,wholesale_price,condition,updated_at';

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
  const gate = gateFromReq(req);
  if (!gate?.corral && !gate?.staff) return sendJson(res, 401, { error: 'Enter the Corral password first.' });
  try {
    const rows = await serviceFetch(`/rest/v1/products?select=${COLS}&wholesale=eq.true&status=eq.published&order=brand.asc&limit=1000`);
    return sendJson(res, 200, { products: Array.isArray(rows) ? rows : [] });
  } catch (err) {
    const code = err.code === 'NO_SERVICE_ROLE' ? 503 : 502;
    return sendJson(res, code, { error: err.code === 'NO_SERVICE_ROLE'
      ? 'Wholesale prices are locked until SUPABASE_SERVICE_ROLE_KEY is set in Vercel. See supabase/APPLY.md.'
      : err.message });
  }
}
