// Unit tests for js/shopper.js: page sorting, "Run all my searches" merge/dedupe/sort and the
// throttled runner, last-visit time. No network, no storage of listings.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const SH = require(path.join(__dirname, '..', '..', 'eBayBootSearch/js/shopper.js'));
const DAY = 86400e3;
function mem() { const m = {}; return { m, getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } }; }
function clock(t = Date.parse('2026-10-21T16:00:00Z')) { const f = () => t; f.add = ms => { t += ms; }; return f; }
const item = (id, o = {}) => Object.assign({ id, title: 'Boot ' + id, url: 'https://www.ebay.com/itm/' + id,
  price: { value: '100.00', currency: 'USD' }, buyingOptions: ['FIXED_PRICE'], endDate: null, shipping: { value: '0.00', currency: 'USD' } }, o);

test('lastVisit: previous visit for the whole session, moves forward next session', () => {
  const local = mem(), now = clock();
  assert.equal(SH.lastVisit(local, mem(), now), null, 'first visit ever');
  const t1 = now(); now.add(DAY);
  const sess = mem();
  assert.equal(SH.lastVisit(local, sess, now), t1);
  now.add(60e3);
  assert.equal(SH.lastVisit(local, sess, now), t1, 'same session: unchanged on reload');
  const t2 = Number(local.m.dusty_last_visit);
  assert.equal(SH.lastVisit(local, mem(), now), t2, 'new session sees the previous one');
});

test('sort: price + shipping (auctions by current bid), calculated shipping after exact totals', () => {
  const items = [
    item('a', { price: { value: '50' }, shipping: { value: '30' } }),          // 80
    item('b', { price: { value: '70' }, shipping: { value: '0' } }),           // 70
    item('c', { price: { value: '10' }, shipping: { calculated: true } }),     // 10, not exact
    item('d', { price: { value: '999' }, currentBid: { value: '60' }, buyingOptions: ['AUCTION'], shipping: { value: '5' } }), // 65
    item('e', { price: null })
  ];
  assert.deepEqual(SH.sortItems(items, 'priceLowToHigh').map(i => i.id), ['d', 'b', 'a', 'c', 'e']);
  assert.deepEqual(SH.sortItems(items, 'priceHighToLow').map(i => i.id), ['a', 'b', 'd', 'c', 'e']);
  assert.deepEqual(SH.totalCost(items[0]), { value: 80, exact: true });
});

test('sort: most bids, distance (unknown last), and server sorts keep eBay order', () => {
  const items = [item('a', { bidCount: 3 }), item('b', { bidCount: null }), item('c', { bidCount: 12, distance: { value: 40 } }), item('d', { bidCount: 3, distance: { value: 5 } })];
  assert.deepEqual(SH.sortItems(items, 'mostBids').map(i => i.id), ['c', 'a', 'd', 'b']);
  assert.deepEqual(SH.sortItems(items, 'distance').map(i => i.id), ['d', 'c', 'a', 'b']);
  for (const m of ['bestMatch', 'endingSoonest', 'newlyListed']) assert.deepEqual(SH.sortItems(items, m).map(i => i.id), ['a', 'b', 'c', 'd']);
});

const T0 = Date.parse('2026-10-21T12:00:00Z');
const iso = h => new Date(T0 + h * 3600e3).toISOString();
function runsFixture() {
  return [
    { search: { id: 's1', name: 'Lucchese 10.5' }, newSince: T0 - 2 * 3600e3, items: [
      item('A', { created: iso(-1), endDate: iso(30), price: { value: '200' } }),          // new for s1
      item('B', { created: iso(-5), endDate: iso(2), price: { value: '90' } }),
      item('C', { created: iso(-3), endDate: iso(10), price: { value: '150' } }) ] },
    { search: { id: 's2', name: 'Tony Lama EE' }, newSince: 0, items: [                    // first run: nothing "new"
      item('C', { created: iso(-3), endDate: iso(10), price: { value: '150' } }),          // duplicate of s1's C
      item('D', { created: iso(-0.5), endDate: null, price: { value: '60' } }),
      item('B', { created: iso(-5), endDate: iso(2), price: { value: '90' } }) ] }
  ];
}

