// Headless browser smoke tests for "My Boots" and "Run all my searches", desktop + mobile, against
// the local preview. Never contacts eBay: the page talks only to /api/boots, which serves MOCK data.
//   DUSTY_MOCK_EBAY=1 node scripts/dev-server.js 8093 &      (mock eBay, tracking off)
//   node scripts/dev-server.js 8091 &                         (no keys: live results off)
//   LIVE_URL=http://localhost:8093/boot-search OFF_URL=http://localhost:8091/boot-search \
//     SHOTS=/workspace/audit/bootsearch/mybooks node --test tests/bootsearch/myboots.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');
const LIVE_URL = process.env.LIVE_URL || 'http://localhost:8093/boot-search';
const OFF_URL = process.env.OFF_URL || 'http://localhost:8091/boot-search';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const SHOTS = process.env.SHOTS || '';
const EPN_KEYS = ['campid', 'customid', 'mkcid', 'mkrid', 'siteid', 'toolid', 'mkevt'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const VIEW = { desktop: { width: 1280, height: 900 }, mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } };

let browser;
test.before(async () => { browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] }); });
test.after(async () => { if (browser) await browser.close(); });

// opts: mobile, doc (preloaded My Boots), paid (mark API items paid + server says affiliate: true),
// fail (searches answer 502), connected (seller name the server would label: connected: true)
const pages = [];
test.afterEach(async () => { while (pages.length) { const p = pages.pop(); if (!p.isClosed()) await p.close(); } });
async function open(url, { mobile = false, doc = null, paid = false, keep = false, fail = false, connected = '' } = {}) {
  const page = await browser.newPage(); pages.push(page);
  await page.setCacheEnabled(false);   // count real requests only (no background revalidation)
  await page.setViewport(mobile ? VIEW.mobile : VIEW.desktop);
  page.api = []; page.errors = []; page.inflight = 0; page.peak = 0;
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.setRequestInterception(true);
  page.on('request', async r => {
    const u = r.url();
    if (/ebay\.com/.test(new URL(u).hostname)) { page.errors.push('page contacted eBay: ' + u); return r.abort(); }
    if (u.includes('/api/boots') && !u.includes('status=1')) { page.api.push(u); page.inflight++; page.peak = Math.max(page.peak, page.inflight); }
    if (fail && u.includes('/api/boots') && !u.includes('status=1')) {
      if (paid) await r.respond({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'upstream' }) }); else await r.respond({ status: 502, body: '{}' });
      return;
    }
    if ((paid || connected) && u.includes('/api/boots')) {
      // Fetch the mock answer server-side, then mark it as the server would with tracking ON.
      // (No campaign ID is used or invented: only the paid flag and a tracking-looking param.)
      const res = await fetch(u); const j = await res.json();
      if (u.includes('status=1')) { if (paid) Object.assign(j, { affiliate: true, profile: 'dbs' }); }
      else if (j.items) {
        if (paid) { j.paid = true; j.items.forEach(it => { it.paid = true; it.url = it.url + '?mkevt=1'; }); }
        if (connected) j.items.forEach(it => { if (it.seller && it.seller.name === connected) it.connected = true; });
      }
      await sleep(40);
      return r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(j) });
    }
    if (u.includes('/api/boots') && !u.includes('status=1')) await sleep(40);   // so overlap is measurable
    r.continue();
  });
  page.on('requestfinished', r => { if (r.url().includes('/api/boots') && !r.url().includes('status=1')) page.inflight--; });
  page.on('requestfailed', r => { if (r.url().includes('/api/boots') && !r.url().includes('status=1')) page.inflight--; });
  await page.evaluateOnNewDocument((doc, keep) => {
    window.__opened = [];
    window.open = (u, t, f) => { window.__opened.push([u, t || '', f || '']); return null; };   // the app must never call this
    // Record new-tab link clicks the app didn't take over (default not prevented), then stop the real navigation.
    window.addEventListener('click', e => {
      const a = e.target.closest && e.target.closest('a[target="_blank"]');
      if (!a || e.defaultPrevented) return;
      window.__opened.push([a.href, a.target, a.rel, 'link']); e.preventDefault();
    });
    if (!keep && !sessionStorage.getItem('__init')) { try { localStorage.clear(); if (doc) localStorage.setItem('dusty_myboots_v1', JSON.stringify(doc)); } catch (e) {} sessionStorage.setItem('__init', '1'); }
  }, doc, keep);
  await page.goto(url, { waitUntil: 'networkidle0' });
  await sleep(250);
  return page;
}
async function search(page) { await page.click('#go'); await page.waitForSelector('#resList .rc', { timeout: 5000 }); await sleep(150); }
const shot = (page, name, full = true) => SHOTS ? page.screenshot({ path: SHOTS + '/' + name, fullPage: full }) : null;
const myDoc = page => page.evaluate(() => JSON.parse(localStorage.getItem('dusty_myboots_v1') || 'null'));
async function runAll(page) {
  await page.click('#runAll');
  await page.waitForFunction(() => /^All my searches: /.test(document.getElementById('resTitle').textContent), { timeout: 8000 });
  await sleep(150);
}
function savedDoc(searches, extra = {}) {
  return Object.assign({ v: 1, searches: searches.map((s, i) => Object.assign({ id: 's' + i, name: s[0], q: s[1], r: { western: true }, at: Date.now() - 1e6, lastRun: 0, newCount: 0 }, s[2] || {})),
    picks: {}, hidden: {}, viewed: {}, runs: [] }, extra);
}

