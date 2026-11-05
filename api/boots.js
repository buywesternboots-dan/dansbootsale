// Vercel Serverless Function: GET /api/boots?<share query>&page=&western=&r_size=…
// Live western-boot results for Dusty's Boot Finder from the Browse API, trimmed to what the
// result cards show. GET /api/boots?status=1 tells the page whether live results are set up
// (no eBay call), including the ONE affiliate switch (affiliate: true only when EPN_ENABLED=true and a
// 10-digit EPN_CAMPAIGN_ID are set here on the server). GET /api/boots?ids=v1|1|0,v1|2|0 re-fetches
// saved item IDs live (max 24), so browsers never store listing data. Any problem returns { fallback: true, reason } and the page falls back to the
// link builder. Secrets come from env vars only (see README) and are never returned or logged.
'use strict';
const { createBrowseService } = require('./_lib/browse.js');

function createHandler(opts) {
  const svc = createBrowseService(opts);
  const handler = async function (req, res) {
    const qs = (req.url || '').split('?')[1] || '';
    const p = new URLSearchParams(qs);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405; res.setHeader('Allow', 'GET'); return res.end('{"error":"method not allowed"}');
    }
    if (p.get('status') === '1') {
      res.setHeader('Cache-Control', 'public, s-maxage=60');
      return res.end(JSON.stringify(svc.status()));
    }
    let out;
    try { out = p.has('ids') ? await svc.items(String(p.get('ids')).split(',')) : await svc.search(qs); } catch (e) { out = { fallback: true, reason: 'live results are unavailable right now' }; }
    if (out.fallback) res.setHeader('Cache-Control', 'public, s-maxage=60');
    else {
      // CDN copy never outlives the in-memory TTL by more than one more TTL (well under 6 h).
      const age = Math.max(0, out.maxAge | 0);
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=' + age + ', stale-while-revalidate=' + age);
    }
    res.statusCode = 200;
    res.end(JSON.stringify(out));
  };
  handler.service = svc;
  return handler;
}

const handler = createHandler();
module.exports = handler;
module.exports.createHandler = createHandler;
