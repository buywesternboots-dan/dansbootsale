import {
  PAGE_SIZE, PHONE_E164, SB_KEY, SB_URL, allowedImageUrl, bootPath, contactLinks, fitSize, fmtSize,
  idFromSlug, isNewBoot, leatherGroup, matches, materialName, money, normalizeProduct, parseNotes,
  publicPool, queryCatalog, readFilters, sizeLine, smsBody, writeFilters, LEATHER_GROUPS, PRICES
} from '/lib/catalog.js';

const ICON = {
  sms: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
  call: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>',
  wa: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.5 14.4c-.3-.1-1.8-.9-2-1-.3-.1-.5-.1-.7.1l-.9 1.2c-.2.2-.3.2-.6.1a8 8 0 0 1-2.4-1.5 9 9 0 0 1-1.6-2.1c-.2-.3 0-.4.1-.6l.4-.5.3-.5v-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6a1.1 1.1 0 0 0-.8.4 3.4 3.4 0 0 0-1 2.5 5.9 5.9 0 0 0 1.2 3.1 13.4 13.4 0 0 0 5.2 4.6c1.9.8 2.6.9 3.6.7a3 3 0 0 0 2-1.4 2.4 2.4 0 0 0 .1-1.4l-.5-.4zM12 2a10 10 0 0 0-8.6 15l-1.4 5 5.1-1.3A10 10 0 1 0 12 2z"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  fb: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 9h3V6h-3c-1.7 0-3 1.3-3 3v2H8v3h3v7h3v-7h3l1-3h-4V9c0-.6.4-1 1-1z"/></svg>',
  reddit: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14.5 16.2a7 7 0 0 1-5 0c-.2.4.4.8 1.2 1 .9.3 1.9.3 2.8 0 .7-.2 1.3-.6 1-1zM9.2 12.2a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4zm5.6 0a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4zM21 12.2a2 2 0 0 0-3.4-1.4 9.7 9.7 0 0 0-5.1-1.6l.9-4.1 2.8.6a1.5 1.5 0 1 0 1.4-1.5 1.5 1.5 0 0 0-1.3 2.2l-3.2-.7a.6.6 0 0 0-.7.4l-1 4.6a9.8 9.8 0 0 0-5.2 1.6 2 2 0 1 0-2.2 3.3 4 4 0 0 0-.1.8c0 3.1 3.6 5.6 8 5.6s8-2.5 8-5.6c0-.3 0-.5-.1-.8A2 2 0 0 0 21 12.2z"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v14"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
  back: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M15 18 9 12l6-6"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  sliders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>'
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = () => document.getElementById('app');
const $ = (s, r = document) => r.querySelector(s);

let products = [];
let loadedAt = 0;
let loadError = '';
let S = readFilters(location.search);
let shown = PAGE_SIZE;
let filtersOpen = false;
let searchTimer = 0;

function thumb(url, w) {
  if (!url) return '';
  if (!allowedImageUrl(url)) return url;
  return `/img?u=${encodeURIComponent(url)}&w=${w}`;
}
function generalSms() {
  return `sms:${PHONE_E164}?&body=${encodeURIComponent('Hi Dan, I found you on dansbootsale.com and have a question about boots.')}`;
}
function toast(t) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = t;
  el.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('on'), 1800);
}
function copy(text) {
  const done = () => toast('Link copied');
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done).catch(() => toast(text));
  else toast(text);
}
async function shareBoot(p) {
  const url = location.origin + bootPath(p);
  const text = `${p.brand} ${materialName(p)}, ${sizeLine(p)}, ${money(p.price)}`;
  if (navigator.share) {
    try { await navigator.share({ title: document.title, text, url }); return; } catch { /* cancelled */ }
  }
  copy(url);
}