for (const mode of ['desktop', 'mobile']) {
  test(`${mode}: save two searches, Run all, merged + deduped + tagged, sort on the page, nothing stored but criteria`, async () => {
    const page = await open(LIVE_URL, { mobile: mode === 'mobile' });
    assert.equal(await page.$eval('#myBoots', e => e.hidden), true);
    await page.type('#any', 'lucchese');
    await search(page);
    await page.click('#resSave'); await sleep(150);
    await page.click('[data-mode="auction"]'); await sleep(600);
    await page.click('#resSave'); await sleep(150);
    const doc = await myDoc(page);
    assert.equal(doc.searches.length, 2);
    assert.deepEqual(doc.searches.map(x => x.name), ["“lucchese” · Men's boots · auction only", "“lucchese” · Men's boots"]);
    assert.equal(await page.$eval('#runAll', b => b.textContent), 'Run all my searches (2)');

    // Coming back later: reload, the Run-all button is right at the top.
    await page.reload({ waitUntil: 'networkidle0' }); await sleep(250);
    await page.evaluate(() => window.scrollTo(0, 0)); await sleep(100);
    const top = await page.$eval('#runAll', b => b.getBoundingClientRect().bottom + window.scrollY);
    assert.ok(top < VIEW[mode].height, 'Run all is on the first screen without scrolling (bottom at ' + top + 'px)');
    assert.match(await page.$eval('#mbSub', e => e.textContent), /2 saved searches/);
    await shot(page, `${mode}-1-my-boots-on-return.png`, false);

    page.api = []; page.peak = 0;
    await runAll(page);
    // Distinct URLs: after a reload Chrome may also revalidate a cached copy in the background
    // (the API's existing stale-while-revalidate header); that hits our server cache, not eBay.
    const calls = [...new Set(page.api.filter(u => !u.includes('ids=')))];
    assert.equal(calls.length, 2, 'one live call per saved search');
    assert.ok(calls.some(u => /sale=auction_only/.test(u)) && calls.some(u => /any=lucchese/.test(u)));
    assert.ok(page.peak <= 2, 'at most 2 searches in flight');
    const info = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#resList .rc')];
      return { n: cards.length, ids: cards.map(c => c.getAttribute('data-id')), title: document.getElementById('resTitle').textContent,
        tab: document.querySelector('#results .tab.on').getAttribute('data-tab'), srcs: cards.map(c => [...c.querySelectorAll('.rc-src span')].map(s => s.textContent)),
        asOf: document.getElementById('resAsOf').textContent, disc: document.getElementById('resDisclosure').hidden,
        links: cards.map(c => [c.querySelector('a').href, c.querySelector('a').rel]), body: document.getElementById('results').innerText };
    });
    assert.equal(new Set(info.ids).size, info.n, 'no duplicate item IDs');
    assert.equal(info.tab, 'all');
    assert.match(info.title, /^All my searches: \d+ boots$/);
    assert.match(info.asOf, /^Live as of \d{1,2}:\d\d (AM|PM) ET · 2 searches/);
    assert.ok(info.srcs.every(s => s.length >= 1), 'every card names its search');
    assert.ok(info.srcs.some(s => s.length === 2), 'a boot both searches found is shown once with both tags');
    assert.equal(info.disc, true, 'tracking off: no disclosure');
    assert.doesNotMatch(info.body, /Paid link/);
    for (const [href, rel] of info.links) { const u = new URL(href); for (const k of EPN_KEYS) assert.equal(u.searchParams.has(k), false, k); assert.doesNotMatch(rel, /sponsored/); }
    await shot(page, `${mode}-2-run-all-merged.png`);
    await page.evaluate(() => document.getElementById('results').scrollIntoView({ block: 'start' })); await sleep(200);
    await shot(page, `${mode}-2b-run-all-closeup.png`, false);

    // Sort on the page: no new eBay calls.
    const before = page.api.length;
    for (const [sort, check] of [['priceLowToHigh', (a, b) => a <= b], ['priceHighToLow', (a, b) => a >= b]]) {
      await page.select('#resSort', sort); await sleep(150);
      const prices = await page.$$eval('#resList .rc-price b', bs => bs.map(b => parseFloat(b.textContent.replace(/[$,]/g, ''))));
      // price + shipping ordering: check price order loosely via first/last
      assert.ok(prices.length > 3);
      assert.ok(check(prices[0] - 30, prices[prices.length - 1]), sort);
    }
    await page.select('#resSort', 'endingSoonest'); await sleep(150);
    const ends = await page.$$eval('#resList .rc', cs => cs.map(c => (c.querySelector('[data-end]') || {}).getAttribute ? Date.parse(c.querySelector('[data-end]').getAttribute('data-end')) : null).filter(Boolean));
    for (let i = 1; i < ends.length; i++) assert.ok(ends[i] >= ends[i - 1], 'ending soonest order');
    await page.select('#resSort', 'newlyListed'); await sleep(150);
    assert.equal(page.api.length, before, 'sorting never refetches');
    if (mode === 'mobile') await shot(page, 'mobile-3-merged-sorted-newest.png', false);

    // Nothing but criteria and IDs ever lands in storage.
    const raw = await page.evaluate(() => Object.keys(localStorage).map(k => k + '=' + localStorage.getItem(k)).join('\n'));
    assert.doesNotMatch(raw, /Lucchese Classics|ebayimg|data:image|https?:\/\/|"title"|"price"/);
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
    assert.ok(m.sw <= m.w + 1, 'no sideways scroll');
    assert.deepEqual(page.errors, []);
    await page.close();
  });
}

