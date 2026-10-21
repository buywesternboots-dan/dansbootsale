/*
 * Paints the tool name from config.js onto the sign banner, the page heading and the tab title.
 * Runs right after the header markup (not deferred) so the sign never shows a stale name.
 * The sign is two lines: a small top line and a big main line. Names of 3+ words put the
 * first word on top ("DUSTY'S" / "BOOT FINDER"); shorter names go on the main line only.
 */
(function () {
  'use strict';
  var C = window.BOOTSEARCH_CONFIG || {};
  var name = String(C.toolName || 'Boot Finder'), sub = String(C.toolSubtitle || '');
  function split(n) {
    var w = n.trim().split(/\s+/);
    return w.length >= 3 ? { top: w[0], main: w.slice(1).join(' ') } : { top: '', main: w.join(' ') };
  }
  var lines = split(name);
  function set(id, txt) { var el = document.getElementById(id); if (el) el.textContent = txt; }
  set('signTop', lines.top); set('signMain', lines.main); set('toolName', name); set('toolSub', sub);
  var top = document.getElementById('signTopRow'); if (top) top.hidden = !lines.top;
  var sign = document.getElementById('sign'); if (sign) sign.setAttribute('aria-label', name + ' (sign)');
  document.title = name + ' \u2013 ' + sub + ' | ' + (C.siteName || '');

  // Shrink the big line until it fits the sign (long names, narrow phones).
  function fit() {
    var m = document.getElementById('signMain'), box = document.getElementById('sign');
    if (!m || !box) return;
    m.style.fontSize = '';
    var max = box.clientWidth - 2 * parseFloat(getComputedStyle(box).paddingLeft || 0), size = parseFloat(getComputedStyle(m).fontSize);
    while (m.scrollWidth > max && size > 14) { size -= 1; m.style.fontSize = size + 'px'; }
  }
  window.BootSearchFitSign = fit;
  fit();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  window.addEventListener('resize', fit);
})();
