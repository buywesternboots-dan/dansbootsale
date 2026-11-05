// Unit tests for js/store.js ("My Boots" on this device). No network.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ST = require(path.join(__dirname, '..', '..', 'eBayBootSearch/js/store.js'));
const HOUR = 3600e3, DAY = 24 * HOUR;
function mem() { const m = {}; return { m, getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } }; }
function clock(t = Date.parse('2026-10-21T16:00:00Z')) { const f = () => t; f.add = ms => { t += ms; }; return f; }
const repo = (st, now, o = {}) => ST.createRepo(ST.createLocalBackend(st), Object.assign({ now }, o));
const ID = n => 'v1|' + (300000000000 + n) + '|0';

test('picks and hidden: item IDs + time only, expire after 6 hours; viewed after 30 days', () => {
  const st = mem(), now = clock();
  const r = repo(st, now);
  assert.equal(r.togglePick(ID(1)), true); r.hide(ID(2)); r.markSeen(ID(3));
  const raw = JSON.parse(st.m[ST.KEY]);
  assert.deepEqual(Object.keys(raw.picks), [ID(1)]); assert.equal(typeof raw.picks[ID(1)], 'number');
  assert.deepEqual(Object.keys(raw.hidden), [ID(2)]);
  now.add(6 * HOUR - 1000);
  assert.equal(repo(st, now).isPick(ID(1)), true); assert.equal(repo(st, now).isHidden(ID(2)), true);
  now.add(1000);
  const r2 = repo(st, now);
  assert.equal(r2.isPick(ID(1)), false, 'pick gone at 6 h'); assert.equal(r2.isHidden(ID(2)), false, 'hidden gone at 6 h');
  assert.equal(r2.picksCount(), 0); assert.equal(r2.isSeen(ID(3)), true);
  assert.deepEqual(Object.keys(JSON.parse(st.m[ST.KEY]).picks), [], 'expired IDs are deleted from storage too');
  now.add(30 * DAY);
  assert.equal(repo(st, now).isSeen(ID(3)), false);
  // in-memory expiry without reload
  const r3 = repo(st, now); r3.togglePick(ID(9)); now.add(6 * HOUR); assert.equal(r3.isPick(ID(9)), false);
});

test('never stores listing data or links: whatever is passed in, only IDs and criteria are written', () => {
  const st = mem(), now = clock();
  const r = repo(st, now);
  r.togglePick(ID(1)); r.hide(ID(2)); r.markSeen(ID(3));
  r.saveSearch('Lucchese 10.5', 'maker=lucchese&size=10.5', { material: ['Ostrich'], western: true, title: 'x', url: 'https://www.ebay.com/itm/1?campid=5339171324' });
  r.addRun('maker=justin', {}, "Men's boots · Justin");
  const text = st.m[ST.KEY];
  assert.doesNotMatch(text, /https?:|campid|mkevt|customid|price|image|title|seller/i);
  assert.equal(r.togglePick('not an id'), false); r.hide('<img src=x>'); r.markSeen('javascript:1');
  assert.deepEqual(Object.keys(JSON.parse(st.m[ST.KEY]).picks), [ID(1)]);
});

test('link rebuild: a plain, untracked eBay link comes from the ID alone', () => {
  assert.equal(ST.plainItemUrl('v1|300000000001|0'), 'https://www.ebay.com/itm/300000000001');
  assert.equal(ST.plainItemUrl('nope'), '');
  assert.equal(ST.legacyId('v1|123456789012|0'), '123456789012');
});

test('saved searches: save (dup = move to top), rename, delete, max 20, run marks + new badge', () => {
  const st = mem(), now = clock();
  const r = repo(st, now, { maxSavedSearches: 3 });
  const a = r.saveSearch('A', 'maker=lucchese', {});
  now.add(1000); const b = r.saveSearch('B', 'maker=justin', { toe: ['Snip Toe'] });
  assert.deepEqual(r.searches().map(s => s.name), ['B', 'A']);
  now.add(1000); const again = r.saveSearch('', 'maker=lucchese', { western: true });
  assert.equal(again.id, a.id); assert.deepEqual(r.searches().map(s => s.name), ['A', 'B'], 'same criteria: moved to top, not duplicated');
  assert.equal(r.renameSearch(b.id, '  Justin snip toe  '), true); assert.equal(r.search(b.id).name, 'Justin snip toe');
  assert.equal(r.renameSearch(b.id, '   '), false, 'blank name refused');
  r.saveSearch('C', 'maker=nocona', {});
  assert.equal(r.atSearchLimit(), true); assert.equal(r.saveSearch('D', 'maker=ariat', {}), null, 'full: refused, nothing dropped');
  r.markRun(a.id, 4); assert.equal(r.newTotal(), 4); assert.equal(r.search(a.id).newCount, 4); assert.ok(r.search(a.id).lastRun > 0);
  r.clearNew(a.id); assert.equal(r.newTotal(), 0);
  assert.equal(r.deleteSearch(b.id), true); assert.equal(r.searches().length, 2);
  assert.deepEqual(repo(st, now).searches().map(s => s.name), ['C', 'A'], 'persisted');
});

