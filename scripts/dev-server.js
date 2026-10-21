import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { bootPath, idFromSlug, normalizeProduct } from '../lib/catalog.js';
import { bootMeta, fillHead, homeMeta } from '../lib/meta.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4173);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function demoSource() {
  const file = '/tmp/redesign/prototype/data.js';
  if (!existsSync(file)) return null;
  return readFileSync(file, 'utf8') + `
    window.__DBS_DEMO__ = (window.BOOTS || []).map(p => ({
      ...p,
      description: p.notes,
      created_at: p.is_new ? new Date(Date.now() - 864e5 * 2).toISOString() : '2025-01-01T00:00:00Z',
      updated_at: p.status === 'sold' ? new Date(Date.now() - 864e5 * 4).toISOString() : '2025-06-01T00:00:00Z',
      sold_at: p.status === 'sold' ? new Date(Date.now() - 864e5 * 4).toISOString() : null
    }));
  `;
}
function demoProducts() {
  const src = demoSource();
  if (!src) return [];
  const context = vm.createContext({ window: {}, console });
  vm.runInContext(src, context, { filename: 'demo-boots.js' });
  return (context.window.__DBS_DEMO__ || []).map(normalizeProduct);
}
function hasDemo(req) {
  return /(?:^|; )dbs_demo=1(?:;|$)/.test(req.headers.cookie || '');
}
function withDemo(html) {
  if (html.includes('/demo-boots.js')) return html;
  return html.replace(
    '<script type="module" src="/site.js"></script>',
    '<script src="/demo-boots.js"></script>\n<script type="module" src="/site.js"></script>'
  );
}
function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}
function safeFile(urlPath) {
  const path = decodeURIComponent(urlPath.split('?')[0]);
  const file = normalize(join(root, path));
  if (!file.startsWith(root)) return null;
  return file;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    if (url.searchParams.get('demo') === '1') {
      res.writeHead(302, { Location: url.pathname, 'Set-Cookie': 'dbs_demo=1; Path=/; SameSite=Lax' });
      return res.end();
    }
    if (url.pathname === '/demo-boots.js') {
      if (!hasDemo(req)) return send(res, 404, 'not found');
      const src = demoSource();
      if (!src) return send(res, 404, 'no demo');
      return send(res, 200, src, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    }
    const boot = url.pathname.match(/^\/boot\/([^/]+)\/?$/);
    if (boot || url.pathname === '/sitemap.xml' || url.pathname === '/img' || url.pathname.startsWith('/api/')) {
      if (hasDemo(req) && (boot || url.pathname === '/sitemap.xml')) {
        const products = demoProducts();
        if (boot) {
          const id = idFromSlug(decodeURIComponent(boot[1]));
          const product = products.find(p => p.id === id);
          const shell = readFileSync(join(root, 'index.html'), 'utf8');
          if (!product) return send(res, 404, withDemo(fillHead(shell, { ...homeMeta(), route: 'boot', robots: 'noindex', title: "That pair isn't listed | Dan's Boot Sale" })), { 'Content-Type': 'text/html; charset=utf-8' });
          const canonical = bootPath(product).slice('/boot/'.length);
          if (decodeURIComponent(boot[1]) !== canonical) {
            res.writeHead(301, { Location: bootPath(product) });
            return res.end();
          }
          return send(res, 200, withDemo(fillHead(shell, bootMeta(product))), { 'Content-Type': 'text/html; charset=utf-8' });
        }
        const locs = products.filter(p => p.status === 'published' || p.status === 'sold').map(p => 'https://www.dansbootsale.com' + bootPath(p));
        return send(res, 200, `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map(u => `<url><loc>${u}</loc></url>`).join('')}</urlset>`, { 'Content-Type': 'application/xml' });
      }
      let target = url.pathname;
      if (boot) target = `/api/boot?slug=${encodeURIComponent(boot[1])}`;
      if (url.pathname === '/sitemap.xml') target = '/api/sitemap';
      if (url.pathname === '/img') target = '/api/img' + url.search;
      const name = target.startsWith('/api/') ? target.split('?')[0].slice(5) : '';
      const mod = await import(`../api/${name}.js`);
      const wrapped = new Proxy(req, { get(t, prop) { return prop === 'url' ? target : t[prop]; } });
      return await mod.default(wrapped, res);
    }
    let path = url.pathname;
    if (path === '/boot-search' || path === '/boot-search/') path = '/eBayBootSearch/index.html';
    else if (path.startsWith('/boot-search/')) path = '/eBayBootSearch/' + path.slice('/boot-search/'.length);
    else if (path === '/eBayBootSearch' || path === '/eBayBootSearch/') {
      res.writeHead(302, { Location: '/boot-search' });
      return res.end();
    } else if (['/how', '/privacy', '/corral', '/admin', '/wholesale', '/staff'].includes(path)) path = '/index.html';
    let file = safeFile(path);
    if (file && existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!file || !existsSync(file) || !statSync(file).isFile()) file = join(root, 'index.html');
    const ext = extname(file);
    if (ext === '.html' && hasDemo(req)) {
      return send(res, 200, withDemo(readFileSync(file, 'utf8')), { 'Content-Type': types['.html'] });
    }
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    createReadStream(file).pipe(res);
  } catch (err) {
    send(res, 500, err.stack || String(err), { 'Content-Type': 'text/plain; charset=utf-8' });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`dev server http://127.0.0.1:${port}`);
});
