// Headless browser tests for live results, against the local preview in MOCK mode (fake eBay data,
// never the real eBay API):
//   DUSTY_MOCK_EBAY=1 node scripts/dev-server.js 8093 &
//   LIVE_URL=http://localhost:8093/boot-search node --test tests/bootsearch/live.test.js   (needs puppeteer-core + Chrome)
// Optional: SHOTS=/workspace/dusty-shots saves screenshots.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');
const LIVE_URL = process.env.LIVE_URL || 'http://localhost:8093/boot-search';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const SHOTS = process.env.SHOTS || '';
const EPN_KEYS = ['campid', 'customid', 'mkcid', 'mkrid', 'siteid', 'toolid', 'mkevt'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

let browser;
test.before(async () => { browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] }); });
test.after(async () => { if (browser) await browser.close(); });

async function open(url, { failApi = false, mobile = false } = {}) {
  const page = await browser.newPage();
  await page.setViewport(mobile ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: 1280, height: 900 });
  page.api = []; page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.setRequestInterception(true);
  page.on('request', r => {
    const u = r.url();
    if (/ebay\.com/.test(new URL(u).hostname)) { page.errors.push('page contacted eBay: ' + u); return r.abort(); }
    if (u.includes('/api/boots')) {
      page.api.push(u);
      if (failApi && !u.includes('status=1')) return r.respond({ status: 500, contentType: 'application/json', body: '{"error":"x"}' });
    }
    r.continue();
  });
  await page.evaluateOnNewDocument(() => {
    window.__opened = [];
    window.open = (u, t, f) => { window.__opened.push([u, t || '', f || '']); return null; };   // the app must never call this
    // Record new-tab link clicks the app didn't take over (default not prevented), then stop the real navigation.
    window.addEventListener('click', e => {
      const a = e.target.closest && e.target.closest('a[target="_blank"]');
      if (!a || e.defaultPrevented) return;
      window.__opened.push([a.href, a.target, a.rel, 'link']); e.preventDefault();
    });
    try { localStorage.clear(); } catch (e) {}
  });
  await page.goto(url, { waitUntil: 'networkidle0' });
  await sleep(300);
  return page;
}
async function search(page) {
  await page.click('#go');
  await page.waitForFunction(() => document.querySelectorAll('#resList .rc').length > 0 || !document.getElementById('resMsg').hidden && /aren’t available/.test(document.getElementById('resMsg').textContent), { timeout: 5000 });
  await sleep(200);
}
const lastApi = page => new URL(page.api.filter(u => !u.includes('status=1')).pop());

test('Find My Boots shows live result cards on the page (no new tab), with every card field', async () => {
  const page = await open(LIVE_URL);
  await search(page);
  assert.deepEqual(await page.evaluate(() => window.__opened), [], 'no eBay tab opened');
  const info = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#resList .rc')];
    const c = cards[0];
    return {
      n: cards.length, title: document.getElementById('resTitle').textContent, asOf: document.getElementById('resAsOf').textContent,
      img: !!c.querySelector('.rc-img img'), t: c.querySelector('.rc-title').textContent, price: c.querySelector('.rc-price').textContent,
      meta: c.querySelector('.rc-meta').textContent, seller: c.querySelector('.rc-seller').textContent,
      disclosureHidden: document.getElementById('resDisclosure').hidden, foot: document.getElementById('resFoot').textContent,
      after: document.getElementById('after').textContent, pager: document.getElementById('resPage').textContent,
      iframes: document.querySelectorAll('iframe').length
    };
  });
  assert.equal(info.n, 24);
  assert.match(info.title, /^1,640 boots found$/);
  assert.match(info.asOf, /^Prices and bids as of \d{1,2}:\d\d (AM|PM) ET · Western styles only$/);
  assert.ok(info.img); assert.ok(info.t.length > 10);
  assert.match(info.price, /^\$\d/);
  assert.match(info.meta, /shipping/i);
  assert.match(info.seller, /^Seller: .+% positive \([\d,]+\)$/);
  assert.equal(info.disclosureHidden, true, 'tracking is off: no ad disclosure');
  assert.match(info.foot, /not affiliated with or endorsed by eBay/);
  assert.match(info.after, /Live results show below/);
  assert.match(info.pager, /^Showing 1–24 of 1,640$/);
  assert.equal(info.iframes, 0, 'never frame eBay');
  const q = lastApi(page).searchParams;
  assert.equal(q.has('page'), false);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('cards link out to eBay in a new tab, with no EPN parameters and no bid buttons', async () => {
  const page = await open(LIVE_URL);
  await search(page);
  const links = await page.$$eval('#resList a', as => as.map(a => [a.href, a.target, a.rel]));
  assert.equal(links.length, 24);
  for (const [href, target, rel] of links) {
    const u = new URL(href);
    assert.equal(u.protocol, 'https:'); assert.match(u.hostname, /(^|\.)ebay\.com$/);
    for (const k of EPN_KEYS) assert.equal(u.searchParams.has(k), false, k + ' in ' + href);
    assert.equal(target, '_blank'); assert.match(rel, /noopener/); assert.doesNotMatch(rel, /sponsored/);
  }
  const text = await page.$eval('#results', e => e.innerText);
  assert.doesNotMatch(text, /place bid|bid now|snipe|auto-?bid/i);
  assert.doesNotMatch(text, /Paid link/);
  await page.close();
});

