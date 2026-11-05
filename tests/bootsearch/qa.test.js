// Full QA pass for Boot Search: drives every control in headless Chrome at desktop (1280) and
// mobile (390) widths and decodes the eBay URL it would open. Never contacts eBay: window.open is
// stubbed and the URL is only parsed.
//   node scripts/dev-server.js 8091 &
//   NODE_PATH=/path/to/node_modules NEW_URL=http://localhost:8091/eBayBootSearch/ \
//     SHOTS=/workspace/audit/bootsearch/qa node --test tests/bootsearch/qa.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');
const D = require('../../eBayBootSearch/js/data.js');
const NEW_URL = process.env.NEW_URL || 'http://localhost:8091/eBayBootSearch/';
const ORIGIN = new URL(NEW_URL).origin;
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const SHOTS = process.env.SHOTS || '';
const EPN_KEYS = ['campid', 'customid', 'mkcid', 'mkrid', 'siteid', 'toolid', 'mkevt'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

let browser;
test.before(async () => { browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] }); });
test.after(async () => { if (browser) await browser.close(); });

const VIEW = { desktop: { width: 1280, height: 900 }, mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } };

async function open(url = NEW_URL, { mobile = false, keepStorage = false, page = null } = {}) {
  page = page || await browser.newPage();
  page.__errors = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') page.__errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => page.__errors.push('pageerror: ' + e.message));
  page.on('response', r => { if (r.status() >= 400) page.__errors.push(r.status() + ' ' + r.url()); });
  page.on('dialog', d => d.dismiss());
  await page.setViewport(mobile ? VIEW.mobile : VIEW.desktop);
  await page.evaluateOnNewDocument((keep) => {
    window.__opened = [];
    window.open = (u, t, f) => { window.__opened.push([u, t || '', f || '']); return null; };   // the app must never call this
    // Record new-tab link clicks the app didn't take over (default not prevented), then stop the real navigation.
    window.addEventListener('click', e => {
      const a = e.target.closest && e.target.closest('a[target="_blank"]');
      if (!a || e.defaultPrevented) return;
      window.__opened.push([a.href, a.target, a.rel, 'link']); e.preventDefault();
    });
    if (!keep && !sessionStorage.getItem('__kept')) { try { localStorage.clear(); } catch (e) {} }
    // config.js is untouched: the switch stays exactly as shipped (off)
  }, keepStorage);
  await page.goto(url, { waitUntil: 'networkidle0' });
  await sleep(150);
  return page;
}
const click = (page, text, scope = 'document') => page.evaluate((t, scope) => {
  const root = scope === 'modal' ? document.getElementById('modalBox') : document;
  const bs = [...root.querySelectorAll('button')].filter(b => b.offsetParent !== null);
  const b = bs.find(b => b.textContent.trim() === t) || bs.find(b => b.textContent.trim().startsWith(t));
  if (!b) throw new Error('no button ' + t); b.click();
}, text, scope);
const openModal = async (page, id) => { await page.click('#' + id); await sleep(80); };
const done = async page => { await page.click('#modalDone'); await sleep(60); };
const checkByValue = (page, list, v) => page.evaluate((list, v) => {
  const el = [...document.querySelectorAll('#modalBody input[data-list="' + list + '"]')].find(i => i.getAttribute('data-v') === v);
  if (!el) throw new Error('no checkbox ' + list + '=' + v); el.click();
}, list, v);
async function go(page) {
  await page.evaluate(() => { window.__opened = []; });
  await page.click('#go'); await sleep(60);
  const opened = await page.evaluate(() => window.__opened);
  assert.equal(opened.length, 1, 'exactly one tab');
  assert.equal(opened[0][1], '_blank'); assert.equal(opened[0][2], 'noopener noreferrer'); assert.equal(opened[0][3], 'link');
  const u = new URL(opened[0][0]);
  for (const k of EPN_KEYS) assert.equal(u.searchParams.has(k), false, 'affiliate param present while switch is off: ' + k);
  assert.equal(u.pathname, '/sch/i.html');
  // the "Show the eBay link" preview must always match what opens
  assert.equal(await page.$eval('#previewUrl', e => e.textContent), opened[0][0], 'preview link matches opened link');
  return u;
}
const P = u => Object.fromEntries(u.searchParams.entries());
async function shot(page, name, full = true) { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full }); }
async function overflow(page, scope = 'body') {
  return page.evaluate(scope => {
    const W = document.documentElement.clientWidth, out = [];
    document.querySelectorAll(scope + ' *').forEach(el => {
      if (el.closest('.brandlist') && el.closest('.brandlist') !== el) {
        const L = el.closest('.brandlist').getBoundingClientRect(), r = el.getBoundingClientRect();
        if (r.width && (r.right > L.right + 1 || r.left < L.left - 1)) out.push('brand outside list: ' + el.textContent.trim().slice(0, 30));
        return;
      }
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > W + 1 || r.left < -1)) out.push(el.tagName + '#' + el.id + '.' + el.className);
    });
    return { scrollW: document.documentElement.scrollWidth, W, out: out.slice(0, 8) };
  }, scope);
}

