import { renderThumb } from '../lib/image.js';
import { queryOf } from '../lib/http.js';

export default async function handler(req, res) {
  try {
    const q = queryOf(req);
    const buf = await renderThumb(q.u || q.url || '', q.w);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=604800, s-maxage=2592000');
    res.end(buf);
  } catch (err) {
    res.statusCode = err.status || 502;
    res.setHeader('Cache-Control', 'no-store');
    res.end(err.message || 'image error');
  }
}
