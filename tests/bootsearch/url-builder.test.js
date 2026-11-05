// Unit tests for the Boot Search URL builder. Run: node --test tests/bootsearch/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const B = require(path.join(ROOT, 'eBayBootSearch/js/url-builder.js'));
const D = require(path.join(ROOT, 'eBayBootSearch/js/data.js'));

function loadConfig() {
  const sandbox = { window: {} };
  new Function('window', fs.readFileSync(path.join(ROOT, 'eBayBootSearch/config.js'), 'utf8'))(sandbox.window);
  return sandbox.window.BOOTSEARCH_CONFIG;
}
// "On" = what the page does after /api/boots?status=1 says affiliate: true (the ONE, server-side switch).
const on = () => { const c = loadConfig(); c.affiliate.serverOn = true; return c; };
const params = u => new URL(u).searchParams;
const EPN_KEYS = ['campid', 'customid', 'mkcid', 'mkrid', 'siteid', 'toolid', 'mkevt'];

test('config: no browser switch at all (server decides), real DBS IDs present, WBW is a placeholder', () => {
  const c = loadConfig();
  assert.equal('enabled' in c.affiliate, false, 'config.js must not carry an affiliate switch');
  assert.equal('serverOn' in c.affiliate, false);
  assert.equal(c.affiliate.profiles.dbs.campaigns.web, '5339171324');
  assert.equal(c.affiliate.profiles.dbs.campaigns.mobile, '5339171325');
  assert.equal(c.affiliate.profiles.wbw.campaigns.web, '<WBW_CAMPID>');
  assert.equal(c.affiliate.profiles.wbw.campaigns.mobile, '<WBW_CAMPID>');
});

test('OFF: every link is clean (no EPN params) across regions, views and options', () => {
  const c = loadConfig();
  for (const r of D.REGIONS) for (const view of ['web', 'mobile']) for (const availability of ['available', 'sold']) {
    const out = B.buildSearch({ region: r.domain, interface_type: view, availability, any_keywords: 'lucchese', gender: 'both' }, c);
    const p = params(out.url);
    for (const k of EPN_KEYS) assert.equal(p.has(k), false, `${k} leaked on ${r.domain}/${view}/${availability}`);
    assert.equal(out.paid, false);
    assert.match(out.url, new RegExp('^https://' + (view === 'mobile' ? 'm' : 'www') + '\\.' + r.domain.replace(/\./g, '\\.') + '/sch/i\\.html\\?'));
  }
});

test('ON, US web: exact EPN params in the expected order, with customid', () => {
  const out = B.buildSearch({ any_keywords: 'lucchese' }, on());
  assert.equal(out.paid, true);
  assert.equal(out.url, 'https://www.ebay.com/sch/i.html?_nkw=lucchese&_sacat=11498&_sop=10&_ipg=240&rt=nc' +
    '&mkcid=1&mkrid=711-53200-19255-0&siteid=0&campid=5339171324&customid=dbs-bootsearch-web&toolid=10001&mkevt=1');
});

