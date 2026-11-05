// Local preview server that mimics vercel.json: static files, SPA rewrites, and /boot/* -> api/listing.js.
// Usage: node scripts/dev-server.js [port]   (set DBS_DEMO_JSON=path to test link previews offline)
// Live results (/api/boots):
//   default            no keys are used, even if EBAY_CLIENT_ID/SECRET are in this shell, so the page
//                      uses the link builder exactly as before and nothing ever reaches eBay.
//   DUSTY_MOCK_EBAY=1  fake eBay data from tests/fixtures/browse-mock.js (never contacts eBay).
//   DUSTY_LIVE_EBAY=1  real Browse API with this shell's env vars. Only with the owner's OK: it spends
//                      real calls from the daily limit.
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), url = require('url');
const ROOT = path.join(__dirname, '..');
const PORT = +process.argv[2] || 8080;
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const listingPath = path.join(ROOT, 'api', 'listing.js');
const listing = fs.existsSync(listingPath) ? require(listingPath) : null;
const boots = (() => {
  const { createHandler } = require(path.join(ROOT, 'api', 'boots.js'));
  if (process.env.DUSTY_MOCK_EBAY !== '1') {
    if (process.env.DUSTY_LIVE_EBAY === '1') { console.log('/api/boots: REAL eBay Browse API (DUSTY_LIVE_EBAY=1)'); return createHandler(); }
    return createHandler({ env: {} });   // no keys -> { live: false }, link builder only
  }
  const { createMockFetch } = require(path.join(ROOT, 'tests', 'fixtures', 'browse-mock.js'));
  console.log('/api/boots: MOCK eBay data (no real eBay calls)');
  return createHandler({ fetch: createMockFetch(), env: { EBAY_CLIENT_ID: 'mock-id', EBAY_CLIENT_SECRET: 'mock-secret',
    EPN_ENABLED: process.env.EPN_ENABLED || 'false', EPN_CAMPAIGN_ID: process.env.EPN_CAMPAIGN_ID || '',
    CONNECTED_SELLERS: process.env.CONNECTED_SELLERS || '', CONNECTED_SELLERS_MODE: process.env.CONNECTED_SELLERS_MODE || '' } });
})();
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json' };
function toRegex(src) { return new RegExp('^' + src.replace(/:(\w+)\*/g, '(?<$1>.*)').replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'); }
const redirects = (cfg.redirects || []).map(r => ({ re: toRegex(r.source), dest: r.destination, code: r.statusCode || (r.permanent ? 308 : 307) }));
const rewrites = cfg.rewrites.map(r => ({ re: toRegex(r.source), dest: r.destination }));
function applyCfgHeaders(res, pathname) {
  for (const rule of cfg.headers || []) {
    if (!toRegex(rule.source).test(pathname)) continue;
    for (const h of rule.headers) res.setHeader(h.key, h.value);
  }
}
function sendFile(res, file, status, reqPath) {
  if (reqPath) applyCfgHeaders(res, reqPath);
  fs.readFile(file, (err, buf) => {
    if (err) { res.statusCode = 404; res.setHeader('Content-Type', 'text/plain'); return res.end('404 Not Found'); }
    res.statusCode = status || 200; res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream'); res.end(buf);
  });
}
http.createServer((req, res) => {
  const u = url.parse(req.url, true); let p = decodeURIComponent(u.pathname);
  if (p.includes('..')) { res.statusCode = 400; return res.end(); }
  if (p === '/api/boots') { applyCfgHeaders(res, p); return boots(req, res); }
  for (const r of redirects) if (r.re.test(p)) { res.statusCode = r.code; res.setHeader('Location', r.dest + (u.search || '')); return res.end(); }
  const file = path.join(ROOT, p === '/' ? 'index.html' : p);
  if (p !== '/' && fs.existsSync(file) && fs.statSync(file).isFile()) return sendFile(res, file, 200, p);
  if (p === '/') return sendFile(res, path.join(ROOT, 'index.html'), 200, p);
  // Vercel serves folder/index.html for /folder and /folder/ (cleanUrls)
  const idx = path.join(ROOT, p, 'index.html');
  if (fs.existsSync(idx)) return sendFile(res, idx, 200, p);
  for (const r of rewrites) {
    const m = p.match(r.re); if (!m) continue;
    let dest = r.dest; for (const [k, v] of Object.entries(m.groups || {})) dest = dest.replace(':' + k, encodeURIComponent(v));
    if (dest.startsWith('/api/listing')) {
      if (!listing) { res.statusCode = 404; res.setHeader('Content-Type', 'text/plain'); return res.end('404 Not Found'); }
      req.query = url.parse(dest, true).query; return listing(req, res);
    }
    return sendFile(res, path.join(ROOT, dest), 200, p);
  }
  res.statusCode = 404; res.setHeader('Content-Type', 'text/plain'); res.end('404 Not Found');
}).listen(PORT, () => console.log('Dan\'s Boot Sale preview on http://localhost:' + PORT));