test('auction mode: endingSoonest request, live countdown that ticks', async () => {
  const page = await open(LIVE_URL);
  await search(page);
  await page.click('[data-mode="auction"]'); await sleep(600);
  const q = lastApi(page).searchParams;
  assert.equal(q.get('sale'), 'auction_only'); assert.equal(q.get('sort'), 'endingSoonest');
  assert.equal(await page.$eval('[data-mode="auction"]', b => b.getAttribute('aria-pressed')), 'true');
  const t1 = await page.$eval('#resList [data-end]', e => e.textContent);
  assert.match(t1, /^(\d+d \d+h|\d+h \d+m|\d+m \d\ds) left$/);
  await sleep(1200);
  const t2 = await page.$eval('#resList [data-end]', e => e.textContent);
  assert.notEqual(t1, t2, 'countdown updates every second');
  assert.ok(await page.$('#resList .rc-time.soon'), 'an auction under 1 h is flagged');
  if (SHOTS) await page.screenshot({ path: SHOTS + '/test-auction-mode.png', fullPage: true });
  await page.close();
});

test('facets from eBay refine the search; western toggle; pagination; price', async () => {
  const page = await open(LIVE_URL);
  await search(page);
  const facetKeys = await page.$$eval('#resFacets .fx-t', e => e.map(x => x.textContent));
  assert.deepEqual(facetKeys, ['Size', 'Width', 'Brand', 'Material', 'Toe', 'Heel', 'Condition', 'Price']);
  await page.click('[data-facet="brand"][data-v="Justin"]'); await sleep(500);
  let q = lastApi(page).searchParams;
  assert.equal(q.get('brand'), 'Justin', 'known maker goes into the normal form state');
  await page.click('[data-facet="material"][data-v="Ostrich"]'); await sleep(500);
  q = lastApi(page).searchParams;
  assert.equal(q.get('r_material'), 'Ostrich');
  assert.equal(await page.$eval('[data-facet="material"][data-v="Ostrich"]', b => b.getAttribute('aria-pressed')), 'true');
  await page.click('[data-facet="cond"][data-v="3000"]'); await sleep(500);
  assert.equal(lastApi(page).searchParams.get('r_cond'), '3000');
  await page.click('#resWestern'); await sleep(500);
  assert.equal(lastApi(page).searchParams.get('western'), '0');
  assert.doesNotMatch(await page.$eval('#resAsOf', e => e.textContent), /Western styles only/);
  await page.$eval('#resNext', b => b.click()); await sleep(600);   // DOM click: Next/Prev smooth-scroll the page
  assert.equal(lastApi(page).searchParams.get('page'), '1');
  assert.match(await page.$eval('#resPage', e => e.textContent), /^Showing 25–48 of/);
  await page.$eval('#resPrev', b => b.click()); await sleep(600);
  assert.equal(lastApi(page).searchParams.has('page'), false);
  await page.$eval('#fxMin', e => { e.value = '50'; }); await page.$eval('#fxMax', e => { e.value = '300'; });
  await page.click('#fxPrice'); await sleep(500);
  q = lastApi(page).searchParams;
  assert.equal(q.get('min'), '50'); assert.equal(q.get('max'), '300');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('saved searches stay on this device (no email/SMS) in My Boots and re-run', async () => {
  const page = await open(LIVE_URL);
  assert.equal(await page.$eval('#myBoots', e => e.hidden), true, 'no My Boots panel before anything is saved');
  await search(page);
  await page.click('[data-mode="auction"]'); await sleep(500);
  await page.click('#resSave'); await sleep(200);
  const doc = await page.evaluate(() => JSON.parse(localStorage.getItem('dusty_myboots_v1')));
  assert.equal(doc.searches.length, 1); assert.match(doc.searches[0].q, /sale=auction_only/);
  assert.equal(await page.evaluate(() => localStorage.getItem('dusty_saved_searches')), null, 'old key not used');
  assert.equal(await page.$eval('#myBoots', e => e.hidden), false);
  assert.match(await page.$eval('#resSave', e => e.textContent), /Saved in My Boots/);
  await page.click('#mbToggle'); await sleep(100);
  assert.match(await page.$eval('#myBoots', e => e.textContent), /this device only/);
  assert.match(await page.$eval('#myBoots', e => e.textContent), /no emails or texts/);
  await page.click('#reset'); await sleep(200);
  await page.click('[data-runone]'); await sleep(600);
  assert.equal(lastApi(page).searchParams.get('sale'), 'auction_only');
  await page.click('[data-delsearch]'); await sleep(100);
  assert.equal(await page.$$eval('[data-runone]', e => e.length), 0);
  await page.close();
});

test('falls back to the link builder: API error -> "Open it on eBay" link; non-US region -> opens eBay as before', async () => {
  const page = await open(LIVE_URL, { failApi: true });
  await search(page);
  const msg = await page.$eval('#resMsg', e => ({ text: e.textContent, href: e.querySelector('a') && e.querySelector('a').href }));
  assert.match(msg.text, /Live results aren’t available/);
  assert.match(msg.href, /^https:\/\/www\.ebay\.com\/sch\/i\.html\?/);
  for (const k of EPN_KEYS) assert.equal(new URL(msg.href).searchParams.has(k), false);
  await page.close();

  const uk = await open(LIVE_URL);
  await uk.select('#region', 'ebay.co.uk');
  await uk.click('#go'); await sleep(200);
  const opened = await uk.evaluate(() => window.__opened);
  assert.equal(opened.length, 1); assert.match(opened[0][0], /^https:\/\/www\.ebay\.co\.uk\/sch\/i\.html/);
  await uk.close();
});

test('shared link opens straight onto results; refine picks survive in the link', async () => {
  const page = await open(LIVE_URL + '?maker=lucchese&size=10&r_toe=Snip%20Toe');
  await page.waitForSelector('#resList .rc', { timeout: 5000 });
  const q = lastApi(page).searchParams;
  assert.equal(q.get('brand'), 'Lucchese'); assert.equal(q.get('size'), '10'); assert.equal(q.get('r_toe'), 'Snip Toe');
  assert.match(await page.evaluate(() => location.search), /r_toe=Snip/);
  await page.close();
});

test('mobile layout: two-column cards, no horizontal scroll', async () => {
  const page = await open(LIVE_URL, { mobile: true });
  await search(page);
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth,
    cols: getComputedStyle(document.getElementById('resList')).gridTemplateColumns.split(' ').length }));
  assert.ok(m.sw <= m.w + 1, 'no sideways scroll'); assert.equal(m.cols, 2);
  if (SHOTS) await page.screenshot({ path: SHOTS + '/test-mobile.png', fullPage: true });
  await page.close();
});