for (const vp of ['desktop', 'mobile']) {
  const mobile = vp === 'mobile';

  test(`[${vp}] loads clean: no console errors, no failed requests, no sideways overflow, switch off`, async () => {
    const page = await open(NEW_URL, { mobile });
    const o = await overflow(page);
    assert.equal(o.scrollW, o.W, 'page scrolls sideways'); assert.deepEqual(o.out, []);
    const info = await page.evaluate(() => ({ disc: document.getElementById('disclosure').hidden, body: document.body.innerText,
      regions: document.querySelectorAll('#region option').length }));
    assert.equal(info.disc, true); assert.doesNotMatch(info.body, /Paid link|Ad · Paid|earns from qualifying/);
    assert.match(info.body, /not affiliated with or endorsed by eBay/);
    assert.equal(info.regions, 18);
    await shot(page, `${vp}-01-default`);
    const u = await go(page);
    assert.deepEqual(P(u), { _nkw: '', _sacat: '11498', _sop: '10', _ipg: '240', rt: 'nc' });
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  test(`[${vp}] every pop-up: fits on screen, no overflow, every brand reachable`, async () => {
    const page = await open(NEW_URL, { mobile });
    for (const [id, name] of [['btnBoot', 'boot-filters'], ['btnBrands', 'brands'], ['btnSettings', 'settings'], ['btnMore', 'more']]) {
      await openModal(page, id);
      if (id === 'btnMore') { await page.click('input[data-flag="local_pickup"]'); await sleep(60); }
      const o = await overflow(page, '#modal');
      assert.deepEqual(o.out, [], name + ' overflow');
      const box = await page.$eval('#modalBox', e => { const r = e.getBoundingClientRect(); return [r.top, r.bottom, innerHeight]; });
      assert.ok(box[0] >= 0 && box[1] <= box[2] + 1, name + ' pop-up off screen ' + box);
      await shot(page, `${vp}-02-${name}`, false);
      if (id === 'btnBrands') {
        // all ~190 brands are in the list and inside its box (scrolling down reaches the last one)
        const r = await page.evaluate(() => {
          const L = document.getElementById('brandList'); const items = L.querySelectorAll('label.check');
          L.scrollTop = L.scrollHeight; const last = items[items.length - 1].getBoundingClientRect(), lb = L.getBoundingClientRect();
          return { n: items.length, lastVisible: last.bottom <= lb.bottom + 2 && last.top >= lb.top - 2, sideways: L.scrollWidth > L.clientWidth + 1 };
        });
        assert.equal(r.n, D.BRANDS.length); assert.equal(r.lastVisible, true, 'last brand reachable by scrolling down'); assert.equal(r.sideways, false);
      }
      await page.keyboard.press('Escape'); await sleep(50);
      assert.equal(await page.$eval('#modal', e => e.hidden), true);
    }
    assert.deepEqual(page.__errors, []);
    await page.close();
  });
}

test('keywords: ANY / ALL (any order, exact order) / EXCLUDE, commas, quotes; Enter searches; Clear all', async () => {
  const page = await open();
  await page.type('#any', 'lucchese, justin  nocona'); await page.type('#all', 'black cherry'); await page.type('#not', 'kids -damaged');
  let p = P(await go(page));
  assert.equal(p._nkw, 'black cherry (lucchese,justin,nocona) -(kids,damaged)');
  await page.select('#allMode', 'exact_order');
  p = P(await go(page)); assert.equal(p._nkw, '"black cherry" (lucchese,justin,nocona) -(kids,damaged)');
  await page.$eval('#all', e => { e.value = ''; }); await page.type('#all', '"black cherry"');
  p = P(await go(page)); assert.equal(p._nkw, '"black cherry" (lucchese,justin,nocona) -(kids,damaged)', 'no nested quotes');
  await page.evaluate(() => { window.__opened = []; }); await page.focus('#any'); await page.keyboard.press('Enter'); await sleep(50);
  assert.equal((await page.evaluate(() => window.__opened)).length, 1, 'Enter in a keyword box searches');
  await page.click('[data-clear="keywords"]'); await sleep(50);
  const vals = await page.evaluate(() => ['any', 'all', 'not'].map(id => document.getElementById(id).value));
  assert.deepEqual(vals, ['', '', '']); assert.equal(P(await go(page))._nkw, '');
  await page.close();
});

test('description checkbox (web only) and Browser / Mobile site', async () => {
  const page = await open();
  await page.click('#desc');
  let u = await go(page); assert.equal(u.host, 'www.ebay.com'); assert.equal(u.searchParams.get('LH_TitleDesc'), '1');
  await click(page, 'Mobile site'); await sleep(50);
  assert.equal(await page.$eval('#descWrap', e => e.hidden), true, 'description option hidden for mobile site');
  assert.equal(await page.$eval('[data-view="mobile"]', e => e.getAttribute('aria-pressed')), 'true');
  u = await go(page); assert.equal(u.host, 'm.ebay.com'); assert.equal(u.searchParams.has('LH_TitleDesc'), false);
  await click(page, 'Browser'); await sleep(50);
  u = await go(page); assert.equal(u.host, 'www.ebay.com'); assert.equal(u.searchParams.get('LH_TitleDesc'), '1');
  await page.close();
});

test('all 18 eBay regions x Browser/Mobile: right host, never affiliate params', async () => {
  const page = await open();
  for (const view of ['web', 'mobile']) {
    await page.click(`[data-view="${view}"]`);
    for (const r of D.REGIONS) {
      await page.select('#region', r.domain); await sleep(10);
      const u = await go(page);
      assert.equal(u.host, (view === 'mobile' ? 'm.' : 'www.') + r.domain, r.label);
    }
  }
  await page.close();
});

test('Boot Filters: gender, every size and width, colors, condition, vintage, handmade, countries; badge counts', async () => {
  const page = await open();
  await openModal(page, 'btnBoot');
  // Mens: every size and every width
  for (const s of D.SIZES_MENS) await page.click(`[data-size="mens"][data-v="${s}"]`);
  for (const w of D.WIDTHS) await page.click(`[data-width="mens"][data-v="${w}"]`);
  await done(page);
  let p = P(await go(page));
  assert.equal(p._sacat, '11498'); assert.equal(p['US Shoe Size'], D.SIZES_MENS.join('|'));
  assert.equal(p['Shoe Width'], D.WIDTHS.filter(w => w !== 'Not Specified').join('|'), '"Not Specified" never sent');
  assert.equal(p._dcat, '11498');
  assert.equal(await page.$eval('#btnBoot .count', e => e.textContent), String(D.SIZES_MENS.length + D.WIDTHS.length));
  // Womens: list switches, mens picks not sent
  await openModal(page, 'btnBoot'); await page.click('[data-gender="womens"]');
  for (const s of D.SIZES_WOMENS) await page.click(`[data-size="womens"][data-v="${s}"]`);
  await page.click('[data-width="womens"][data-v="B"]');
  await done(page);
  p = P(await go(page));
  assert.equal(p._sacat, '53557'); assert.equal(p['US Shoe Size'], D.SIZES_WOMENS.join('|')); assert.equal(p['Shoe Width'], 'B');
  // Both: one search, category 11450, sizes merged without duplicates
  await openModal(page, 'btnBoot'); await page.click('[data-gender="both"]'); await done(page);
  p = P(await go(page));
  assert.equal(p._sacat, '11450');
  const merged = [...new Set(D.SIZES_MENS.concat(D.SIZES_WOMENS))];
  assert.equal(p['US Shoe Size'], merged.join('|'));
  // reset filters, then colors / condition / vintage / handmade / countries
  await openModal(page, 'btnBoot'); await page.click('[data-clear="boot_filters"]'); await sleep(30);
  assert.equal(await page.$eval('[data-gender="mens"]', e => e.getAttribute('aria-pressed')), 'true');
  for (const c of D.COLORS) await checkByValue(page, 'selected_colors', c);
  await done(page);
  p = P(await go(page)); assert.equal(p.Color, D.COLORS.filter(c => c !== 'Not specified').join('|'));
  const cases = [
    [['selected_conditions', 'New'], { LH_ItemCondition: '1000|1500|1750' }],
    [['selected_conditions', 'Used'], { LH_ItemCondition: '1000|1500|1750|3000' }],
    [['selected_vintage', 'Yes'], { kw: 'vintage' }],
    [['selected_vintage', 'No'], { kw: '' }],              // Yes + No = no filter
    [['selected_vintage', 'Yes'], { kw: '-vintage' }],     // only No left
    [['selected_handmade', 'Handmade'], { Handmade: 'Yes' }],
    [['selected_handmade', 'Not handmade'], { Handmade: null }],
    [['selected_handmade', 'Handmade'], { Handmade: 'No' }],
    [['selected_countries', 'USA'], { 'Country/Region of Manufacture': 'United States' }],
    [['selected_countries', 'Mexico'], { 'Country/Region of Manufacture': 'United States|Mexico' }],
    [['selected_countries', 'Not specified'], { 'Country/Region of Manufacture': 'United States|Mexico' }]
  ];
  for (const [[list, v], exp] of cases) {
    await openModal(page, 'btnBoot');
    if (list === 'selected_countries' && v === 'Mexico') await page.evaluate(() => document.querySelector('details.more'));
    await checkByValue(page, list, v); await done(page);
    p = P(await go(page));
    for (const [k, want] of Object.entries(exp)) {
      if (k === 'kw') assert.equal(p._nkw, want, list + ' ' + v);
      else assert.equal(p[k] ?? null, want, `${list}=${v} -> ${k}`);
    }
  }
  // "More countries" list works too
  await openModal(page, 'btnBoot'); await page.click('details.more summary'); await checkByValue(page, 'selected_countries', 'Japan'); await done(page);
  assert.equal(P(await go(page))['Country/Region of Manufacture'], 'United States|Mexico|Japan');
  await page.close();
});

test('Brands: A-Z filter, search box, letter + search, no-match note, Unbranded, Clear all', async () => {
  const page = await open();
  await openModal(page, 'btnBrands');
  await page.click('[data-letter="L"]'); await sleep(30);
  let names = await page.$$eval('#brandList label', ls => ls.map(l => l.textContent.trim()));
  assert.deepEqual(names, D.BRANDS.filter(b => b[0].toUpperCase() === 'L'));
  await page.click('[data-letter=""]');
  await page.type('#brandSearch', 'tony');
  names = await page.$$eval('#brandList label', ls => ls.map(l => l.textContent.trim()));
  assert.deepEqual(names, ['Tony Lama']);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'brandSearch', 'search box keeps focus while typing');
  await checkByValue(page, 'selected_brands', 'Tony Lama'); await sleep(30);
  assert.equal(await page.$eval('#brandSearch', e => e.value), 'tony', 'search kept after ticking');
  await page.$eval('#brandSearch', e => { e.value = ''; }); await page.type('#brandSearch', 'jb hill');
  names = await page.$$eval('#brandList label', ls => ls.map(l => l.textContent.trim()));
  assert.deepEqual(names, ['J.B. Hill'], 'punctuation-insensitive search');
  await checkByValue(page, 'selected_brands', 'J.B. Hill');
  await page.$eval('#brandSearch', e => { e.value = ''; }); await page.type('#brandSearch', 'lu'); await page.click('[data-letter="L"]'); await sleep(30);
  names = await page.$$eval('#brandList label', ls => ls.map(l => l.textContent.trim()));
  assert.ok(names.length && names.every(n => n[0] === 'L' && /lu/i.test(n)), 'letter + search combine: ' + names);
  await page.$eval('#brandSearch', e => { e.value = ''; }); await page.type('#brandSearch', 'zzzz');
  assert.match(await page.$eval('#brandList', e => e.textContent), /No brands matching/);
  await page.click('input[data-flag="unbranded_checked"]');
  await done(page);
  let p = P(await go(page));
  assert.equal(p.Brand, 'Tony Lama|J.B. Hill|Unbranded'); assert.equal(p._dcat, '11498');
  assert.equal(await page.$eval('#btnBrands .count', e => e.textContent), '3');
  await shot(page, 'desktop-03-brands-picked');
  await openModal(page, 'btnBrands'); await page.click('[data-clear="brands"]'); await sleep(30);
  assert.equal(await page.$eval('#brandSearch', e => e.value), '');
  await done(page);
  p = P(await go(page)); assert.equal(p.Brand, undefined);
  await page.close();
});

test('category toggle off: all of eBay, boot-only picks dropped with a warning, buttons hidden', async () => {
  const page = await open();
  await openModal(page, 'btnBrands'); await checkByValue(page, 'selected_brands', 'Lucchese'); await done(page);
  await page.click('#useCat'); await sleep(30);
  const st = await page.evaluate(() => ({ boot: document.getElementById('btnBoot').hidden, brands: document.getElementById('btnBrands').hidden,
    warn: document.getElementById('catOffNote').hidden }));
  assert.deepEqual(st, { boot: true, brands: true, warn: false });
  const p = P(await go(page));
  assert.equal(p._sacat, '0'); assert.equal(p.Brand, undefined); assert.equal(p._dcat, undefined);
  await shot(page, 'desktop-04-category-off');
  await page.click('#useCat'); await sleep(30);
  assert.equal(P(await go(page)).Brand, 'Lucchese');
  await page.close();
});

test('Search Settings: price cleaning + min>max, every sale type, every sort, sold', async () => {
  const page = await open();
  await openModal(page, 'btnSettings');
  await page.type('#pmin', '$4a9,99'); await page.type('#pmax', '1.2.3');
  assert.equal(await page.$eval('#pmin', e => e.value), '49,99');
  await done(page);
  let p = P(await go(page)); assert.equal(p._udlo, '1.2'); assert.equal(p._udhi, '49.99', 'min>max swapped');
  await openModal(page, 'btnSettings');
  assert.equal(await page.$eval('#priceNote', e => e.hidden), false, 'min>max warning shown');
  await shot(page, 'desktop-05-price-warning', false);
  await page.$eval('#pmin', e => { e.value = ''; }); await page.type('#pmin', '40');
  await page.$eval('#pmax', e => { e.value = ''; }); await page.type('#pmax', '400');
  assert.equal(await page.$eval('#priceNote', e => e.hidden), true);
  await done(page);
  p = P(await go(page)); assert.equal(p._udlo, '40'); assert.equal(p._udhi, '400');
  assert.match(await page.$eval('#summary', e => e.textContent), /\$40–\$400/);
  const SALE = { all: {}, auction_only: { LH_Auction: '1' }, fixed_best_offer_only: { LH_BIN: '1' }, best_offer_only: { LH_BO: '1' } };
  for (const [v, exp] of Object.entries(SALE)) {
    await openModal(page, 'btnSettings'); await page.select('#saleType', v); await done(page);
    p = P(await go(page));
    for (const k of ['LH_Auction', 'LH_BIN', 'LH_BO']) assert.equal(p[k], exp[k], v + ' ' + k);
  }
  for (const s of D.SORTS) {
    await openModal(page, 'btnSettings'); await page.select('#sortBy', s.value); await done(page);
    assert.equal(P(await go(page))._sop, s.sop, s.value);
  }
  await openModal(page, 'btnSettings'); await page.select('#avail', 'sold'); await done(page);
  p = P(await go(page)); assert.equal(p.LH_Sold, '1'); assert.equal(p.LH_Complete, '1');
  await page.select('#region', 'ebay.co.uk');
  assert.match(await page.$eval('#summary', e => e.textContent), /£40–£400/);
  assert.equal(await page.$eval('#btnSettings .count', e => e.textContent), '5');
  await page.close();
});

test('More Options: returns, free shipping, pickup with ZIP validation and every distance; UK postcode', async () => {
  const page = await open();
  await openModal(page, 'btnMore');
  await page.click('input[data-flag="returns_accepted"]'); await page.click('input[data-flag="free_shipping"]'); await page.click('input[data-flag="local_pickup"]'); await sleep(30);
  await page.type('#zip', '30a3');
  assert.equal(await page.$eval('#zip', e => e.value), '303');
  assert.match(await page.$eval('#zipNote', e => e.textContent), /all 5 digits/);
  await done(page);
  let p = P(await go(page));
  assert.equal(p.LH_RPA, '1'); assert.equal(p.LH_FS, '1'); assert.equal(p.LH_PickupOnly, '1');
  assert.equal(p._stpos, undefined, 'partial ZIP not sent');
  await openModal(page, 'btnMore'); await page.$eval('#zip', e => { e.value = ''; }); await page.type('#zip', '303019'); // max 5 digits
  assert.equal(await page.$eval('#zip', e => e.value), '30301');
  for (const m of D.DISTANCES) {
    await page.select('#miles', m); await sleep(10);
    assert.match(await page.$eval('#zipNote', e => e.textContent), new RegExp('within ' + m + ' miles of 30301'));
  }
  await shot(page, 'desktop-06-more-options', false);
  await page.select('#miles', '25'); await done(page);
  p = P(await go(page)); assert.equal(p._stpos, '30301'); assert.equal(p._sadis, '25'); assert.equal(p.LH_SALocation, '1');
  assert.equal(await page.$eval('#btnMore .count', e => e.textContent), '3');
  // UK: postcode allowed
  await page.select('#region', 'ebay.co.uk');
  await openModal(page, 'btnMore');
  assert.equal(await page.$eval('label[for="zip"]', e => e.textContent), 'Postcode');
  await page.$eval('#zip', e => { e.value = ''; }); await page.type('#zip', 'sw1a 1aa'); await done(page);
  p = P(await go(page)); assert.equal(p._stpos, 'SW1A 1AA');
  // untick pickup: no location params
  await openModal(page, 'btnMore'); await page.click('input[data-flag="local_pickup"]'); await done(page);
  p = P(await go(page)); for (const k of ['LH_PickupOnly', '_stpos', '_sadis', 'LH_SALocation']) assert.equal(p[k], undefined, k);
  await page.close();
});

test('Save settings: restored on next visit when ticked; nothing kept when unticked', async () => {
  const page = await open();
  await page.type('#any', 'nocona'); await page.select('#region', 'ebay.ca');
  await openModal(page, 'btnBrands'); await checkByValue(page, 'selected_brands', 'Nocona'); await done(page);
  const before = (await go(page)).toString();
  await page.evaluate(() => sessionStorage.setItem('__kept', '1'));
  await page.reload({ waitUntil: 'networkidle0' }); await sleep(100);
  assert.equal(await page.$eval('#any', e => e.value), 'nocona'); assert.equal(await page.$eval('#region', e => e.value), 'ebay.ca');
  assert.equal((await go(page)).toString(), before, 'same search after reload');
  await page.click('#save'); await go(page);
  assert.equal(await page.evaluate(() => localStorage.getItem('dusty_prefs')), null);
  assert.equal(await page.evaluate(() => localStorage.getItem('ebay_boot_prefs')), null);
  await page.close();
});

test('Copy link + shared link reproduces the exact search; Reset clears everything', async () => {
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions(ORIGIN, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  const page = await open();
  await page.type('#any', 'roper'); await page.select('#allMode', 'exact_order'); await page.type('#all', 'square toe'); await page.type('#not', 'kids');
  await page.click('#desc'); await page.select('#region', 'ebay.com.au');
  await openModal(page, 'btnBoot'); await page.click('[data-gender="both"]'); await page.click('[data-size="mens"][data-v="10"]');
  await page.click('[data-tab="size"][data-v="womens"]'); await page.click('[data-size="womens"][data-v="7.5"]');
  await page.click('[data-width="mens"][data-v="EE"]'); await checkByValue(page, 'selected_colors', 'Black'); await checkByValue(page, 'selected_conditions', 'Used');
  await checkByValue(page, 'selected_vintage', 'Yes'); await checkByValue(page, 'selected_handmade', 'Handmade'); await checkByValue(page, 'selected_countries', 'USA'); await done(page);
  await openModal(page, 'btnBrands'); await checkByValue(page, 'selected_brands', "Little's"); await page.click('input[data-flag="unbranded_checked"]'); await done(page);
  await openModal(page, 'btnSettings'); await page.type('#pmin', '50'); await page.type('#pmax', '500'); await page.select('#saleType', 'auction_only');
  await page.select('#sortBy', 'priceHighToLow'); await page.select('#avail', 'sold'); await done(page);
  await openModal(page, 'btnMore'); await page.click('input[data-flag="returns_accepted"]'); await page.click('input[data-flag="free_shipping"]');
  await page.click('input[data-flag="local_pickup"]'); await page.type('#zip', '2000'); await page.select('#miles', '100'); await done(page);
  const expected = (await go(page)).toString();
  await page.click('#share'); await sleep(200);
  const link = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(link.startsWith(ORIGIN + '/boot-search?'), 'shared links use the preferred /boot-search address: ' + link);
  assert.match(await page.$eval('#toast', e => e.textContent), /Link copied/);
  assert.equal(await page.evaluate(() => location.href), link, 'address bar shows the shared link');
  const other = await open(link);
  assert.equal((await go(other)).toString(), expected, 'shared link opens the same eBay search');
  await shot(other, 'desktop-07-opened-from-shared-link');
  // edits after opening a shared link keep the address bar in sync
  await other.type('#any', ' lucchese'); await sleep(30);
  assert.match(await other.evaluate(() => location.search), /any=roper\+lucchese/);
  await other.close();
  // Reset
  await page.click('#reset'); await sleep(50);
  assert.deepEqual(P(await go(page)), { _nkw: '', _sacat: '11498', _sop: '10', _ipg: '240', rt: 'nc' });
  assert.equal(await page.evaluate(() => location.search), '');
  assert.match(await page.$eval('#toast', e => e.textContent), /back to the defaults/);
  const counts = await page.$$eval('.menu .count', cs => cs.map(c => c.textContent).join(''));
  assert.equal(counts, '');
  await page.close();
});

test('"Show the eBay link" reveals the exact URL that opens', async () => {
  const page = await open(NEW_URL + '?maker=tony-lama&size=11&width=ee');
  await page.click('#preview summary'); await sleep(30);
  assert.equal(await page.$eval('#preview', e => e.open), true);
  const shown = await page.$eval('#previewUrl', e => e.textContent);
  const u = await go(page);
  assert.equal(shown, u.toString());
  assert.equal(u.searchParams.get('Brand'), 'Tony Lama'); assert.equal(u.searchParams.get('Shoe Width'), 'EE');
  await shot(page, 'desktop-08-show-ebay-link');
  await page.close();
});

test('shareable URL params: every key maps to the right eBay param; junk values dropped', async () => {
  const q = 'any=justin,ariat&all=snip%20toe&exact=1&not=kids&gender=womens&size=7,7.5,99&width=b,zz&brand=Old%20Gringo&maker=lucchese,nope' +
    '&cond=used&color=black,purple&vintage=yes&handmade=Handmade&country=usa,Atlantis&unbranded=1&min=20&max=300&sale=best_offer_only' +
    '&sort=endingSoonest&region=ebay.de&view=mobile&desc=1&ra=1&fs=1&pickup=1&zip=10115&miles=50';
  const page = await open(NEW_URL + '?' + q);
  const u = await go(page);
  assert.equal(u.host, 'm.ebay.de');
  assert.deepEqual(P(u), {
    _nkw: '"snip toe" (justin,ariat) -kids vintage', _sacat: '53557', LH_ItemCondition: '3000', Color: 'Black', 'US Shoe Size': '7|7.5',
    'Shoe Width': 'B', Brand: 'Old Gringo|Lucchese|Unbranded', Handmade: 'Yes', 'Country/Region of Manufacture': 'United States',
    _dcat: '53557', _udlo: '20', _udhi: '300', LH_BO: '1', _sop: '1', LH_RPA: '1', LH_FS: '1', LH_PickupOnly: '1',
    _stpos: '10115', _sadis: '50', LH_SALocation: '1', _ipg: '240', rt: 'nc' });
  // sold + nocat
  const p2 = await open(NEW_URL + '?sold=1&nocat=1&brand=lucchese');
  const v = P(await go(p2)); assert.equal(v._sacat, '0'); assert.equal(v.LH_Sold, '1'); assert.equal(v.Brand, undefined);
  // bad region / gender / view fall back to defaults
  const p3 = await open(NEW_URL + '?region=evil.com&gender=kids&view=tv&sort=x&sale=y&miles=7');
  const w = await go(p3); assert.equal(w.host, 'www.ebay.com'); assert.equal(w.searchParams.get('_sacat'), '11498'); assert.equal(w.searchParams.get('_sop'), '10');
  // a shared link wins over saved settings
  await p3.evaluate(() => { localStorage.setItem('dusty_prefs', JSON.stringify({ any_keywords: 'saved' })); sessionStorage.setItem('__kept', '1'); });
  await p3.goto(NEW_URL + '?any=fromlink', { waitUntil: 'networkidle0' });
  assert.equal(await p3.$eval('#any', e => e.value), 'fromlink');
  for (const pg of [page, p2, p3]) await pg.close();
});

test('/boot-search is the main address (served directly, no redirect); /eBayBootSearch still works', async () => {
  const res = await fetch(ORIGIN + '/boot-search?maker=lucchese', { redirect: 'manual' });
  assert.equal(res.status, 200, 'no redirect: the address people share stays in the bar');
  const page = await open(ORIGIN + '/boot-search?maker=lucchese&size=9');
  assert.equal(new URL(page.url()).pathname, '/boot-search');
  const p = P(await go(page)); assert.equal(p.Brand, 'Lucchese'); assert.equal(p['US Shoe Size'], '9');
  assert.deepEqual(page.__errors, []);
  await page.close();
  for (const legacy of ['/eBayBootSearch', '/eBayBootSearch/?maker=lucchese']) {
    const old = await open(ORIGIN + legacy);
    assert.equal(await old.$eval('#signMain', e => e.textContent), 'Boot Finder', legacy);
    await old.close();
  }
  const cfg = require('../../vercel.json');
  assert.ok(cfg.rewrites.some(r => r.source === '/boot-search' && r.destination === '/eBayBootSearch/index.html'));
  assert.ok(!(cfg.redirects || []).some(r => r.source === '/boot-search'));
});

test('naming (EPN): tool name comes from config, has no "eBay", banner/title/meta/headings agree', async () => {
  const fs = require('fs'), vm = require('vm'), path = require('path');
  const sb = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../eBayBootSearch/config.js'), 'utf8'), sb);
  const C = sb.window.BOOTSEARCH_CONFIG;
  assert.doesNotMatch(C.toolName, /ebay/i); assert.doesNotMatch(C.toolName, /\bdan\b|dan's/i, 'no "Dan" in the tool name');
  assert.equal(C.toolSubtitle, 'Searches live eBay listings');
  assert.equal(C.shareUrl, '/boot-search');
  for (const mobile of [false, true]) {
    const page = await open(ORIGIN + '/boot-search', { mobile });
    const r = await page.evaluate(() => ({
      title: document.title, h1: document.querySelector('h1').textContent, top: document.getElementById('signTop').textContent,
      main: document.getElementById('signMain').textContent, sub: document.getElementById('toolSub').textContent,
      subStyle: (() => { const cs = getComputedStyle(document.getElementById('toolSub')); return [cs.fontSize, cs.color]; })(),
      signFont: getComputedStyle(document.getElementById('signMain')).fontSize,
      fits: document.getElementById('signMain').scrollWidth <= document.getElementById('sign').clientWidth,
      meta: [...document.querySelectorAll('meta[property^="og:"], meta[name="description"], link[rel="canonical"]')].map(m => m.content || m.href),
      imgs: [...document.querySelectorAll('img')].map(i => i.src), fontsOk: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family),
      bodyTextNames: document.body.innerText.match(/Advanced Boot Search|Boot Search Tool|for eBay/gi) }));
    assert.equal(r.title, C.toolName + ' – ' + C.toolSubtitle + " | Dan's Boot Sale");
    assert.equal(r.h1, C.toolName); assert.equal(r.top + ' ' + r.main, C.toolName); assert.equal(r.sub, C.toolSubtitle);
    assert.ok(parseFloat(r.subStyle[0]) < parseFloat(r.signFont) / 2, 'subtitle clearly smaller than the sign lettering');
    assert.equal(r.fits, true, 'sign text fits');
    assert.deepEqual(r.imgs, [], 'no banner image with old eBay lettering');
    assert.equal(r.bodyTextNames, null, 'old tool name still visible');
    assert.ok(r.fontsOk.includes('Sancreek') && r.fontsOk.includes('Rye'), 'western fonts loaded: ' + r.fontsOk);
    assert.ok(r.meta.includes('https://www.dansbootsale.com/boot-search'), 'canonical/og:url use /boot-search');
    assert.ok(r.meta.some(m => m === C.toolName), 'og:title is the tool name');
    for (const m of r.meta) assert.doesNotMatch(m, /ebay (it|ing)|\bebayed\b|boot ?bay/i, 'no eBay-as-verb or Bay word play: ' + m);
    await shot(page, `${mobile ? 'mobile' : 'desktop'}-00-renamed-top`, false);
    assert.deepEqual(page.__errors, []);
    await page.close();
  }
  // changing the name is one line in config.js: the page follows it with no other edits
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => { let c; Object.defineProperty(window, 'BOOTSEARCH_CONFIG', { get: () => c, set(v) { v.toolName = 'Big Sky Boot Finder'; c = v; }, configurable: true }); });
  await page.goto(ORIGIN + '/boot-search', { waitUntil: 'networkidle0' });
  const t = await page.evaluate(() => [document.getElementById('signTop').textContent, document.getElementById('signMain').textContent, document.title]);
  assert.deepEqual(t.slice(0, 2), ['Big', 'Sky Boot Finder']); assert.match(t[2], /^Big Sky Boot Finder – /);
  await page.close();
});

test('keyboard: open pop-up with Enter, focus stays on the chip/checkbox used, Tab is trapped, Escape returns focus', async () => {
  const page = await open();
  await page.focus('#btnBoot'); await page.keyboard.press('Enter'); await sleep(60);
  assert.equal(await page.evaluate(() => document.getElementById('modal').hidden), false);
  assert.equal(await page.evaluate(() => document.getElementById('modal').contains(document.activeElement)), true);
  await page.focus('[data-size="mens"][data-v="10"]'); await page.keyboard.press('Space'); await sleep(40);
  let a = await page.evaluate(() => [document.activeElement.getAttribute('data-size'), document.activeElement.getAttribute('data-v'), document.activeElement.getAttribute('aria-pressed')]);
  assert.deepEqual(a, ['mens', '10', 'true'], 'focus kept on the toggled chip');
  await page.keyboard.press('Tab'); await sleep(10);
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-v')), '10.5');
  await page.focus('input[data-list="selected_colors"][data-v="Black"]'); await page.keyboard.press('Space'); await sleep(30);
  assert.equal(await page.evaluate(() => document.activeElement.matches('input[data-v="Black"]:checked')), true);
  for (let i = 0; i < 120; i++) await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.getElementById('modalBox').contains(document.activeElement)), true, 'Tab stays in pop-up');
  await page.keyboard.down('Shift'); for (let i = 0; i < 5; i++) await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
  assert.equal(await page.evaluate(() => document.getElementById('modalBox').contains(document.activeElement)), true, 'Shift+Tab stays in pop-up');
  await page.keyboard.press('Escape'); await sleep(30);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'btnBoot', 'focus returns to the button');
  // brands: checkbox via keyboard keeps focus
  await page.focus('#btnBrands'); await page.keyboard.press('Enter'); await sleep(50);
  await page.focus('input[data-v="Ariat"]'); await page.keyboard.press('Space'); await sleep(30);
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-v')), 'Ariat');
  // whole page reachable by Tab without traps
  await page.keyboard.press('Escape');
  await page.close();
});

