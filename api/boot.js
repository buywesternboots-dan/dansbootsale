import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootPath, idFromSlug, normalizeProduct } from '../lib/catalog.js';
import { cachedPublicProducts, queryOf } from '../lib/http.js';
import { bootMeta, fillHead, homeMeta } from '../lib/meta.js';

function shell() {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const p of [join(here, '..', 'index.html'), join(process.cwd(), 'index.html')]) {
    try { return readFileSync(p, 'utf8'); } catch { /* try the next path */ }
  }
  return '<!doctype html><title>Dan\'s Boot Sale</title><p>Missing index.html</p>';
}

function html(res, status, body, cache) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.end(body);
}

export default async function handler(req, res) {
  const slug = String(queryOf(req).slug || '');
  const page = shell();
  const id = idFromSlug(slug);
  let products = [];
  try {
    products = (await cachedPublicProducts()).map(normalizeProduct);
  } catch {
    products = [];
  }
  const product = products.find(p => p.id === id);
  if (!product) {
    const meta = homeMeta();
    meta.route = 'boot';
    meta.robots = 'noindex';
    meta.title = "That pair isn't listed | Dan's Boot Sale";
    meta.description = 'This boot is not on the public list. Text Dan if you had a link to it.';
    return html(res, 404, fillHead(page, meta), 'no-store');
  }
  const canonicalSlug = bootPath(product).slice('/boot/'.length);
  if (slug !== canonicalSlug) {
    res.statusCode = 301;
    res.setHeader('Location', bootPath(product));
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.end();
  }
  return html(res, 200, fillHead(page, bootMeta(product)), 'public, s-maxage=300, stale-while-revalidate=86400');
}
