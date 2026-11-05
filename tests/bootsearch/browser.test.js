// Headless browser tests for the rebuilt Boot Search page (ported from the EPN handoff harness).
// Needs: a running preview server and puppeteer-core + Chrome.
//   node scripts/dev-server.js 8091 &
//   npm i --no-save puppeteer-core     (or NODE_PATH=/path/to/node_modules)
//   NEW_URL=http://localhost:8091/eBayBootSearch/ node --test tests/bootsearch/browser.test.js
// Optional parity check against the old React bundle: serve the old build (e.g. a worktree of
// branch ebay-clean-links) and set OLD_URL=http://localhost:8092/eBayBootSearch/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');
const NEW_URL = process.env.NEW_URL || 'http://localhost:8091/eBayBootSearch/';
const OLD_URL = process.env.OLD_URL || '';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const SHOTS = process.env.SHOTS || '';
const EPN_KEYS = ['campid', 'customid', 'mkcid', 'mkrid', 'siteid', 'toolid', 'mkevt'];

let browser;
test.before(async () => { browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] }); });
test.after(async () => { if (browser) await browser.close(); });

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Opens a page with window.open stubbed and saved prefs injected. affiliate: true makes the SERVER
// status say affiliate: true (the one real switch), by answering /api/boots?status=1 in the browser.
// configOnly: true instead forces only the browser config, which must NOT turn paid links on.
async function open(url, { prefs = null, affiliate = false, configOnly = false, mobile = false } = {}) {
  const page = await browser.newPage();
  await page.setViewport(mobile ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: 1280, height: 900 });
  if (affiliate && !configOnly) {
    await page.setRequestInterception(true);
    page.on('request', r => r.url().includes('/api/boots?status=1')
      ? r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ live: false, env: 'production', affiliate: true, profile: 'dbs' }) })
      : r.continue());
  }
  await page.evaluateOnNewDocument((prefs, affiliate) => {
    window.__opened = [];
    window.open = (u, t, f) => { window.__opened.push([u, t || '', f || '']); return null; };   // the app must never call this
    // Record new-tab link clicks the app didn't take over (default not prevented), then stop the real navigation.
    window.addEventListener('click', e => {
      const a = e.target.closest && e.target.closest('a[target="_blank"]');
      if (!a || e.defaultPrevented) return;
      window.__opened.push([a.href, a.target, a.rel, 'link']); e.preventDefault();
    });
    try { localStorage.clear(); if (prefs) localStorage.setItem('dusty_prefs', JSON.stringify(prefs)); } catch (e) {}
    // old bundle switch
    Object.defineProperty(window, 'EBAY_AFFILIATE_ENABLED', { get: () => affiliate, set() {}, configurable: true });
    // new config: force the switch without editing config.js
    let cfg;
    Object.defineProperty(window, 'BOOTSEARCH_CONFIG', { get: () => cfg, set(v) { v.affiliate.enabled = affiliate; if (affiliate) v.affiliate.serverOn = true; cfg = v; }, configurable: true });
  }, prefs, affiliate);
  await page.goto(url, { waitUntil: 'networkidle0' });
  await sleep(300);
  return page;
}
const click = (page, text) => page.evaluate(t => {
  const bs = [...document.querySelectorAll('button')];
  const b = bs.find(b => b.textContent.trim() === t) || bs.find(b => b.textContent.trim().startsWith(t));
  if (!b) throw new Error('no button ' + t); b.click();
}, text);
async function go(page) { await page.evaluate(() => { window.__opened = []; }); await page.click('#go'); await sleep(150); return page.evaluate(() => window.__opened); }
const qp = u => new URL(u).searchParams;

const BASE = { interface_type: 'web', region: 'ebay.com', use_boot_filters: true, gender: 'mens', availability: 'available' };
const CASES = {
  'mens keywords': { ...BASE, any_keywords: 'lucchese justin', all_keywords: 'cowboy', exclude_keywords: 'kids' },
  'womens full filters': { ...BASE, gender: 'womens', selected_sizes_womens: ['7', '7.5'], selected_widths_womens: ['B'], selected_colors: ['Black'],
    selected_conditions: ['Used'], selected_brands: ['Old Gringo'], unbranded_checked: true, selected_handmade: ['Handmade'],
    selected_countries: ['USA'], selected_vintage: ['Yes'], price_min: '40', price_max: '400', sale_type: 'best_offer_only', sort_by: 'priceLowToHigh' },
  'uk mobile': { ...BASE, interface_type: 'mobile', region: 'ebay.co.uk', search_description: true },
  'germany web, exact phrase': { ...BASE, region: 'ebay.de', all_keywords: 'black cherry', all_keywords_mode: 'exact_order' },
  'category off': { ...BASE, use_boot_filters: false, any_keywords: 'boot jack', selected_brands: ['Lucchese'] },
  'pickup + returns + free ship': { ...BASE, returns_accepted: true, free_shipping: true, local_pickup: true, local_pickup_zipcode: '30301', local_pickup_distance: '50', sort_by: 'endingSoonest' }
};