test('picks: heart stores only the ID, Picks tab refetches live by ID; hide + viewed + undo', async () => {
  const page = await open(LIVE_URL, { doc: savedDoc([['Lucchese', 'any=lucchese'], ['Auctions', 'sale=auction_only&sort=endingSoonest']]) });
  await runAll(page);
  const ids = await page.$$eval('#resList .rc', cs => cs.map(c => c.getAttribute('data-id')));
  await page.click(`[data-pick="${ids[0]}"]`); await sleep(100);
  await page.click(`[data-pick="${ids[1]}"]`); await sleep(100);
  let doc = await myDoc(page);
  assert.deepEqual(Object.keys(doc.picks).sort(), [ids[0], ids[1]].sort());
  assert.ok(Object.values(doc.picks).every(v => typeof v === 'number'), 'time only, no listing copy');
  // hide one
  await page.click(`[data-hide="${ids[2]}"]`); await sleep(100);
  assert.equal(await page.$(`#resList [data-id="${ids[2]}"]`), null);
  assert.equal(await page.$eval('#resUndo', e => e.hidden), false);
  // view one (click the eBay link; target=_blank is stubbed by preventing navigation)
  await page.evaluate(id => { const a = document.querySelector(`#resList [data-id="${id}"] a`); a.addEventListener('click', e => e.preventDefault(), { once: true }); a.click(); }, ids[3]);
  await sleep(100);
  assert.ok((await myDoc(page)).viewed[ids[3]]);
  page.api = [];
  await page.click('#results [data-tab="picks"]');
  await page.waitForFunction(() => document.querySelectorAll('#resList .rc').length === 2, { timeout: 5000 });
  assert.equal(page.api.length, 1); assert.match(decodeURIComponent(page.api[0]), /ids=v1\|/);
  const pick = await page.$eval('#resList .rc', c => ({ title: c.querySelector('.rc-title').textContent, href: c.querySelector('a').href, price: c.querySelector('.rc-price').textContent }));
  assert.ok(pick.title.length > 10, 'title comes from the live lookup'); assert.match(pick.price, /\$/);
  assert.match(pick.href, /^https:\/\/www\.ebay\.com\/itm\/\d+$/, 'link rebuilt now: plain while tracking is off');
  assert.match(await page.$eval('#resAsOf', e => e.textContent), /as of \d{1,2}:\d\d (AM|PM) ET/);
  await shot(page, 'desktop-4-picks-live-refetch.png');
  await page.click('#results [data-tab="hidden"]'); await page.waitForSelector('#resList [data-unhide]', { timeout: 5000 });
  await page.click('#resList [data-unhide]'); await sleep(200);
  assert.equal((await myDoc(page)).hidden[ids[2]], undefined);
  await page.click('#results [data-tab="viewed"]'); await page.waitForFunction(() => document.querySelectorAll('#resList .rc').length === 1, { timeout: 5000 });
  // un-heart from the Picks tab
  await page.click('#results [data-tab="picks"]');
  await page.waitForFunction(() => document.getElementById('resTitle').textContent === '♥ My picks' && document.querySelectorAll('#resList .rc-title').length === 2 &&
    !/eBay item/.test(document.getElementById('resList').textContent), { timeout: 5000 });
  await page.click('#resList [data-pick]'); await sleep(200);
  assert.equal(await page.$$eval('#resList .rc', c => c.length), 1);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('new-match badge (on-site only): listings newer than the last run are flagged, per search and on cards', async () => {
  const doc = savedDoc([['Lucchese', 'any=lucchese', { lastRun: Date.now() - 3.5 * 3600e3 }], ['Never run', 'sale=auction_only&sort=endingSoonest']]);
  const page = await open(LIVE_URL, { doc });
  await runAll(page);
  const n = await page.$$eval('#resList .badge.new', b => b.filter(x => x.textContent === 'New match').length);
  assert.ok(n >= 1, 'some cards say New match');
  assert.match(await page.$eval('#resAsOf', e => e.textContent), /\d+ new since last run/);
  const d = await myDoc(page);
  assert.ok(d.searches[0].newCount >= 1); assert.equal(d.searches[1].newCount, 0, 'first run never counts as new');
  await page.click('#mbToggle'); await sleep(100);
  assert.match(await page.$eval('#mbSearches', e => e.textContent), /\d+ new/);
  assert.equal(await page.$eval('#mbNew', e => e.hidden), false);
  await shot(page, 'desktop-5-new-match-badges.png');
  await page.evaluate(() => document.getElementById('results').scrollIntoView({ block: 'start' })); await sleep(200);
  await shot(page, 'desktop-5b-new-match-closeup.png', false);
  await page.close();
});

test('My Boots panel: rename inline, recent searches, delete, Download my data, Clear my data wipes everything', async () => {
  const page = await open(LIVE_URL, { doc: savedDoc([['Lucchese', 'any=lucchese'], ['Auctions', 'sale=auction_only&sort=endingSoonest']]) });
  await page.click('#mbToggle'); await sleep(100);
  await page.click('[data-rename="s0"]'); await sleep(100);
  await page.$eval('#mbRenameIn', e => { e.value = ''; });
  await page.type('#mbRenameIn', 'Black cherry Lucchese');
  await page.keyboard.press('Enter'); await sleep(150);
  assert.equal((await myDoc(page)).searches[0].name, 'Black cherry Lucchese');
  await page.click('[data-runone="s0"]'); await page.waitForSelector('#resList .rc'); await sleep(200);
  assert.match(await page.$eval('#mbRuns', e => e.textContent), /“lucchese” · Men's boots/, 'recent searches list names the keywords');
  if (SHOTS) { await page.evaluate(() => window.scrollTo(0, 0)); await shot(page, 'desktop-6-panel-open.png', false); }
  const exportJson = await page.evaluate(() => JSON.stringify(window.DustyLive.store().exportData()));
  assert.match(exportJson, /Black cherry Lucchese/);
  await page.click('[data-delsearch="s1"]'); await sleep(100);
  assert.equal((await myDoc(page)).searches.length, 1);
  await page.evaluate(() => { localStorage.setItem('dusty_prefs', '{}'); localStorage.setItem('ebay_boot_prefs', '{}'); });
  await page.click('#clearData'); await sleep(200);
  const keys = await page.evaluate(() => Object.keys(localStorage));
  assert.deepEqual(keys.filter(k => /dusty|ebay_boot/.test(k)), [], 'nothing of ours left');
  assert.equal(await page.$eval('#myBoots', e => e.hidden), true);
  await page.close();
});

test('tracking ON (server says so): disclosure under the merged title, on screen on a phone; cards say Paid link with rel=sponsored', async () => {
  const page = await open(LIVE_URL, { mobile: true, paid: true, doc: savedDoc([['Lucchese', 'any=lucchese'], ['Auctions', 'sale=auction_only&sort=endingSoonest']]) });
  await runAll(page);
  await page.evaluate(() => document.getElementById('results').scrollIntoView({ block: 'start' })); await sleep(300);
  const d = await page.evaluate(() => {
    const dis = document.getElementById('resDisclosure'), r = dis.getBoundingClientRect(), t = document.getElementById('resTitle'), o = document.getElementById('resOpen');
    const first = document.querySelector('#resList .rc');
    return { hidden: dis.hidden, text: dis.innerText, bottom: r.bottom, top: r.top, vh: innerHeight,
      afterTitle: !!(t.compareDocumentPosition(dis) & Node.DOCUMENT_POSITION_FOLLOWING), beforeOpen: !!(dis.compareDocumentPosition(o) & Node.DOCUMENT_POSITION_FOLLOWING),
      aboveCards: r.bottom <= first.getBoundingClientRect().top, cta: first.querySelector('.rc-cta').textContent, rel: first.querySelector('a').rel };
  });
  assert.equal(d.hidden, false);
  assert.match(d.text, /As an eBay Partner Network Affiliate, Dan's Boot Sale earns from qualifying purchases/);
  assert.ok(d.afterTitle && d.beforeOpen, 'under the title, above "Open this search on eBay"');
  assert.ok(d.top >= 0 && d.bottom <= d.vh, 'visible on a phone without scrolling past the results title');
  assert.ok(d.aboveCards);
  assert.match(d.cta, /^Paid link · /); assert.match(d.rel, /sponsored/); assert.match(d.rel, /noopener/);
  // single search too: disclosure placement + resOpen rel
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('#go'); await page.waitForFunction(() => /boots found/.test(document.getElementById('resTitle').textContent), { timeout: 5000 });
  assert.equal(await page.$eval('#resDisclosure', e => e.hidden), false);
  assert.equal(await page.$eval('#resOpen', a => a.rel), 'sponsored noopener noreferrer');
  assert.equal(await page.$eval('#disclosure', e => e.hidden), false, 'form disclosure above Find My Boots too');
  await page.evaluate(() => document.getElementById('results').scrollIntoView({ block: 'start' })); await sleep(200);
  await shot(page, 'mobile-7-tracking-on-disclosure.png', false);
  await page.close();
});

test('live results OFF (no keys): Run all falls back to plain eBay links; picks show plain links built from the ID', async () => {
  const doc = savedDoc([['Lucchese', 'any=lucchese'], ['UK Ariat', 'region=ebay.co.uk&any=ariat']], { picks: { 'v1|300000000004|0': Date.now() - 60e3 } });
  const page = await open(OFF_URL, { doc });
  assert.equal(await page.$eval('#myBoots', e => e.hidden), false);
  page.api = [];
  await page.click('#runAll'); await sleep(300);
  const msg = await page.$eval('#resMsg', e => ({ text: e.textContent, links: [...e.querySelectorAll('a')].map(a => [a.href, a.rel]) }));
  assert.match(msg.text, /Live results aren’t available/);
  assert.equal(msg.links.length, 2);
  for (const [href, rel] of msg.links) { assert.match(href, /^https:\/\/www\.ebay\.(com|co\.uk)\/sch\/i\.html\?/); for (const k of EPN_KEYS) assert.equal(new URL(href).searchParams.has(k), false); assert.equal(rel, 'noopener noreferrer', 'unpaid: no sponsored'); }
  assert.equal(await page.$eval('#resDisclosure', e => e.hidden), true, 'nothing paid on screen');
  // My Boots entries are real links to eBay here (no live results), never window.open.
  await page.click('#mbToggle'); await sleep(100);
  const entry = await page.$eval('#mbSearches a[data-runone="s0"]', a => ({ href: a.href, rel: a.rel, target: a.target }));
  assert.match(entry.href, /^https:\/\/www\.ebay\.com\/sch\/i\.html\?.*lucchese/); assert.equal(entry.rel, 'noopener noreferrer'); assert.equal(entry.target, '_blank');
  await page.evaluate(() => { window.__opened = []; });
  await page.click('#mbSearches a[data-runone="s0"]'); await sleep(100);
  const op = await page.evaluate(() => window.__opened);
  assert.equal(op.length, 1); assert.equal(op[0][3], 'link'); assert.equal(op[0][0], entry.href);
  assert.equal(await page.$eval('#any', e => e.value), 'lucchese', 'criteria loaded into the form too');
  assert.equal(page.api.length, 0, 'no API calls when live results are off');
  await page.click('#myBoots [data-tab="picks"]'); await sleep(300);
  const pick = await page.$eval('#resList .rc', c => ({ href: c.querySelector('a').href, t: c.textContent }));
  assert.equal(pick.href, 'https://www.ebay.com/itm/300000000004');
  assert.match(pick.t, /eBay item 300000000004/);
  await shot(page, 'desktop-8-live-off-fallback.png');
  assert.deepEqual(page.errors, []);
  await page.close();
});

// N1: whenever ANY link on screen is paid, the disclosure shows: the "Open it on eBay" fallback,
// failed searches in the merged list, link-only searches, and My Boots link entries.
test('tracking ON + live search fails: fallback "Open it on eBay" is sponsored and the disclosure shows', async () => {
  const page = await open(LIVE_URL, { paid: true, fail: true });
  await page.click('#go');
  await page.waitForFunction(() => /Live results aren’t available/.test(document.getElementById('resMsg').textContent), { timeout: 5000 });
  const d = await page.evaluate(() => ({ dis: document.getElementById('resDisclosure').hidden, text: document.getElementById('resDisclosure').innerText,
    rel: document.querySelector('#resMsg a').rel, open: document.getElementById('resOpen').rel, cards: document.querySelectorAll('#resList .rc').length }));
  assert.equal(d.cards, 0);
  assert.equal(d.dis, false, 'disclosure shown for the paid fallback link');
  assert.match(d.text, /eBay Partner Network Affiliate/);
  assert.equal(d.rel, 'sponsored noopener noreferrer'); assert.equal(d.open, 'sponsored noopener noreferrer');
  assert.deepEqual(await page.evaluate(() => window.__opened), [], 'live results took over the click: no tab');
  assert.equal(await page.$eval('#go', a => a.rel), 'sponsored noopener noreferrer', 'Find My Boots link is marked sponsored when paid');
  await page.close();
});

test('tracking ON + every saved search fails in Run all: failed-search links are sponsored and disclosed', async () => {
  const page = await open(LIVE_URL, { paid: true, fail: true, doc: savedDoc([['Lucchese', 'any=lucchese'], ['Ariat', 'any=ariat']]) });
  await page.click('#runAll');
  await page.waitForFunction(() => document.querySelectorAll('#resMsg a').length >= 1, { timeout: 8000 }); await sleep(150);
  const d = await page.evaluate(() => ({ dis: document.getElementById('resDisclosure').hidden, rels: [...document.querySelectorAll('#resMsg a')].map(a => a.rel) }));
  assert.ok(d.rels.length >= 1);
  for (const r of d.rels) assert.equal(r, 'sponsored noopener noreferrer');
  assert.equal(d.dis, false, 'disclosure shown when only failed-search links are on screen');
  await page.close();
});

test('tracking ON + live results OFF: link-only Run all and My Boots link entries are sponsored and disclosed', async () => {
  const page = await open(OFF_URL, { paid: true, doc: savedDoc([['Lucchese', 'any=lucchese'], ['Sold Ariat', 'any=ariat&sold=1']]) });
  const panel = await page.evaluate(() => ({ rels: [...document.querySelectorAll('#mbSearches a.mb-name')].map(a => a.rel),
    dis: document.getElementById('mbDisclosure').hidden, text: document.getElementById('mbDisclosure').innerText }));
  assert.deepEqual(panel.rels, ['sponsored noopener noreferrer', 'noopener noreferrer'], 'sold searches are never paid');
  assert.equal(panel.dis, false, 'panel disclosure next to paid entries'); assert.match(panel.text, /eBay Partner Network Affiliate/);
  await page.click('#runAll'); await sleep(300);
  const d = await page.evaluate(() => ({ dis: document.getElementById('resDisclosure').hidden, rels: [...document.querySelectorAll('#resMsg a')].map(a => a.rel) }));
  assert.deepEqual(d.rels, ['sponsored noopener noreferrer', 'noopener noreferrer']);
  assert.equal(d.dis, false);
  await page.close();
});

test('connected seller (server-labelled): card says so, others do not', async () => {
  const page = await open(LIVE_URL, { connected: 'texasleatherco' });
  await search(page);
  const c = await page.evaluate(() => [...document.querySelectorAll('#resList .rc')].map(r => ({ seller: r.textContent.includes('texasleatherco'), label: (r.querySelector('.rc-conn') || {}).textContent || '' })));
  assert.ok(c.some(x => x.label), 'at least one labelled card');
  for (const x of c) assert.equal(!!x.label, x.seller, 'label only on the connected seller');
  assert.ok(c.filter(x => x.label).every(x => x.label === 'Seller has a business connection to this site'));
  await shot(page, 'desktop-9-connected-seller.png');
  await page.close();
});

test('throttle: 5 saved searches never run more than 2 at a time; max count respected', async () => {
  const s = Array.from({ length: 14 }, (_, i) => ['S' + i, 'any=boot' + i]);
  const page = await open(LIVE_URL, { doc: savedDoc(s) });
  page.api = []; page.peak = 0;
  await runAll(page);
  assert.equal(page.api.length, 12, 'max 12 searches per press');
  assert.ok(page.peak <= 2, 'peak in flight = ' + page.peak);
  assert.match(await page.$eval('#resMsg', e => e.textContent), /Only the first 12/);
  await page.close();
});
