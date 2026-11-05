/*
 * Dusty's Boot Finder: live results from the Browse API (item_summary/search).
 * Server-side only (Vercel function api/boots.js + local dev server). Never sent to the browser.
 *
 *  - App token: client_credentials grant, scope https://api.ebay.com/oauth/api_scope, cached in
 *    memory until 5 minutes before it expires. Hosts are Sandbox (api.sandbox.ebay.com)
 *    unless EBAY_ENV is exactly "production". This demo leaves EBAY_ENV unset.
 *  - Search: GET /buy/browse/v1/item_summary/search with X-EBAY-C-MARKETPLACE-ID: EBAY_US.
 *  - Affiliate tracking is OFF unless EPN_ENABLED=true AND EPN_CAMPAIGN_ID is a 10-digit ID.
 *    Off = no X-EBAY-C-ENDUSERCTX header, no EPN params, links are itemWebUrl.
 *  - Caching: 5 min (auctions / ending soonest), 30 min (Buy It Now). When eBay is busy or errors, an
 *    older copy may be served (labelled "saved copy" on the page) for at most 15 min (auctions) or
 *    1 h (Buy It Now). Nothing older is ever shown.
 *  - Connected sellers (CONNECTED_SELLERS / CONNECTED_SELLERS_MODE): listings from sellers with a
 *    business connection to this site are labelled (connected: true) or excluded.
 *  - Item lookup (items(ids)): re-fetches up to 24 saved item IDs live (getItem), so the browser keeps
 *    only item IDs and never stores titles, prices or photos.
 *  - Soft daily cap on Browse calls (EBAY_DAILY_CAP, default 4000); over it -> stale copy or fallback.
 *  - Any problem (no keys, eBay error, cap) returns { fallback: true, reason } so the page uses the
 *    existing link builder. eBay error bodies and secrets are never returned.
 *
 * Everything is injectable (fetch, env, clock) so tests never touch the real eBay API.
 */
'use strict';
const path = require('path');
const U = require(path.join(__dirname, '..', '..', 'eBayBootSearch', 'js', 'url-builder.js'));
const DATA = require(path.join(__dirname, '..', '..', 'eBayBootSearch', 'js', 'data.js'));

const SCOPE = 'https://api.ebay.com/oauth/api_scope';
const MIN = 60 * 1000;
const TTL_AUCTION = 5 * MIN;
const TTL_BIN = 30 * MIN;
const STALE_MAX_AUCTION = 15 * MIN;      // older copy cap when eBay is busy/erroring (auctions)
const STALE_MAX_BIN = 60 * MIN;          // ... and for Buy It Now
const STALE_MAX = STALE_MAX_BIN;         // hard max for anything served
const ITEM_IDS_MAX = 24;                 // item lookup: IDs per request
const ITEM_ID_RE = /^v1\|\d{6,20}\|\d{1,20}$/;
const TOKEN_EARLY = 5 * MIN;             // refresh the token 5 min before it expires
const PAGE_SIZE = 24;
const MAX_OFFSET = 9999;                  // Browse returns at most 10,000 items per result set
const CACHE_MAX_ENTRIES = 500;
const EPN_PARAMS = ['mkcid', 'mkrid', 'siteid', 'campid', 'customid', 'toolid', 'mkevt', 'mkpid'];
const WESTERN_CATEGORIES = { mens: '11498', womens: '53557' };   // leaf categories (Men's / Women's Boots)

// Facets the page shows, keyed by our short name -> eBay aspect name(s).
const FACETS = {
  size: ['US Shoe Size'], width: ['Shoe Width'], brand: ['Brand'], material: ['Upper Material', 'Material'],
  toe: ['Toe Shape'], heel: ['Heel Height'], style: ['Style'], color: ['Color']
};
// Refinement params the page may send on top of the normal share query (raw eBay values, "|" separated).
const REFINE_KEYS = ['size', 'width', 'brand', 'material', 'toe', 'heel'];