test('OFF: disclosure hidden, non-endorsement shown, link clean, one tab with noopener', async () => {
  const page = await open(NEW_URL);
  const info = await page.evaluate(() => ({ disc: document.getElementById('disclosure').hidden,
    body: document.body.innerText, title: document.title }));
  assert.equal(info.disc, true);
  assert.doesNotMatch(info.body, /Paid link|Ad · Paid|earns from qualifying/);
  assert.match(info.body, /not affiliated with or endorsed by eBay/);
  assert.equal(info.title, "Dusty's Boot Finder – Searches live eBay listings | Dan's Boot Sale");
  const opened = await go(page);
  assert.equal(opened.length, 1);
  assert.equal(opened[0][1], '_blank'); assert.equal(opened[0][2], 'noopener noreferrer', 'unpaid: no sponsored');
  assert.equal(opened[0][3], 'link', 'a real <a> link, not window.open');
  for (const k of EPN_KEYS) assert.equal(qp(opened[0][0]).has(k), false, k);
  await page.close();
});

test('ON: disclosure is above the button and names EPN; US web link carries DBS web campaign', async () => {
  const page = await open(NEW_URL, { affiliate: true });
  const info = await page.evaluate(() => {
    const d = document.getElementById('disclosure'), g = document.getElementById('go');
    return { hidden: d.hidden, text: d.innerText, before: !!(d.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING),
      after: document.getElementById('after').innerText };
  });
  assert.equal(info.hidden, false); assert.equal(info.before, true);
  assert.match(info.text, /Ad · Paid links\. As an eBay Partner Network Affiliate, Dan's Boot Sale earns/);
  // Find My Boots is a real link: rel=sponsored when paid, set from the built URL.
  const g = await page.$eval('#go', a => ({ tag: a.tagName, rel: a.rel, href: a.href, prev: document.getElementById('previewUrl').textContent }));
  assert.equal(g.tag, 'A'); assert.equal(g.rel, 'sponsored noopener noreferrer'); assert.equal(g.href, g.prev);
  assert.match(info.text, /not affiliated with or endorsed by eBay/);
  assert.match(info.after, /^Paid link/);
  if (SHOTS) await page.screenshot({ path: SHOTS + '/new-affiliate-on-desktop.png', fullPage: true });
  const [[u]] = await go(page);
  const p = qp(u);
  assert.equal(p.get('campid'), '5339171324'); assert.equal(p.get('customid'), 'dbs-bootsearch-web');
  assert.equal(p.get('mkrid'), '711-53200-19255-0'); assert.equal(p.get('toolid'), '10001'); assert.equal(p.get('mkevt'), '1');
  await page.close();
});

test('single switch: forcing the browser config on (enabled/serverOn) with the server OFF gives clean links and no disclosure', async () => {
  const page = await open(NEW_URL, { affiliate: true, configOnly: true });
  await sleep(300);
  assert.equal(await page.$eval('#disclosure', d => d.hidden), true);
  assert.doesNotMatch(await page.evaluate(() => document.body.innerText), /Paid link|Ad · Paid/);
  const [[u]] = await go(page);
  for (const k of EPN_KEYS) assert.equal(qp(u).has(k), false, k);
  await page.close();
});

test('ON, UI flow (handoff harness): Both = one tab, combined; Sold = clean', async () => {
  const page = await open(NEW_URL, { affiliate: true });
  await click(page, 'Boot Filters'); await sleep(100);
  await click(page, 'Both'); await sleep(100);
  const hint = await page.evaluate(() => [...document.querySelectorAll('p')].map(p => p.textContent).find(t => t.startsWith('Both')));
  assert.equal(hint, 'Both runs one search in one tab, covering mens and womens (selected sizes and widths are combined)');
  await click(page, '10'); await page.click('[data-tab="size"][data-v="womens"]'); await sleep(50); await click(page, '7'); await sleep(50);
  await click(page, 'Done'); await sleep(100);
  let opened = await go(page);
  assert.equal(opened.length, 1, 'Both must open exactly one tab');
  let p = qp(opened[0][0]);
  assert.equal(p.get('_sacat'), '11450'); assert.equal(p.get('US Shoe Size'), '10|7');
  assert.equal(p.get('campid'), '5339171324');

  await click(page, 'Search Settings'); await sleep(100);
  await page.select('#avail', 'sold'); await sleep(50);
  await click(page, 'Done'); await sleep(100);
  const after = await page.evaluate(() => document.getElementById('after').innerText);
  assert.match(after, /not a paid link/);
  opened = await go(page);
  p = qp(opened[0][0]);
  assert.equal(p.get('LH_Sold'), '1'); assert.equal(p.get('LH_Complete'), '1');
  for (const k of EPN_KEYS) assert.equal(p.has(k), false, 'sold must be clean: ' + k);
  await page.close();
});

test('ON, ebay.pl region: clean link', async () => {
  const page = await open(NEW_URL, { affiliate: true });
  await page.select('#region', 'ebay.pl');
  const [[u]] = await go(page);
  for (const k of EPN_KEYS) assert.equal(qp(u).has(k), false, k);
  assert.match(u, /^https:\/\/www\.ebay\.pl\//);
  await page.close();
});

test('Shared link ?maker=lucchese&gender=womens&size=7 opens that exact search', async () => {
  const page = await open(NEW_URL + '?maker=lucchese&gender=womens&size=7&max=300');
  const [[u]] = await go(page);
  const p = qp(u);
  assert.equal(p.get('Brand'), 'Lucchese'); assert.equal(p.get('_sacat'), '53557');
  assert.equal(p.get('US Shoe Size'), '7'); assert.equal(p.get('_udhi'), '300');
  await page.close();
});

test('Saved settings: old "ebay_boot_prefs" key is moved to dusty_prefs once and deleted', async () => {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => { if (!sessionStorage.getItem('__m')) { localStorage.clear(); localStorage.setItem('ebay_boot_prefs', JSON.stringify({ any_keywords: 'oldsaved' })); sessionStorage.setItem('__m', '1'); } });
  await page.goto(NEW_URL, { waitUntil: 'networkidle0' }); await sleep(300);
  assert.equal(await page.$eval('#any', e => e.value), 'oldsaved');
  assert.equal(await page.evaluate(() => localStorage.getItem('ebay_boot_prefs')), null);
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('dusty_prefs'))).any_keywords, 'oldsaved');
  await page.close();
});