async function ensureProducts(force) {
  const demo = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') && Array.isArray(window.__DBS_DEMO__)
    ? window.__DBS_DEMO__ : null;
  if (demo) {
    products = demo.map(normalizeProduct);
    loadedAt = Date.now();
    loadError = '';
    return;
  }
  if (!force && products.length && Date.now() - loadedAt < 15000) return;
  const headers = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Accept: 'application/json', 'Content-Type': 'application/json' };
  try {
    const rpc = await fetch(`${SB_URL}/rest/v1/rpc/public_catalog`, { method: 'POST', headers, body: '{}' });
    if (rpc.ok) {
      const data = await rpc.json();
      if (Array.isArray(data)) {
        products = data.map(normalizeProduct);
        loadedAt = Date.now();
        loadError = '';
        return;
      }
    }
    const res = await fetch(`${SB_URL}/rest/v1/products?select=id,gender,brand,title,size,width,no_width,material,price,photos,women_size,women_width,status,updated_at,created_at,sold_at&status=in.(published,sold)&price=gt.0&limit=1000`, { headers });
    if (!res.ok) throw new Error('Catalog request failed');
    const data = await res.json();
    products = (Array.isArray(data) ? data : []).map(normalizeProduct);
    loadedAt = Date.now();
    loadError = '';
  } catch (err) {
    loadError = err.message || 'offline';
    if (!products.length) products = [];
  }
}

function card(p) {
  const sold = p.status === 'sold';
  const altFit = p.gender === 'M' && p.women_size != null && S.g !== 'M'
    ? `Fits women's ${fmtSize(p.women_size)}` : '';
  const photo = p.photos[0] || '';
  return `<a class="card${sold ? ' sold' : ''}" href="${bootPath(p)}">
    <div class="ph">${photo ? `<img src="${thumb(photo, 440)}" data-full="${esc(photo)}" alt="${esc(p.brand)} ${esc(materialName(p))} boots, ${esc(sizeLine(p))}" width="440" height="440" loading="lazy" decoding="async">` : ''}
      <div class="tag">${isNewBoot(p) && !sold ? '<span class="new">New</span>' : ''}${p.exotic && !sold ? '<span class="exo">Exotic</span>' : ''}</div>
      ${sold ? '<div class="stamp">Sold</div>' : ''}
    </div>
    <div class="cb"><div class="brand">${esc(p.brand)}</div><div class="name">${esc(materialName(p))}</div>
      <div class="size"><span class="sz">${esc(sizeLine(p))}</span></div>
      ${altFit ? `<div class="alt">${altFit}</div>` : ''}
      <div class="price">${money(p.price)}</div></div></a>`;
}

function pillGroup(key, opts, label) {
  return `<div class="pills" role="group" aria-label="${label}">${opts.map(([v, txt, n]) => {
    const on = Array.isArray(S[key]) ? S[key].includes(v) : S[key] === v;
    const disabled = n === 0 && !on;
    return `<button type="button" class="pill" data-k="${esc(key)}" data-v="${esc(v)}" aria-pressed="${on}" ${disabled ? 'disabled' : ''}>${esc(txt)}${n != null ? `<small>${n}</small>` : ''}</button>`;
  }).join('')}</div>`;
}

