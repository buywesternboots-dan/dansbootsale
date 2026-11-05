/*
 * Dusty's Boot Finder: live result cards from /api/boots (our own Vercel function; the browser
 * never talks to eBay's API and never sees any key), plus "My Boots".
 *  - On load it asks /api/boots?status=1 whether live results are set up AND whether affiliate
 *    tracking is on. That server answer is the ONE affiliate switch: paid links and the disclosure
 *    appear only when it says affiliate: true. If live results are off (no keys, local preview,
 *    error), "Find My Boots" opens the eBay search like before.
 *  - Link-out only. Each card is a plain link to the real listing on eBay in a new tab. No frames,
 *    no bidding, no auto-bid or sniping. Buying happens on eBay.
 *  - My Boots (js/store.js, this device only): saved searches (criteria), ♥ picks / hidden /
 *    viewed (eBay item IDs only), recent searches. Picks and hidden drop off after 6 hours.
 *    Listing details are always fetched live (/api/boots?ids=); links are rebuilt every time, never
 *    stored. No accounts, nothing stored on a server, no email/SMS/push alerts.
 *  - "Run all my searches": runs every saved search live (2 at a time, small gap, max 12), merges
 *    the results into one list with duplicates removed, tags each card with its search(es), and
 *    sorts on the page. The merged list is kept in memory only.
 *  - The ad disclosure sits right under the results title (above "Open this search on eBay") and
 *    appears only when a shown link is paid.
 */
