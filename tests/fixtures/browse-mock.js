// Fake eBay for tests and the local preview (DUSTY_MOCK_EBAY=1 node scripts/dev-server.js).
// Never contacts eBay. Returns a token response and Browse-shaped search responses whose
// end dates are relative to "now", so countdowns look real. Records every call it gets.
'use strict';

const BOOT_SVG = (fill, accent) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><rect width="300" height="300" fill="#f3ead8"/>` +
  `<path d="M110 30h70l-4 150c0 10 8 18 18 22l60 22c14 5 22 16 22 30v16H70l-6-40 10-60z" fill="${fill}"/>` +
  `<path d="M112 60h66M114 90h62M116 120h58" stroke="${accent}" stroke-width="5" fill="none"/>` +
  `<rect x="66" y="262" width="40" height="8" fill="#2a1d14"/></svg>`);

const SAMPLE = [
  ['Lucchese Classics Black Cherry Goat Western Cowboy Boots Men 10.5 D', '#5a1f1f', '#c79a52', 'AUCTION', 189.0, 14, 0.4, 'Pre-owned', '3000', 'Lucchese', '10.5', 'D'],
  ['Tony Lama Vintage Caiman Belly Western Boots Mens 11 EE Made in USA', '#6b4a2b', '#e8d3a8', 'AUCTION', 242.5, 22, 2.2, 'Pre-owned', '3000', 'Tony Lama', '11', 'EE'],
  ['Justin Roper Brown Leather Western Boots Men Size 9 D Square Toe', '#7a4b28', '#2a1d14', 'FIXED_PRICE', 64.99, null, 70, 'Pre-owned', '3000', 'Justin', '9', 'D'],
  ['Nocona Ostrich Full Quill Western Cowboy Boots Mens 10 D Snip Toe', '#a7743f', '#5a3a1e', 'AUCTION', 151.0, 9, 5.5, 'Pre-owned', '3000', 'Nocona', '10', 'D'],
  ['Ariat Heritage Roper Western Boot Men 10.5 EE New in Box', '#3d2a1c', '#c79a52', 'FIXED_PRICE', 139.95, null, 300, 'New with box', '1000', 'Ariat', '10.5', 'EE'],
  ['Olsen-Stelzer Custom Inlay Western Boots Mens 9.5 C Handmade Texas', '#2f4f6f', '#e2c48f', 'AUCTION', 410.0, 31, 0.9, 'Pre-owned', '3000', 'Olsen-Stelzer', '9.5', 'C'],
  ['Dan Post Black Leather Western Boots Men 12 D Cowboy Heel', '#1e1a17', '#9a5a2b', 'FIXED_PRICE', 89.0, null, 150, 'Pre-owned', '3000', 'Dan Post', '12', 'D'],
  ['Larry Mahan Exotic Lizard Western Boots Mens 10 D Vintage 1980s', '#6f6a3a', '#2a1d14', 'AUCTION', 97.0, 6, 11, 'Pre-owned', '3000', 'Larry Mahan', '10', 'D']
];

function sampleItems(now, offset, limit, category, only) {
  const out = [];
  const pool = only ? SAMPLE.filter(s => only.includes(s[3])) : SAMPLE;
  for (let i = 0; i < limit; i++) {
    const n = offset + i, s = pool[n % pool.length];
    const auction = s[3] === 'AUCTION';
    const end = new Date(now + s[6] * 3600e3 + n * 60e3).toISOString();
    const id = 'v1|' + (300000000000 + n) + '|0';
    out.push({
      itemId: id, title: s[0] + (n >= pool.length ? ' #' + (n + 1) : ''),
      image: { imageUrl: BOOT_SVG(s[1], s[2]) },
      price: { value: s[4].toFixed(2), currency: 'USD' },
      ...(auction ? { currentBidPrice: { value: s[4].toFixed(2), currency: 'USD' }, bidCount: s[5] } : {}),
      buyingOptions: auction ? ['AUCTION'] : ['FIXED_PRICE', 'BEST_OFFER'],
      itemEndDate: end, itemCreationDate: new Date(now - (n + 1) * 3600e3).toISOString(),
      condition: s[7], conditionId: s[8],
      shippingOptions: [n % 3 === 0 ? { shippingCostType: 'FIXED', shippingCost: { value: '0.00', currency: 'USD' } }
        : { shippingCostType: 'FIXED', shippingCost: { value: (12.5 + n % 4).toFixed(2), currency: 'USD' } }],
      seller: { username: ['dusty_trails_boots', 'bootbarn_resale', 'texasleatherco', 'oldwestvault'][n % 4], feedbackPercentage: ['99.8', '100.0', '98.7', '99.5'][n % 4], feedbackScore: [4123, 987, 15210, 342][n % 4] },
      itemLocation: { city: ['Austin', 'Fort Worth', 'Tulsa', 'Cheyenne'][n % 4], stateOrProvince: ['TX', 'TX', 'OK', 'WY'][n % 4], country: 'US' },
      categories: [{ categoryId: category || '11498' }],
      itemWebUrl: 'https://www.ebay.com/itm/' + (300000000000 + n),
      itemAffiliateWebUrl: 'https://www.ebay.com/itm/' + (300000000000 + n) + '?mkcid=1&mkrid=711-53200-19255-0&siteid=0&campid=MOCKCAMPID&toolid=10001&mkevt=1'
    });
  }
  return out;
}

const REFINEMENT = {
  aspectDistributions: [
    { localizedAspectName: 'US Shoe Size', aspectValueDistributions: [['10', 412], ['10.5', 388], ['11', 351], ['9', 290], ['9.5', 270], ['12', 198], ['8', 120]].map(([v, c]) => ({ localizedAspectValue: v, matchCount: c })) },
    { localizedAspectName: 'Shoe Width', aspectValueDistributions: [['D', 1210], ['EE', 402], ['B', 77], ['C', 64], ['EEE', 41]].map(([v, c]) => ({ localizedAspectValue: v, matchCount: c })) },
    { localizedAspectName: 'Brand', aspectValueDistributions: [['Justin', 520], ['Tony Lama', 410], ['Ariat', 395], ['Lucchese', 312], ['Nocona', 233], ['Dan Post', 180], ['Larry Mahan', 51]].map(([v, c]) => ({ localizedAspectValue: v, matchCount: c })) },
    { localizedAspectName: 'Upper Material', aspectValueDistributions: [['Leather', 1300], ['Ostrich', 140], ['Caiman', 96], ['Lizard', 88], ['Snakeskin', 61]].map(([v, c]) => ({ localizedAspectValue: v, matchCount: c })) },
    { localizedAspectName: 'Toe Shape', aspectValueDistributions: [['Square Toe', 610], ['Round Toe', 480], ['Pointed Toe', 300], ['Snip Toe', 170]].map(([v, c]) => ({ localizedAspectValue: v, matchCount: c })) },
    { localizedAspectName: 'Heel Height', aspectValueDistributions: [['Low (3/4 to 1 1/2 in)', 700], ['Mid (1 3/4 to 2 1/4 in)', 520], ['Flat (0 to 1/2 in)', 90]].map(([v, c]) => ({ localizedAspectValue: v, matchCount: c })) },
    { localizedAspectName: 'Style', aspectValueDistributions: [{ localizedAspectValue: 'Western', matchCount: 1640 }] }
  ],
  conditionDistributions: [{ condition: 'Pre-owned', conditionId: '3000', matchCount: 1302 }, { condition: 'New with box', conditionId: '1000', matchCount: 255 }, { condition: 'New without box', conditionId: '1500', matchCount: 83 }],
  buyingOptionDistributions: [{ buyingOption: 'FIXED_PRICE', matchCount: 1180 }, { buyingOption: 'AUCTION', matchCount: 460 }, { buyingOption: 'BEST_OFFER', matchCount: 512 }]
};

// opts: { total, now: () => ms, failSearch: status, failToken: status, failItem: status, goneIds: [ids], expiresIn }
function createMockFetch(opts) {
  opts = opts || {};
  const calls = [];
  const now = opts.now || Date.now;
  const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  async function mockFetch(url, init) {
    init = init || {};
    calls.push({ url: String(url), method: init.method || 'GET', headers: Object.assign({}, init.headers), body: init.body || null });
    const u = new URL(url);
    if (u.pathname === '/identity/v1/oauth2/token') {
      if (opts.failToken) return json(opts.failToken, { error: 'invalid_client', error_description: 'secret detail that must not leak' });
      return json(200, { access_token: 'mock-token-' + calls.length, expires_in: opts.expiresIn || 7200, token_type: 'Application Access Token' });
    }
    if (u.pathname === '/buy/browse/v1/item_summary/search') {
      if (typeof opts.failSearch === 'function') { const st = opts.failSearch(calls); if (st) return json(st, { errors: [{ errorId: 12001, message: 'internal eBay detail' }] }); }
      else if (opts.failSearch) return json(opts.failSearch, { errors: [{ errorId: 12001, message: 'internal eBay detail' }] });
      const p = u.searchParams;
      const total = opts.total != null ? opts.total : 1640;
      const limit = Math.min(+p.get('limit') || 50, Math.max(0, total - (+p.get('offset') || 0)));
      const offset = +p.get('offset') || 0;
      const fg = p.get('fieldgroups') || '';
      const body = { href: String(url), total, limit: +p.get('limit') || 50, offset,
        itemSummaries: sampleItems(now(), offset, limit, p.get('category_ids'), /buyingOptions:\{AUCTION\}/.test(p.get('filter') || '') ? ['AUCTION'] : /buyingOptions:\{FIXED_PRICE/.test(p.get('filter') || '') ? ['FIXED_PRICE'] : null) };
      if (/pickupPostalCode:/.test(p.get('filter') || '')) body.itemSummaries.forEach((it, i) => { it.distanceFromPickupLocation = { value: String((i * 7 + 3) % 45 + 1), unitOfMeasure: 'MILE' }; });
      if (offset + limit < total) body.next = 'next-page';
      if (/ASPECT_REFINEMENTS/.test(fg)) body.refinement = REFINEMENT;
      return json(200, body);
    }
    // getItem: /buy/browse/v1/item/v1|300000000005|0 -> the same fake listing search returns for n=5.
    const im = u.pathname.match(/^\/buy\/browse\/v1\/item\/(.+)$/);
    if (im) {
      if (opts.failItem) return json(opts.failItem, { errors: [{ errorId: 11001, message: 'internal eBay detail' }] });
      const m = decodeURIComponent(im[1]).match(/^v1\|(\d+)\|0$/);
      const n = m ? Number(m[1]) - 300000000000 : -1;
      if (n < 0 || n > 100000 || (opts.goneIds || []).includes(decodeURIComponent(im[1]))) return json(404, { errors: [{ errorId: 11001, message: 'not found' }] });
      return json(200, sampleItems(now(), n, 1, '11498')[0]);
    }
    return json(404, { errors: [{ message: 'not mocked' }] });
  }
  mockFetch.calls = calls;
  return mockFetch;
}

module.exports = { createMockFetch, sampleItems, REFINEMENT };
