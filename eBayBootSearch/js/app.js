/*
 * Boot Search page logic (vanilla JS, no framework, no build step).
 * Reads settings from config.js, option lists from data.js, and builds links with url-builder.js.
 * Nothing here talks to eBay: the finished search URL simply opens in a new tab.
 */
(function () {
  'use strict';
  var CFG = window.BOOTSEARCH_CONFIG;
  var D = window.BOOTSEARCH_DATA;
  var U = window.BootSearchURL;
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- state ---------- */
  function loadSaved() {
    try { var raw = localStorage.getItem(CFG.storageKey); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  // A shared link (?brand=Lucchese&size=10) wins over saved settings so it opens exactly as sent.
  var fromLink = U.hasShareParams(location.search);
  var S = fromLink ? U.stateFromQuery(location.search) : U.normalizeState(loadSaved());
  var sizeTab = 'mens', widthTab = 'mens';   // which list is shown when gender is "Both"
  var brandLetter = '', brandQuery = '';
  var openModal = null;

  function toggle(list, v) { var i = list.indexOf(v); if (i === -1) list.push(v); else list.splice(i, 1); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ---------- main form ---------- */
  function fillStatic() {
    $('region').innerHTML = D.REGIONS.map(function (r) { return '<option value="' + r.domain + '">' + esc(r.label) + '</option>'; }).join('');
  }

  function syncForm() {
    document.querySelectorAll('[data-view]').forEach(function (b) {
      var on = b.getAttribute('data-view') === S.interface_type;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
    });
    $('region').value = S.region;
    $('any').value = S.any_keywords; $('all').value = S.all_keywords; $('not').value = S.exclude_keywords;
    $('allMode').value = S.all_keywords_mode;
    $('desc').checked = S.search_description;
    $('useCat').checked = S.use_boot_filters;
    refresh();
  }

  function counts() {
    var g = S.gender;
    var sizes = g === 'womens' ? S.selected_sizes_womens : g === 'both' ? S.selected_sizes_mens.concat(S.selected_sizes_womens) : S.selected_sizes_mens;
    var widths = g === 'womens' ? S.selected_widths_womens : g === 'both' ? S.selected_widths_mens.concat(S.selected_widths_womens) : S.selected_widths_mens;
    return {
      boot: sizes.length + widths.length + S.selected_colors.length + S.selected_conditions.length +
        S.selected_vintage.length + S.selected_handmade.length + S.selected_countries.length,
      brands: S.selected_brands.length + (S.unbranded_checked ? 1 : 0),
      settings: (S.price_min ? 1 : 0) + (S.price_max ? 1 : 0) + (S.sale_type !== 'all' ? 1 : 0) +
        (S.sort_by !== 'newlyListed' ? 1 : 0) + (S.availability === 'sold' ? 1 : 0),
      more: (S.returns_accepted ? 1 : 0) + (S.free_shipping ? 1 : 0) + (S.local_pickup ? 1 : 0)
    };
  }

  function summaryText() {
    var bits = [];
    var gl = { mens: "Men's boots", womens: "Women's boots", both: "Men's + women's" };
    bits.push(S.use_boot_filters ? gl[S.gender] : 'All of eBay');
    if (S.use_boot_filters) {
      var g = S.gender;
      var sizes = g === 'womens' ? S.selected_sizes_womens : g === 'both' ? S.selected_sizes_mens.concat(S.selected_sizes_womens) : S.selected_sizes_mens;
      sizes = sizes.filter(function (v, i) { return sizes.indexOf(v) === i; });
      if (sizes.length) bits.push('size ' + sizes.join(', '));
      var brands = S.selected_brands.slice(); if (S.unbranded_checked) brands.push('Unbranded');
      if (brands.length) bits.push(brands.length > 3 ? brands.length + ' brands' : brands.join(', '));
    }
    if (S.selected_conditions.length === 1) bits.push(S.selected_conditions[0].toLowerCase());
    var pr = U.priceRange(S), cur = D.CURRENCY[S.region] || '';
    if (pr.min || pr.max) bits.push(pr.max ? cur + (pr.min || '0') + '–' + cur + pr.max : cur + pr.min + ' and up');
    if (S.sale_type !== 'all') bits.push(D.SALE_TYPES.filter(function (o) { return o.value === S.sale_type; })[0].label.toLowerCase());
    if (S.availability === 'sold') bits.push('sold listings');
    return bits.join(' · ');
  }

  function refresh() {
    var c = counts();
    var cat = S.use_boot_filters;
    $('btnBoot').hidden = !cat; $('btnBrands').hidden = !cat;
    $('catOffNote').hidden = cat || (c.boot - S.selected_conditions.length - S.selected_vintage.length + c.brands) === 0;
    [['btnBoot', c.boot], ['btnBrands', c.brands], ['btnSettings', c.settings], ['btnMore', c.more]].forEach(function (p) {
      $(p[0]).querySelector('.count').textContent = p[1] ? String(p[1]) : '';
    });
    $('descWrap').hidden = S.interface_type !== 'web';
    $('summary').textContent = summaryText();

    var built = U.buildSearch(S, CFG);
    $('previewUrl').textContent = built.url;
    // Opened from a shared link: keep the address bar matching the current picks, so a reload or
    // re-share gives what is on screen (not the original link).
    if (fromLink) { var q = U.shareQuery(S); history.replaceState(null, '', location.pathname + (q ? '?' + q : '')); }

    // Disclosure: only claim paid links when the affiliate switch is actually on.
    var aff = CFG.affiliate || {};
    var box = $('disclosure');
    if (aff.enabled === true) {
      box.hidden = false;
      box.innerHTML = '<p class="d1">' + esc(aff.disclosure) + '</p><p class="d2">' + esc(CFG.nonEndorsement) + '</p>' +
        (aff.disclosurePageUrl ? '<a href="' + esc(aff.disclosurePageUrl) + '">Affiliate disclosure</a>' : '');
      $('after').textContent = built.paid ? 'Paid link · Results open on eBay in a new tab.'
        : 'Results open on eBay in a new tab. This search is not a paid link.';
    } else {
      box.hidden = true; box.innerHTML = '';
      $('after').textContent = CFG.nonEndorsement + ' Results open on eBay in a new tab.';
    }
  }

  function save() {
    try {
      if ($('save').checked) localStorage.setItem(CFG.storageKey, JSON.stringify(S));
      else localStorage.removeItem(CFG.storageKey);
    } catch (e) { /* private mode etc. */ }
  }

  function search() {
    save();
    var built = U.buildSearch(S, CFG);
    window.open(built.url, '_blank', 'noopener');   // one search, one tab
  }

  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  function shareLink() {
    var q = U.shareQuery(S);
    var link = location.origin + (CFG.shareUrl || location.pathname) + (q ? '?' + q : '');   // always the preferred /boot-search address
    var done = function () { toast('Link copied. Anyone who opens it gets this exact search.'); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(link).then(done, function () { prompt('Copy this link:', link); });
    else prompt('Copy this link:', link);
    history.replaceState(null, '', (CFG.shareUrl || location.pathname) + (q ? '?' + q : ''));
  }

  /* ---------- modals ---------- */
  var TITLES = { boot_filters: 'Boot Filters', brands: 'Brands', standard_filters: 'Search Settings', advanced: 'More Options' };

  function chip(label, on, attrs) { return '<button type="button" class="chip' + (on ? ' on' : '') + '" aria-pressed="' + on + '" ' + attrs + '>' + esc(label) + '</button>'; }
  function box(label, on, attrs) { return '<label class="check"><input type="checkbox"' + (on ? ' checked' : '') + ' ' + attrs + '> <span>' + esc(label) + '</span></label>'; }
  function select(id, opts, val) {
    return '<select id="' + id + '">' + opts.map(function (o) { return '<option value="' + esc(o.value) + '"' + (o.value === val ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('') + '</select>';
  }

  function bootFiltersHTML() {
    var g = S.gender, h = '';
    h += '<div class="sec"><div class="sec-t">Gender</div><div class="chips">' +
      chip('Mens', g === 'mens', 'data-gender="mens"') + chip('Womens', g === 'womens', 'data-gender="womens"') +
      chip('Both', g === 'both', 'data-gender="both"') + '</div>' +
      (g === 'both' ? '<p class="note">Both runs one search in one tab, covering mens and womens (selected sizes and widths are combined)</p>' : '') + '</div>';

    var st = g === 'both' ? sizeTab : g;
    var sizeList = st === 'womens' ? D.SIZES_WOMENS : D.SIZES_MENS;
    var sizeSel = st === 'womens' ? S.selected_sizes_womens : S.selected_sizes_mens;
    h += '<div class="sec"><div class="sec-t">Size(s)' + (g === 'both' ? tabs('size', sizeTab, S.selected_sizes_mens.length, S.selected_sizes_womens.length) : '') +
      '</div><div class="chips">' + sizeList.map(function (v) { return chip(v, sizeSel.indexOf(v) !== -1, 'data-size="' + st + '" data-v="' + v + '"'); }).join('') + '</div></div>';

    var wt = g === 'both' ? widthTab : g;
    var widthSel = wt === 'womens' ? S.selected_widths_womens : S.selected_widths_mens;
    h += '<div class="sec"><div class="sec-t">Width(s)' + (g === 'both' ? tabs('width', widthTab, S.selected_widths_mens.length, S.selected_widths_womens.length) : '') +
      '</div><div class="chips">' + D.WIDTHS.map(function (v) { return chip(v, widthSel.indexOf(v) !== -1, 'data-width="' + wt + '" data-v="' + v + '"'); }).join('') + '</div></div>';

    h += '<div class="sec"><div class="sec-t">Color</div><div class="checks">' + D.COLORS.map(function (v) { return box(v, S.selected_colors.indexOf(v) !== -1, 'data-list="selected_colors" data-v="' + esc(v) + '"'); }).join('') + '</div></div>';

    h += '<div class="sec cols3">' +
      '<div><div class="sec-t">Condition</div>' + D.CONDITIONS.map(function (v) { return box(v, S.selected_conditions.indexOf(v) !== -1, 'data-list="selected_conditions" data-v="' + v + '"'); }).join('') + '</div>' +
      '<div><div class="sec-t">Vintage</div>' + D.VINTAGE.map(function (v) { return box(v, S.selected_vintage.indexOf(v) !== -1, 'data-list="selected_vintage" data-v="' + v + '"'); }).join('') + '</div>' +
      '<div><div class="sec-t">Handmade</div>' + D.HANDMADE.map(function (v) { return box(v, S.selected_handmade.indexOf(v) !== -1, 'data-list="selected_handmade" data-v="' + v + '"'); }).join('') + '</div>' +
      '</div>';

    var moreOpen = S.selected_countries.some(function (c) { return D.COUNTRIES_MORE.indexOf(c) !== -1; });
    h += '<div class="sec"><div class="sec-t">Country of Origin</div><div class="checks">' +
      D.COUNTRIES_MAIN.map(function (v) { return box(v, S.selected_countries.indexOf(v) !== -1, 'data-list="selected_countries" data-v="' + v + '"'); }).join('') +
      '</div><details class="more"' + (moreOpen ? ' open' : '') + '><summary>More countries</summary><div class="checks">' +
      D.COUNTRIES_MORE.map(function (v) { return box(v, S.selected_countries.indexOf(v) !== -1, 'data-list="selected_countries" data-v="' + v + '"'); }).join('') +
      '</div></details></div>';
    return h;
  }
  function tabs(kind, cur, nm, nw) {
    return ' <span class="tabs">' + chip('Mens' + (nm ? ' (' + nm + ')' : ''), cur === 'mens', 'data-tab="' + kind + '" data-v="mens"') +
      chip('Womens' + (nw ? ' (' + nw + ')' : ''), cur === 'womens', 'data-tab="' + kind + '" data-v="womens"') + '</span>';
  }

  function fold(x) { return String(x).toLowerCase().replace(/[^a-z0-9]+/g, ''); }
  function brandListHTML() {
    var q = fold(brandQuery);
    var list = D.BRANDS.filter(function (b) {
      if (brandLetter && b.toUpperCase().indexOf(brandLetter) !== 0) return false;
      return !q || fold(b).indexOf(q) !== -1;
    });
    var why = brandQuery ? 'matching \u201c' + esc(brandQuery) + '\u201d' + (brandLetter ? ' under ' + brandLetter : '') : 'under ' + brandLetter;
    return list.length ? list.map(function (b) { return box(b, S.selected_brands.indexOf(b) !== -1, 'data-list="selected_brands" data-v="' + esc(b) + '"'); }).join('')
      : '<p class="note">No brands ' + why + '. Not listed? Type the maker in \u201cANY of these words\u201d instead.</p>';
  }
  function brandsHTML() {
    var letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    return '<div class="sec tint">' + box('Unbranded', S.unbranded_checked, 'data-flag="unbranded_checked"') + '</div>' +
      '<div class="sec"><label class="sec-t small" for="brandSearch">Find a brand</label>' +
      '<input type="search" id="brandSearch" placeholder="e.g., Lucchese" autocomplete="off" value="' + esc(brandQuery) + '"></div>' +
      '<div class="sec"><div class="sec-t small" id="lblLetters">Filter by letter:</div><div class="chips letters" role="group" aria-labelledby="lblLetters">' +
      chip('All', !brandLetter, 'data-letter=""') + letters.map(function (l) { return chip(l, brandLetter === l, 'data-letter="' + l + '"'); }).join('') + '</div></div>' +
      (S.selected_brands.length ? '<p class="note" id="brandSel">Selected: ' + esc(S.selected_brands.join(', ')) + '</p>' : '') +
      '<div class="brandlist" id="brandList" role="group" aria-label="Brands">' + brandListHTML() + '</div>';
  }

  function settingsHTML() {
    return '<div class="sec cols2"><div><label class="sec-t" for="pmin">Min Price</label><input type="text" inputmode="decimal" id="pmin" placeholder="0" value="' + esc(S.price_min) + '"></div>' +
      '<div><label class="sec-t" for="pmax">Max Price</label><input type="text" inputmode="decimal" id="pmax" placeholder="Any" value="' + esc(S.price_max) + '"></div></div>' +
      '<p class="note warn" id="priceNote" aria-live="polite"' + (U.priceRange(S).swapped ? '' : ' hidden') + '>Min is higher than max, so the search will use ' +
      esc(U.priceRange(S).min) + ' to ' + esc(U.priceRange(S).max) + '.</p>' +
      '<div class="sec"><label class="sec-t" for="saleType">Sale Type</label>' + select('saleType', D.SALE_TYPES, S.sale_type) + '</div>' +
      '<div class="sec"><label class="sec-t" for="sortBy">Sort by</label>' + select('sortBy', D.SORTS, S.sort_by) + '</div>' +
      '<div class="sec"><label class="sec-t" for="avail">Availability</label>' + select('avail', D.AVAILABILITY, S.availability) + '</div>';
  }

  function moreHTML() {
    return '<div class="sec">' + box('Returns accepted', S.returns_accepted, 'data-flag="returns_accepted"') +
      box('Free shipping', S.free_shipping, 'data-flag="free_shipping"') +
      box('Local pickup available', S.local_pickup, 'data-flag="local_pickup"') +
      (S.local_pickup ? '<div class="indent">' +
        '<label class="sec-t small" for="zip">' + (S.region === 'ebay.com' ? 'ZIP code' : 'Postcode') + '</label>' +
        '<input type="text" id="zip" autocomplete="postal-code" placeholder="' + (S.region === 'ebay.com' ? 'e.g., 76102' : 'Postcode') + '" inputmode="' +
        (S.region === 'ebay.com' ? 'numeric' : 'text') + '" maxlength="' + (S.region === 'ebay.com' ? 5 : 10) + '" value="' + esc(S.local_pickup_zipcode) + '" aria-describedby="zipNote">' +
        '<label class="sec-t small" for="miles">Distance</label>' +
        select('miles', D.DISTANCES.map(function (m) { return { value: m, label: 'Within ' + m + ' miles' }; }), S.local_pickup_distance) +
        '<p class="note" id="zipNote" aria-live="polite">' + zipNote() + '</p></div>' : '') + '</div>';
  }
  function zipNote() {
    if (!S.local_pickup_zipcode) return 'Add a ' + (S.region === 'ebay.com' ? 'ZIP code' : 'postcode') + ' to limit the distance. Without one, eBay shows pickup items anywhere.';
    return U.zipValid(S.local_pickup_zipcode, S.region) ? 'Pickup within ' + S.local_pickup_distance + ' miles of ' + esc(S.local_pickup_zipcode) + '.'
      : (S.region === 'ebay.com' ? 'Enter all 5 digits of the ZIP code.' : 'Enter a full postcode.');
  }

  var RENDER = { boot_filters: bootFiltersHTML, brands: brandsHTML, standard_filters: settingsHTML, advanced: moreHTML };

  // A selector that finds "the same" control again after the modal is redrawn.
  var KEY_ATTRS = ['data-gender', 'data-size', 'data-width', 'data-tab', 'data-letter', 'data-list', 'data-flag', 'data-clear'];
  function focusKey(el) {
    if (!el || !$('modal').contains(el)) return null;
    if (el.id) return '#' + el.id;
    for (var i = 0; i < KEY_ATTRS.length; i++) {
      var a = KEY_ATTRS[i];
      if (el.hasAttribute(a)) {
        var sel = '[' + a + '="' + el.getAttribute(a).replace(/["\\]/g, '\\$&') + '"]';
        if (el.hasAttribute('data-v')) sel += '[data-v="' + el.getAttribute('data-v').replace(/["\\]/g, '\\$&') + '"]';
        return sel;
      }
    }
    return null;
  }
  function renderModal() {
    if (!openModal) return;
    var body = $('modalBody'), top = body.scrollTop;
    var list = body.querySelector('.brandlist'), listTop = list ? list.scrollTop : 0;
    var key = focusKey(document.activeElement);
    var caret = document.activeElement && document.activeElement.tagName === 'INPUT' && /text|search/.test(document.activeElement.type)
      ? document.activeElement.selectionStart : null;
    $('modalTitle').innerHTML = esc(TITLES[openModal]) + ' <button type="button" class="clear" data-clear="' + openModal + '">Clear all</button>';
    body.innerHTML = RENDER[openModal]();
    body.scrollTop = top;
    var nl = body.querySelector('.brandlist'); if (nl) nl.scrollTop = listTop;
    // Keyboard users keep their place: re-focus the control they just used.
    var again = key && $('modal').querySelector(key);
    if (again) { again.focus({ preventScroll: true }); if (caret !== null && again.setSelectionRange) try { again.setSelectionRange(caret, caret); } catch (e) { /* ignore */ } }
    else if (key) $('modalBox').focus();
  }
  function updateBrandList() {
    var l = $('brandList'); if (!l) return;
    l.innerHTML = brandListHTML(); l.scrollTop = 0;
  }

  var lastFocus = null;
  function showModal(name) {
    openModal = name; lastFocus = document.activeElement;
    $('modal').hidden = false; document.body.classList.add('noscroll');
    $('modalBody').scrollTop = 0;
    renderModal();
    $('modalBox').focus();
  }
  function closeModal() {
    openModal = null; $('modal').hidden = true; document.body.classList.remove('noscroll');
    refresh();
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function clearSection(name) {
    var d = U.defaultState();
    var groups = {
      keywords: ['any_keywords', 'all_keywords', 'exclude_keywords', 'search_description'],
      boot_filters: ['gender', 'selected_sizes_mens', 'selected_sizes_womens', 'selected_widths_mens', 'selected_widths_womens',
        'selected_conditions', 'selected_colors', 'selected_vintage', 'selected_handmade', 'selected_countries'],
      brands: ['selected_brands', 'unbranded_checked'],
      standard_filters: ['price_min', 'price_max', 'sale_type', 'sort_by', 'availability'],
      advanced: ['returns_accepted', 'free_shipping', 'local_pickup', 'local_pickup_zipcode', 'local_pickup_distance']
    };
    (groups[name] || []).forEach(function (k) { S[k] = d[k]; });
    if (name === 'brands') { brandLetter = ''; brandQuery = ''; }
    if (name === 'keywords') syncForm(); else { renderModal(); refresh(); }
  }

  /* ---------- events ---------- */
  function bind() {
    document.querySelectorAll('[data-view]').forEach(function (b) {
      b.addEventListener('click', function () { S.interface_type = b.getAttribute('data-view'); syncForm(); });
    });
    $('region').addEventListener('change', function (e) { S.region = e.target.value; refresh(); });
    [['any', 'any_keywords'], ['all', 'all_keywords'], ['not', 'exclude_keywords']].forEach(function (p) {
      $(p[0]).addEventListener('input', function (e) { S[p[1]] = e.target.value; refresh(); });
      $(p[0]).addEventListener('keydown', function (e) { if (e.key === 'Enter') search(); });
    });
    $('allMode').addEventListener('change', function (e) { S.all_keywords_mode = e.target.value; refresh(); });
    $('desc').addEventListener('change', function (e) { S.search_description = e.target.checked; refresh(); });
    $('useCat').addEventListener('change', function (e) { S.use_boot_filters = e.target.checked; refresh(); });
    document.querySelectorAll('[data-open]').forEach(function (b) {
      b.addEventListener('click', function () { showModal(b.getAttribute('data-open')); });
    });
    document.querySelector('[data-clear="keywords"]').addEventListener('click', function () { clearSection('keywords'); });
    $('go').addEventListener('click', search);
    $('share').addEventListener('click', shareLink);
    $('reset').addEventListener('click', function () {
      S = U.defaultState(); sizeTab = widthTab = 'mens'; brandLetter = ''; brandQuery = ''; fromLink = false;
      try { localStorage.removeItem(CFG.storageKey); } catch (e) { /* ignore */ }
      history.replaceState(null, '', location.pathname);
      syncForm(); toast('Everything is back to the defaults.');
    });

    // Modal: one delegated handler for every control inside it.
    $('modalX').addEventListener('click', closeModal);
    $('modalDone').addEventListener('click', closeModal);
    $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) closeModal(); });
    document.addEventListener('keydown', function (e) {
      if (!openModal) return;
      if (e.key === 'Escape') { closeModal(); return; }
      if (e.key !== 'Tab') return;
      // Keep Tab inside the open pop-up.
      var f = [].filter.call($('modalBox').querySelectorAll('button, input, select, summary, [href]'), function (el) { return !el.disabled && el.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1], a = document.activeElement;
      if (e.shiftKey && (a === first || a === $('modalBox'))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (a === last || !$('modalBox').contains(a))) { e.preventDefault(); first.focus(); }
    });
    $('modalTitle').addEventListener('click', function (e) { var c = e.target.closest('[data-clear]'); if (c) clearSection(c.getAttribute('data-clear')); });

    var body = $('modalBody');
    body.addEventListener('click', function (e) {
      var t = e.target.closest('button'); if (!t) return;
      var v = t.getAttribute('data-v');
      if (t.hasAttribute('data-gender')) { S.gender = t.getAttribute('data-gender'); if (S.gender !== 'both') sizeTab = widthTab = S.gender; }
      else if (t.hasAttribute('data-size')) toggle(t.getAttribute('data-size') === 'womens' ? S.selected_sizes_womens : S.selected_sizes_mens, v);
      else if (t.hasAttribute('data-width')) toggle(t.getAttribute('data-width') === 'womens' ? S.selected_widths_womens : S.selected_widths_mens, v);
      else if (t.hasAttribute('data-tab')) { if (t.getAttribute('data-tab') === 'size') sizeTab = v; else widthTab = v; }
      else if (t.hasAttribute('data-letter')) brandLetter = t.getAttribute('data-letter');
      else return;
      renderModal(); refresh();
    });
    body.addEventListener('change', function (e) {
      var t = e.target;
      if (t.hasAttribute('data-list')) toggle(S[t.getAttribute('data-list')], t.getAttribute('data-v'));
      else if (t.hasAttribute('data-flag')) S[t.getAttribute('data-flag')] = t.checked;
      else if (t.id === 'saleType') S.sale_type = t.value;
      else if (t.id === 'sortBy') S.sort_by = t.value;
      else if (t.id === 'avail') S.availability = t.value;
      else if (t.id === 'miles') { S.local_pickup_distance = t.value; $('zipNote').innerHTML = zipNote(); }
      else return;
      if (t.getAttribute('data-flag') === 'local_pickup' || t.getAttribute('data-list') === 'selected_brands') renderModal();
      refresh();
    });
    body.addEventListener('input', function (e) {
      var t = e.target;
      if (t.id === 'brandSearch') { brandQuery = t.value; updateBrandList(); return; }
      if (t.id === 'pmin' || t.id === 'pmax') {
        // Typing stays free-form (so "49,99" can be typed); the stored value is a clean number.
        var typed = t.value.replace(/[^0-9.,]/g, ''); if (typed !== t.value) t.value = typed;
        S[t.id === 'pmin' ? 'price_min' : 'price_max'] = U.cleanPrice(typed);
        var pr = U.priceRange(S), n = $('priceNote');
        n.hidden = !pr.swapped;
        if (pr.swapped) n.textContent = 'Min is higher than max, so the search will use ' + pr.min + ' to ' + pr.max + '.';
      } else if (t.id === 'zip') {
        var z = U.cleanZip(t.value, S.region); if (z !== t.value) t.value = z;
        S.local_pickup_zipcode = z.trim();
        $('zipNote').innerHTML = zipNote();
      } else return;
      refresh();
    });
    body.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.id === 'brandSearch') e.preventDefault(); });
  }

  fillStatic();
  bind();
  syncForm();
})();