// Sandbox unless EBAY_ENV is exactly "production" (production needs Buy API approval + EPN's OK).
function hosts(env) {
  const prod = String(env.EBAY_ENV || '').trim().toLowerCase() === 'production';
  return prod
    ? { api: 'https://api.ebay.com', env: 'production' }
    : { api: 'https://api.sandbox.ebay.com', env: 'sandbox' };
}

// FTC: sellers with a business connection to this site (env CONNECTED_SELLERS, comma-separated eBay
// usernames, empty by default). CONNECTED_SELLERS_MODE=label (default) marks their cards;
// exclude drops their listings. Matching ignores case.
function connectedSellers(env) {
  const names = String(env.CONNECTED_SELLERS || '').split(',').map(x => x.trim().toLowerCase())
    .filter(x => /^[a-z0-9._*-]{1,64}$/.test(x));
  const mode = String(env.CONNECTED_SELLERS_MODE || 'label').trim().toLowerCase() === 'exclude' ? 'exclude' : 'label';
  return { names: new Set(names), mode };
}
function isConnected(item, cs) { return !!(item && item.seller && cs.names.has(String(item.seller.name).toLowerCase())); }
// Label or drop connected-seller listings. Returns { items, excluded }.
function applyConnected(items, cs) {
  if (!cs.names.size) return { items, excluded: 0 };
  if (cs.mode === 'exclude') { const kept = items.filter(i => !isConnected(i, cs)); return { items: kept, excluded: items.length - kept.length }; }
  return { items: items.map(i => (isConnected(i, cs) ? Object.assign({}, i, { connected: true }) : i)), excluded: 0 };
}

function epnSettings(env) {
  const on = String(env.EPN_ENABLED || '').toLowerCase() === 'true';
  const campid = String(env.EPN_CAMPAIGN_ID || '').trim();
  if (!on) return { on: false, reason: 'EPN_ENABLED is not true' };
  if (!/^\d{10}$/.test(campid)) return { on: false, reason: 'EPN_CAMPAIGN_ID missing or not a 10-digit ID' };
  // Placement label only (customid / affiliateReferenceId). Never personal data: letters, digits, - and _.
  const prefix = String(env.EPN_REFERENCE_PREFIX || 'dusty-bootfinder').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60) || 'dusty-bootfinder';
  return { on: true, campid, prefix };
}

// Which config.js affiliate profile (disclosure wording + search-link campaigns) the page should use
// while tracking is on. Server-side so the browser can't pick one on its own.
function epnProfile(env) {
  const p = String(env.EPN_PROFILE || 'dbs').trim().toLowerCase();
  return /^[a-z0-9_-]{1,20}$/.test(p) ? p : 'dbs';
}


