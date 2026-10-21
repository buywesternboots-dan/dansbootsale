/*
 * Boot Search URL builder: turns the form state into one eBay search URL.
 * Pure functions, no DOM, no network. eBay is never called from here; the visitor's
 * browser simply opens the finished search page on eBay.
 *
 * Browser: window.BootSearchURL. Node (tests): require('./url-builder.js').
 */
(function (root) {
  'use strict';
  var DATA = (typeof module === 'object' && module.exports) ? require('./data.js') : root.BOOTSEARCH_DATA;

  // State uses the same field names as the old tool's saved preferences (localStorage).
  function defaultState() {
    return {
      interface_type: 'web', region: 'ebay.com', use_boot_filters: true, gender: 'mens',
      any_keywords: '', all_keywords: '', all_keywords_mode: 'any_order', exclude_keywords: '',
      search_description: false,
      selected_sizes_mens: [], selected_sizes_womens: [], selected_widths_mens: [], selected_widths_womens: [],
      selected_conditions: [], selected_colors: [], selected_brands: [], unbranded_checked: false,
      selected_vintage: [], selected_handmade: [], selected_countries: [],
      price_min: '', price_max: '', sale_type: 'all', sort_by: 'newlyListed', availability: 'available',
      returns_accepted: false, free_shipping: false, local_pickup: false,
      local_pickup_zipcode: '', local_pickup_distance: '10'
    };
  }

  var ARRAY_KEYS = ['selected_sizes_mens', 'selected_sizes_womens', 'selected_widths_mens', 'selected_widths_womens',
    'selected_conditions', 'selected_colors', 'selected_brands', 'selected_vintage', 'selected_handmade', 'selected_countries'];
  var BOOL_KEYS = ['use_boot_filters', 'search_description', 'unbranded_checked', 'returns_accepted', 'free_shipping', 'local_pickup'];

  function inList(list, v) { return list.indexOf(v) !== -1; }
  function uniq(a) { var out = []; a.forEach(function (x) { if (!inList(out, x)) out.push(x); }); return out; }
  // Commas count as separators too, so "lucchese, justin" works like "lucchese justin".
  function words(s) { return String(s || '').trim().split(/[\s,]+/).filter(Boolean); }

  // Match a value to an option list ignoring case ("black" -> "Black"); unknown values are dropped.
  function canon(list, v) {
    var low = String(v).trim().toLowerCase();
    for (var i = 0; i < list.length; i++) if (list[i].toLowerCase() === low) return list[i];
    return null;
  }
  function canonList(list, values) { return uniq(values.map(function (v) { return canon(list, v); }).filter(Boolean)); }

  // Prices: digits and one decimal point. "49,99" (decimal comma) -> "49.99"; "1,250" (thousands) -> "1250".
  function cleanPrice(raw) {
    var v = String(raw == null ? '' : raw).replace(/[^0-9.,]/g, '');
    if (v.indexOf(',') !== -1 && v.indexOf('.') === -1 && /,\d{1,2}$/.test(v)) v = v.replace(/,(?=\d{1,2}$)/, '.');
    v = v.replace(/,/g, '');
    var dot = v.indexOf('.');
    if (dot !== -1) v = v.slice(0, dot + 1) + v.slice(dot + 1).split('.')[0];   // "1.2.3" -> "1.2"
    return v;
  }
  // The number actually sent to eBay ('' when blank or just ".").
  function priceValue(v) { v = cleanPrice(v).replace(/\.$/, ''); return v === '' || v === '.' ? '' : v.replace(/^\./, '0.'); }

  // Location for "Local pickup": US sites need a 5-digit ZIP; other sites take a short postcode.
  function cleanZip(raw, region) {
    var v = String(raw == null ? '' : raw);
    if (region === 'ebay.com') return v.replace(/\D/g, '').slice(0, 5);
    return v.replace(/[^0-9A-Za-z \-]/g, '').replace(/\s+/g, ' ').replace(/^\s+/, '').slice(0, 10).toUpperCase();
  }
  function zipValid(zip, region) {
    zip = String(zip || '').trim();
    return region === 'ebay.com' ? /^\d{5}$/.test(zip) : /^[0-9A-Z][0-9A-Z \-]{1,9}$/.test(zip);
  }

  // Accept saved prefs / partial state and return a complete, valid state.
  function normalizeState(input) {
    var s = defaultState();
    if (!input || typeof input !== 'object') return s;
    Object.keys(s).forEach(function (k) {
      if (!(k in input) || input[k] === undefined || input[k] === null) return;
      if (inList(ARRAY_KEYS, k)) s[k] = Array.isArray(input[k]) ? input[k].map(String) : [];
      else if (inList(BOOL_KEYS, k)) s[k] = input[k] === true;
      else s[k] = String(input[k]);
    });
    if (!inList(['web', 'mobile'], s.interface_type)) s.interface_type = 'web';
    if (!DATA.REGIONS.some(function (r) { return r.domain === s.region; })) s.region = 'ebay.com';
    // Old tool allowed "no gender", which searched all of Clothing, Shoes & Accessories with men's sizes.
    if (!inList(['mens', 'womens', 'both'], s.gender)) s.gender = 'mens';
    if (!inList(['any_order', 'exact_order'], s.all_keywords_mode)) s.all_keywords_mode = 'any_order';
    if (!DATA.SALE_TYPES.some(function (o) { return o.value === s.sale_type; })) s.sale_type = 'all';
    if (!DATA.SORTS.some(function (o) { return o.value === s.sort_by; })) s.sort_by = 'newlyListed';
    if (s.availability !== 'sold') s.availability = 'available'; // old saved value "all" meant available
    if (!inList(DATA.DISTANCES, s.local_pickup_distance)) s.local_pickup_distance = '10';
    s.price_min = cleanPrice(s.price_min);
    s.price_max = cleanPrice(s.price_max);
    s.local_pickup_zipcode = cleanZip(s.local_pickup_zipcode, s.region).trim();
    // Drop values that no longer exist in the option lists (e.g. "Under 5", brand "Not Specified").
    // Values from shared links may differ in case ("black", "ee") or be junk: map to the real option or drop.
    s.selected_sizes_mens = uniq(s.selected_sizes_mens.map(function (v) { return v.trim(); }).filter(function (v) { return inList(DATA.SIZES_MENS, v); }));
    s.selected_sizes_womens = uniq(s.selected_sizes_womens.map(function (v) { return v.trim(); }).filter(function (v) { return inList(DATA.SIZES_WOMENS, v); }));
    s.selected_widths_mens = canonList(DATA.WIDTHS, s.selected_widths_mens);
    s.selected_widths_womens = canonList(DATA.WIDTHS, s.selected_widths_womens);
    s.selected_brands = canonList(DATA.BRANDS, s.selected_brands);
    s.selected_colors = canonList(DATA.COLORS, s.selected_colors);
    s.selected_conditions = canonList(DATA.CONDITIONS, s.selected_conditions);
    s.selected_vintage = canonList(DATA.VINTAGE, s.selected_vintage);
    s.selected_handmade = canonList(DATA.HANDMADE, s.selected_handmade);
    s.selected_countries = canonList(DATA.COUNTRIES_MAIN.concat(DATA.COUNTRIES_MORE), s.selected_countries);
    return s;
  }

  // eBay keyword syntax: all words (optionally "exact phrase"), any words as (a,b), excluded as -(a,b).
  function buildKeywords(s) {
    var parts = [];
    var all = String(s.all_keywords || '').trim();
    if (s.all_keywords_mode === 'exact_order') {
      all = all.replace(/"/g, '').replace(/\s+/g, ' ').trim();   // no nested quotes inside the phrase
      if (all) parts.push('"' + all + '"');
    } else if (all) parts.push(words(all).join(' '));
    var any = words(s.any_keywords);
    if (any.length === 1) parts.push(any[0]); else if (any.length > 1) parts.push('(' + any.join(',') + ')');
    var not = words(s.exclude_keywords).map(function (w) { return w.replace(/^-+/, ''); }).filter(Boolean);
    if (not.length === 1) parts.push('-' + not[0]); else if (not.length > 1) parts.push('-(' + not.join(',') + ')');
    var kw = parts.join(' ');
    var v = s.selected_vintage || [];
    if (inList(v, 'Yes') && !inList(v, 'No')) kw = (kw + ' vintage').trim();
    else if (inList(v, 'No') && !inList(v, 'Yes')) kw = (kw + ' -vintage').trim();
    return kw;
  }

  // Min/max as sent to eBay. If min is above max they are swapped (eBay would otherwise show nothing).
  function priceRange(s) {
    var min = priceValue(s.price_min), max = priceValue(s.price_max), swapped = false;
    if (min && max && parseFloat(min) > parseFloat(max)) { var t = min; min = max; max = t; swapped = true; }
    return { min: min, max: max, swapped: swapped };
  }

  // Decide whether EPN params apply, and why not when they don't.
  function affiliateDecision(s, config) {
    var aff = (config && config.affiliate) || {};
    if (aff.enabled !== true) return { paid: false, reason: 'affiliate switch is off' };
    var profile = aff.profiles && aff.profiles[aff.activeProfile];
    if (!profile) return { paid: false, reason: 'no active affiliate profile' };
    var campid = s.interface_type === 'mobile' ? profile.campaigns.mobile : profile.campaigns.web;
    // EPN campaign IDs are 10 digits. Anything else (e.g. "<WBW_CAMPID>") is a placeholder: never send it.
    if (!/^\d{10}$/.test(String(campid || ''))) return { paid: false, reason: 'campaign ID is a placeholder' };
    if (!DATA.EPN_ROTATION[s.region]) return { paid: false, reason: 'no EPN program for ' + s.region };
    if (s.availability === 'sold') return { paid: false, reason: 'sold searches are never affiliate links' };
    return {
      paid: true, reason: 'affiliate on',
      params: [
        ['mkcid', '1'], ['mkrid', DATA.EPN_ROTATION[s.region]], ['siteid', DATA.EBAY_SITE_ID[s.region] || '0'],
        ['campid', String(campid)],
        ['customid', profile.customidPrefix + '-' + (s.interface_type === 'mobile' ? 'mobile' : 'web')],
        ['toolid', aff.toolid || '10001'], ['mkevt', '1']
      ]
    };
  }

  // Returns { url, paid, reason }. One search, one tab (the old "Both" opened two tabs).
  function buildSearch(input, config) {
    var s = normalizeState(input);
    var q = new URLSearchParams();
    q.set('_nkw', buildKeywords(s));

    var boots = s.use_boot_filters;
    var g = s.gender;
    var cat = boots ? DATA.CATEGORY[g] : DATA.CATEGORY.none;
    q.set('_sacat', cat);

    if (s.selected_conditions.length) {
      var codes = [];
      s.selected_conditions.forEach(function (c) { codes = codes.concat(DATA.CONDITION_CODES[c] || []); });
      if (codes.length) q.set('LH_ItemCondition', uniq(codes).join('|'));
    }

    var aspect = false;
    if (boots) {
      var sizes = g === 'womens' ? s.selected_sizes_womens
        : g === 'both' ? uniq(s.selected_sizes_mens.concat(s.selected_sizes_womens)) : s.selected_sizes_mens;
      var widths = g === 'womens' ? s.selected_widths_womens
        : g === 'both' ? uniq(s.selected_widths_mens.concat(s.selected_widths_womens)) : s.selected_widths_mens;
      var colors = s.selected_colors.filter(function (c) { return c !== 'Not specified'; });
      if (colors.length) { q.set('Color', colors.join('|')); aspect = true; }
      if (sizes.length) { q.set('US Shoe Size', sizes.join('|')); aspect = true; }
      widths = widths.filter(function (w) { return w !== 'Not Specified'; });
      if (widths.length) { q.set('Shoe Width', widths.join('|')); aspect = true; }
      var brands = s.selected_brands.slice();
      if (s.unbranded_checked) brands.push('Unbranded');
      if (brands.length) { q.set('Brand', brands.join('|')); aspect = true; }
      var hm = s.selected_handmade;
      if (inList(hm, 'Handmade') && !inList(hm, 'Not handmade')) { q.set('Handmade', 'Yes'); aspect = true; }
      else if (inList(hm, 'Not handmade') && !inList(hm, 'Handmade')) { q.set('Handmade', 'No'); aspect = true; }
      var countries = s.selected_countries.filter(function (c) { return c !== 'Not specified'; });
      if (countries.length) {
        q.set('Country/Region of Manufacture', countries.map(function (c) { return DATA.COUNTRY_ASPECT_VALUE[c] || c; }).join('|'));
        aspect = true;
      }
    }
    if (aspect && cat !== '0') q.set('_dcat', cat);
    var pr = priceRange(s);
    if (pr.min) q.set('_udlo', pr.min);
    if (pr.max) q.set('_udhi', pr.max);
    if (s.sale_type === 'auction_only') q.set('LH_Auction', '1');
    else if (s.sale_type === 'fixed_best_offer_only') q.set('LH_BIN', '1');
    else if (s.sale_type === 'best_offer_only') q.set('LH_BO', '1');
    var sort = DATA.SORTS.filter(function (o) { return o.value === s.sort_by; })[0];
    if (sort) q.set('_sop', sort.sop);
    if (s.availability === 'sold') { q.set('LH_Sold', '1'); q.set('LH_Complete', '1'); }
    if (s.search_description && s.interface_type === 'web') q.set('LH_TitleDesc', '1');
    if (s.returns_accepted) q.set('LH_RPA', '1');
    if (s.free_shipping) q.set('LH_FS', '1');
    if (s.local_pickup) {
      q.set('LH_PickupOnly', '1');
      if (zipValid(s.local_pickup_zipcode, s.region)) {
        q.set('_stpos', s.local_pickup_zipcode); q.set('_sadis', s.local_pickup_distance); q.set('LH_SALocation', '1');
      }
    }
    q.set('_ipg', '240');
    q.set('rt', 'nc');

    var aff = affiliateDecision(s, config);
    if (aff.paid) aff.params.forEach(function (p) { q.set(p[0], p[1]); });

    var host = (s.interface_type === 'mobile' ? 'm.' : 'www.') + s.region;
    return { url: 'https://' + host + '/sch/i.html?' + q.toString(), paid: aff.paid, reason: aff.reason };
  }

  /* ---------- Shareable links: ?brand=Lucchese&gender=womens&size=7,7.5 ---------- */
  // Short query keys -> state keys. Lists are comma-separated.
  var SHARE_KEYS = {
    any: 'any_keywords', all: 'all_keywords', not: 'exclude_keywords', gender: 'gender', region: 'region',
    sale: 'sale_type', sort: 'sort_by', min: 'price_min', max: 'price_max', zip: 'local_pickup_zipcode',
    miles: 'local_pickup_distance', view: 'interface_type'
  };
  var SHARE_LISTS = { cond: 'selected_conditions', color: 'selected_colors', vintage: 'selected_vintage',
    handmade: 'selected_handmade', country: 'selected_countries', brand: 'selected_brands' };
  var SHARE_FLAGS = { exact: 'all_keywords_mode', desc: 'search_description', ra: 'returns_accepted', fs: 'free_shipping',
    pickup: 'local_pickup', unbranded: 'unbranded_checked', sold: 'availability', nocat: 'use_boot_filters' };

  function hasShareParams(search) {
    var p = new URLSearchParams(search || '');
    var keys = Object.keys(SHARE_KEYS).concat(Object.keys(SHARE_LISTS), Object.keys(SHARE_FLAGS), ['size', 'width', 'maker']);
    return keys.some(function (k) { return p.has(k); });
  }

  function findBrand(name) {
    var n = String(name).trim().toLowerCase().replace(/[-_]+/g, ' ');
    return DATA.BRANDS.filter(function (b) { return b.toLowerCase() === n || b.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() === n; })[0];
  }

  // Build a state from a shared link. Starts from defaults, not saved prefs, so the link reproduces exactly.
  function stateFromQuery(search) {
    var p = new URLSearchParams(search || '');
    var s = defaultState();
    Object.keys(SHARE_KEYS).forEach(function (k) { if (p.has(k)) s[SHARE_KEYS[k]] = p.get(k); });
    Object.keys(SHARE_LISTS).forEach(function (k) { if (p.has(k)) s[SHARE_LISTS[k]] = p.get(k).split(',').map(function (x) { return x.trim(); }).filter(Boolean); });
    if (p.has('maker')) s.selected_brands = s.selected_brands.concat(p.get('maker').split(','));
    s.selected_brands = uniq(s.selected_brands.map(findBrand).filter(Boolean));
    if (p.get('exact') === '1') s.all_keywords_mode = 'exact_order';
    if (p.get('desc') === '1') s.search_description = true;
    if (p.get('ra') === '1') s.returns_accepted = true;
    if (p.get('fs') === '1') s.free_shipping = true;
    if (p.get('pickup') === '1') s.local_pickup = true;
    if (p.get('unbranded') === '1') s.unbranded_checked = true;
    if (p.get('sold') === '1') s.availability = 'sold';
    if (p.get('nocat') === '1') s.use_boot_filters = false;
    var gender = normalizeState({ gender: s.gender }).gender;
    var size = p.has('size') ? p.get('size').split(',') : [];
    var width = p.has('width') ? p.get('width').split(',') : [];
    if (gender === 'womens') { s.selected_sizes_womens = size; s.selected_widths_womens = width; }
    else if (gender === 'both') {
      s.selected_sizes_mens = size.filter(function (v) { return inList(DATA.SIZES_MENS, v); });
      s.selected_sizes_womens = size.filter(function (v) { return inList(DATA.SIZES_WOMENS, v); });
      s.selected_widths_mens = width; s.selected_widths_womens = width;
    } else { s.selected_sizes_mens = size; s.selected_widths_mens = width; }
    return normalizeState(s);
  }

  // The reverse: a short query string describing everything that differs from the defaults.
  function shareQuery(input) {
    var s = normalizeState(input), d = defaultState(), p = new URLSearchParams();
    Object.keys(SHARE_KEYS).forEach(function (k) { var key = SHARE_KEYS[k]; if (s[key] !== d[key] && s[key] !== '') p.set(k, s[key]); });
    Object.keys(SHARE_LISTS).forEach(function (k) { var v = s[SHARE_LISTS[k]]; if (v.length) p.set(k, v.join(',')); });
    var sizes = s.gender === 'womens' ? s.selected_sizes_womens : s.gender === 'both'
      ? uniq(s.selected_sizes_mens.concat(s.selected_sizes_womens)) : s.selected_sizes_mens;
    var widths = s.gender === 'womens' ? s.selected_widths_womens : s.gender === 'both'
      ? uniq(s.selected_widths_mens.concat(s.selected_widths_womens)) : s.selected_widths_mens;
    if (sizes.length) p.set('size', sizes.join(','));
    if (widths.length) p.set('width', widths.join(','));
    if (s.all_keywords_mode === 'exact_order') p.set('exact', '1');
    if (s.search_description) p.set('desc', '1');
    if (s.returns_accepted) p.set('ra', '1');
    if (s.free_shipping) p.set('fs', '1');
    if (s.local_pickup) p.set('pickup', '1');
    if (s.unbranded_checked) p.set('unbranded', '1');
    if (s.availability === 'sold') p.set('sold', '1');
    if (!s.use_boot_filters) p.set('nocat', '1');
    return p.toString();
  }

  var API = { defaultState: defaultState, normalizeState: normalizeState, buildKeywords: buildKeywords,
    affiliateDecision: affiliateDecision, buildSearch: buildSearch, stateFromQuery: stateFromQuery,
    shareQuery: shareQuery, hasShareParams: hasShareParams, SHARE_FLAGS: SHARE_FLAGS,
    cleanPrice: cleanPrice, priceRange: priceRange, cleanZip: cleanZip, zipValid: zipValid };
  if (typeof module === 'object' && module.exports) module.exports = API;
  else root.BootSearchURL = API;
})(this);
