import { SITE, bootPath, isRecentSold, normalizeProduct, publicPool } from '../lib/catalog.js';
import { cachedPublicProducts } from '../lib/http.js';

export default async function handler(req, res) {
  const locs = [`${SITE}/`, `${SITE}/how`, `${SITE}/privacy`, `${SITE}/boot-search`];
  try {
    const now = Date.now();
    const products = publicPool((await cachedPublicProducts()).map(normalizeProduct))
      .filter(p => p.status === 'published' || isRecentSold(p, now));
    for (const p of products) locs.push(SITE + bootPath(p));
  } catch {
    /* homepage links still ship if the catalog is unreachable */
  }
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
    locs.map(u => `  <url><loc>${u.replace(/&/g, '&amp;')}</loc></url>`).join('\n')
  }\n</urlset>\n`;
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=600');
  res.end(body);
}