// "12:52 AM ET"
function etTime(ms) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(ms)) + ' ET';
}
function etDay(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

// eBay aspect/filter values: braces, pipes and commas would break the syntax.
function cleanVal(v) { return String(v).replace(/[{}|,]/g, ' ').replace(/\s+/g, ' ').trim(); }
function list(v) { return String(v || '').split('|').map(cleanVal).filter(Boolean).slice(0, 30); }
function uniq(a) { return a.filter((x, i) => a.indexOf(x) === i); }

/* ---------- request -> Browse queries ---------- */

// Parse the page's query string: the normal share keys (?maker=&size=…) plus API-only keys.
function parseRequest(search) {
  const p = new URLSearchParams(search || '');
  const s = U.stateFromQuery(p.toString());
  const refine = {};
  REFINE_KEYS.forEach(k => { refine[k] = list(p.get('r_' + k)); });
  refine.cond = list(p.get('r_cond')).filter(v => /^\d{4}$/.test(v));
  const page = Math.max(0, Math.min(400, parseInt(p.get('page'), 10) || 0));
  const western = p.get('western') !== '0';
  return { state: s, refine, page, western };
}

// Why this request can't use the API (null = it can).
function unsupported(req) {
  const s = req.state;
  if (s.region !== 'ebay.com') return 'live results cover eBay US only';
  if (s.availability === 'sold') return 'sold listings are not available live';
  if (!s.use_boot_filters && !U.buildKeywords(s)) return 'add keywords to search all of eBay';
  return null;
}

function genderLists(s, g) {
  if (g === 'womens') return { sizes: s.selected_sizes_womens, widths: s.selected_widths_womens };
  if (g === 'mens') return { sizes: s.selected_sizes_mens, widths: s.selected_widths_mens };
  return { sizes: uniq(s.selected_sizes_mens.concat(s.selected_sizes_womens)), widths: uniq(s.selected_widths_mens.concat(s.selected_widths_womens)) };
}

function isAuctionMode(s) { return s.sale_type === 'auction_only' || s.sort_by === 'endingSoonest'; }

// One query per category ("both" genders = men's + women's, never the non-leaf 11450).
function buildQueries(req) {
  const s = req.state, r = req.refine;
  const genders = !s.use_boot_filters ? [null] : s.gender === 'both' ? ['mens', 'womens'] : [s.gender];
  const perCall = genders.length > 1 ? PAGE_SIZE / 2 : PAGE_SIZE;
  return genders.map(g => {
    const q = new URLSearchParams();
    const kw = U.buildKeywords(s);
    if (kw) q.set('q', kw.slice(0, 350));
    if (g) {
      const cat = WESTERN_CATEGORIES[g];
      q.set('category_ids', cat);
      const gl = genderLists(s, g);
      const asp = ['categoryId:' + cat];
      const add = (name, vals) => { vals = uniq(vals.map(cleanVal).filter(Boolean)); if (vals.length) asp.push(name + ':{' + vals.join('|') + '}'); };
      add('US Shoe Size', gl.sizes.concat(r.size));
      add('Shoe Width', gl.widths.filter(w => w !== 'Not Specified').concat(r.width));
      const brands = s.selected_brands.slice(); if (s.unbranded_checked) brands.push('Unbranded');
      add('Brand', brands.concat(r.brand));
      add('Color', s.selected_colors.filter(c => c !== 'Not specified'));
      add('Upper Material', r.material);
      add('Toe Shape', r.toe);
      add('Heel Height', r.heel);
      const hm = s.selected_handmade;
      if (hm.includes('Handmade') && !hm.includes('Not handmade')) add('Handmade', ['Yes']);
      else if (hm.includes('Not handmade') && !hm.includes('Handmade')) add('Handmade', ['No']);
      add('Country/Region of Manufacture', s.selected_countries.filter(c => c !== 'Not specified').map(c => DATA.COUNTRY_ASPECT_VALUE[c] || c));
      if (req.western) add('Style', ['Western']);
      q.set('aspect_filter', asp.join(','));
    }
    const f = [];
    const pr = U.priceRange(s);
    if (pr.min || pr.max) f.push('price:[' + (pr.min || '0') + '..' + (pr.max || '') + ']', 'priceCurrency:USD');
    let conds = r.cond.slice();
    if (!conds.length) s.selected_conditions.forEach(c => { conds = conds.concat(DATA.CONDITION_CODES[c] || []); });
    if (conds.length) f.push('conditionIds:{' + uniq(conds).join('|') + '}');
    if (s.sale_type === 'auction_only') f.push('buyingOptions:{AUCTION}');
    else if (s.sale_type === 'fixed_best_offer_only') f.push('buyingOptions:{FIXED_PRICE|BEST_OFFER}');
    else if (s.sale_type === 'best_offer_only') f.push('buyingOptions:{BEST_OFFER}');
    if (s.returns_accepted) f.push('returnsAccepted:true');
    if (s.free_shipping) f.push('maxDeliveryCost:0');
    if (s.search_description) f.push('searchInDescription:true');
    if (s.local_pickup && U.zipValid(s.local_pickup_zipcode, 'ebay.com')) {
      f.push('deliveryOptions:{SELLER_ARRANGED_LOCAL_PICKUP}', 'pickupCountry:US', 'pickupPostalCode:' + s.local_pickup_zipcode,
        'pickupRadius:' + s.local_pickup_distance, 'pickupRadiusUnit:mi');
    } else f.push('deliveryCountry:US');
    q.set('filter', f.join(','));
    const sort = { endingSoonest: 'endingSoonest', newlyListed: 'newlyListed', priceLowToHigh: 'price', priceHighToLow: '-price' }[s.sort_by];
    if (sort) q.set('sort', sort);
    q.set('limit', String(perCall));
    q.set('offset', String(Math.min(MAX_OFFSET, req.page * perCall)));
    q.set('fieldgroups', 'ASPECT_REFINEMENTS,MATCHING_ITEMS,CONDITION_REFINEMENTS,BUYING_OPTION_REFINEMENTS');
    return { gender: g, params: q };
  });
}

/* ---------- Browse response -> trimmed JSON ---------- */

function money(m) { return m && m.value != null ? { value: String(m.value), currency: m.currency || 'USD' } : null; }

function stripEpn(u) {
  try { const x = new URL(u); EPN_PARAMS.forEach(k => x.searchParams.delete(k)); return x.toString(); } catch (e) { return null; }
}
function safeEbayUrl(u) {
  try { const x = new URL(u); return x.protocol === 'https:' && /(^|\.)ebay\.com$/.test(x.hostname) ? x.toString() : null; } catch (e) { return null; }
}

function trimItem(it, epn) {
  const ship = (it.shippingOptions || [])[0] || {};
  const seller = it.seller || {};
  const loc = it.itemLocation || {};
  let url, paid = false;
  if (epn.on && it.itemAffiliateWebUrl && safeEbayUrl(it.itemAffiliateWebUrl)) { url = safeEbayUrl(it.itemAffiliateWebUrl); paid = true; }
  else url = it.itemWebUrl ? stripEpn(safeEbayUrl(it.itemWebUrl) || '') : null;
  return {
    id: String(it.itemId || ''),
    title: String(it.title || '').slice(0, 200),
    image: (it.image && it.image.imageUrl) || ((it.thumbnailImages || [])[0] || {}).imageUrl || null,
    price: money(it.price),
    currentBid: money(it.currentBidPrice),
    bidCount: typeof it.bidCount === 'number' ? it.bidCount : null,
    buyingOptions: Array.isArray(it.buyingOptions) ? it.buyingOptions : [],
    endDate: it.itemEndDate || null,
    created: it.itemCreationDate || null,
    shipping: ship.shippingCostType === 'CALCULATED' ? { calculated: true }
      : ship.shippingCost ? money(ship.shippingCost) : null,
    condition: it.condition || null,
    seller: seller.username ? { name: seller.username, feedbackPct: seller.feedbackPercentage || null, feedbackScore: seller.feedbackScore != null ? seller.feedbackScore : null } : null,
    // Only present when the search used the local-pickup ZIP filter.
    distance: it.distanceFromPickupLocation && it.distanceFromPickupLocation.value != null
      ? { value: Number(it.distanceFromPickupLocation.value), unit: it.distanceFromPickupLocation.unitOfMeasure || 'mi' } : null,
    location: [loc.city, loc.stateOrProvince, loc.country && loc.country !== 'US' ? loc.country : ''].filter(Boolean).join(', ') || null,
    url, paid
  };
}

function trimFacets(raw) {
  const out = { aspects: {}, conditions: [], buyingOptions: [] };
  const ref = (raw && raw.refinement) || {};
  (ref.aspectDistributions || []).forEach(a => {
    const name = a.localizedAspectName;
    const key = Object.keys(FACETS).find(k => FACETS[k].includes(name));
    if (!key || out.aspects[key]) return;
    out.aspects[key] = (a.aspectValueDistributions || []).map(v => ({ value: v.localizedAspectValue, count: v.matchCount || 0 }))
      .filter(v => v.value).slice(0, 60);
  });
  out.conditions = (ref.conditionDistributions || []).map(c => ({ id: String(c.conditionId || ''), label: c.condition, count: c.matchCount || 0 })).filter(c => c.id);
  out.buyingOptions = (ref.buyingOptionDistributions || []).map(b => ({ value: b.buyingOption, count: b.matchCount || 0 })).filter(b => b.value);
  return out;
}

function mergeFacets(list) {
  if (list.length === 1) return list[0];
  const out = { aspects: {}, conditions: [], buyingOptions: [] };
  const add = (arr, item, key) => { const f = arr.find(x => x[key] === item[key]); if (f) f.count += item.count; else arr.push(Object.assign({}, item)); };
  list.forEach(f => {
    Object.keys(f.aspects).forEach(k => { out.aspects[k] = out.aspects[k] || []; f.aspects[k].forEach(v => add(out.aspects[k], v, 'value')); });
    f.conditions.forEach(c => add(out.conditions, c, 'id'));
    f.buyingOptions.forEach(b => add(out.buyingOptions, b, 'value'));
  });
  Object.keys(out.aspects).forEach(k => out.aspects[k].sort((a, b) => b.count - a.count));
  return out;
}

function sortMerged(items, sortBy) {
  const num = m => (m ? parseFloat(m.value) : Infinity);
  const price = i => num(i.currentBid || i.price);
  const cmp = {
    endingSoonest: (a, b) => Date.parse(a.endDate || 0) - Date.parse(b.endDate || 0),
    newlyListed: (a, b) => Date.parse(b.created || 0) - Date.parse(a.created || 0),
    priceLowToHigh: (a, b) => price(a) - price(b),
    priceHighToLow: (a, b) => price(b) - price(a)
  }[sortBy];
  return cmp ? items.slice().sort(cmp) : items;
}

/* ---------- the service (one per process; state = token, cache, counter) ---------- */

function createBrowseService(opts) {
  opts = opts || {};
  const env = opts.env || process.env;
  const fetchFn = opts.fetch || globalThis.fetch;
  const now = opts.now || Date.now;
  const log = opts.log || (() => {});
  let token = null;                         // { value, expiresAt }
  const cache = new Map();                  // key -> { data, fetchedAt, ttl }
  const counter = { day: '', browse: 0, token: 0 };

  const cap = () => Math.max(0, parseInt(env.EBAY_DAILY_CAP, 10) || 4000);
  function bump(kind) {
    const d = etDay(now());
    if (counter.day !== d) { counter.day = d; counter.browse = 0; counter.token = 0; }
    counter[kind]++;
  }
  function overCap() { const d = etDay(now()); return counter.day === d && counter.browse >= cap(); }
  function hasKeys() { return !!(env.EBAY_CLIENT_ID && env.EBAY_CLIENT_SECRET); }

  async function getToken(force) {
    if (!force && token && now() < token.expiresAt - TOKEN_EARLY) return token.value;
    const h = hosts(env);
    const basic = Buffer.from(env.EBAY_CLIENT_ID + ':' + env.EBAY_CLIENT_SECRET).toString('base64');
    bump('token');
    const res = await fetchFn(h.api + '/identity/v1/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + basic },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: SCOPE }).toString()
    });
    if (!res.ok) { token = null; throw Object.assign(new Error('token request failed'), { status: res.status, stage: 'token' }); }
    const j = await res.json();
    if (!j.access_token) throw Object.assign(new Error('token response had no access_token'), { stage: 'token' });
    token = { value: j.access_token, expiresAt: now() + (Number(j.expires_in) || 7200) * 1000 };
    return token.value;
  }

  async function callSearch(params, epn, mode) {
    const h = hosts(env);
    const url = h.api + '/buy/browse/v1/item_summary/search?' + params.toString();
    for (let attempt = 0; attempt < 2; attempt++) {
      const t = await getToken(attempt > 0);
      const headers = { Authorization: 'Bearer ' + t, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US', Accept: 'application/json' };
      if (epn.on) headers['X-EBAY-C-ENDUSERCTX'] = 'affiliateCampaignId=' + epn.campid + ',affiliateReferenceId=' + (epn.prefix + '-' + mode).slice(0, 256);
      bump('browse');
      const res = await fetchFn(url, { method: 'GET', headers });
      if (res.status === 401 && attempt === 0) { token = null; continue; }   // token revoked/expired early: refresh once
      if (!res.ok) throw Object.assign(new Error('search failed'), { status: res.status, stage: 'search' });
      return res.json();
    }
    throw Object.assign(new Error('search unauthorized'), { status: 401, stage: 'search' });
  }

  function cacheKey(req, queries, epn) {
    return [hosts(env).env, epn.on ? 'epn' : 'clean'].concat(queries.map(q => q.params.toString())).join('#');
  }
  function remember(key, entry) {
    cache.delete(key); cache.set(key, entry);
    while (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
  }

  // Finished payload from a cache entry: drop listings that have ended since it was fetched.
  function payload(entry, extra) {
    const t = now();
    const items = entry.data.items.filter(i => !i.endDate || Date.parse(i.endDate) > t);
    return Object.assign({}, entry.data, { items, fetchedAt: new Date(entry.fetchedAt).toISOString(), asOf: etTime(entry.fetchedAt),
      maxAge: Math.max(0, Math.round((entry.fetchedAt + entry.ttl - t) / 1000)) }, extra || {});
  }

  // The ONE affiliate switch. The page turns paid links (and the disclosure) on only when this says
  // affiliate: true, which needs EPN_ENABLED=true AND a 10-digit EPN_CAMPAIGN_ID on the server.
  function status() {
    const on = epnSettings(env).on;
    const out = { live: hasKeys(), env: hosts(env).env, affiliate: on };
    if (on) out.profile = epnProfile(env);
    return out;
  }

  async function search(search) {
    if (!hasKeys()) return { fallback: true, reason: 'live results are not set up yet' };
    const req = parseRequest(search);
    const why = unsupported(req);
    if (why) return { fallback: true, reason: why };
    const epn = epnSettings(env);
    const queries = buildQueries(req);
    const auction = isAuctionMode(req.state);
    const ttl = auction ? TTL_AUCTION : TTL_BIN;
    const key = cacheKey(req, queries, epn);
    const hit = cache.get(key);
    const t = now();
    if (hit && t - hit.fetchedAt < hit.ttl) return payload(hit, { cache: 'hit' });
    const stale = hit && t - hit.fetchedAt < (auction ? STALE_MAX_AUCTION : STALE_MAX_BIN) ? hit : null;
    if (overCap()) {
      log('daily cap reached', counter.browse);
      return stale ? payload(stale, { cache: 'stale', maxAge: 60, note: 'busy' }) : { fallback: true, reason: 'live results are busy right now' };
    }
    try {
      const mode = auction ? 'auction' : 'bin';
      const raws = await Promise.all(queries.map(q => callSearch(q.params, epn, mode)));
      let items = [];
      raws.forEach(raw => { items = items.concat((raw.itemSummaries || []).map(it => trimItem(it, epn))); });
      const conn = applyConnected(items, connectedSellers(env)); items = conn.items;
      if (raws.length > 1) {
        const seen = new Set();
        items = sortMerged(items.filter(i => !seen.has(i.id) && seen.add(i.id)), req.state.sort_by);
      }
      const total = raws.reduce((n, r) => n + (Number(r.total) || 0), 0);
      const perPage = PAGE_SIZE;
      const data = {
        items, total, page: req.page, pageSize: perPage,
        hasMore: raws.some(r => !!r.next) && (req.page + 1) * perPage < Math.min(total, 10000),
        facets: mergeFacets(raws.map(trimFacets)),
        paid: items.some(i => i.paid),
        mode: auction ? 'auction' : 'all', western: req.western && req.state.use_boot_filters
      };
      if (conn.excluded) data.excluded = conn.excluded;
      const entry = { data, fetchedAt: t, ttl };
      remember(key, entry);
      return payload(entry, { cache: 'miss' });
    } catch (e) {
      log('browse error', e.stage, e.status);
      if (stale) return payload(stale, { cache: 'stale', maxAge: 60, note: 'error' });
      const auctionNote = e.status === 400 && req.state.sale_type === 'auction_only'
        ? 'the auction filter needs a boot category; try Buy It Now or turn the boot category on' : null;
      return { fallback: true, reason: auctionNote || 'live results are unavailable right now' };
    }
  }

  /* ---------- item lookup: saved picks / hidden / viewed are re-fetched live by ID ---------- */
  const itemCache = new Map();               // id|epn -> { item, fetchedAt, ttl }
  async function getItem(id, epn) {
    const h = hosts(env);
    const url = h.api + '/buy/browse/v1/item/' + encodeURIComponent(id) + '?fieldgroups=COMPACT';
    for (let attempt = 0; attempt < 2; attempt++) {
      const t = await getToken(attempt > 0);
      const headers = { Authorization: 'Bearer ' + t, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US', Accept: 'application/json' };
      if (epn.on) headers['X-EBAY-C-ENDUSERCTX'] = 'affiliateCampaignId=' + epn.campid + ',affiliateReferenceId=' + (epn.prefix + '-item').slice(0, 256);
      bump('browse');
      const res = await fetchFn(url, { method: 'GET', headers });
      if (res.status === 401 && attempt === 0) { token = null; continue; }
      if (res.status === 404 || res.status === 410) return null;        // ended / removed
      if (!res.ok) throw Object.assign(new Error('item failed'), { status: res.status, stage: 'item' });
      return res.json();
    }
    throw Object.assign(new Error('item unauthorized'), { status: 401, stage: 'item' });
  }
  // ids: array of Browse item IDs (v1|123|0). Returns { items: [...live], gone: [ids], asOf } or fallback.
  async function items(ids) {
    if (!hasKeys()) return { fallback: true, reason: 'live results are not set up yet' };
    ids = uniq((ids || []).map(String).filter(id => ITEM_ID_RE.test(id))).slice(0, ITEM_IDS_MAX);
    if (!ids.length) return { items: [], gone: [], asOf: etTime(now()), fetchedAt: new Date(now()).toISOString(), maxAge: 0 };
    const epn = epnSettings(env);
    const t = now();
    const out = new Array(ids.length), gone = [];
    let queue = ids.map((id, i) => ({ id, i })), failed = 0, oldest = t, minTtl = TTL_BIN;
    async function worker() {
      while (queue.length) {
        const { id, i } = queue.shift();
        const key = id + '#' + (epn.on ? 'epn' : 'clean') + '#' + hosts(env).env;
        const hit = itemCache.get(key);
        if (hit && t - hit.fetchedAt < hit.ttl) { out[i] = hit.item; oldest = Math.min(oldest, hit.fetchedAt); minTtl = Math.min(minTtl, hit.ttl); continue; }
        if (overCap()) { failed++; continue; }
        try {
          const raw = await getItem(id, epn);
          if (!raw) { gone.push(id); itemCache.delete(key); continue; }
          const item = trimItem(raw, epn);
          const ttl = item.buyingOptions.indexOf('AUCTION') !== -1 ? TTL_AUCTION : TTL_BIN;
          itemCache.delete(key); itemCache.set(key, { item, fetchedAt: t, ttl });
          while (itemCache.size > CACHE_MAX_ENTRIES) itemCache.delete(itemCache.keys().next().value);
          out[i] = item; minTtl = Math.min(minTtl, ttl);
        } catch (e) { log('item error', e.stage, e.status); failed++; }
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);
    const conn = applyConnected(out.filter(Boolean), connectedSellers(env));   // ended listings stay (shown as "Ended")
    const list = conn.items;
    if (!list.length && failed) return { fallback: true, reason: 'live results are unavailable right now' };
    return { items: list, gone, failed, excluded: conn.excluded, paid: list.some(i => i.paid), asOf: etTime(oldest), fetchedAt: new Date(oldest).toISOString(),
      maxAge: Math.max(0, Math.round((oldest + minTtl - t) / 1000)) };
  }

  return { search, items, status, _counter: counter, _cache: cache, _itemCache: itemCache, _token: () => token };
}

module.exports = { createBrowseService, parseRequest, buildQueries, trimItem, trimFacets, mergeFacets, epnSettings, epnProfile, hosts, etTime, connectedSellers, applyConnected,
  TTL_AUCTION, TTL_BIN, STALE_MAX, STALE_MAX_AUCTION, STALE_MAX_BIN, PAGE_SIZE, SCOPE, ITEM_IDS_MAX, ITEM_ID_RE };