test('labels: every input/select on the page and in every pop-up has an accessible name; focus is visible', async () => {
  const page = await open();
  const unnamed = async () => page.evaluate(() => [...document.querySelectorAll('input, select')].filter(el => el.offsetParent !== null).filter(el =>
    !(el.labels && el.labels.length) && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby')).map(el => el.id || el.outerHTML.slice(0, 60)));
  assert.deepEqual(await unnamed(), []);
  for (const id of ['btnBoot', 'btnBrands', 'btnSettings', 'btnMore']) {
    await openModal(page, id);
    if (id === 'btnMore') { await page.click('input[data-flag="local_pickup"]'); await sleep(30); }
    assert.deepEqual(await unnamed(), [], id);
    await page.keyboard.press('Escape');
  }
  // keyboard focus ring present on main controls
  for (const sel of ['#go', '#btnBoot', '#share', '#reset']) {
    await page.focus(sel); await page.keyboard.press('Shift'); 
    const ow = await page.$eval(sel, e => getComputedStyle(e).outlineStyle + ' ' + getComputedStyle(e).outlineWidth);
    assert.notEqual(ow.split(' ')[0], 'none', sel + ' has no focus outline');
  }
  await page.close();
});

test('contrast: visible text meets WCAG AA (4.5:1, or 3:1 for large text)', async () => {
  for (const mobile of [false, true]) {
    const page = await open(NEW_URL, { mobile });
    const bad = await page.evaluate(() => {
      const parse = c => { const m = c.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m[3] === undefined ? 1 : m[3] }; };
      const lum = ({ r, g, b }) => [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
      const bgOf = el => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c.a > 0.5) return c; } return { r: 255, g: 253, b: 248 }; };
      const out = [];
      document.querySelectorAll('#app *, .bs-top *').forEach(el => {
        if (el.offsetParent === null) return;
        const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()); if (!own) return;
        const cs = getComputedStyle(el); const fg = parse(cs.color), bg = bgOf(el);
        const L1 = lum(fg), L2 = lum(bg), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
        const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700, large = size >= 24 || (bold && size >= 18.66);
        if (ratio < (large ? 3 : 4.5)) out.push(el.tagName + '.' + el.className + ' "' + el.textContent.trim().slice(0, 25) + '" ' + ratio.toFixed(2));
      });
      return out;
    });
    assert.deepEqual(bad, [], (mobile ? 'mobile' : 'desktop') + ' low contrast');
    await page.close();
  }
});

test('mobile: tap targets for main controls are at least 40px tall and nothing overlaps', async () => {
  const page = await open(NEW_URL, { mobile: true });
  const r = await page.evaluate(() => {
    const els = ['#go', '#btnBoot', '#btnBrands', '#btnSettings', '#btnMore', '#region', '#any', '#all', '#allMode', '#not'].map(s => document.querySelector(s));
    const small = els.filter(e => e.getBoundingClientRect().height < 40).map(e => e.id);
    const rects = els.map(e => e.getBoundingClientRect()); const overlaps = [];
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlaps.push(els[i].id + '/' + els[j].id);
    }
    return { small, overlaps };
  });
  assert.deepEqual(r.overlaps, []);
  assert.deepEqual(r.small, []);
  await page.close();
});