(function () {
  'use strict';
  var A = window.DustyApp, CFG = window.BOOTSEARCH_CONFIG, U = window.BootSearchURL, SH = window.DustyShopper, ST = window.DustyStore;
  if (!A || !SH || !ST) return;
  var $ = function (id) { return document.getElementById(id); };
  var esc = A.esc;
  var API = '/api/boots';
  var REFINE_KEY = 'dusty_refine', PREFS_KEY = 'dusty_view_prefs';
  var SHOP = CFG.shopper || {};
  var LIVE = false, page = 0, seq = 0, last = null, merged = null, savedView = null;
  var tab = 'results', pageSort = null, undoId = null, undoTimer = null, renaming = null, panelOpen = false;
  var repo = makeRepo();
  var prevVisit = SH.lastVisit(safeStorage(), safeSession());
  var prefs = loadPrefs();
  // History alone (recent searches, viewed, hidden) shows the panel only if it was there when the page
  // loaded, so the page doesn't jump on the first search. Saving or hearting shows it right away.
  // Once shown, it stays (deleting the last saved search doesn't yank it away) until "Clear my data".
  var panelSticky = !!(repo.runs().length || repo.viewedCount() || repo.hiddenCount());

  function makeRepo() {
    return ST.createRepo(ST.createLocalBackend(safeStorage()), { maxEntries: SHOP.maxEntries, itemTtlHours: SHOP.itemTtlHours,
      historyDays: SHOP.historyDays, maxSavedSearches: SHOP.maxSavedSearches });
  }
  function memStorage() { var m = {}; return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; } }; }
  function safeStorage() { try { localStorage.setItem('dusty_t', '1'); localStorage.removeItem('dusty_t'); return localStorage; } catch (e) { return safeStorage.m || (safeStorage.m = memStorage()); } }
  function safeSession() { try { sessionStorage.setItem('dusty_t', '1'); sessionStorage.removeItem('dusty_t'); return sessionStorage; } catch (e) { return safeSession.m || (safeSession.m = memStorage()); } }
  function loadPrefs() {
    var p = { layout: 'grid', hideSeen: false };
    try { var s = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null'); if (s) { if (s.layout === 'list') p.layout = 'list'; p.hideSeen = s.hideSeen === true; } } catch (e) { /* ignore */ }
    return p;
  }
  function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* ignore */ } }

  // Extra picks that come from eBay's own facet lists (raw eBay values), on top of the form state.
  function blankRefine() { return { size: [], width: [], brand: [], material: [], toe: [], heel: [], cond: [], western: true }; }
  var R = loadRefine();
  function loadRefine() {
    var r = blankRefine();
    try {
      var fromUrl = new URLSearchParams(location.search), any = false;
      ['size', 'width', 'brand', 'material', 'toe', 'heel', 'cond'].forEach(function (k) {
        if (fromUrl.has('r_' + k)) { r[k] = fromUrl.get('r_' + k).split('|').filter(Boolean); any = true; }
      });
      if (fromUrl.get('western') === '0') { r.western = false; any = true; }
      if (any) return r;
      var saved = JSON.parse(localStorage.getItem(REFINE_KEY) || 'null');
      if (saved) Object.keys(r).forEach(function (k) { if (k in saved) r[k] = saved[k]; });
    } catch (e) { /* ignore */ }
    return r;
  }
  function saveRefine() {
    try { if ($('save').checked) localStorage.setItem(REFINE_KEY, JSON.stringify(R)); else localStorage.removeItem(REFINE_KEY); } catch (e) { /* ignore */ }
  }
  function refineQuery(r) {
    var p = new URLSearchParams();
    ['size', 'width', 'brand', 'material', 'toe', 'heel', 'cond'].forEach(function (k) { if (r[k] && r[k].length) p.set('r_' + k, r[k].join('|')); });
    if (r.western === false) p.set('western', '0');
    return p.toString();
  }
  function joinQ(parts) { return parts.filter(Boolean).join('&'); }
  function apiQuery(S, pg) { var q = joinQ([U.shareQuery(S), refineQuery(R), pg ? 'page=' + pg : '']); return API + (q ? '?' + q : ''); }
  function savedApiQuery(s) { var q = joinQ([s.q, refineQuery(s.r || blankRefine())]); return API + (q ? '?' + q : ''); }
  // Link to the saved search on eBay, built now from criteria with the CURRENT switch.
  function savedBuilt(s) { return U.buildSearch(U.stateFromQuery(s.q), A.linkConfig()); }
  function savedEbayUrl(s) { return savedBuilt(s).url; }
  // Is any of these saved searches' eBay links paid right now (server switch on)?
  function anyPaid(list) { return (list || []).some(function (s) { return savedBuilt(s).paid; }); }
  function linkRel(paid) { return (paid ? 'sponsored ' : '') + 'noopener noreferrer'; }

  // Live results cover eBay US, available (not sold) listings. Anything else keeps the link builder.
  function canShow(S) { return LIVE && S.region === 'ebay.com' && S.availability !== 'sold'; }
  function canShowSaved(s) { return canShow(U.stateFromQuery(s.q)); }

  /* ---------- formatting ---------- */
  function money(m) {
    if (!m) return '';
    var n = parseFloat(m.value); if (isNaN(n)) return '';
    return (m.currency && m.currency !== 'USD' ? m.currency + ' ' : '$') + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function left(ms) {
    if (ms <= 0) return 'Ended';
    var s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    if (d) return d + 'd ' + h + 'h left';
    if (h) return h + 'h ' + m + 'm left';
    return m + 'm ' + (sec < 10 ? '0' : '') + sec + 's left';
  }
  function safeImg(u) { return /^https:\/\//.test(u || '') || /^data:image\//.test(u || '') ? u : ''; }
  function safeLink(u) { try { var x = new URL(u); return x.protocol === 'https:' && /(^|\.)ebay\.com$/.test(x.hostname) ? x.toString() : ''; } catch (e) { return ''; } }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

  function toolsHTML(id, view) {
    var pick = repo.isPick(id);
    return '<div class="rc-tools">' +
      '<button type="button" class="rc-star' + (pick ? ' on' : '') + '" data-pick="' + esc(id) + '" aria-pressed="' + pick + '" aria-label="' +
        (pick ? 'Remove from My picks' : 'Add to My picks') + '" title="' + (pick ? 'Remove from My picks' : 'Add to My picks') + '">' + (pick ? '♥' : '♡') + '</button>' +
      (view === 'hidden' ? '<button type="button" class="rc-unhide" data-unhide="' + esc(id) + '">Show again</button>'
        : view === 'results' || view === 'all' ? '<button type="button" class="rc-hide" data-hide="' + esc(id) + '" aria-label="Hide this listing" title="Hide this listing">×</button>' : '') +
      '</div>';
  }

  // view: 'results' | 'all' | 'picks' | 'hidden' | 'viewed'
  function card(it, view) {
    var auction = (it.buyingOptions || []).indexOf('AUCTION') !== -1;
    var href = safeLink(it.url); if (!href) return '';
    var ended = it.endDate && Date.parse(it.endDate) <= Date.now();
    var price = auction && it.currentBid ? money(it.currentBid) : money(it.price);
    var priceNote = auction ? (it.bidCount === 1 ? '1 bid' : (it.bidCount || 0) + ' bids') + ' · current bid'
      : ((it.buyingOptions || []).indexOf('BEST_OFFER') !== -1 ? 'Buy It Now · or Best Offer' : 'Buy It Now');
    var ship = !it.shipping ? 'Shipping: see listing' : it.shipping.calculated ? 'Calculated shipping'
      : parseFloat(it.shipping.value) === 0 ? 'Free shipping' : '+' + money(it.shipping) + ' shipping';
    var seller = it.seller ? esc(it.seller.name) + (it.seller.feedbackPct ? ' · ' + esc(it.seller.feedbackPct) + '% positive' : '') +
      (it.seller.feedbackScore != null ? ' (' + Number(it.seller.feedbackScore).toLocaleString('en-US') + ')' : '') : '';
    var end = ended ? '<p class="rc-time ended">Ended</p>' : it.endDate && auction ? '<p class="rc-time" data-end="' + esc(it.endDate) + '"></p>' : '';
    var img = safeImg(it.image);
    var seen = repo.isSeen(it.id), listView = view === 'results' || view === 'all';
    var badges = '';
    if (view === 'all' && it.isNew) badges += '<span class="badge new">New match</span>';
    else if (view === 'results' && prevVisit && it.created && Date.parse(it.created) > prevVisit) badges += '<span class="badge new">New since your last visit</span>';
    if (seen && listView) badges += '<span class="badge seen">Seen</span>';
    if (ended) badges += '<span class="badge ended">Ended</span>';
    var src = view === 'all' && it.sources && it.sources.length ? '<p class="rc-src">From: ' + it.sources.map(function (s) { return '<span>' + esc(s.name) + '</span>'; }).join(' ') + '</p>' : '';
    return '<li class="rc' + (seen && listView ? ' is-seen' : '') + (ended ? ' is-ended' : '') + '" data-id="' + esc(it.id) + '">' +
      '<a class="rc-link" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer' + (it.paid ? ' sponsored' : '') + '" data-seen="' + esc(it.id) + '">' +
      '<div class="rc-img">' + (img ? '<img loading="lazy" decoding="async" src="' + esc(img) + '" alt="">' : '<span>No photo</span>') + '</div>' +
      '<div class="rc-body">' + (badges ? '<p class="rc-badges">' + badges + '</p>' : '') + '<h3 class="rc-title">' + esc(it.title) + '</h3>' +
      '<p class="rc-price"><b>' + esc(price) + '</b> <span>' + esc(priceNote) + '</span></p>' + end +
      '<p class="rc-meta">' + esc(ship) + (it.condition ? ' · ' + esc(it.condition) : '') + '</p>' +
      (seller ? '<p class="rc-seller">Seller: ' + seller + '</p>' : '') +
      (it.distance ? '<p class="rc-dist">' + esc(Math.round(it.distance.value)) + ' mi away</p>' : '') +
      (it.location ? '<p class="rc-loc">' + esc(it.location) + '</p>' : '') +
      (it.connected ? '<p class="rc-conn">Seller has a business connection to this site</p>' : '') + src +
      '<span class="rc-cta">' + (it.paid ? 'Paid link · ' : '') + 'View on eBay ↗</span></div></a>' + toolsHTML(it.id, view) + '</li>';
  }
  // Live lookup is off: the item ID is all we keep, so show a plain (untracked) link built from it.
  function plainCard(id, view) {
    var href = ST.plainItemUrl(id); if (!href) return '';
    return '<li class="rc rc-plain" data-id="' + esc(id) + '"><a class="rc-link" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer" data-seen="' + esc(id) + '">' +
      '<div class="rc-body"><h3 class="rc-title">eBay item ' + esc(ST.legacyId(id)) + '</h3><p>Details load live when results are on.</p>' +
      '<span class="rc-cta">View on eBay ↗</span></div></a>' + toolsHTML(id, view) + '</li>';
  }

  function tick() {
    var now = Date.now();
    [].forEach.call(document.querySelectorAll('#resList [data-end]'), function (el) {
      var ms = Date.parse(el.getAttribute('data-end')) - now;
      el.textContent = left(ms);
      el.classList.toggle('soon', ms > 0 && ms < 3600e3);
      el.classList.toggle('ended', ms <= 0);
    });
  }
  setInterval(tick, 1000);

  /* ---------- disclosure (only when a shown link is paid) ---------- */
  function setDisclosure(paid) {
    var dis = $('resDisclosure'), text = U.disclosureText(A.linkConfig());
    if (paid && text) {
      dis.hidden = false;
      dis.innerHTML = '<p class="d1">' + esc(text) + '</p><p class="d2">' + esc(CFG.nonEndorsement) + '</p>' +
        (CFG.affiliate.disclosurePageUrl ? '<a href="' + esc(CFG.affiliate.disclosurePageUrl) + '">Affiliate disclosure</a>' : '');
    } else { dis.hidden = true; dis.innerHTML = ''; }
  }
  // "Open this search on eBay": rel carries "sponsored" only when the link is paid.
  function setOpenLink(url, show, paid) {
    var a = $('resOpen');
    a.hidden = !show; if (url) a.href = url;
    a.rel = linkRel(!!paid);
  }

  /* ---------- facets (filled from eBay's own refinement counts) ---------- */
  var FACET_LABELS = { size: 'Size', width: 'Width', brand: 'Brand', material: 'Material', toe: 'Toe', heel: 'Heel' };
  function sList(S, key) {
    var g = S.gender === 'womens' ? 'womens' : 'mens';
    if (key === 'size') return S['selected_sizes_' + g];
    if (key === 'width') return S['selected_widths_' + g];
    if (key === 'brand') return S.selected_brands;
    return null;
  }
  function formValue(S, key, v) {
    var D = window.BOOTSEARCH_DATA, low = String(v).toLowerCase();
    var opts = key === 'brand' ? D.BRANDS : key === 'width' ? D.WIDTHS : key === 'size' ? (S.gender === 'womens' ? D.SIZES_WOMENS : D.SIZES_MENS) : [];
    for (var i = 0; i < opts.length; i++) if (opts[i].toLowerCase() === low) return opts[i];
    return null;
  }
  function isOn(S, key, v) { var l = sList(S, key); return (l && l.indexOf(v) !== -1) || R[key].indexOf(v) !== -1; }
  function facetChip(key, v, count, on) {
    return '<button type="button" class="chip' + (on ? ' on' : '') + '" aria-pressed="' + on + '" data-facet="' + key + '" data-v="' + esc(v) + '">' +
      esc(v) + (count != null ? ' <i>' + Number(count).toLocaleString('en-US') + '</i>' : '') + '</button>';
  }
  function activeFilterCount() {
    var S = A.get(), n = 0;
    Object.keys(FACET_LABELS).forEach(function (k) { n += R[k].length + ((sList(S, k) || []).length); });
    var pr = U.priceRange(S);
    return n + R.cond.length + S.selected_conditions.length + (pr.min ? 1 : 0) + (pr.max ? 1 : 0);
  }
  function facetsHTML(f) {
    var S = A.get(), html = '';
    Object.keys(FACET_LABELS).forEach(function (key) {
      var vals = (f.aspects[key] || []).slice(0, 12);
      var picked = (sList(S, key) || []).concat(R[key]).filter(function (v) { return !vals.some(function (x) { return x.value === v; }); });
      if (!vals.length && !picked.length) return;
      html += '<div class="fx"><span class="fx-t">' + FACET_LABELS[key] + '</span>' +
        picked.map(function (v) { return facetChip(key, v, null, true); }).join('') +
        vals.map(function (x) { return facetChip(key, x.value, x.count, isOn(S, key, x.value)); }).join('') + '</div>';
    });
    if (f.conditions.length) {
      var codes = []; S.selected_conditions.forEach(function (c) { codes = codes.concat(window.BOOTSEARCH_DATA.CONDITION_CODES[c] || []); });
      html += '<div class="fx"><span class="fx-t">Condition</span>' + f.conditions.map(function (c) {
        var on = R.cond.length ? R.cond.indexOf(c.id) !== -1 : codes.indexOf(c.id) !== -1;
        return '<button type="button" class="chip' + (on ? ' on' : '') + '" aria-pressed="' + on + '" data-facet="cond" data-v="' + esc(c.id) + '">' +
          esc(c.label) + ' <i>' + Number(c.count).toLocaleString('en-US') + '</i></button>';
      }).join('') + '</div>';
    }
    var pr = U.priceRange(S);
    html += '<div class="fx fx-price"><span class="fx-t">Price</span>' +
      '<input type="text" inputmode="decimal" id="fxMin" placeholder="Min $" value="' + esc(pr.min) + '" aria-label="Minimum price">' +
      '<input type="text" inputmode="decimal" id="fxMax" placeholder="Max $" value="' + esc(pr.max) + '" aria-label="Maximum price">' +
      '<button type="button" class="pill" id="fxPrice">Apply</button></div>';
    return html;
  }

  /* ---------- toolbar, tabs, layout ---------- */
  var mobile = window.matchMedia ? window.matchMedia('(max-width: 560px)') : { matches: false };
  var filtersOpen = !mobile.matches;   // folded away by default on phones
  function syncFilters() {
    $('resFacets').classList.toggle('folded', !filtersOpen);
    $('resFiltersBtn').setAttribute('aria-expanded', String(filtersOpen));
    var n = activeFilterCount();
    $('resFiltersBtn').textContent = (filtersOpen ? 'Hide filters' : 'Filters') + (n ? ' (' + n + ')' : '');
  }
  function currentSort() { return pageSort || (tab === 'results' ? A.get().sort_by : 'bestMatch'); }
  function syncModes() {
    var S = A.get();
    var mode = S.sale_type === 'auction_only' ? 'auction' : S.sale_type === 'fixed_best_offer_only' ? 'bin' : 'all';
    [].forEach.call(document.querySelectorAll('[data-mode]'), function (b) {
      var on = b.getAttribute('data-mode') === mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
    });
    $('resWestern').checked = R.western;
    $('resWestern').disabled = !S.use_boot_filters;
    var distOk = tab === 'results' && !!(S.local_pickup && U.zipValid(S.local_pickup_zipcode, 'ebay.com'));
    $('sortDistance').hidden = !distOk; $('sortDistance').disabled = !distOk;
    if (pageSort === 'distance' && !distOk) pageSort = null;
    $('resSort').value = currentSort();
    $('hideSeen').checked = prefs.hideSeen;
    [].forEach.call(document.querySelectorAll('[data-layout]'), function (b) {
      var on = b.getAttribute('data-layout') === prefs.layout; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
    });
    $('resList').classList.toggle('list', prefs.layout === 'list');
    syncFilters();
  }
  function syncTabs() {
    [].forEach.call(document.querySelectorAll('#results [data-tab]'), function (b) {
      var on = b.getAttribute('data-tab') === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on));
    });
    $('tabAll').hidden = !merged && tab !== 'all';
    $('tabResults').hidden = !last && tab !== 'results';
    $('picksN').textContent = repo.picksCount();
    $('hiddenN').textContent = repo.hiddenCount();
    $('viewedN').textContent = Math.min(24, repo.viewedCount());
    var res = tab === 'results';
    $('resModes').hidden = !res; $('resAsOf').hidden = !(res || tab === 'all');
    if (!res) { $('resPager').hidden = true; $('resFacets').hidden = true; $('resFiltersBtn').hidden = true; }
    $('resSave').hidden = !res;
    $('resToolbar').classList.toggle('is-saved-view', !res && tab !== 'all');
    syncSaveBtn();
  }
  function syncSaveBtn() {
    var q = U.shareQuery(A.get());
    var saved = repo.searches().some(function (s) { return s.q === q && JSON.stringify(s.r) === JSON.stringify(Object.assign(blankRefine(), R)); });
    $('resSave').textContent = saved ? '♥ Saved in My Boots' : '♡ Save this search';
    $('resSave').classList.toggle('on', saved);
  }

  function showFallback(reason) {
    var S = A.get(), built = U.buildSearch(S, A.linkConfig());
    $('resMsg').hidden = false;
    $('resMsg').innerHTML = 'Live results aren’t available right now' + (reason ? ' (' + esc(reason) + ')' : '') +
      '. Your search is ready on eBay: <a href="' + esc(built.url) + '" target="_blank" rel="' + linkRel(built.paid) + '">Open it on eBay ↗</a>';
    // The fallback link (and "Open this search on eBay") may be paid: disclose whenever it is.
    $('resList').innerHTML = ''; $('resPager').hidden = true; $('resFacets').innerHTML = ''; setDisclosure(built.paid);
    $('resAsOf').textContent = ''; $('resHiddenNote').hidden = true;
  }

  /* ---------- drawing ---------- */
  function draw() {
    syncTabs(); syncModes(); renderPanel();
    if (tab === 'all') return merged ? renderAll() : null;
    if (tab === 'picks' || tab === 'hidden' || tab === 'viewed') return drawSaved(tab);
    if (last) render(last);
  }

  // Saved lists hold IDs only: fetch the listings live (24 per request), or show plain links.
  var SAVED_TITLES = { picks: '♥ My picks', hidden: 'Hidden listings', viewed: 'Recently viewed' };
  var SAVED_EMPTY = { picks: 'No ♥ picks right now. Tap the heart on any listing. Picks are kept on this device for 6 hours.',
    hidden: 'Nothing hidden.', viewed: 'Nothing viewed yet.' };
  function savedIds(view) { return (view === 'picks' ? repo.picks() : view === 'hidden' ? repo.hidden() : repo.viewed(24)).map(function (x) { return x.id; }); }
  function drawSaved(view) {
    $('resTitle').textContent = SAVED_TITLES[view];
    setOpenLink('', false);
    var ids = savedIds(view);
    $('resHiddenNote').hidden = view !== 'hidden' || !ids.length;
    if (view === 'hidden') $('resHiddenNote').innerHTML = '<button type="button" class="linkbtn" id="unhideAll">Show all hidden again</button>';
    if (!ids.length) { $('resMsg').hidden = false; $('resMsg').textContent = SAVED_EMPTY[view]; $('resList').innerHTML = ''; setDisclosure(false); return; }
    var key = view + ':' + ids.join(',');
    if (savedView && savedView.key === key && Date.now() - savedView.at < 60e3) return paintSaved(view, savedView);
    if (!LIVE) return paintSaved(view, { key: key, ids: ids, items: null });
    $('resMsg').hidden = false; $('resMsg').textContent = 'Fetching live prices…';
    var mine = ++seq, chunks = [];
    for (var i = 0; i < ids.length && i < 96; i += 24) chunks.push(ids.slice(i, i + 24));
    Promise.all(chunks.map(function (c) {
      return fetch(API + '?ids=' + encodeURIComponent(c.join(',')), { headers: { Accept: 'application/json' } }).then(function (r) { return r.ok ? r.json() : { fallback: true }; });
    })).then(function (parts) {
      if (mine !== seq) return;
      var items = [], gone = [], fb = false;
      parts.forEach(function (p) { if (p.fallback) fb = true; else { items = items.concat(p.items || []); gone = gone.concat(p.gone || []); } });
      gone.forEach(function (id) { if (view === 'picks') repo.removePick(id); else if (view === 'hidden') repo.unhide(id); });
      savedView = { key: key, ids: ids, items: fb && !items.length ? null : items, gone: gone.length, at: Date.now(), asOf: parts[0] && parts[0].asOf };
      paintSaved(view, savedView); syncTabs();
    }).catch(function () { if (mine === seq) paintSaved(view, { key: key, ids: ids, items: null }); });
  }
  function paintSaved(view, sv) {
    var html, paid = false;
    if (sv.items) {
      var shown = SH.sortMerged(sv.items, pageSort || 'bestMatch');
      paid = shown.some(function (it) { return it.paid; });
      html = shown.map(function (it) { return card(it, view); }).join('');
      $('resAsOf').hidden = false;
      $('resAsOf').textContent = 'Prices and bids as of ' + (sv.asOf || '') + (sv.gone ? ' · ' + plural(sv.gone, 'listing') + ' ended or removed' : '');
    } else {
      html = sv.ids.map(function (id) { return plainCard(id, view); }).join('');
    }
    setDisclosure(paid);
    $('resMsg').hidden = !!html; if (!html) $('resMsg').textContent = SAVED_EMPTY[view];
    $('resList').innerHTML = html;
    tick(); observe();
  }

  function render(d) {
    last = d;
    $('resFacets').hidden = false; $('resFiltersBtn').hidden = false;
    var total = d.total || 0, from = d.page * d.pageSize + 1, to = d.page * d.pageSize + d.items.length;
    $('resTitle').textContent = total ? total.toLocaleString('en-US') + ' boots found' : 'No boots found';
    var built = U.buildSearch(A.get(), A.linkConfig());
    setOpenLink(built.url, true, built.paid);
    $('resAsOf').textContent = 'Prices and bids as of ' + d.asOf + (d.western ? ' · Western styles only' : '') +
      (d.note === 'busy' ? ' · showing a saved copy from ' + d.asOf + ' (busy)' : d.note === 'error' ? ' · showing a saved copy from ' + d.asOf : '');
    setDisclosure(!!d.paid || built.paid);   // any paid card OR a paid "Open this search on eBay"
    $('resFacets').innerHTML = facetsHTML(d.facets || { aspects: {}, conditions: [], buyingOptions: [] });
    var c = filterShown(d.items);
    var shown = SH.sortItems(c.shown, pageSort || A.get().sort_by);
    $('resMsg').hidden = !!shown.length;
    if (!shown.length) $('resMsg').textContent = d.items.length ? 'Everything on this page is hidden or seen. Try the next page, or show them again below.'
      : 'Nothing matches right now. Try fewer filters, or turn off “Western styles only”.';
    $('resList').innerHTML = shown.map(function (it) { return card(it, 'results'); }).join('');
    hiddenNote(c, 'on this page');
    $('resPager').hidden = !(d.page > 0 || d.hasMore);
    $('resPrev').disabled = d.page <= 0; $('resNext').disabled = !d.hasMore;
    $('resPage').textContent = total ? 'Showing ' + from.toLocaleString('en-US') + '–' + to.toLocaleString('en-US') + ' of ' + total.toLocaleString('en-US') : '';
    tick(); observe();
  }
  // Hidden listings never show; seen ones only when "Hide listings I've seen" is off.
  function filterShown(items) {
    var hiddenN = 0, seenN = 0;
    var shown = items.filter(function (it) {
      if (repo.isHidden(it.id)) { hiddenN++; return false; }
      if (prefs.hideSeen && repo.isSeen(it.id)) { seenN++; return false; }
      return true;
    });
    return { shown: shown, hiddenN: hiddenN, seenN: seenN };
  }
  function hiddenNote(c, where) {
    var bits = [];
    if (c.hiddenN) bits.push(c.hiddenN + ' hidden ' + where + ' · <button type="button" class="linkbtn" data-tab="hidden">See hidden</button>');
    if (c.seenN) bits.push(c.seenN + ' seen and tucked away · <button type="button" class="linkbtn" id="showSeen">Show seen</button>');
    $('resHiddenNote').hidden = !bits.length; $('resHiddenNote').innerHTML = bits.join('<br>');
  }

  /* ---------- Run all my searches ---------- */
  function runAllSearches() {
    var list = repo.searches(); if (!list.length) return;
    tab = 'all'; pageSort = null;
    $('results').hidden = false; syncTabs(); syncModes();
    $('resTitle').textContent = 'All my searches';
    setOpenLink('', false); setDisclosure(false);
    $('resList').innerHTML = ''; $('resHiddenNote').hidden = true;
    var max = SHOP.runAllMax || 12;
    var liveOnes = list.filter(canShowSaved), linkOnes = list.filter(function (s) { return !canShowSaved(s); });
    if (!liveOnes.length) {
      merged = null; syncTabs();
      $('resAsOf').textContent = '';
      $('resMsg').hidden = false;
      $('resMsg').innerHTML = (LIVE ? 'These searches can’t show live results here (non-US or sold).' : 'Live results aren’t available right now.') +
        ' Open each one on eBay:' + linksList(linkOnes);
      setDisclosure(anyPaid(linkOnes));
      scrollToResults(); return;
    }
    $('resMsg').hidden = false; $('resMsg').textContent = 'Rounding up boots from ' + plural(Math.min(max, liveOnes.length), 'search', 'searches') + '…';
    $('runAll').disabled = true;
    var mine = ++seq;
    scrollToResults();
    SH.runAll(liveOnes, function (s) {
      return fetch(savedApiQuery(s), { headers: { Accept: 'application/json' } }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    }, { max: max, concurrency: SHOP.runAllConcurrency || 2, delayMs: SHOP.runAllDelayMs == null ? 250 : SHOP.runAllDelayMs,
      onProgress: function (done, total) { if (mine === seq) $('resMsg').textContent = 'Rounding up boots… ' + done + ' of ' + total + ' searches done'; } })
      .then(function (res) {
        $('runAll').disabled = false;
        if (mine !== seq) return;
        var ok = res.results.filter(function (r) { return r.ok; });
        var runs = ok.map(function (r) { return { search: r.search, items: r.data.items || [], newSince: r.search.lastRun || 0 }; });
        var counts = SH.newCounts(runs), now = Date.now();
        runs.forEach(function (r) { repo.markRun(r.search.id, counts[r.search.id] || 0, now); });
        var asOfs = ok.map(function (r) { return r.data.asOf; }).filter(Boolean);
        merged = { items: SH.mergeRuns(runs), ran: ok.length, failed: res.results.filter(function (r) { return !r.ok; }).map(function (r) { return r.search; }),
          skipped: res.skipped, linkOnly: linkOnes, asOf: asOfs.sort()[0] || '', stale: ok.some(function (r) { return r.data.note; }),
          newTotal: Object.keys(counts).reduce(function (n, k) { return n + counts[k]; }, 0) };
        draw();
      }, function () { $('runAll').disabled = false; if (mine === seq) showFallback(''); });
  }
  function linksList(list) {
    return '<ul class="res-links">' + list.map(function (s) {
      var b = savedBuilt(s);
      return '<li><a href="' + esc(b.url) + '" target="_blank" rel="' + linkRel(b.paid) + '">' + esc(s.name) + ' ↗</a></li>';
    }).join('') + '</ul>';
  }
  function renderAll() {
    var m = merged;
    var c = filterShown(m.items);
    var shown = SH.sortMerged(c.shown, pageSort || 'bestMatch');
    $('resTitle').textContent = 'All my searches: ' + plural(m.items.length, 'boot');
    $('resAsOf').hidden = false;
    $('resAsOf').textContent = 'Live as of ' + m.asOf + ' · ' + plural(m.ran, 'search', 'searches') + (m.newTotal ? ' · ' + m.newTotal + ' new since last run' : '') +
      (m.stale ? ' · some show a saved copy' : '');
    setOpenLink('', false);
    // Disclose when any link on screen is paid: cards, or the failed / link-only search links.
    setDisclosure(shown.some(function (it) { return it.paid; }) || anyPaid(m.failed) || anyPaid(m.linkOnly));
    var notes = [];
    if (m.failed.length) notes.push(plural(m.failed.length, 'search', 'searches') + ' couldn’t load right now:' + linksList(m.failed));
    if (m.linkOnly.length) notes.push('Not shown live (non-US or sold):' + linksList(m.linkOnly));
    if (m.skipped) notes.push('Only the first ' + (SHOP.runAllMax || 12) + ' saved searches run at once.');
    var msg = (!shown.length ? (m.items.length ? 'Everything here is hidden or seen. ' : 'Nothing matches right now. ') : '') + notes.join('<br>');
    $('resMsg').hidden = !msg; $('resMsg').innerHTML = msg;
    $('resList').innerHTML = shown.map(function (it) { return card(it, 'all'); }).join('');
    hiddenNote(c, 'here');
    tick(); observe();
  }
  function scrollToResults() { var r = $('results'); if (r.scrollIntoView) r.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

  /* ---------- My Boots panel ---------- */
  function renderPanel() {
    var list = repo.searches(), runs = repo.runs(), picks = repo.picksCount(), viewed = repo.viewedCount();
    var any = list.length || picks || panelSticky;
    $('myBoots').hidden = !any;
    if (!any) return;
    panelSticky = true;
    var newT = repo.newTotal();
    $('mbNew').hidden = !newT; $('mbNew').textContent = newT + ' new';
    $('runAll').hidden = !list.length;
    $('runAll').textContent = 'Run all my searches (' + list.length + ')';
    $('mbSub').textContent = [list.length ? plural(list.length, 'saved search', 'saved searches') : 'No saved searches yet', '♥ ' + picks + (picks === 1 ? ' pick' : ' picks')].join(' · ') + ' · on this device';
    $('mbToggle').setAttribute('aria-expanded', String(panelOpen));
    $('mbToggle').textContent = panelOpen ? 'Close' : 'Open';
    $('mbBody').hidden = !panelOpen;
    $('mbPicksN').textContent = picks; $('mbViewedN').textContent = Math.min(24, viewed); $('mbHiddenN').textContent = repo.hiddenCount();
    var panelPaid = false;
    $('mbSearches').innerHTML = list.length ? list.map(function (s) {
      if (renaming === s.id) {
        return '<li class="mb-row editing"><label class="sr-only" for="mbRenameIn">New name</label><input type="text" id="mbRenameIn" class="mb-input" maxlength="80" value="' + esc(s.name) + '">' +
          '<button type="button" class="pill on" data-renamesave="' + esc(s.id) + '">Save</button><button type="button" class="pill" data-renamecancel="1">Cancel</button></li>';
      }
      // Live: a button that shows results here. Not live (or non-US / sold): a real link to eBay.
      var nameEl = canShowSaved(s) ? '<button type="button" class="mb-name" data-runone="' + esc(s.id) + '">' + esc(s.name) + '</button>'
        : (function (b) { if (b.paid) panelPaid = true; return '<a class="mb-name" data-runone="' + esc(s.id) + '" href="' + esc(b.url) + '" target="_blank" rel="' + linkRel(b.paid) + '">' + esc(s.name) + ' ↗</a>'; })(savedBuilt(s));
      return '<li class="mb-row">' + nameEl +
        (s.newCount ? '<span class="badge new">' + s.newCount + ' new</span>' : '') +
        '<button type="button" class="mb-ico" data-rename="' + esc(s.id) + '" aria-label="Rename ' + esc(s.name) + '" title="Rename">✎</button>' +
        '<button type="button" class="mb-ico" data-delsearch="' + esc(s.id) + '" aria-label="Delete ' + esc(s.name) + '" title="Delete">×</button></li>';
    }).join('') : '<li class="mb-empty">Tap “♡ Save this search” on any results to keep it here.</li>';
    $('mbRuns').innerHTML = runs.slice(0, 6).map(function (r, i) {
      if (canShowSaved(r)) return '<li><button type="button" class="linkbtn" data-runrecent="' + i + '">' + esc(r.label || 'Search') + '</button></li>';
      var b = savedBuilt(r); if (b.paid) panelPaid = true;
      return '<li><a class="linkbtn" data-runrecent="' + i + '" href="' + esc(b.url) + '" target="_blank" rel="' + linkRel(b.paid) + '">' + esc(r.label || 'Search') + ' ↗</a></li>';
    }).join('');
    // Paid links in the panel get their own disclosure right there.
    var mbd = $('mbDisclosure'), dtext = U.disclosureText(A.linkConfig());
    mbd.hidden = !(panelPaid && dtext);
    mbd.innerHTML = panelPaid && dtext ? '<p class="d1">' + esc(dtext) + '</p><p class="d2">' + esc(CFG.nonEndorsement) + '</p>' : '';
    $('mbRunsWrap').hidden = !runs.length;
    if (renaming) { var inp = $('mbRenameIn'); if (inp && document.activeElement !== inp) { inp.focus(); inp.select(); } }
  }
  // Put saved criteria back into the form; run live results when possible. When not, the entry was a
  // real <a> link and the browser is already opening eBay (no window.open anywhere).
  function loadCriteria(q, r) {
    R = Object.assign(blankRefine(), r || {});
    A.set(U.stateFromQuery(q)); pageSort = null;
    if (canShow(A.get())) run(0);
  }
  // A short, recognizable name: the keywords first, then the form summary.
  function searchLabel(S) {
    var kw = [S.all_keywords, S.any_keywords].map(function (x) { return String(x || '').trim(); }).filter(Boolean).join(' ');
    var parts = [kw ? '“' + kw.slice(0, 40) + '”' : '', A.summary()].filter(Boolean);
    return (parts.join(' · ') + (R.western ? '' : ' · any style')).slice(0, 80);
  }
  function saveSearch() {
    var S = A.get();
    if (repo.atSearchLimit() && !repo.searches().some(function (s) { return s.q === U.shareQuery(S); })) {
      A.toast('My Boots holds ' + (SHOP.maxSavedSearches || 20) + ' searches. Delete one to save another.'); return;
    }
    var s = repo.saveSearch(searchLabel(S), U.shareQuery(S), R);
    if (!s) { A.toast('Couldn’t save on this device.'); return; }
    A.toast('Saved as “' + s.name + '” in My Boots.');
    draw();
  }
  function clearMyData() {
    if (window.confirm && !window.confirm('Clear everything Dusty\u2019s Boot Finder keeps on this device? Saved searches, picks, history and settings will be removed.')) return;
    repo.clearAll();
    try { sessionStorage.removeItem(SH.KEYS.sessionPrev); } catch (e) { /* ignore */ }
    R = blankRefine(); prefs = { layout: 'grid', hideSeen: false }; merged = null; last = null; savedView = null; tab = 'results'; panelOpen = false; panelSticky = false;
    repo = makeRepo();
    $('results').hidden = true;
    A.toast('All cleared. Nothing from this tool is left on this device.');
    renderPanel();
  }
  function exportData() {
    var blob = new Blob([JSON.stringify(repo.exportData(), null, 2)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'dustys-boot-finder-my-data.json';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  // Optional (config shopper.markSeenOn = 'view'): a card counts as seen once fully on screen.
  var io = null;
  function observe() {
    if (SHOP.markSeenOn !== 'view' || (tab !== 'results' && tab !== 'all') || !window.IntersectionObserver) return;
    if (io) io.disconnect();
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.intersectionRatio >= 0.99) { var id = e.target.getAttribute('data-id'); if (!repo.isSeen(id)) { repo.markSeen(id); markSeenDom(e.target); } io.unobserve(e.target); }
      });
    }, { threshold: [0.99] });
    [].forEach.call(document.querySelectorAll('#resList .rc:not(.is-seen)'), function (li) { io.observe(li); });
  }
  function markSeenDom(li) {
    if (!li || li.classList.contains('is-seen') || (tab !== 'results' && tab !== 'all')) return;
    li.classList.add('is-seen');
    var b = li.querySelector('.rc-badges');
    if (!b) { b = document.createElement('p'); b.className = 'rc-badges'; var body = li.querySelector('.rc-body'); body.insertBefore(b, body.firstChild); }
    b.insertAdjacentHTML('beforeend', '<span class="badge seen">Seen</span>');
  }

  function run(pg) {
    var S = A.get();
    page = pg || 0; tab = 'results';
    saveRefine();
    $('results').hidden = false; syncTabs(); syncModes();
    $('resTitle').textContent = 'Results';
    var built = U.buildSearch(S, A.linkConfig());
    setOpenLink(built.url, true, built.paid); setDisclosure(built.paid);
    $('resMsg').hidden = false; $('resMsg').textContent = 'Rounding up boots…';
    if (!page) { repo.addRun(U.shareQuery(S), R, searchLabel(S)); renderPanel(); }
    var mine = ++seq;
    fetch(apiQuery(S, page), { headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) { if (mine !== seq) return; if (d.fallback) showFallback(d.reason); else { render(d); syncTabs(); } })
      .catch(function () { if (mine === seq) showFallback(''); });
    if (pg) scrollToResults();
  }

  function showUndo(id) {
    undoId = id; $('resUndo').hidden = false;
    clearTimeout(undoTimer); undoTimer = setTimeout(function () { $('resUndo').hidden = true; undoId = null; }, 10000);
  }
  function redrawCards() {
    // Re-paint without refetching (heart / hide / unhide).
    syncTabs(); renderPanel();
    if (tab === 'all' && merged) renderAll();
    else if (tab === 'results' && last) render(last);
    else if (savedView && (tab === 'picks' || tab === 'hidden' || tab === 'viewed')) {
      var ids = savedIds(tab);
      if (!ids.length) return drawSaved(tab);
      savedView.ids = ids; savedView.key = tab + ':' + ids.join(',');
      if (savedView.items) savedView.items = savedView.items.filter(function (it) { return ids.indexOf(it.id) !== -1; });
      paintSaved(tab, savedView);
    } else draw();
  }

  /* ---------- events ---------- */
  document.addEventListener('click', function (e) {
    var a = e.target.closest('#resList a[data-seen]');
    if (a) {
      var sid = a.getAttribute('data-seen');
      if (!repo.isSeen(sid)) { repo.markSeen(sid); markSeenDom(a.closest('.rc')); }
      return;
    }
    // My Boots link entries (not live): let the browser open eBay, and load the criteria into the form.
    var ml = e.target.closest('a[data-runone], a[data-runrecent]');
    if (ml) {
      var ls = ml.hasAttribute('data-runone') ? repo.search(ml.getAttribute('data-runone')) : repo.runs()[+ml.getAttribute('data-runrecent')];
      if (ls) { if (ls.id) repo.clearNew(ls.id); R = Object.assign(blankRefine(), ls.r || {}); A.set(U.stateFromQuery(ls.q)); pageSort = null; }
      return;
    }
    var t = e.target.closest('button'); if (!t) return;
    var S = A.get();
    if (t.hasAttribute('data-mode')) {
      var m = t.getAttribute('data-mode');
      A.update(function (s) {
        s.sale_type = m === 'auction' ? 'auction_only' : m === 'bin' ? 'fixed_best_offer_only' : 'all';
        if (m === 'auction') s.sort_by = 'endingSoonest';
        else if (s.sort_by === 'endingSoonest') s.sort_by = 'newlyListed';
      });
      pageSort = null; run(0);
    } else if (t.hasAttribute('data-tab')) {
      tab = t.getAttribute('data-tab'); pageSort = null; savedView = null;
      $('results').hidden = false; draw();
      if (t.closest('#myBoots')) scrollToResults();
    } else if (t.hasAttribute('data-pick')) {
      var on = repo.togglePick(t.getAttribute('data-pick'));
      A.toast(on ? 'Added to ♥ My picks (kept on this device for 6 hours).' : 'Removed from My picks.');
      redrawCards();
    } else if (t.hasAttribute('data-hide')) {
      var hid = t.getAttribute('data-hide');
      repo.hide(hid); $('resUndoText').textContent = 'Listing hidden.'; showUndo(hid); redrawCards();
    } else if (t.hasAttribute('data-unhide')) {
      repo.unhide(t.getAttribute('data-unhide')); redrawCards();
    } else if (t.id === 'resUndoBtn') {
      if (undoId) repo.unhide(undoId); undoId = null; $('resUndo').hidden = true; redrawCards();
    } else if (t.id === 'unhideAll') {
      repo.unhideAll(); A.toast('All hidden listings will show again.'); redrawCards();
    } else if (t.id === 'showSeen') {
      prefs.hideSeen = false; savePrefs(); draw();
    } else if (t.id === 'clearData' || t.id === 'clearData2') {
      clearMyData();
    } else if (t.id === 'mbExport') {
      exportData();
    } else if (t.hasAttribute('data-layout')) {
      prefs.layout = t.getAttribute('data-layout') === 'list' ? 'list' : 'grid'; savePrefs(); syncModes();
    } else if (t.id === 'resFiltersBtn') {
      filtersOpen = !filtersOpen; syncFilters();
    } else if (t.hasAttribute('data-facet')) {
      var key = t.getAttribute('data-facet'), v = t.getAttribute('data-v');
      if (key === 'cond') {
        var i = R.cond.indexOf(v); if (i === -1) R.cond.push(v); else R.cond.splice(i, 1);
        if (S.selected_conditions.length) A.update(function (s) { s.selected_conditions = []; });
      } else {
        // Values the form knows (a listed size, width or maker) go into the form itself, so the
        // Boot Filters / Brands pop-ups and shared links stay in sync. Anything else is a refine pick.
        var l = sList(S, key), known = l && formValue(S, key, v);
        if (R[key].indexOf(v) !== -1) R[key].splice(R[key].indexOf(v), 1);
        else if (l && l.indexOf(v) !== -1) A.update(function (s) { var ll = sList(s, key); ll.splice(ll.indexOf(v), 1); });
        else if (known) A.update(function (s) { sList(s, key).push(known); });
        else R[key].push(v);
      }
      run(0);
    } else if (t.id === 'fxPrice') {
      var mn = $('fxMin').value, mx = $('fxMax').value;
      A.update(function (s) { s.price_min = U.cleanPrice(mn); s.price_max = U.cleanPrice(mx); });
      run(0);
    } else if (t.id === 'resPrev') { if (page > 0) run(page - 1); }
    else if (t.id === 'resNext') { if (last && last.hasMore) run(page + 1); }
    else if (t.id === 'resSave') saveSearch();
    else if (t.id === 'runAll') runAllSearches();
    else if (t.id === 'mbToggle') { panelOpen = !panelOpen; renaming = null; renderPanel(); }
    else if (t.hasAttribute('data-runone')) {
      var sv = repo.search(t.getAttribute('data-runone')); if (!sv) return;
      repo.clearNew(sv.id); loadCriteria(sv.q, sv.r);
    } else if (t.hasAttribute('data-runrecent')) {
      var rr = repo.runs()[+t.getAttribute('data-runrecent')]; if (rr) loadCriteria(rr.q, rr.r);
    } else if (t.hasAttribute('data-rename')) {
      renaming = t.getAttribute('data-rename'); renderPanel();
    } else if (t.hasAttribute('data-renamesave')) {
      repo.renameSearch(t.getAttribute('data-renamesave'), $('mbRenameIn').value); renaming = null; renderPanel();
      if (merged) draw();
    } else if (t.hasAttribute('data-renamecancel')) {
      renaming = null; renderPanel();
    } else if (t.hasAttribute('data-delsearch')) {
      var gone = repo.search(t.getAttribute('data-delsearch'));
      repo.deleteSearch(t.getAttribute('data-delsearch')); renaming = null;
      if (gone) A.toast('Deleted “' + gone.name + '”.');
      renderPanel(); syncSaveBtn();
    }
  });
  // Middle-click / "open in new tab" also counts as viewing it on eBay.
  document.addEventListener('auxclick', function (e) {
    var a = e.target.closest('#resList a[data-seen]');
    if (a && e.button === 1) { var sid = a.getAttribute('data-seen'); if (!repo.isSeen(sid)) { repo.markSeen(sid); markSeenDom(a.closest('.rc')); } }
  });
  $('resSort').addEventListener('change', function (e) {
    var v = e.target.value;
    if (tab !== 'results' || SH.PAGE_SORTS.indexOf(v) !== -1) { pageSort = v; redrawCards(); return; }   // re-sort on the page, no new search
    pageSort = null;
    A.update(function (s) { s.sort_by = v; });
    run(0);
  });
  $('hideSeen').addEventListener('change', function (e) { prefs.hideSeen = e.target.checked; savePrefs(); draw(); });
  $('resWestern').addEventListener('change', function (e) { R.western = e.target.checked; run(0); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (e.target.id === 'fxMin' || e.target.id === 'fxMax')) $('fxPrice').click();
    if (e.target.id === 'mbRenameIn') {
      if (e.key === 'Enter') { e.preventDefault(); var b = document.querySelector('[data-renamesave]'); if (b) b.click(); }
      else if (e.key === 'Escape') { renaming = null; renderPanel(); }
    }
  });
  $('reset').addEventListener('click', function () {
    R = blankRefine(); pageSort = null; try { localStorage.removeItem(REFINE_KEY); } catch (e) { /* ignore */ }
    $('results').hidden = true;
  });
  // Another tab changed My Boots: keep this one in step.
  window.addEventListener('storage', function (e) {
    if (e.key === ST.KEY || e.key === null) { repo = makeRepo(); renderPanel(); if (!$('results').hidden) redrawCards(); }
  });

  $('resFoot').textContent = CFG.nonEndorsement + ' Listings open on eBay; bid or buy there. Prices can change after the time shown.';
  window.DustyLive = { canShow: canShow, run: run, runAll: runAllSearches, refine: function () { return R; }, refineQuery: function () { return refineQuery(R); },
    store: function () { return repo; } };
  renderPanel();

  // Ask our own function whether live results are set up and whether tracking is on (the ONE
  // affiliate switch). No eBay call happens here.
  fetch(API + '?status=1', { headers: { Accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (!j) return;
      A.setServer({ affiliate: j.affiliate === true, profile: j.profile });
      renderPanel();
      if (j.live !== true) return;
      LIVE = true; A.refresh(); renderPanel();
      // A shared link with picks opens straight onto results.
      if (U.hasShareParams(location.search) && canShow(A.get())) run(0);
    })
    .catch(function () { /* static host or offline: the link builder keeps working, links stay clean */ });
})();