test('mergeRuns: dedupes by item ID, tags every source search, best rank kept, "new" per search', () => {
  const m = SH.mergeRuns(runsFixture());
  assert.deepEqual(m.map(i => i.id), ['A', 'B', 'C', 'D']);
  const C = m.find(i => i.id === 'C');
  assert.deepEqual(C.sources.map(s => s.name), ['Lucchese 10.5', 'Tony Lama EE']);
  assert.equal(C.rank, 0, 'C is #1 in Tony Lama EE');
  assert.equal(m.find(i => i.id === 'A').isNew, true);
  assert.equal(m.find(i => i.id === 'D').isNew, false, 'first run of a search marks nothing new');
  assert.equal(m.find(i => i.id === 'C').isNew, false, 'C created before s1 last ran');
  assert.deepEqual(SH.newCounts(runsFixture()), { s1: 1, s2: 0 });
  // inputs not mutated
  const r = runsFixture(); SH.mergeRuns(r); assert.equal('sources' in r[0].items[0], false);
});

test('sortMerged: best match interleaves, price low/high, ending soonest, newest listed', () => {
  const m = SH.mergeRuns(runsFixture());
  assert.deepEqual(SH.sortMerged(m, 'bestMatch').map(i => i.id), ['A', 'C', 'B', 'D'], 'round-robin by position: #1s, then #2s');
  assert.deepEqual(SH.sortMerged(m, 'priceLowToHigh').map(i => i.id), ['D', 'B', 'C', 'A']);
  assert.deepEqual(SH.sortMerged(m, 'priceHighToLow').map(i => i.id), ['A', 'C', 'B', 'D']);
  assert.deepEqual(SH.sortMerged(m, 'endingSoonest').map(i => i.id), ['B', 'C', 'A', 'D'], 'no end date sorts last');
  assert.deepEqual(SH.sortMerged(m, 'newlyListed').map(i => i.id), ['D', 'A', 'C', 'B']);
  assert.notEqual(SH.sortMerged(m, 'priceLowToHigh'), m, 'returns a new array');
});

test('mergeRuns: a paid copy of a duplicate keeps the server-given paid URL', () => {
  const m = SH.mergeRuns([
    { search: { id: 'x', name: 'x' }, items: [item('Z')] },
    { search: { id: 'y', name: 'y' }, items: [item('Z', { paid: true, url: 'https://www.ebay.com/itm/Z?mkevt=1' })] }]);
  assert.equal(m[0].paid, true); assert.match(m[0].url, /mkevt=1/);
});

test('runAll: concurrency 2, delay between starts, max count, order kept, failures isolated', async () => {
  const searches = Array.from({ length: 7 }, (_, i) => ({ id: 's' + i, name: 'S' + i }));
  let active = 0, peak = 0; const started = [], sleeps = [], progress = [];
  const fetchOne = s => { active++; peak = Math.max(peak, active); started.push(s.id);
    return new Promise(r => setImmediate(r)).then(() => { active--; if (s.id === 's2') throw new Error('HTTP 500'); if (s.id === 's3') return { fallback: true, reason: 'busy' }; return { items: [item(s.id)] }; }); };
  const out = await SH.runAll(searches, fetchOne, { max: 5, concurrency: 2, delayMs: 250, sleep: ms => { sleeps.push(ms); return Promise.resolve(); }, onProgress: (d, t) => progress.push(d + '/' + t) });
  assert.equal(peak, 2, 'never more than 2 at once');
  assert.deepEqual(started, ['s0', 's1', 's2', 's3', 's4'], 'max 5: s5, s6 never run');
  assert.equal(out.skipped, 2);
  assert.deepEqual(sleeps, [250, 250, 250], 'small gap before every start after the first two');
  assert.deepEqual(out.results.map(r => [r.search.id, r.ok]), [['s0', true], ['s1', true], ['s2', false], ['s3', false], ['s4', true]]);
  assert.equal(out.results[3].error, 'busy');
  assert.deepEqual(progress, ['1/5', '2/5', '3/5', '4/5', '5/5']);
  assert.deepEqual(await SH.runAll([], fetchOne), { results: [], skipped: 0 });
});