test('Saved settings: written on search when "Save" is ticked, removed when unticked', async () => {
  const page = await open(NEW_URL);
  await page.type('#any', 'nocona'); await go(page);
  let saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dusty_prefs')));
  assert.equal(saved.any_keywords, 'nocona');
  await page.click('#save'); await go(page);
  saved = await page.evaluate(() => localStorage.getItem('dusty_prefs'));
  assert.equal(saved, null);
  await page.close();
});

test('Parity with the old React tool (same saved prefs => same eBay URL)', { skip: !OLD_URL && 'OLD_URL not set' }, async () => {
  for (const affiliate of [false, true]) {
    for (const [name, prefs] of Object.entries(CASES)) {
      const oldP = await open(OLD_URL, { prefs, affiliate }); const [[oldUrl]] = await go(oldP); await oldP.close();
      const newP = await open(NEW_URL, { prefs, affiliate }); const [[newUrl]] = await go(newP); await newP.close();
      // The only intended difference for these cases: customid (placement label) when the switch is on.
      const expected = new URL(oldUrl);
      if (affiliate) {
        const entries = [...expected.searchParams.entries()]; const out = new URLSearchParams();
        for (const [k, v] of entries) { out.append(k, v); if (k === 'campid') out.append('customid', 'dbs-bootsearch-' + (prefs.interface_type === 'mobile' ? 'mobile' : 'web')); }
        expected.search = out.toString();
      }
      assert.equal(newUrl, expected.toString(), `${name} (affiliate ${affiliate ? 'on' : 'off'})\nold: ${oldUrl}\nnew: ${newUrl}`);
      console.log(`# parity ok: ${name} / affiliate ${affiliate ? 'on' : 'off'}`);
    }
  }
});
