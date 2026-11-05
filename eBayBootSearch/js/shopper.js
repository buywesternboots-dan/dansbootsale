/*
 * Dusty's Boot Finder: pure helpers for the results page (no storage of listings, no network).
 *   - lastVisit(): previous visit time for the "New since your last visit" badge.
 *   - sortItems(): sort one page of live results.
 *   - mergeRuns() / sortMerged(): "Run all my searches" merges every saved search's live results,
 *     removes duplicates by eBay item ID and tags each card with the search(es) that found it.
 *   - runAll(): runs the saved searches through a fetch function, throttled (concurrency, delay, max).
 * The shopper's saved data lives in js/store.js. Browser: window.DustyShopper. Node: require().
 */
(function (root) {
  'use strict';
  var KEYS = { lastVisit: 'dusty_last_visit', sessionPrev: 'dusty_prev_visit' };

  // Previous visit time for "New since your last visit". The same value holds for the whole browser
  // session (so reloading doesn't wipe the badges); a new session moves "last visit" forward.
  function lastVisit(local, session, now) {
    now = now || Date.now;
    try {
      var prev = session.getItem(KEYS.sessionPrev);
      if (prev === null) {
        prev = local.getItem(KEYS.lastVisit) || '';
        session.setItem(KEYS.sessionPrev, prev);
        local.setItem(KEYS.lastVisit, String(now()));
      }
      var n = parseInt(prev, 10);
      return isNaN(n) ? null : n;
    } catch (e) { return null; }
  }

  function amount(m) { var n = m ? parseFloat(m.value) : NaN; return isNaN(n) ? null : n; }
  function isAuction(it) { return (it.buyingOptions || []).indexOf('AUCTION') !== -1; }
  // Item price (current bid for auctions) plus shipping. Unknown/calculated shipping -> price only,
  // flagged so it sorts after items whose full cost is known.
  function totalCost(it) {
    var p = amount(isAuction(it) && it.currentBid ? it.currentBid : it.price);
    if (p === null) return { value: null, exact: false };
    if (!it.shipping || it.shipping.calculated) return { value: p, exact: false };
    var s = amount(it.shipping);
    return { value: p + (s || 0), exact: s !== null };
  }

  // Sort one page of results. Server sorts (Best match, Ending soonest, Newly listed) keep eBay's
  // order; price sorts are refined to price + shipping; Most bids / Distance are page-only sorts.
  function sortItems(items, mode) {
    var list = items.map(function (it, i) { return { it: it, i: i }; });
    var cmp;
    if (mode === 'priceLowToHigh' || mode === 'priceHighToLow') {
      var dir = mode === 'priceLowToHigh' ? 1 : -1;
      cmp = function (a, b) {
        var x = totalCost(a.it), y = totalCost(b.it);
        if (x.value === null || y.value === null) return (x.value === null) - (y.value === null);
        if (x.exact !== y.exact) return x.exact ? -1 : 1;
        return dir * (x.value - y.value);
      };
    } else if (mode === 'mostBids') {
      cmp = function (a, b) { return (b.it.bidCount == null ? -1 : b.it.bidCount) - (a.it.bidCount == null ? -1 : a.it.bidCount); };
    } else if (mode === 'distance') {
      cmp = function (a, b) {
        var x = a.it.distance ? a.it.distance.value : Infinity, y = b.it.distance ? b.it.distance.value : Infinity;
        return x - y;
      };
    } else return items.slice();
    return list.sort(function (a, b) { return cmp(a, b) || a.i - b.i; }).map(function (x) { return x.it; });
  }

  /* ---------- "Run all my searches" ---------- */

  // runs: [{ search: {id, name}, items: [...], newSince: ms|0 }] in saved-search order.
  // Returns one list, deduped by item ID. Each item gets sources [{id, name}], rank (best position in
  // any search, for "Best match") and isNew (created after that search's previous run).
  function mergeRuns(runs) {
    var byId = {}, out = [];
    (runs || []).forEach(function (run, si) {
      (run.items || []).forEach(function (it, pos) {
        if (!it || !it.id) return;
        var fresh = !!(run.newSince && it.created && Date.parse(it.created) > run.newSince);
        var src = { id: run.search.id, name: run.search.name };
        var m = byId[it.id];
        if (!m) {
          m = byId[it.id] = Object.assign({}, it, { sources: [src], rank: pos, firstSearch: si, isNew: fresh });
          out.push(m);
        } else {
          if (!m.sources.some(function (x) { return x.id === src.id; })) m.sources.push(src);
          if (pos < m.rank || (pos === m.rank && si < m.firstSearch)) { m.rank = pos; m.firstSearch = si; }
          m.isNew = m.isNew || fresh;
          if (it.paid) { m.paid = true; m.url = it.url; }
        }
      });
    });
    return out;
  }
  // New listings per search (for the on-site badge).
  function newCounts(runs) {
    var c = {};
    (runs || []).forEach(function (run) {
      c[run.search.id] = (run.items || []).filter(function (it) { return run.newSince && it.created && Date.parse(it.created) > run.newSince; }).length;
    });
    return c;
  }
  function ts(v, dflt) { var n = Date.parse(v || ''); return isNaN(n) ? dflt : n; }
  // Every sort is done here (the merged list has no single eBay order).
  function sortMerged(items, mode) {
    var list = items.map(function (it, i) { return { it: it, i: i }; }), cmp;
    if (mode === 'priceLowToHigh' || mode === 'priceHighToLow' || mode === 'mostBids') return sortItems(items, mode);
    if (mode === 'endingSoonest') cmp = function (a, b) { return ts(a.it.endDate, Infinity) - ts(b.it.endDate, Infinity); };
    else if (mode === 'newlyListed') cmp = function (a, b) { return ts(b.it.created, -Infinity) - ts(a.it.created, -Infinity); };
    else cmp = function (a, b) { return (a.it.rank - b.it.rank) || (a.it.firstSearch - b.it.firstSearch); };   // best match: interleave
    return list.sort(function (a, b) { var r = cmp(a, b); return (r === r && r) || a.i - b.i; }).map(function (x) { return x.it; });
  }

  // Run each search through fetchOne(search) -> Promise<{items,...}|{fallback}>, at most `concurrency`
  // at a time, `delayMs` between starts, and no more than `max` searches. onProgress(done, total).
  // Resolves to [{ search, ok, data|error }] in the original order.
  function runAll(searches, fetchOne, opts) {
    opts = opts || {};
    var max = Math.max(1, opts.max || 12), conc = Math.max(1, Math.min(4, opts.concurrency || 2)), delay = Math.max(0, opts.delayMs == null ? 250 : opts.delayMs);
    var wait = opts.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var list = (searches || []).slice(0, max), out = new Array(list.length), next = 0, done = 0;
    function worker(w) {
      if (next >= list.length) return Promise.resolve();
      var i = next++, s = list[i];
      return (i >= conc && delay ? wait(delay) : Promise.resolve())
        .then(function () { return fetchOne(s); })
        .then(function (d) { out[i] = d && !d.fallback ? { search: s, ok: true, data: d } : { search: s, ok: false, error: (d && d.reason) || 'unavailable' }; },
          function (e) { out[i] = { search: s, ok: false, error: String((e && e.message) || e) }; })
        .then(function () { done++; if (opts.onProgress) opts.onProgress(done, list.length); return worker(w); });
    }
    var ws = []; for (var w = 0; w < Math.min(conc, list.length); w++) ws.push(worker(w));
    return Promise.all(ws).then(function () { return { results: out, skipped: Math.max(0, (searches || []).length - list.length) }; });
  }

  var API = { lastVisit: lastVisit, sortItems: sortItems, totalCost: totalCost, KEYS: KEYS,
    mergeRuns: mergeRuns, newCounts: newCounts, sortMerged: sortMerged, runAll: runAll,
    // Sorts eBay's Browse API does itself; the rest are applied to the current page only.
    SERVER_SORTS: ['bestMatch', 'endingSoonest', 'newlyListed', 'priceLowToHigh', 'priceHighToLow'],
    PAGE_SORTS: ['mostBids', 'distance'] };
  if (typeof module === 'object' && module.exports) module.exports = API;
  else root.DustyShopper = API;
})(this);