test('ON, US mobile: m.ebay.com with the mobile campaign', () => {
  const p = params(B.buildSearch({ interface_type: 'mobile' }, on()).url);
  assert.equal(p.get('campid'), '5339171325');
  assert.equal(p.get('customid'), 'dbs-bootsearch-mobile');
  assert.match(B.buildSearch({ interface_type: 'mobile' }, on()).url, /^https:\/\/m\.ebay\.com\//);
});

test('ON, every EPN market gets its own rotation + site ID', () => {
  const c = on();
  for (const [domain, mkrid] of Object.entries(D.EPN_ROTATION)) {
    const p = params(B.buildSearch({ region: domain }, c).url);
    assert.equal(p.get('mkrid'), mkrid, domain);
    assert.equal(p.get('siteid'), D.EBAY_SITE_ID[domain], domain);
  }
  const uk = params(B.buildSearch({ region: 'ebay.co.uk' }, c).url);
  assert.equal(uk.get('mkrid'), '710-53481-19255-0'); assert.equal(uk.get('siteid'), '3');
});

test('ON, non-EPN regions (pl, hk, sg, my, ph) get clean links, never the US rotation', () => {
  for (const d of ['ebay.pl', 'ebay.com.hk', 'ebay.com.sg', 'ebay.com.my', 'ebay.ph']) {
    const out = B.buildSearch({ region: d }, on());
    assert.equal(out.paid, false, d);
    for (const k of EPN_KEYS) assert.equal(params(out.url).has(k), false, `${k} on ${d}`);
  }
});

test('ON, Sold searches are clean and keep LH_Sold/LH_Complete', () => {
  const out = B.buildSearch({ availability: 'sold' }, on());
  const p = params(out.url);
  assert.equal(out.paid, false);
  assert.equal(p.get('LH_Sold'), '1'); assert.equal(p.get('LH_Complete'), '1');
  for (const k of EPN_KEYS) assert.equal(p.has(k), false);
});

test('ON with WBW placeholder profile: placeholder never reaches eBay, link is clean', () => {
  const c = on(); c.affiliate.activeProfile = 'wbw';
  const out = B.buildSearch({}, c);
  assert.equal(out.paid, false);
  assert.equal(out.reason, 'campaign ID is a placeholder');
  assert.doesNotMatch(out.url, /WBW|campid|%3CWBW/);
});

test('Both: one URL, category 11450, mens + womens sizes and widths merged', () => {
  const out = B.buildSearch({ gender: 'both', selected_sizes_mens: ['10', '10.5'], selected_sizes_womens: ['7', '10'],
    selected_widths_mens: ['D'], selected_widths_womens: ['B', 'D'] }, loadConfig());
  const p = params(out.url);
  assert.equal(p.get('_sacat'), '11450');
  assert.equal(p.get('US Shoe Size'), '10|10.5|7');
  assert.equal(p.get('Shoe Width'), 'D|B');
  assert.equal(p.get('_dcat'), '11450');
});

test('No gender saved (old default) becomes Mens, never the all-clothing category', () => {
  const p = params(B.buildSearch({ gender: null }, loadConfig()).url);
  assert.equal(p.get('_sacat'), '11498');
});

test('Keyword syntax matches the old tool', () => {
  assert.equal(B.buildKeywords(B.normalizeState({ all_keywords: 'vintage cowboy', any_keywords: 'lucchese justin', exclude_keywords: 'damaged -worn' })),
    'vintage cowboy (lucchese,justin) -(damaged,worn)');
  assert.equal(B.buildKeywords(B.normalizeState({ all_keywords: 'black cherry', all_keywords_mode: 'exact_order', exclude_keywords: 'kids' })),
    '"black cherry" -kids');
  assert.equal(B.buildKeywords(B.normalizeState({ any_keywords: 'ostrich', selected_vintage: ['Yes'] })), 'ostrich vintage');
  assert.equal(B.buildKeywords(B.normalizeState({ selected_vintage: ['No'] })), '-vintage');
});

test('Boot filters, settings and options map to the same eBay params as before', () => {
  const p = params(B.buildSearch({
    gender: 'womens', selected_sizes_womens: ['7', '7.5'], selected_widths_womens: ['B', 'Not Specified'],
    selected_colors: ['Black', 'Not specified'], selected_conditions: ['New', 'Used'], selected_brands: ['Lucchese', 'Old Gringo'],
    unbranded_checked: true, selected_handmade: ['Handmade'], selected_countries: ['USA', 'Mexico', 'Not specified'],
    price_min: '50', price_max: '300', sale_type: 'auction_only', sort_by: 'endingSoonest', search_description: true,
    returns_accepted: true, free_shipping: true, local_pickup: true, local_pickup_zipcode: '30301', local_pickup_distance: '25'
  }, loadConfig()).url);
  const expect = { _sacat: '53557', LH_ItemCondition: '1000|1500|1750|3000', Color: 'Black', 'US Shoe Size': '7|7.5', 'Shoe Width': 'B',
    Brand: 'Lucchese|Old Gringo|Unbranded', Handmade: 'Yes', 'Country/Region of Manufacture': 'United States|Mexico', _dcat: '53557',
    _udlo: '50', _udhi: '300', LH_Auction: '1', _sop: '1', LH_TitleDesc: '1', LH_RPA: '1', LH_FS: '1', LH_PickupOnly: '1',
    _stpos: '30301', _sadis: '25', LH_SALocation: '1', _ipg: '240', rt: 'nc' };
  for (const [k, v] of Object.entries(expect)) assert.equal(p.get(k), v, k);
});

test('Boot category off: searches all of eBay and drops boot-only filters (old behavior)', () => {
  const p = params(B.buildSearch({ use_boot_filters: false, selected_brands: ['Lucchese'], selected_sizes_mens: ['10'] }, loadConfig()).url);
  assert.equal(p.get('_sacat'), '0');
  assert.equal(p.has('Brand'), false); assert.equal(p.has('US Shoe Size'), false); assert.equal(p.has('_dcat'), false);
});

test('Mobile view never sends LH_TitleDesc (old behavior)', () => {
  assert.equal(params(B.buildSearch({ interface_type: 'mobile', search_description: true }, loadConfig()).url).has('LH_TitleDesc'), false);
});

test('Shareable links round-trip, and maker= deep links resolve to a known brand', () => {
  const s = B.normalizeState({ gender: 'womens', any_keywords: 'red boots', selected_brands: ['Tony Lama'], selected_sizes_womens: ['7'],
    availability: 'sold', price_max: '200', free_shipping: true });
  const back = B.stateFromQuery('?' + B.shareQuery(s));
  assert.deepEqual(back, s);
  assert.deepEqual(B.stateFromQuery('?maker=tony-lama').selected_brands, ['Tony Lama']);
  assert.deepEqual(B.stateFromQuery('?maker=lucchese,not-a-brand').selected_brands, ['Lucchese']);
  assert.equal(B.hasShareParams('?maker=lucchese'), true);
  assert.equal(B.hasShareParams('?utm_source=x'), false);
});

test('No invented campaign IDs anywhere in the live tool (only the two real DBS IDs)', () => {
  const dir = path.join(ROOT, 'eBayBootSearch');
  const files = [];
  (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (f === 'legacy') continue;
    if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(js|html|css)$/.test(f)) files.push(p); } })(dir);
  const found = new Set();
  for (const f of files) for (const m of fs.readFileSync(f, 'utf8').matchAll(/\b53\d{8}\b|campid\s*[:=]\s*['"]?(\d{6,})/g)) found.add(m[1] || m[0]);
  assert.deepEqual([...found].sort(), ['5339171324', '5339171325']);
  const cfg = fs.readFileSync(path.join(dir, 'config.js'), 'utf8');
  assert.equal((cfg.match(/5339171324/g) || []).length, 1);
  assert.equal((cfg.match(/5339171325/g) || []).length, 1);
});

test('single switch: config.js alone can never turn paid links on (only the server answer can)', () => {
  for (const tweak of [c => { c.affiliate.enabled = true; }, c => { c.affiliate.enabled = 'true'; c.affiliate.serverOn = 'true'; }, c => { c.affiliate.serverOn = 1; }]) {
    const c = loadConfig(); tweak(c);
    const out = B.buildSearch({ any_keywords: 'lucchese' }, c);
    assert.equal(out.paid, false);
    for (const k of EPN_KEYS) assert.equal(params(out.url).has(k), false, k);
  }
  assert.equal(B.buildSearch({}, on()).paid, true);
});

test('per-profile disclosure names the account holder, "Affiliate" capitalized; server picks the profile', () => {
  const c = on();
  assert.match(B.disclosureText(c), /^Ad · Paid links\. As an eBay Partner Network Affiliate, Dan's Boot Sale earns from qualifying purchases\.$/);
  c.affiliate.serverProfile = 'wbw';
  assert.match(B.disclosureText(c), /Western Boot World earns/);
  assert.equal(B.buildSearch({}, c).paid, false, 'WBW still a placeholder campaign -> clean');
  c.affiliate.serverProfile = 'nope';
  assert.match(B.disclosureText(c), /Dan's Boot Sale/, 'unknown server profile falls back to activeProfile');
  const noText = on(); delete noText.affiliate.profiles.dbs.disclosure;
  assert.equal(B.buildSearch({}, noText).paid, false, 'no disclosure text -> never paid');
});

test('customid is a placement label only (sanitized), never shopper data', () => {
  const c = on(); c.affiliate.profiles.dbs.customidPrefix = 'dbs bootsearch <script>@me.com';
  const id = params(B.buildSearch({}, c).url).get('customid');
  assert.match(id, /^[A-Za-z0-9_-]+$/);
  assert.equal(id, 'dbsbootsearchscriptmecom-web');
});
