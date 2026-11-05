// Unit tests for the live-results function (api/boots.js + api/_lib/browse.js).
// Every eBay response is mocked (tests/fixtures/browse-mock.js): nothing here contacts eBay.
// Run: node --test tests/bootsearch/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const B = require(path.join(ROOT, 'api/_lib/browse.js'));
const { createHandler } = require(path.join(ROOT, 'api/boots.js'));
const { createMockFetch } = require(path.join(ROOT, 'tests/fixtures/browse-mock.js'));

const KEYS = { EBAY_CLIENT_ID: 'test-client-id', EBAY_CLIENT_SECRET: 'test-client-secret-XYZ', EBAY_ENV: 'production' };
const EPN_KEYS = ['campid', 'customid', 'mkcid', 'mkrid', 'siteid', 'toolid', 'mkevt'];
function clock(start) { let t = start || Date.parse('2026-10-21T16:00:00Z'); const f = () => t; f.add = ms => { t += ms; }; return f; }
function svc(extra = {}, mock = {}) {
  const now = clock();
  const fetch = createMockFetch(Object.assign({ now }, mock));
  const s = B.createBrowseService({ env: Object.assign({}, KEYS, extra), fetch, now });
  return { s, fetch, now };
}
const searches = f => f.calls.filter(c => c.url.includes('/item_summary/search'));
const tokens = f => f.calls.filter(c => c.url.includes('/oauth2/token'));
const sp = c => new URL(c.url).searchParams;

// Minimal res for the Vercel-style handler.
function call(handler, url) {
  return new Promise(resolve => {
    const res = { headers: {}, statusCode: 0, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(body) { resolve({ status: this.statusCode, headers: this.headers, body: String(body), json: JSON.parse(body) }); } };
    handler({ method: 'GET', url }, res);
  });
}

test('token: client_credentials with the api_scope, Basic auth, cached until 5 min before expiry', async () => {
  const { s, fetch, now } = svc();
  await s.search('');
  const t = tokens(fetch);
  assert.equal(t.length, 1);
  assert.equal(t[0].url, 'https://api.ebay.com/identity/v1/oauth2/token');
  assert.equal(t[0].method, 'POST');
  assert.equal(t[0].headers.Authorization, 'Basic ' + Buffer.from('test-client-id:test-client-secret-XYZ').toString('base64'));
  const body = new URLSearchParams(t[0].body);
  assert.equal(body.get('grant_type'), 'client_credentials');
  assert.equal(body.get('scope'), 'https://api.ebay.com/oauth/api_scope');
  // Different searches reuse the token until 5 min before its 2 h expiry.
  now.add(60 * 60e3); await s.search('maker=lucchese');
  now.add(54 * 60e3); await s.search('maker=justin');
  assert.equal(tokens(fetch).length, 1, 'still cached at 1h54m');
  now.add(2 * 60e3); await s.search('maker=nocona');
  assert.equal(tokens(fetch).length, 2, 'refreshed inside the last 5 minutes');
});

