/*
 * Dusty's Boot Finder: "My Boots", the shopper's own repository of saved searches and activity.
 *
 * What is kept (one localStorage key, "dusty_myboots_v1"), and nothing else:
 *   searches  saved search CRITERIA (the share query + refine picks), a name, and when it was last
 *             run / how many new matches it had. No results are ever stored.
 *   picks     ♥ picks: eBay item ID -> time added. Dropped after itemTtlHours (6).
 *   hidden    hidden listings: eBay item ID -> time hidden. Dropped after itemTtlHours (6).
 *   viewed    listings opened on eBay: item ID -> time. Dropped after historyDays (30).
 *   runs      recent searches (criteria + label + time), newest first, max 20, historyDays.
 * Never stored: listing titles, prices, photos, seller names, or any link (affiliate or not).
 * Cards and links are rebuilt from a live lookup (/api/boots?ids=) or, with live results off,
 * from the item ID as a plain https://www.ebay.com/itm/<number> link.
 *
 * Storage is behind a tiny backend interface so accounts (e.g. Supabase) can be added later
 * without touching the UI:
 *   backend = { load() -> doc|null, save(doc) -> bool, clear() }
 * The repo keeps the doc in memory and writes it through on every change. A remote backend can
 * load before createRepo() and push saves in the background.
 *
 * Browser: window.DustyStore. Node (tests): require('./store.js').
 */