function filtersHtml(availCount) {
  const base = publicPool(products).filter(p => p.status !== 'sold');
  const facet = skip => base.filter(p => matches(p, S, skip));
  const sized = base.filter(p => (S.g === 'M' ? p.gender === 'M' : S.g === 'W' ? (p.gender === 'W' || p.women_size != null) : true));
  const sizesAll = [...new Set(sized.map(p => fmtSize(fitSize(p, S.g))).filter(x => x !== '?'))].sort((a, b) => Number(a) - Number(b));
  const sp = facet('sizes');
  const wp = facet('widths');
  const lp = facet('leather');
  const brands = [...new Set(base.map(p => p.brand))].filter(Boolean).sort((a, b) => a.localeCompare(b));
  return `<div class="sheet-head"><strong>Filters</strong><button type="button" class="btn btn-sm btn-ghost" data-close>Done</button></div>
    <div class="fgroup"><h2>Size type</h2><div class="seg" role="group" aria-label="Size type">${[['all', 'All'], ['M', "Men's"], ['W', "Women's"]].map(([v, t]) => `<button type="button" data-g="${v}" aria-pressed="${S.g === v}">${t}</button>`).join('')}</div>
      ${S.g === 'W' ? '<p class="fhint">Includes men\'s pairs that fit, converted to women\'s size.</p>' : ''}</div>
    <div class="fgroup"><h2>Size${S.g === 'W' ? " (women's)" : S.g === 'M' ? " (men's)" : ''}</h2>${pillGroup('sizes', sizesAll.map(s => [s, s, sp.filter(p => fmtSize(fitSize(p, S.g)) === s).length]), 'Size')}</div>
    <div class="fgroup"><h2>Width</h2>${pillGroup('widths', ['Narrow', 'Regular', 'Wide'].map(w => [w, w, wp.filter(p => p.wgroup === w).length]), 'Width')}<p class="fhint">Regular is a D for men and a B for women.</p></div>
    <div class="fgroup"><h2>Leather</h2>${pillGroup('leather', LEATHER_GROUPS.map(([n]) => [n, n, lp.filter(p => p.lgroup === n || leatherGroup(p.material) === n).length]).filter(x => x[2] > 0 || S.leather.includes(x[0])), 'Leather')}</div>
    <div class="fgroup"><h2>Price</h2>${pillGroup('price', PRICES.map(([v, t]) => [v, t, null]), 'Price')}</div>
    <div class="fgroup"><h2>Brand</h2><select data-brand aria-label="Brand"><option value="">All brands</option>${brands.map(b => `<option value="${esc(b)}" ${S.brand === b ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select></div>
    <div class="sheet-foot"><button type="button" class="btn btn-ghost" data-reset>Clear all</button><button type="button" class="btn btn-dark" data-close>Show ${availCount} pairs</button></div>`;
}

function chips() {
  const c = [];
  if (S.g !== 'all') c.push(['g', S.g === 'M' ? "Men's" : "Women's"]);
  S.sizes.forEach(v => c.push(['sizes:' + v, 'Size ' + v]));
  S.widths.forEach(v => c.push(['widths:' + v, v]));
  S.leather.forEach(v => c.push(['leather:' + v, v]));
  if (S.exotic) c.push(['exotic', 'Exotic only']);
  if (S.brand) c.push(['brand', S.brand]);
  if (S.price) c.push(['price', (PRICES.find(x => x[0] === S.price) || [, S.price])[1]]);
  if (S.q) c.push(['q', '“' + S.q + '”']);
  if (!c.length) return '';
  return `<div class="chips">${c.map(([k, t]) => `<button type="button" class="chip" data-rm="${esc(k)}">${esc(t)} <span aria-hidden="true">✕</span></button>`).join('')}<button type="button" class="chip clear" data-reset>Clear all</button></div>`;
}

function home() {
  document.title = "Dan's Boot Sale · Vintage & exotic western boots";
  document.body.classList.remove('has-sticky');
  document.body.dataset.route = 'home';
  const { available, sold } = queryCatalog(products, S);
  const slice = available.slice(0, shown);
  const listUrl = writeFilters(S);
  try { sessionStorage.setItem('dbs-list', listUrl); } catch { /* private mode */ }
  app().innerHTML = loadError && !products.length
    ? `<div class="wrap"><div class="empty"><strong>The catalog didn't load.</strong><p>Check the connection, or text Dan and he'll find a pair with you.</p><p><a class="btn btn-primary" href="${generalSms()}">${ICON.sms}Text Dan</a> <button type="button" class="btn btn-ghost" data-retry>Try again</button></p></div></div>`
    : `<div class="wrap shop">
      <aside class="filters${filtersOpen ? ' open' : ''}" id="filters" aria-label="Filters">${filtersHtml(available.length)}</aside>
      <section aria-label="Boots">
        <div class="toolbar" id="toolbar">
          <div class="searchrow"><label class="search">${ICON.search}<input type="search" id="q" placeholder="Search boots…" value="${esc(S.q)}" aria-label="Search boots" enterkeyhint="search"></label>
            <button type="button" class="btn btn-ghost filterbtn" data-open>${ICON.sliders}Filters</button></div>
          <div class="metarow"><div class="count">${available.length} pair${available.length === 1 ? '' : 's'} <span>available</span></div>
            <label class="sort">Sort <select id="sort" aria-label="Sort boots"><option value="new">Newest</option><option value="low">Price: low to high</option><option value="high">Price: high to low</option><option value="size">Size</option></select></label></div>
          ${chips()}
        </div>
        <div class="grid">
          ${slice.length ? slice.map(card).join('') : `<div class="empty"><strong>No pairs match those filters.</strong><p>Try another size or leather, or let Dusty search eBay.</p><a class="btn btn-dark" href="/boot-search">Open Dusty's Boot Finder</a></div>`}
          ${available.length > shown ? `<div class="more-wrap"><button type="button" class="btn btn-dark" data-more>Show more pairs</button></div>` : ''}
          <div class="finder-cta"><div><strong>Not seeing your size?</strong><p>Dusty's Boot Finder searches eBay by size, width and maker. Affiliate links are off.</p></div><a class="btn btn-primary" href="/boot-search">Open Boot Finder</a></div>
          ${sold.length ? `<div class="section-label">Recently sold</div>${sold.map(card).join('')}` : ''}
        </div>
      </section>
    </div><div class="scrim${filtersOpen ? ' on' : ''}" id="scrim"></div>`;
  const sort = $('#sort');
  if (sort) sort.value = S.sort;
  if (filtersOpen) document.body.classList.add('sheet-open');
}

function rerender(opts = {}) {
  const y = window.scrollY;
  history.replaceState(null, '', writeFilters(S));
  home();
  if (opts.keepScroll) window.scrollTo(0, y);
  if (opts.focusSearch) {
    const i = $('#q');
    if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  }
}

function detail(slug) {
  const id = idFromSlug(slug);
  const p = products.find(x => x.id === id && (x.status === 'published' || x.status === 'sold'));
  document.body.dataset.route = 'boot';
  document.body.classList.remove('sheet-open');
  filtersOpen = false;
  if (!p) {
    document.title = "That pair isn't listed | Dan's Boot Sale";
    app().innerHTML = `<div class="wrap page"><h1>That pair isn't listed</h1><p class="desc">It may have been archived. Text Dan if someone sent you this link.</p><p><a class="btn btn-primary" href="${generalSms()}">${ICON.sms}Text Dan</a> <a class="btn btn-ghost" href="/">All boots</a></p></div>`;
    document.body.classList.remove('has-sticky');
    window.scrollTo(0, 0);
    return;
  }
  const path = bootPath(p);
  if (location.pathname !== path) history.replaceState(null, '', path);
  const sold = p.status === 'sold';
  const n = parseNotes(p.description);
  const L = contactLinks(p);
  const photos = p.photos.slice(0, 16);
  const more = products.filter(x => x.id !== p.id && x.status === 'published' && x.gender === p.gender && x.size != null && p.size != null && Math.abs(x.size - p.size) <= 0.5).slice(0, 4);
  const back = (() => { try { return sessionStorage.getItem('dbs-list') || '/'; } catch { return '/'; } })();
  document.title = `${p.brand} ${materialName(p)} · ${sizeLine(p)} · ${money(p.price)} | Dan's Boot Sale`;
  const wSmall = p.width ? p.wgroup : 'Not listed';
  app().innerHTML = `<div class="wrap detail-wrap">
    <div class="crumbs"><a href="${esc(back)}">${ICON.back}All boots</a><span class="fine">Lot ${String(p.id).padStart(3, '0')}</span></div>
    <article class="detail">
      <div class="gallery">
        <div class="gmain" id="gmain">${photos.map((u, i) => `<img src="${thumb(u, 900)}" data-full="${esc(u)}" alt="${esc(p.brand)} ${esc(materialName(p))} boots, photo ${i + 1} of ${photos.length}" width="900" height="900" ${i ? 'loading="lazy"' : 'fetchpriority="high"'}>`).join('') || '<img alt="" src="/assets/horseshoe.png">'} </div>
        <span class="gcount" id="gcount">1 / ${Math.max(photos.length, 1)}</span>
        <div class="dots" id="dots">${photos.slice(0, 12).map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>
        <div class="gthumbs">${photos.slice(0, 8).map((u, i) => `<button type="button" data-i="${i}" aria-label="Photo ${i + 1}" aria-current="${i ? 'false' : 'true'}"><img src="${thumb(u, 160)}" data-full="${esc(u)}" alt="" width="160" height="160" loading="lazy"></button>`).join('')}</div>
      </div>
      <div class="info">
        <div class="brand">${esc(p.brand)}${p.exotic ? ' · Exotic' : ''}</div>
        <h1 tabindex="-1">${esc(materialName(p))} ${p.gender === 'W' ? 'cowgirl' : 'cowboy'} boots</h1>
        <p class="sub">${esc(p.title || '')}</p>
        ${sold ? '<div class="sold-banner">This pair has sold. Text Dan if you want something similar.</div>' : ''}
        <div class="pricebox"><span class="p">${money(p.price)}</span>${sold ? '' : '<span class="note">Free US shipping &amp; returns</span>'}</div>
        <dl class="facts">
          <div class="fact"><dt>Size</dt><dd>${esc(sizeLine(p))}${p.gender === 'M' && p.women_size ? `<small>Fits women's ${fmtSize(p.women_size)}</small>` : ''}</dd></div>
          <div class="fact"><dt>Width</dt><dd>${esc(p.width || '—')}<small>${esc(wSmall)}</small>${n.sole ? `<small>Sole widest part ${esc(n.sole)}</small>` : ''}</dd></div>
          <div class="fact"><dt>Leather</dt><dd>${esc(materialName(p))}${n.color ? `<small>${esc(n.color)}</small>` : ''}</dd></div>
        </dl>
        ${sold ? `<p><a class="btn btn-primary" href="${L.sms}">${ICON.sms}Text Dan about something similar</a></p>` : `<div class="contact-box"><h2>Want this pair?</h2><p>Text Dan to claim it. He'll confirm it's still here and send payment options: Zelle, PayPal, Venmo or Cash App.</p>
          <div class="cgrid">
            <a class="btn btn-primary wide" href="${L.sms}">${ICON.sms}Text Dan about this pair</a>
            <a class="btn btn-ghost" href="${L.call}">${ICON.call}Call</a>
            <a class="btn btn-ghost" href="${L.wa}" target="_blank" rel="noopener">${ICON.wa}WhatsApp</a>
            <a class="btn btn-ghost" href="${L.fb}" target="_blank" rel="noopener">${ICON.fb}Messenger</a>
            <a class="btn btn-ghost" href="${L.mail}">${ICON.mail}Email</a>
            <a class="btn btn-ghost" href="${L.reddit}" target="_blank" rel="noopener">${ICON.reddit}Reddit</a>
          </div>
          <div class="sharerow"><button type="button" class="btn btn-ghost" data-share>${ICON.share}Share</button><button type="button" class="btn btn-ghost" data-copy>${ICON.link}Copy link</button></div>
        </div>`}
        ${n.cond.length ? `<section class="block"><h2>Honest condition report</h2><div class="cond">${n.cond.map(c => `<div class="cond-row"><b>${esc(c.part)}</b><div class="bar" role="img" aria-label="${c.score} out of 10"><i class="s${Math.max(0, Math.min(10, Math.round(c.score)))}"></i></div><span></span><span class="why"><b>${c.score}/10</b> · ${esc(c.why)}</span></div>`).join('')}</div></section>` : ''}
        ${n.meas.length || n.sole ? `<section class="block"><h2>Measurements</h2><div class="meas">${(n.sole ? [['Sole widest part', n.sole]] : []).concat(n.meas).map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div><p class="fine">Compare these with a pair that fits. Text Dan if you need one that isn't listed.</p></section>` : ''}
        ${n.desc ? `<section class="block"><h2>About this pair</h2><p class="desc">${esc(n.desc)}</p>${n.made ? `<p class="fine">Made in ${esc(n.made)}</p>` : ''}</section>` : ''}
        <section class="block"><h2>How buying works</h2><ol class="steps"><li><span><b>Text Dan</b>The message already names this pair, the size and the price.</span></li><li><span><b>Pay how you like</b>Zelle, PayPal, Venmo or Cash App. Dan holds the pair once you've paid.</span></li><li><span><b>Free shipping, free returns</b>Ships free in the US. Unworn returns are free if you ask within 3 days of delivery.</span></li></ol></section>
        ${n.fine ? `<p class="fine">${esc(n.fine)}</p>` : ''}
      </div>
    </article>
    ${more.length ? `<section class="more"><div class="section-label">More in your size</div><div class="grid">${more.map(card).join('')}</div></section>` : ''}
  </div>
  ${sold ? '' : `<div class="stickybar"><div class="sp">${money(p.price)}<small>${esc(sizeLine(p))}</small></div><button type="button" class="btn btn-ghost" data-share aria-label="Share">${ICON.share}</button><a class="btn btn-primary" href="${L.sms}">${ICON.sms}Text Dan</a></div>`}`;
  document.body.classList.toggle('has-sticky', !sold);
  const g = $('#gmain');
  const cnt = $('#gcount');
  const dots = [...document.querySelectorAll('#dots i')];
  const thumbs = [...document.querySelectorAll('.gthumbs button')];
  if (g) g.addEventListener('scroll', () => {
    const i = Math.round(g.scrollLeft / Math.max(g.clientWidth, 1));
    if (cnt) cnt.textContent = `${i + 1} / ${Math.max(photos.length, 1)}`;
    dots.forEach((d, j) => d.classList.toggle('on', j === Math.min(i, dots.length - 1)));
    thumbs.forEach((b, j) => b.setAttribute('aria-current', j === i ? 'true' : 'false'));
  }, { passive: true });
  app().onclick = e => {
    const t = e.target.closest('[data-i],[data-share],[data-copy]');
    if (!t) return;
    if (t.dataset.i != null && g) g.scrollTo({ left: g.clientWidth * Number(t.dataset.i), behavior: 'smooth' });
    if ('share' in t.dataset) shareBoot(p);
    if ('copy' in t.dataset) copy(location.origin + bootPath(p));
  };
  window.scrollTo(0, 0);
  $('#app h1')?.focus();
}

function how() {
  document.body.dataset.route = 'page';
  document.body.classList.remove('has-sticky', 'sheet-open');
  document.title = "How buying works | Dan's Boot Sale";
  app().innerHTML = `<div class="wrap page"><h1>How buying works</h1><p class="desc">No cart and no account. Dan's Boot Sale works like a classified ad: you talk to Dan, then he ships the pair.</p>
    <section class="block"><ol class="steps">
      <li><span><b>Find a pair</b>Filter by size, width and leather. Listings include measurements and a condition report.</span></li>
      <li><span><b>Text Dan</b>The message names the pair, size and price, plus a link back to it.</span></li>
      <li><span><b>Pay how you like</b>Zelle, PayPal, Venmo or Cash App. Dan holds the pair once payment lands.</span></li>
      <li><span><b>Free shipping and returns</b>Free shipping in the US. Unworn pairs can come back free if you ask within 3 days of delivery. Outside the US, text for a quote.</span></li>
    </ol></section>
    <p><a class="btn btn-primary" href="${generalSms()}">${ICON.sms}Text Dan</a> <a class="btn btn-ghost" href="tel:+14044880174">${ICON.call}Call</a></p>
    <p class="fine">404-488-0174 · dansbootsale@gmail.com · <a href="https://www.facebook.com/HOFFYWOOD/">Facebook</a> · <a href="https://www.reddit.com/user/SpadesQuiz/">Reddit</a></p>
  </div>`;
  window.scrollTo(0, 0);
}

function privacy() {
  document.body.dataset.route = 'page';
  document.body.classList.remove('has-sticky', 'sheet-open');
  document.title = "Privacy | Dan's Boot Sale";
  app().innerHTML = `<div class="wrap page"><h1>Privacy</h1>
    <p class="desc">Dan's Boot Sale is run by ATS20, LLC. Questions: <a href="mailto:dansbootsale@gmail.com">dansbootsale@gmail.com</a> or 404-488-0174.</p>
    <section class="block"><h2>What this site stores</h2><p class="desc">The public site has no accounts and no checkout. Text, call, WhatsApp, email and social buttons open your own apps. They don't send a form to this website.</p>
    <p class="desc">The shop loads the public boot list from our database: photos, sizes, prices and the description written for the listing. Private fields such as SKU, cost and wholesale price are not part of that public list.</p>
    <p class="desc">Staff and admin sign-in uses a private session so inventory can be updated. Those pages are not for shoppers.</p></section>
    <section class="block"><h2>Boot Finder</h2><p class="desc">Dusty's Boot Finder builds an eBay search and opens it on eBay. Affiliate links are off, so those searches are ordinary eBay links.</p></section>
  </div>`;
  window.scrollTo(0, 0);
}

function pathOf() {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  return path;
}

async function route() {
  const path = pathOf();
  if (path === '/how') return how();
  if (path === '/privacy') return privacy();
  if (['/corral', '/admin', '/wholesale', '/staff'].includes(path)) {
    document.body.dataset.route = 'page';
    document.body.classList.remove('has-sticky', 'sheet-open');
    const mod = await import('/admin.js');
    return mod.open(path);
  }
  await ensureProducts(false);
  const bootQuery = new URLSearchParams(location.search).get('boot');
  if ((path === '/') && bootQuery) return detail(bootQuery);
  const boot = path.match(/^\/boot\/([^/]+)/);
  if (boot) return detail(decodeURIComponent(boot[1]));
  S = readFilters(location.search);
  shown = PAGE_SIZE;
  filtersOpen = false;
  document.body.classList.remove('sheet-open');
  home();
}

function onAppClick(e) {
  const t = e.target.closest('button');
  if (!t || !app().contains(t)) return;
  if (t.dataset.g) { S.g = t.dataset.g; S.sizes = []; shown = PAGE_SIZE; rerender({ keepScroll: true }); return; }
  if (t.dataset.k) {
    const k = t.dataset.k, v = t.dataset.v;
    if (Array.isArray(S[k])) S[k] = S[k].includes(v) ? S[k].filter(x => x !== v) : [...S[k], v];
    else S[k] = S[k] === v ? '' : v;
    shown = PAGE_SIZE;
    rerender({ keepScroll: true });
    return;
  }
  if (t.dataset.rm) {
    const [k, v] = t.dataset.rm.split(':');
    if (v != null && Array.isArray(S[k])) S[k] = S[k].filter(x => x !== v);
    else S[k] = Array.isArray(S[k]) ? [] : (k === 'sort' ? 'new' : k === 'g' ? 'all' : '');
    shown = PAGE_SIZE;
    rerender({ keepScroll: true });
    return;
  }
  if ('reset' in t.dataset) {
    S = readFilters('');
    shown = PAGE_SIZE;
    rerender();
    return;
  }
  if ('open' in t.dataset) { filtersOpen = true; document.body.classList.add('sheet-open'); $('#filters')?.classList.add('open'); $('#scrim')?.classList.add('on'); return; }
  if ('close' in t.dataset) { filtersOpen = false; document.body.classList.remove('sheet-open'); $('#filters')?.classList.remove('open'); $('#scrim')?.classList.remove('on'); return; }
  if ('more' in t.dataset) { shown += PAGE_SIZE; rerender({ keepScroll: true }); return; }
  if ('retry' in t.dataset) { ensureProducts(true).then(home); }
}

document.addEventListener('click', e => {
  if (e.target.id === 'scrim') {
    filtersOpen = false;
    document.body.classList.remove('sheet-open');
    $('#filters')?.classList.remove('open');
    $('#scrim')?.classList.remove('on');
    return;
  }
  const a = e.target.closest('a');
  if (!a || a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  let url;
  try { url = new URL(a.href); } catch { return; }
  if (url.origin !== location.origin) return;
  if (/^\/(boot-search|eBayBootSearch|api|img|assets|fonts|eBayBootSearch)\b/.test(url.pathname)) return;
  if (!/^\/($|boot\/|how|privacy|corral|admin|wholesale|staff)/.test(url.pathname)) return;
  e.preventDefault();
  const next = url.pathname + url.search;
  if (next === location.pathname + location.search) { route(); return; }
  history.pushState(null, '', next);
  route();
});
document.addEventListener('change', e => {
  if (e.target.id === 'sort') { S.sort = e.target.value; shown = PAGE_SIZE; rerender({ keepScroll: true }); }
  if (e.target.matches('[data-brand]')) { S.brand = e.target.value; shown = PAGE_SIZE; rerender({ keepScroll: true }); }
});
document.addEventListener('input', e => {
  if (e.target.id !== 'q') return;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { S.q = e.target.value.trim(); shown = PAGE_SIZE; rerender({ keepScroll: true, focusSearch: true }); }, 250);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && filtersOpen) {
    filtersOpen = false;
    document.body.classList.remove('sheet-open');
    $('#filters')?.classList.remove('open');
    $('#scrim')?.classList.remove('on');
  }
});
document.addEventListener('error', e => {
  const img = e.target;
  if (img?.dataset?.full && img.src !== img.dataset.full) img.src = img.dataset.full;
}, true);
app().addEventListener('click', onAppClick);
window.addEventListener('popstate', () => route());
const year = document.getElementById('year');
if (year) year.textContent = String(new Date().getFullYear());
document.querySelectorAll('a[href^="sms:"]').forEach(a => { if (a.classList.contains('head-cta') || a.textContent.includes('404')) a.href = generalSms(); });
route();