test('recent searches: newest first, deduped, max 20, 30 days', () => {
  const st = mem(), now = clock(); const r = repo(st, now);
  for (let i = 0; i < 25; i++) { now.add(1000); r.addRun('size=' + i, {}, 'Size ' + i); }
  r.addRun('size=3', {}, 'Size 3 again');
  const runs = r.runs();
  assert.equal(runs.length, 20); assert.equal(runs[0].label, 'Size 3 again');
  assert.equal(runs.filter(x => x.q === 'size=3').length, 1);
  now.add(31 * DAY); assert.equal(repo(st, now).runs().length, 0);
});

test('clearAll ("Clear my data") removes every key this tool writes; export has everything', () => {
  const st = mem(), now = clock(); const r = repo(st, now);
  r.saveSearch('A', 'maker=lucchese', {}); r.togglePick(ID(1)); r.markSeen(ID(2));
  for (const k of ['ebay_boot_prefs', 'dusty_refine', 'dusty_view_prefs', 'dusty_last_visit']) st.setItem(k, 'x');
  st.setItem('someone_else', 'keep');
  const ex = r.exportData();
  assert.equal(ex.data.searches.length, 1); assert.deepEqual(Object.keys(ex.data.picks), [ID(1)]);
  r.clearAll();
  assert.deepEqual(Object.keys(st.m), ['someone_else']);
  assert.deepEqual(r.size(), { searches: 0, picks: 0, hidden: 0, viewed: 0, runs: 0 });
});

test('migration from earlier builds: criteria kept, listing copies dropped, old keys deleted', () => {
  const st = mem(), now = clock();
  st.setItem('dusty_saved_searches', JSON.stringify([{ name: 'Old', q: 'maker=tony-lama', r: { western: false }, at: now() - DAY }]));
  st.setItem('dusty_picks', JSON.stringify({ [ID(1)]: { at: now() - HOUR, snap: { id: ID(1), title: 'Boot', price: { value: '9' }, image: 'https://i.ebayimg.com/x.jpg', url: 'https://www.ebay.com/itm/1' } },
    [ID(2)]: { at: now() - 10 * HOUR, snap: { title: 'old' } } }));
  st.setItem('dusty_history', JSON.stringify({ [ID(3)]: { seen: now() - DAY }, [ID(4)]: { hidden: now() - HOUR, snap: { title: 'Hidden boot' } } }));
  const r = repo(st, now);
  assert.deepEqual(r.searches().map(s => [s.name, s.q, s.r.western]), [['Old', 'maker=tony-lama', false]]);
  assert.deepEqual(r.picks().map(p => p.id), [ID(1)], 'pick older than 6 h dropped');
  assert.equal(r.isSeen(ID(3)), true); assert.equal(r.isHidden(ID(4)), true);
  for (const k of ['dusty_saved_searches', 'dusty_picks', 'dusty_history']) assert.equal(st.getItem(k), null, k + ' deleted');
  assert.doesNotMatch(st.m[ST.KEY], /Boot|ebayimg|https/);
});

test('backend interface: memory backend works the same (accounts can plug in later); broken storage never throws', () => {
  const r = ST.createRepo(ST.createMemoryBackend(), { now: clock() });
  r.saveSearch('A', 'maker=lucchese', {}); r.togglePick(ID(1));
  assert.equal(r.searches().length, 1); assert.equal(r.isPick(ID(1)), true); assert.equal(r.backendKind, 'memory');
  const bad = { getItem: () => '{not json', setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('x'); } };
  const r2 = repo(bad, clock());
  r2.togglePick(ID(1)); r2.saveSearch('A', 'q', {}); r2.clearAll();
  assert.equal(r2.picksCount(), 0);
});