(function (root) {
  'use strict';
  var HOUR = 3600e3, DAY = 24 * HOUR;
  var KEY = 'dusty_myboots_v1';
  // Older keys from earlier builds. dusty_picks / dusty_history held listing copies: migrated to
  // IDs only and deleted.
  var LEGACY = { saved: 'dusty_saved_searches', picks: 'dusty_picks', history: 'dusty_history' };
  // Every key this tool writes, for "Clear my data".
  var ALL_KEYS = [KEY, LEGACY.saved, LEGACY.picks, LEGACY.history, 'dusty_refine', 'dusty_view_prefs',
    'dusty_last_visit', 'dusty_prefs', 'ebay_boot_prefs'];
  var ID_RE = /^v1\|\d{6,20}\|\d{1,20}$/;

  function blank() { return { v: 1, searches: [], picks: {}, hidden: {}, viewed: {}, runs: [] }; }

  /* ---------- backends ---------- */
  function createLocalBackend(storage, key) {
    key = key || KEY;
    return {
      kind: 'local',
      load: function () { try { var v = JSON.parse(storage.getItem(key) || 'null'); return v && typeof v === 'object' ? v : null; } catch (e) { return null; } },
      save: function (doc) { try { storage.setItem(key, JSON.stringify(doc)); return true; } catch (e) { return false; } },
      clear: function () { ALL_KEYS.forEach(function (k) { try { storage.removeItem(k); } catch (e) { /* ignore */ } }); },
      raw: function (k) { try { return storage.getItem(k); } catch (e) { return null; } },
      drop: function (k) { try { storage.removeItem(k); } catch (e) { /* ignore */ } }
    };
  }
  function createMemoryBackend() {
    var doc = null, extra = {};
    return { kind: 'memory', load: function () { return doc ? JSON.parse(JSON.stringify(doc)) : null; },
      save: function (d) { doc = JSON.parse(JSON.stringify(d)); return true; }, clear: function () { doc = null; extra = {}; },
      raw: function (k) { return k in extra ? extra[k] : null; }, drop: function (k) { delete extra[k]; }, _set: function (k, v) { extra[k] = v; } };
  }

  /* ---------- helpers ---------- */
  function str(v, n) { return String(v == null ? '' : v).slice(0, n || 200); }
  function isId(id) { return ID_RE.test(String(id || '')); }
  // "v1|123456789012|0" -> "123456789012"
  function legacyId(id) { var m = String(id || '').match(/^v1\|(\d+)\|/); return m ? m[1] : ''; }
  // Plain, untracked listing link rebuilt from the ID (used when live lookup is off).
  function plainItemUrl(id) { var n = legacyId(id); return n ? 'https://www.ebay.com/itm/' + n : ''; }
  function cleanRefine(r) {
    var out = {};
    ['size', 'width', 'brand', 'material', 'toe', 'heel', 'cond'].forEach(function (k) {
      out[k] = Array.isArray(r && r[k]) ? r[k].map(function (x) { return str(x, 80); }).slice(0, 30) : [];
    });
    out.western = !(r && r.western === false);
    return out;
  }
  function sameCriteria(a, b) { return a.q === b.q && JSON.stringify(cleanRefine(a.r)) === JSON.stringify(cleanRefine(b.r)); }
  function newId(now) { return 's' + now.toString(36) + Math.floor(Math.random() * 1e6).toString(36); }

  /* ---------- the repository ---------- */
  function createRepo(backend, opts) {
    opts = opts || {};
    var now = opts.now || Date.now;
    var itemTtl = (opts.itemTtlHours || 6) * HOUR;
    var histTtl = (opts.historyDays || 30) * DAY;
    var maxEntries = opts.maxEntries || 2000;
    var maxSearches = opts.maxSavedSearches || 20;
    var maxRuns = 20;
    var loaded = backend.load();
    var doc = sanitize(loaded) || blank();
    migrate();
    prune();
    // Write back only when loading changed something (expiry, migration, cleanup). Never writes an
    // empty record on its own, so "Clear my data" in another tab stays cleared.
    if (loaded ? JSON.stringify(doc) !== JSON.stringify(loaded) : !isEmpty()) persist();
    function isEmpty() { return !doc.searches.length && !doc.runs.length && !Object.keys(doc.picks).length && !Object.keys(doc.hidden).length && !Object.keys(doc.viewed).length; }

    function sanitize(d) {
      if (!d || typeof d !== 'object') return null;
      var out = blank();
      (Array.isArray(d.searches) ? d.searches : []).forEach(function (s) {
        if (!s || typeof s.q !== 'string') return;
        out.searches.push({ id: str(s.id, 40) || newId(now()), name: str(s.name, 80) || 'My search', q: str(s.q, 2000), r: cleanRefine(s.r),
          at: +s.at || now(), lastRun: +s.lastRun || 0, newCount: Math.max(0, +s.newCount || 0) });
      });
      ['picks', 'hidden', 'viewed'].forEach(function (k) {
        var m = d[k] && typeof d[k] === 'object' ? d[k] : {};
        Object.keys(m).forEach(function (id) { if (isId(id) && +m[id]) out[k][id] = +m[id]; });
      });
      (Array.isArray(d.runs) ? d.runs : []).forEach(function (r) {
        if (r && typeof r.q === 'string') out.runs.push({ q: str(r.q, 2000), r: cleanRefine(r.r), label: str(r.label, 120), at: +r.at || 0 });
      });
      return out;
    }

    // Earlier builds: saved searches (criteria) move over; picks/history keep IDs + times only.
    function migrate() {
      if (!backend.raw) return;
      var changed = false;
      try {
        var old = JSON.parse(backend.raw(LEGACY.saved) || 'null');
        if (Array.isArray(old)) old.forEach(function (s) {
          if (s && typeof s.q === 'string' && !doc.searches.some(function (x) { return sameCriteria(x, s); }))
            doc.searches.push({ id: newId(now()) + doc.searches.length, name: str(s.name, 80) || 'My search', q: str(s.q, 2000), r: cleanRefine(s.r), at: +s.at || now(), lastRun: 0, newCount: 0 });
        });
        if (old) changed = true;
      } catch (e) { /* ignore */ }
      try {
        var p = JSON.parse(backend.raw(LEGACY.picks) || 'null');
        if (p && typeof p === 'object') { Object.keys(p).forEach(function (id) { if (isId(id) && p[id] && +p[id].at) doc.picks[id] = +p[id].at; }); changed = true; }
      } catch (e) { /* ignore */ }
      try {
        var h = JSON.parse(backend.raw(LEGACY.history) || 'null');
        if (h && typeof h === 'object') {
          Object.keys(h).forEach(function (id) { if (!isId(id) || !h[id]) return; if (+h[id].seen) doc.viewed[id] = +h[id].seen; if (+h[id].hidden) doc.hidden[id] = +h[id].hidden; });
          changed = true;
        }
      } catch (e) { /* ignore */ }
      if (changed) [LEGACY.saved, LEGACY.picks, LEGACY.history].forEach(function (k) { backend.drop(k); });
    }

    function capMap(m) {
      var ids = Object.keys(m); if (ids.length <= maxEntries) return;
      ids.sort(function (a, b) { return m[b] - m[a]; }).slice(maxEntries).forEach(function (id) { delete m[id]; });
    }
    function prune() {
      var t = now();
      ['picks', 'hidden'].forEach(function (k) { Object.keys(doc[k]).forEach(function (id) { if (t - doc[k][id] >= itemTtl) delete doc[k][id]; }); });
      Object.keys(doc.viewed).forEach(function (id) { if (t - doc.viewed[id] >= histTtl) delete doc.viewed[id]; });
      doc.runs = doc.runs.filter(function (r) { return t - r.at < histTtl; }).slice(0, maxRuns);
      capMap(doc.picks); capMap(doc.hidden); capMap(doc.viewed);
      doc.searches = doc.searches.slice(0, maxSearches);
    }
    function persist() { prune(); return backend.save(doc); }
    function idsByTime(m) { prune(); return Object.keys(m).sort(function (a, b) { return m[b] - m[a]; }); }
    function findSearch(id) { for (var i = 0; i < doc.searches.length; i++) if (doc.searches[i].id === id) return doc.searches[i]; return null; }
    function copy(s) { return s ? JSON.parse(JSON.stringify(s)) : null; }

    var api = {
      backendKind: backend.kind,
      /* saved searches */
      searches: function () { return doc.searches.map(copy); },
      search: function (id) { return copy(findSearch(id)); },
      // Save criteria (q = share query, r = refine picks). Same criteria again = moved to the top.
      saveSearch: function (name, q, r) {
        var entry = { q: str(q, 2000), r: cleanRefine(r) };
        var dup = doc.searches.filter(function (s) { return sameCriteria(s, entry); })[0];
        if (dup) { doc.searches.splice(doc.searches.indexOf(dup), 1); doc.searches.unshift(dup); if (name) dup.name = str(name, 80); persist(); return copy(dup); }
        if (doc.searches.length >= maxSearches) return null;
        var s = { id: newId(now()), name: str(name, 80) || 'My search', q: entry.q, r: entry.r, at: now(), lastRun: 0, newCount: 0 };
        doc.searches.unshift(s); persist(); return copy(s);
      },
      renameSearch: function (id, name) { var s = findSearch(id); name = str(name, 80).trim(); if (!s || !name) return false; s.name = name; persist(); return true; },
      deleteSearch: function (id) { var s = findSearch(id); if (!s) return false; doc.searches.splice(doc.searches.indexOf(s), 1); persist(); return true; },
      // After a live run: remember when, and how many listings were new since the previous run.
      markRun: function (id, newCount, at) { var s = findSearch(id); if (!s) return; s.lastRun = at || now(); s.newCount = Math.max(0, newCount | 0); persist(); },
      clearNew: function (id) { var s = findSearch(id); if (s && s.newCount) { s.newCount = 0; persist(); } },
      newTotal: function () { return doc.searches.reduce(function (n, s) { return n + (s.newCount || 0); }, 0); },
      atSearchLimit: function () { return doc.searches.length >= maxSearches; },
      /* ♥ picks (IDs only, 6 h) */
      isPick: function (id) { prune(); return !!doc.picks[id]; },
      togglePick: function (id) { if (!isId(id)) return false; if (doc.picks[id]) delete doc.picks[id]; else doc.picks[id] = now(); persist(); return !!doc.picks[id]; },
      removePick: function (id) { delete doc.picks[id]; persist(); },
      picks: function () { return idsByTime(doc.picks).map(function (id) { return { id: id, at: doc.picks[id] }; }); },
      picksCount: function () { return idsByTime(doc.picks).length; },
      /* hidden (IDs only, 6 h) */
      isHidden: function (id) { prune(); return !!doc.hidden[id]; },
      hide: function (id) { if (!isId(id)) return; doc.hidden[id] = now(); persist(); },
      unhide: function (id) { delete doc.hidden[id]; persist(); },
      unhideAll: function () { doc.hidden = {}; persist(); },
      hidden: function () { return idsByTime(doc.hidden).map(function (id) { return { id: id, at: doc.hidden[id] }; }); },
      hiddenCount: function () { return idsByTime(doc.hidden).length; },
      /* viewed + recent searches (history) */
      isSeen: function (id) { return !!doc.viewed[id]; },
      markSeen: function (id) { if (!isId(id)) return; doc.viewed[id] = now(); persist(); },
      viewed: function (limit) { return idsByTime(doc.viewed).slice(0, limit || 24).map(function (id) { return { id: id, at: doc.viewed[id] }; }); },
      viewedCount: function () { return idsByTime(doc.viewed).length; },
      addRun: function (q, r, label) {
        var e = { q: str(q, 2000), r: cleanRefine(r), label: str(label, 120), at: now() };
        doc.runs = [e].concat(doc.runs.filter(function (x) { return !sameCriteria(x, e); })); persist();
      },
      runs: function () { prune(); return doc.runs.map(copy); },
      clearHistory: function () { doc.viewed = {}; doc.hidden = {}; doc.runs = []; persist(); },
      /* everything */
      exportData: function () { prune(); return { tool: "Dusty's Boot Finder", exportedAt: new Date(now()).toISOString(), data: copy(doc) }; },
      clearAll: function () { doc = blank(); backend.clear(); },
      size: function () { prune(); return { searches: doc.searches.length, picks: Object.keys(doc.picks).length, hidden: Object.keys(doc.hidden).length, viewed: Object.keys(doc.viewed).length, runs: doc.runs.length }; },
      _doc: function () { return doc; }
    };
    return api;
  }

  var API = { createRepo: createRepo, createLocalBackend: createLocalBackend, createMemoryBackend: createMemoryBackend,
    plainItemUrl: plainItemUrl, legacyId: legacyId, isId: isId, KEY: KEY, LEGACY: LEGACY, ALL_KEYS: ALL_KEYS };
  if (typeof module === 'object' && module.exports) module.exports = API;
  else root.DustyStore = API;
})(this);