test('EBAY_ENV defaults to sandbox: unset, "sandbox" or anything but "production" use the sandbox hosts', async () => {
  for (const v of [undefined, '', 'sandbox', 'prod', 'live']) {
    const { s, fetch } = svc({ EBAY_ENV: v });
    await s.search('');
    assert.ok(fetch.calls.length >= 2);
    for (const c of fetch.calls) assert.match(c.url, /^https:\/\/api\.sandbox\.ebay\.com\//, String(v));
    assert.equal(s.status().env, 'sandbox');
  }
  assert.equal(B.hosts({}).env, 'sandbox');
  assert.equal(B.hosts({ EBAY_ENV: ' Production ' }).env, 'production');
});

/* ---------- connected sellers (FTC business-connection label) ---------- */
test('connected sellers: empty by default, nothing labelled or dropped', async () => {
  const { s } = svc();
  const r = await s.search('');
  assert.ok(r.items.length > 0);
  assert.ok(r.items.every(i => !('connected' in i)));
  assert.equal(r.excluded, undefined);
  assert.equal(B.connectedSellers({}).names.size, 0);
  assert.equal(B.connectedSellers({}).mode, 'label');
});

test('connected sellers: label mode (default) marks only those sellers, case-insensitive, junk ignored', async () => {
  const cs = B.connectedSellers({ CONNECTED_SELLERS: ' TexasLeatherCo , ,bad name!, oldwestvault', CONNECTED_SELLERS_MODE: 'nonsense' });
  assert.deepEqual([...cs.names].sort(), ['oldwestvault', 'texasleatherco']);
  assert.equal(cs.mode, 'label');
  const { s } = svc({ CONNECTED_SELLERS: 'TexasLeatherCo' });
  const r = await s.search('');
  const conn = r.items.filter(i => i.connected);
  assert.ok(conn.length > 0);
  assert.ok(conn.every(i => i.seller.name === 'texasleatherco'));
  assert.ok(r.items.filter(i => !i.connected).every(i => i.seller.name !== 'texasleatherco'));
  assert.equal(r.excluded, undefined);
});

test('connected sellers: exclude mode drops their listings from search and item lookup', async () => {
  const env = { CONNECTED_SELLERS: 'texasleatherco,oldwestvault', CONNECTED_SELLERS_MODE: 'EXCLUDE' };
  const { s } = svc(env);
  const r = await s.search('');
  assert.ok(r.items.length > 0);
  assert.ok(r.items.every(i => !['texasleatherco', 'oldwestvault'].includes(i.seller.name)));
  assert.ok(r.excluded > 0);
  // Item lookup: find IDs from both kinds of seller, then look them up in exclude mode.
  const { s: plain } = svc();
  const all = (await plain.search('')).items;
  const keep = all.find(i => i.seller.name === 'dusty_trails_boots'), drop = all.find(i => i.seller.name === 'texasleatherco');
  const look = await s.items([keep.id, drop.id]);
  assert.deepEqual(look.items.map(i => i.id), [keep.id]);
  assert.equal(look.excluded, 1);
  // Label mode on lookup marks it instead.
  const { s: lab } = svc({ CONNECTED_SELLERS: 'texasleatherco' });
  const l2 = await lab.items([keep.id, drop.id]);
  assert.deepEqual(l2.items.map(i => !!i.connected), [false, true]);
});

test('401 from Browse: refresh the token once and retry', async () => {
  let n = 0;
  const { s, fetch } = svc({}, { failSearch: () => (++n === 1 ? 401 : 0) });
  const out = await s.search('');
  assert.equal(out.fallback, undefined);
  assert.equal(tokens(fetch).length, 2);
  assert.equal(searches(fetch).length, 2);
});

test('search call: EBAY_US marketplace, Western men\'s boots by default, no affiliate header', async () => {
  const { s, fetch } = svc();
  const out = await s.search('');
  const c = searches(fetch)[0];
  assert.match(c.url, /^https:\/\/api\.ebay\.com\/buy\/browse\/v1\/item_summary\/search\?/);
  assert.equal(c.headers['X-EBAY-C-MARKETPLACE-ID'], 'EBAY_US');
  assert.match(c.headers.Authorization, /^Bearer mock-token-/);
  assert.equal('X-EBAY-C-ENDUSERCTX' in c.headers, false);
  const p = sp(c);
  assert.equal(p.get('category_ids'), '11498');
  assert.equal(p.get('aspect_filter'), 'categoryId:11498,Style:{Western}');
  assert.equal(p.get('fieldgroups'), 'ASPECT_REFINEMENTS,MATCHING_ITEMS,CONDITION_REFINEMENTS,BUYING_OPTION_REFINEMENTS');
  assert.equal(p.get('limit'), '24'); assert.equal(p.get('offset'), '0');
  assert.equal(p.get('sort'), 'newlyListed');
  assert.equal(out.western, true);
});

test('women\'s = 53557; both = two calls (11498 + 53557, never 11450), merged without duplicates', async () => {
  const w = svc(); await w.s.search('gender=womens');
  assert.equal(sp(searches(w.fetch)[0]).get('category_ids'), '53557');
  const b = svc(); const out = await b.s.search('gender=both&sort=endingSoonest');
  const cats = searches(b.fetch).map(c => sp(c).get('category_ids')).sort();
  assert.deepEqual(cats, ['11498', '53557']);
  searches(b.fetch).forEach(c => assert.equal(sp(c).get('limit'), '12'));
  assert.equal(new Set(out.items.map(i => i.id)).size, out.items.length);
  const ends = out.items.map(i => Date.parse(i.endDate));
  assert.deepEqual(ends, ends.slice().sort((a, b) => a - b), 'merged list stays ending-soonest');
});

test('western=0 drops Style:{Western}; boot category off searches keywords only', async () => {
  const a = svc(); await a.s.search('western=0');
  assert.equal(sp(searches(a.fetch)[0]).get('aspect_filter'), 'categoryId:11498');
  const b = svc(); await b.s.search('nocat=1&any=lucchese,justin');
  const p = sp(searches(b.fetch)[0]);
  assert.equal(p.has('category_ids'), false); assert.equal(p.has('aspect_filter'), false);
  assert.equal(p.get('q'), '(lucchese,justin)');
});

test('auction mode: buyingOptions:{AUCTION} + sort=endingSoonest, 5 min cache', async () => {
  const { s, fetch } = svc();
  const out = await s.search('sale=auction_only&sort=endingSoonest');
  const p = sp(searches(fetch)[0]);
  assert.match(p.get('filter'), /(^|,)buyingOptions:\{AUCTION\}(,|$)/);
  assert.equal(p.get('sort'), 'endingSoonest');
  assert.equal(out.mode, 'auction');
  assert.equal(out.maxAge, 300);
  assert.ok(out.items.every(i => i.buyingOptions.includes('AUCTION')));
});

test('filters map to Browse syntax: sizes, widths, brands, price, condition, BIN, returns, free shipping, refine picks', async () => {
  const { s, fetch } = svc();
  await s.search('maker=lucchese,tony-lama&size=10,10.5&width=D,EE&min=50&max=400&cond=Used&sale=fixed_best_offer_only&ra=1&fs=1&sort=priceLowToHigh' +
    '&r_material=Ostrich|Caiman&r_toe=Snip%20Toe&r_heel=Low%20(3/4%20to%201%201/2%20in)&r_brand=Nocona');
  const p = sp(searches(fetch)[0]);
  assert.equal(p.get('aspect_filter'), 'categoryId:11498,US Shoe Size:{10|10.5},Shoe Width:{D|EE},Brand:{Lucchese|Tony Lama|Nocona},' +
    'Upper Material:{Ostrich|Caiman},Toe Shape:{Snip Toe},Heel Height:{Low (3/4 to 1 1/2 in)},Style:{Western}');
  assert.equal(p.get('filter'), 'price:[50..400],priceCurrency:USD,conditionIds:{3000},buyingOptions:{FIXED_PRICE|BEST_OFFER},returnsAccepted:true,maxDeliveryCost:0,deliveryCountry:US');
  assert.equal(p.get('sort'), 'price');
  // r_cond (facet condition IDs) overrides the New/Used form pick
  const b = svc(); await b.s.search('cond=Used&r_cond=1000|1500');
  assert.match(sp(searches(b.fetch)[0]).get('filter'), /conditionIds:\{1000\|1500\}/);
});

test('values cannot break the filter syntax (braces/pipes stripped)', async () => {
  const { s, fetch } = svc();
  await s.search('r_material=' + encodeURIComponent('Leather},Brand:{Evil'));
  assert.equal(sp(searches(fetch)[0]).get('aspect_filter'), 'categoryId:11498,Upper Material:{Leather Brand: Evil},Style:{Western}');
});

test('pagination: page N -> offset N*24; hasMore follows next/total; offset capped at 10,000 results', async () => {
  const { s, fetch } = svc({}, { total: 60 });
  const p1 = await s.search('page=1');
  assert.equal(sp(searches(fetch)[0]).get('offset'), '24');
  assert.equal(p1.hasMore, true); assert.equal(p1.page, 1);
  const p2 = await s.search('page=2');
  assert.equal(p2.items.length, 12); assert.equal(p2.hasMore, false);
  const big = svc(); await big.s.search('page=400');
  assert.equal(sp(searches(big.fetch)[0]).get('offset'), '9600');
});

test('trimmed JSON: card fields only, itemWebUrl with tracking OFF, nothing secret', async () => {
  const { s } = svc();
  const out = await s.search('sale=auction_only');
  const it = out.items[0];
  assert.deepEqual(Object.keys(it).sort(), ['bidCount', 'buyingOptions', 'condition', 'created', 'currentBid', 'distance', 'endDate', 'id', 'image', 'location', 'paid', 'price', 'seller', 'shipping', 'title', 'url'].sort());
  assert.equal(it.url, 'https://www.ebay.com/itm/300000000000');
  assert.equal(it.paid, false); assert.equal(out.paid, false);
  assert.deepEqual(Object.keys(it.seller).sort(), ['feedbackPct', 'feedbackScore', 'name']);
  const raw = JSON.stringify(out);
  for (const k of EPN_KEYS) assert.equal(raw.includes(k + '='), false, k + ' leaked');
  assert.equal(raw.includes('test-client-secret'), false); assert.equal(raw.includes('mock-token'), false);
  assert.equal(raw.includes('itemAffiliateWebUrl'), false);
});

test('EPN stays off unless EPN_ENABLED=true AND a 10-digit EPN_CAMPAIGN_ID', async () => {
  for (const env of [{}, { EPN_CAMPAIGN_ID: '1234567890' }, { EPN_ENABLED: 'true' }, { EPN_ENABLED: 'true', EPN_CAMPAIGN_ID: '<WBW_CAMPID>' }, { EPN_ENABLED: '1', EPN_CAMPAIGN_ID: '1234567890' }]) {
    const { s, fetch } = svc(env);
    const out = await s.search('');
    assert.equal('X-EBAY-C-ENDUSERCTX' in searches(fetch)[0].headers, false, JSON.stringify(env));
    assert.equal(out.paid, false);
    out.items.forEach(i => assert.equal(new URL(i.url).searchParams.has('campid'), false));
  }
});

test('EPN on (future): header sent and itemAffiliateWebUrl used', async () => {
  const { s, fetch } = svc({ EPN_ENABLED: 'true', EPN_CAMPAIGN_ID: '1234567890', EPN_REFERENCE_PREFIX: 'dusty-test' });
  const out = await s.search('sale=auction_only');
  assert.equal(searches(fetch)[0].headers['X-EBAY-C-ENDUSERCTX'], 'affiliateCampaignId=1234567890,affiliateReferenceId=dusty-test-auction');
  assert.equal(out.paid, true);
  assert.ok(out.items.every(i => i.paid && /campid=/.test(i.url)));
});

test('cache: identical searches hit memory; auctions expire after 5 min, Buy It Now after 30 min', async () => {
  const { s, fetch, now } = svc();
  await s.search('sale=auction_only'); await s.search('sale=auction_only');
  assert.equal(searches(fetch).length, 1);
  now.add(4 * 60e3); assert.equal((await s.search('sale=auction_only')).cache, 'hit');
  now.add(61e3); assert.equal((await s.search('sale=auction_only')).cache, 'miss');
  assert.equal(searches(fetch).length, 2);
  await s.search('sale=fixed_best_offer_only');
  now.add(29 * 60e3); assert.equal((await s.search('sale=fixed_best_offer_only')).cache, 'hit');
  now.add(61e3); assert.equal((await s.search('sale=fixed_best_offer_only')).cache, 'miss');
});

test('cached copies drop listings that have ended since they were fetched', async () => {
  const now = clock();
  const base = createMockFetch({ now });
  const fetch = async (u, i) => { const r = await base(u, i); const j = await r.json();
    if (j.itemSummaries) j.itemSummaries[0].itemEndDate = new Date(now() + 2 * 60e3).toISOString();
    return { ok: r.ok, status: r.status, json: async () => j }; };
  const s = B.createBrowseService({ env: KEYS, fetch, now });
  const first = await s.search('sale=auction_only&sort=endingSoonest');
  now.add(4.5 * 60e3);
  const again = await s.search('sale=auction_only&sort=endingSoonest');
  assert.equal(again.cache, 'hit');
  assert.ok(again.items.length < first.items.length);
  assert.ok(again.items.every(i => Date.parse(i.endDate) > now()));
});

test('daily soft cap: stale copy (<6 h) when available, otherwise graceful fallback; resets the next ET day', async () => {
  const { s, fetch, now } = svc({ EBAY_DAILY_CAP: '2' });
  await s.search('maker=lucchese'); await s.search('maker=justin');
  const over = await s.search('maker=nocona');
  assert.deepEqual(over, { fallback: true, reason: 'live results are busy right now' });
  now.add(31 * 60e3);
  const stale = await s.search('maker=lucchese');
  assert.equal(stale.cache, 'stale'); assert.equal(stale.note, 'busy');
  assert.equal(searches(fetch).length, 2);
  now.add(24 * 3600e3);
  assert.equal((await s.search('maker=nocona')).cache, 'miss');
});

test('stale fallback copies are capped: 1 h for Buy It Now, 15 min for auctions, and labelled', async () => {
  let fail = false;
  const { s, now } = svc({}, { failSearch: () => (fail ? 500 : 0) });
  await s.search(''); await s.search('sale=auction_only&sort=endingSoonest');
  fail = true;
  now.add(10 * 60e3);
  const a = await s.search('sale=auction_only&sort=endingSoonest');
  assert.equal(a.cache, 'stale'); assert.equal(a.note, 'error');
  now.add(5 * 60e3 + 1);
  assert.equal((await s.search('sale=auction_only&sort=endingSoonest')).fallback, true, 'auction copy older than 15 min is never shown');
  now.add(40 * 60e3);                       // BIN copy now ~55 min old
  assert.equal((await s.search('')).cache, 'stale');
  now.add(5 * 60e3 + 1);
  assert.equal((await s.search('')).fallback, true, 'BIN copy older than 1 h is never shown');
  assert.equal(B.STALE_MAX_BIN, 3600e3); assert.equal(B.STALE_MAX_AUCTION, 15 * 60e3);
});

test('item lookup (?ids=): live re-fetch by ID, ended/removed reported, IDs validated, max 24, cached', async () => {
  const { s, fetch } = svc({}, { goneIds: ['v1|300000000003|0'] });
  const ids = ['v1|300000000001|0', 'v1|300000000003|0', 'bad id', 'v1|300000000001|0', 'javascript:alert(1)'];
  const out = await s.items(ids);
  assert.deepEqual(out.items.map(i => i.id), ['v1|300000000001|0']);
  assert.deepEqual(out.gone, ['v1|300000000003|0']);
  assert.match(out.items[0].title, /Tony Lama/);
  assert.equal(out.items[0].paid, false);
  assert.equal(out.items[0].url, 'https://www.ebay.com/itm/300000000001');
  const calls = fetch.calls.filter(c => c.url.includes('/buy/browse/v1/item/'));
  assert.equal(calls.length, 2, 'invalid and duplicate IDs never reach eBay');
  assert.equal(calls[0].headers['X-EBAY-C-ENDUSERCTX'], undefined, 'no affiliate header while tracking is off');
  await s.items(['v1|300000000001|0']);
  assert.equal(fetch.calls.filter(c => c.url.includes('/buy/browse/v1/item/')).length, 2, 'second lookup served from cache');
  const many = Array.from({ length: 40 }, (_, i) => 'v1|' + (300000000100 + i) + '|0');
  assert.equal((await s.items(many)).items.length, B.ITEM_IDS_MAX);
  const off = B.createBrowseService({ env: {}, fetch: createMockFetch() });
  assert.equal((await off.items(['v1|300000000001|0'])).fallback, true);
  const err = svc({}, { failItem: 500 });
  const e = await err.s.items(['v1|300000000001|0']);
  assert.equal(e.fallback, true); assert.equal(JSON.stringify(e).includes('internal eBay detail'), false);
});

test('item lookup with tracking ON: affiliate URL + paid flag come from the server only', async () => {
  const { s, fetch } = svc({ EPN_ENABLED: 'true', EPN_CAMPAIGN_ID: '1234567890' });
  const out = await s.items(['v1|300000000002|0']);
  assert.equal(out.paid, true); assert.equal(out.items[0].paid, true);
  const c = fetch.calls.find(x => x.url.includes('/buy/browse/v1/item/'));
  assert.equal(c.headers['X-EBAY-C-ENDUSERCTX'], 'affiliateCampaignId=1234567890,affiliateReferenceId=dusty-bootfinder-item');
});

test('no keys / non-US / sold / eBay errors -> fallback, no eBay body leaked', async () => {
  const nokeys = createMockFetch();
  const s0 = B.createBrowseService({ env: {}, fetch: nokeys });
  assert.equal((await s0.search('')).fallback, true);
  assert.equal(nokeys.calls.length, 0, 'no call without keys');
  const { s, fetch } = svc();
  assert.equal((await s.search('region=ebay.co.uk')).fallback, true);
  assert.equal((await s.search('sold=1')).fallback, true);
  assert.equal(fetch.calls.length, 0);
  for (const mock of [{ failSearch: 500 }, { failSearch: 429 }, { failToken: 401 }]) {
    const e = svc({}, mock);
    const out = await e.s.search('');
    assert.equal(out.fallback, true);
    assert.equal(JSON.stringify(out).includes('internal eBay detail') || JSON.stringify(out).includes('secret detail'), false);
  }
  const a = svc({}, { failSearch: 400 });
  assert.match((await a.s.search('sale=auction_only')).reason, /auction filter needs a boot category/);
});

test('facets: size/width/brand/material/toe/heel + condition + buying options', async () => {
  const { s } = svc();
  const out = await s.search('');
  assert.deepEqual(Object.keys(out.facets.aspects).sort(), ['brand', 'heel', 'material', 'size', 'style', 'toe', 'width']);
  assert.deepEqual(out.facets.aspects.brand[0], { value: 'Justin', count: 520 });
  assert.deepEqual(out.facets.conditions[0], { id: '3000', label: 'Pre-owned', count: 1302 });
  assert.ok(out.facets.buyingOptions.some(b => b.value === 'AUCTION'));
});

test('"as of" time is in Eastern time', () => {
  assert.equal(B.etTime(Date.parse('2026-10-21T16:05:00Z')), '12:05 PM ET');
  assert.equal(B.etTime(Date.parse('2026-12-21T16:05:00Z')), '11:05 AM ET');
});

test('handler: status probe makes no eBay call; CDN headers follow the TTL; JSON never includes secrets', async () => {
  const fetch = createMockFetch();
  const h = createHandler({ env: KEYS, fetch });
  const st = await call(h, '/api/boots?status=1');
  assert.deepEqual(st.json, { live: true, env: 'production', affiliate: false });
  assert.match(st.headers['x-robots-tag'], /noindex/);
  const on = await call(createHandler({ env: Object.assign({ EPN_ENABLED: 'true', EPN_CAMPAIGN_ID: '1234567890' }, KEYS), fetch: createMockFetch() }), '/api/boots?status=1');
  assert.deepEqual(on.json, { live: true, env: 'production', affiliate: true, profile: 'dbs' });
  const bad = await call(createHandler({ env: Object.assign({ EPN_ENABLED: 'true', EPN_CAMPAIGN_ID: 'MOCKCAMPID' }, KEYS), fetch: createMockFetch() }), '/api/boots?status=1');
  assert.equal(bad.json.affiliate, false, 'non 10-digit campaign -> switch stays off');
  const ids = await call(createHandler({ env: KEYS, fetch: createMockFetch() }), '/api/boots?ids=' + encodeURIComponent('v1|300000000001|0,v1|300000000002|0'));
  assert.equal(ids.json.items.length, 2);
  assert.match(ids.headers['cache-control'], /s-maxage=\d+/);
  assert.equal(fetch.calls.length, 0);
  const a = await call(h, '/api/boots?sale=auction_only');
  assert.equal(a.headers['cache-control'], 'public, max-age=0, s-maxage=300, stale-while-revalidate=300');
  const b = await call(h, '/api/boots?sale=fixed_best_offer_only');
  assert.equal(b.headers['cache-control'], 'public, max-age=0, s-maxage=1800, stale-while-revalidate=1800');
  assert.equal(a.body.includes('test-client'), false);
  const none = await call(createHandler({ env: {}, fetch: createMockFetch() }), '/api/boots?status=1');
  assert.equal(none.json.live, false);
  const post = await new Promise(r => h({ method: 'POST', url: '/api/boots' }, { setHeader() {}, end() { r(this.statusCode); } }));
  assert.equal(post, 405);
});

test('source has no hard-coded secrets and the tool name has no "eBay"', () => {
  const fs = require('fs');
  for (const f of ['api/boots.js', 'api/_lib/browse.js', 'eBayBootSearch/js/results.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.equal(/v\^1\.1#|PRD-[0-9a-f]{8}|SBX-[0-9a-f]{8}/.test(src), false, f);
    assert.equal(/iframe/i.test(src.replace(/No frames[^\n]*/g, '')), false, f + ' must not frame eBay');
  }
  const cfg = fs.readFileSync(path.join(ROOT, 'eBayBootSearch/config.js'), 'utf8');
  assert.equal(/toolName:\s*"[^"]*ebay/i.test(cfg), false);
  const page = fs.readFileSync(path.join(ROOT, 'eBayBootSearch/index.html'), 'utf8');
  assert.match(page, /name="robots" content="noindex, nofollow"/);
});

test('sort menu -> Browse sort param (best match = none); distance only with the pickup ZIP filter', async () => {
  const want = { bestMatch: null, endingSoonest: 'endingSoonest', newlyListed: 'newlyListed', priceLowToHigh: 'price', priceHighToLow: '-price' };
  for (const [ui, api] of Object.entries(want)) {
    const { s, fetch } = svc(); await s.search('sort=' + ui);
    assert.equal(sp(searches(fetch)[0]).get('sort'), api, ui);
  }
  const plain = svc(); const a = await plain.s.search('');
  assert.ok(a.items.every(i => i.distance === null));
  const near = svc(); const b = await near.s.search('pickup=1&zip=30301&miles=50');
  assert.match(sp(searches(near.fetch)[0]).get('filter'), /pickupPostalCode:30301/);
  assert.ok(b.items.every(i => i.distance && typeof i.distance.value === 'number'));
  assert.ok(b.items.every(i => typeof i.created === 'string'), 'itemCreationDate passed through for "New" badges');
});
