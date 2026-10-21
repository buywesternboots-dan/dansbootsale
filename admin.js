import { SB_KEY, SB_URL, money } from '/lib/catalog.js';
import { buildUndoOps, parseListPerfectly, planImport, planSummary, safeRecord } from '/lib/csv-import.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = () => document.getElementById('app');
const SIZES = [];
for (let n = 4; n <= 15; n += 0.5) SIZES.push(n);

let sb = null;
let rows = [];
let orders = [];
let tab = 'drafts';
let q = '';
let editId = null;
let csvPlan = null;
let receipt = null;
let adminEmail = '';
let staffItems = [];
let staffEdit = null;
let wired = false;

function css() {
  if (document.querySelector('link[data-admin]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/admin.css';
  link.dataset.admin = '1';
  document.head.appendChild(link);
}
function shell(title, body) {
  document.title = `${title} | Dan's Boot Sale`;
  app().innerHTML = `<div class="wrap portal"><p><a href="/">← Back to the shop</a></p>${body}</div>`;
}
async function db() {
  if (sb) return sb;
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm');
  sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  return sb;
}
async function gate() {
  const res = await fetch('/api/gate');
  if (!res.ok) return { corral: false, staff: false, configured: false };
  return res.json();
}
async function postGate(body) {
  const res = await fetch('/api/gate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Sign-in failed');
  return data;
}
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function photo(p) { return (Array.isArray(p.photos) ? p.photos[0] : '') || ''; }

function corralForm(message) {
  shell('The Corral', `<h1>The Corral</h1><p>Wholesale partners and staff sign in here. This isn't the shop.</p>
    ${message ? `<p class="warn">${esc(message)}</p>` : ''}
    <form class="form" data-form="corral">
      <label>Password <input type="password" name="password" autocomplete="current-password" required></label>
      <button class="btn btn-dark" type="submit">Enter</button>
    </form>`);
}
async function corral() {
  const flags = await gate();
  if (flags.corral) {
    shell('The Corral', `<h1>The Corral</h1><div class="choice">
      <a class="btn btn-dark" href="/wholesale">Wholesale catalog</a>
      <a class="btn btn-ghost" href="/admin">Admin</a>
      <a class="btn btn-ghost" href="/staff">Staff intake</a>
      <button class="btn btn-ghost" type="button" data-act="logout">Sign out</button>
    </div>`);
    return;
  }
  corralForm('');
}
async function wholesale() {
  const flags = await gate();
  if (!flags.corral) return corralForm('Enter the Corral password to see wholesale prices.');
  shell('Wholesale', `<h1>Wholesale</h1><p class="meta">Loading prices…</p>`);
  const res = await fetch('/api/wholesale');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    shell('Wholesale', `<h1>Wholesale</h1><p class="warn">${esc(data.error || 'Could not load wholesale prices.')}</p>`);
    return;
  }
  const items = data.products || [];
  shell('Wholesale', `<h1>Wholesale catalog</h1><p class="meta">${items.length} published wholesale pairs. Retail price is crossed out. These prices never appear on the public shop.</p>
    <label>Search <input id="ws-q" type="search" placeholder="Brand or size"></label>
    <div class="ws-grid" id="ws-grid">${wsCards(items, '')}</div>`);
  document.getElementById('ws-q')?.addEventListener('input', e => {
    const box = document.getElementById('ws-grid');
    if (box) box.innerHTML = wsCards(items, e.target.value);
  });
}
function wsCards(items, query) {
  const needle = query.trim().toLowerCase();
  const list = items.filter(p => !needle || `${p.brand} ${p.title} ${p.size} ${p.width} ${p.material}`.toLowerCase().includes(needle));
  if (!list.length) return '<p>No pairs match.</p>';
  return list.map(p => `<article class="ws-card">${photo(p) ? `<img src="${esc(photo(p))}" alt="">` : '<img alt="">'}
    <div><strong>${esc(p.brand || '')}</strong><div>${esc(p.title || p.material || '')}</div>
    <div class="meta">${esc(p.gender === 'W' ? "Women's" : "Men's")} ${esc(p.size ?? '—')} ${esc(p.width || '')}</div>
    <div class="ws-price">${money(p.wholesale_price)}</div>
    <div class="ws-retail">Retail ${money(p.price)}</div></div></article>`).join('');
}

function staffForm(item) {
  const p = item || {};
  return `<form class="form" data-form="staff">
    <input type="hidden" name="id" value="${esc(p.id || '')}">
    <label>Title <input name="title" required value="${esc(p.title || '')}"></label>
    <div class="row2"><label>Brand <input name="brand" value="${esc(p.brand || '')}"></label>
      <label>Leather <input name="material" value="${esc(p.material || '')}"></label></div>
    <div class="row2"><label>Gender <select name="gender"><option value="M" ${p.gender === 'W' ? '' : 'selected'}>Men's</option><option value="W" ${p.gender === 'W' ? 'selected' : ''}>Women's</option><option value="">Unknown</option></select></label>
      <label>Size <select name="size"><option value="">—</option>${SIZES.map(s => `<option ${Number(p.size) === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label></div>
    <div class="row2"><label>Width <input name="width" value="${esc(p.width || '')}" placeholder="D, EE, 2E"></label>
      <label>Wholesale price <input name="wholesale_price" inputmode="decimal" value="${esc(p.wholesale_price ?? '')}"></label></div>
    <label><input type="checkbox" name="no_width" ${p.no_width ? 'checked' : ''}> No letter width on this pair</label>
    <label>Condition (1 rough – 5 excellent) <input name="condition" inputmode="numeric" value="${esc(p.condition ?? '')}"></label>
    <label>Notes for Dan <textarea name="notes">${esc(p.notes || '')}</textarea></label>
    <p class="meta">These notes stay off the public shop while the pair is a draft. Don't put a group price in the public description later.</p>
    <div class="photos" id="staff-photos">${(p.photos || []).map(u => `<img src="${esc(u)}" alt="">`).join('')}</div>
    <label>Photos <input type="file" id="staff-file" accept="image/*" multiple></label>
    <button class="btn btn-dark" type="submit">${p.id ? 'Update draft' : 'Save draft'}</button>
  </form>`;
}
async function staff() {
  const flags = await gate();
  if (!flags.staff) {
    shell('Staff', `<h1>Staff intake</h1><p>Wholesale drafts only. This page doesn't publish anything.</p>
      ${''}<form class="form" data-form="staff-login"><label>Staff password <input type="password" name="password" autocomplete="current-password" required></label><button class="btn btn-dark" type="submit">Sign in</button></form>`);
    return;
  }
  const res = await fetch('/api/staff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list' }) });
  const data = await res.json().catch(() => ({}));
  staffItems = res.ok ? (data.products || []) : [];
  const editing = staffItems.find(p => p.id === staffEdit) || null;
  shell('Staff', `<h1>Staff intake</h1>
    ${res.ok ? '' : `<p class="warn">${esc(data.error || 'Could not load drafts.')}</p>`}
    ${staffForm(editing)}
    <h2>Drafts waiting on Dan</h2>
    ${staffItems.map(p => `<div class="row">${photo(p) ? `<img src="${esc(photo(p))}" alt="">` : '<img alt="">'}<div><h3>${esc(p.brand || 'Untitled')} ${esc(p.title || '')}</h3><div class="meta">${esc(p.size ?? '—')} ${esc(p.width || '')} · wholesale ${money(p.wholesale_price)}</div>
      <div class="actions"><button class="btn btn-sm btn-ghost" type="button" data-act="staff-edit" data-id="${p.id}">Edit</button></div></div></div>`).join('') || '<p>No drafts yet.</p>'}
    <p><button class="btn btn-ghost" type="button" data-act="logout">Sign out</button></p>`);
  const box = document.getElementById('staff-photos');
  const files = [];
  document.getElementById('staff-file')?.addEventListener('change', async e => {
    for (const file of e.target.files || []) {
      const signRes = await fetch('/api/staff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'signUpload', filename: file.name }) });
      const signed = await signRes.json().catch(() => ({}));
      if (!signRes.ok) { alert(signed.error || 'Upload failed'); continue; }
      const fd = new FormData();
      fd.append('cacheControl', '3600');
      fd.append('', file);
      const put = await fetch(signed.signedUrl, { method: 'PUT', body: fd, headers: { 'x-upsert': 'false' } });
      if (!put.ok) { alert('The photo did not upload.'); continue; }
      files.push(signed.publicUrl);
      if (box) box.insertAdjacentHTML('beforeend', `<img src="${esc(signed.publicUrl)}" alt="">`);
    }
    e.target.dataset.urls = JSON.stringify([...(editing?.photos || []), ...files]);
  });
  if (editing) document.getElementById('staff-file').dataset.urls = JSON.stringify(editing.photos || []);
}

async function admin() {
  const client = await db();
  const { data } = await client.auth.getSession();
  if (!data?.session) {
    shell('Admin', `<h1>Admin</h1><p>Sign in with the Supabase account that owns this shop. The password is not stored on this website.</p>
      <form class="form" data-form="admin">
        <label>Email <input name="email" type="email" autocomplete="username" required></label>
        <label>Password <input name="password" type="password" autocomplete="current-password" required></label>
        <button class="btn btn-dark" type="submit">Sign in</button>
      </form>`);
    return;
  }
  const { data: prod, error } = await client.from('products').select('*').order('id');
  if (error) {
    shell('Admin', `<h1>Admin</h1><p class="warn">${esc(error.message)}</p><button class="btn btn-ghost" type="button" data-act="admin-out">Sign out</button>`);
    return;
  }
  rows = prod || [];
  if (tab === 'orders' || tab === 'wsorders') {
    const ord = await client.from('orders').select('*').order('created_at', { ascending: false }).limit(200);
    orders = ord.data || [];
  }
  adminEmail = data.session.user?.email || '';
  renderAdmin(adminEmail);
}
function filtered(list) {
  const needle = q.trim().toLowerCase();
  if (!needle) return list;
  return list.filter(p => `${p.brand} ${p.title} ${p.size} ${p.width} ${p.material} ${p.id}`.toLowerCase().includes(needle));
}
function productRow(p, kind) {
  const missing = Array.isArray(p.missing) ? p.missing : [];
  return `<div class="row">${photo(p) ? `<img src="${esc(photo(p))}" alt="">` : '<img alt="">'}<div>
    <h3>${esc(p.brand || 'Unknown')} · ${esc(p.title || p.material || 'Untitled')}</h3>
    <div class="meta">${esc(p.gender || '?')} ${esc(p.size ?? '—')} ${esc(p.width || 'width?')} · retail ${money(p.price)} · wholesale ${p.wholesale_price ? money(p.wholesale_price) : '—'}${missing.length ? ` · missing ${esc(missing.join(', '))}` : ''}</div>
    <div class="actions">
      ${kind === 'draft' ? `<button class="btn btn-sm btn-dark" type="button" data-act="publish" data-id="${p.id}">Publish</button>` : ''}
      ${kind !== 'sold' ? `<button class="btn btn-sm btn-ghost" type="button" data-act="sold" data-id="${p.id}">Mark sold</button>` : `<button class="btn btn-sm btn-ghost" type="button" data-act="relist" data-id="${p.id}">Relist</button>`}
      <button class="btn btn-sm btn-ghost" type="button" data-act="edit" data-id="${p.id}">Edit</button>
      <button class="btn btn-sm btn-ghost" type="button" data-act="archive" data-id="${p.id}">Archive</button>
      <button class="btn btn-sm btn-danger" type="button" data-act="delete" data-id="${p.id}">Delete</button>
    </div>
    ${kind === 'draft' ? `<div class="form row2" style="margin-top:8px">
      <label>Brand <input id="f_${p.id}_brand" value="${esc(p.brand || '')}"></label>
      <label>Size <input id="f_${p.id}_size" value="${esc(p.size ?? '')}"></label>
      <label>Width <input id="f_${p.id}_width" value="${esc(p.width || '')}"></label>
      <label>Retail price <input id="f_${p.id}_price" value="${esc(p.price ?? '')}"></label>
      <label><input type="checkbox" id="f_${p.id}_nowidth" ${p.no_width ? 'checked' : ''}> No width</label>
    </div>` : ''}
  </div></div>`;
}
function editForm(p) {
  const item = p || {};
  return `<form class="form" data-form="edit">
    <input type="hidden" name="id" value="${esc(item.id || '')}">
    <label>Title <input name="title" value="${esc(item.title || '')}" required></label>
    <div class="row2"><label>Brand <input name="brand" value="${esc(item.brand || '')}"></label><label>Leather <input name="material" value="${esc(item.material || '')}"></label></div>
    <div class="row2"><label>Gender <select name="gender"><option value="M" ${item.gender !== 'W' ? 'selected' : ''}>Men's</option><option value="W" ${item.gender === 'W' ? 'selected' : ''}>Women's</option></select></label>
      <label>Size <input name="size" value="${esc(item.size ?? '')}"></label></div>
    <div class="row2"><label>Width <input name="width" value="${esc(item.width || '')}"></label><label>Retail price <input name="price" value="${esc(item.price ?? '')}"></label></div>
    <div class="row2"><label>Wholesale price <input name="wholesale_price" value="${esc(item.wholesale_price ?? '')}"></label><label>Status <select name="status">${['draft', 'published', 'sold', 'archived'].map(s => `<option ${item.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label></div>
    <label><input type="checkbox" name="no_width" ${item.no_width ? 'checked' : ''}> No letter width</label>
    <label><input type="checkbox" name="wholesale" ${item.wholesale ? 'checked' : ''}> Show in wholesale catalog</label>
    <label>Public description <textarea name="notes">${esc(item.notes || '')}</textarea></label>
    <p class="meta">This text is shown on the boot page after you publish. Don't put group price, cost, or SKU here.</p>
    <label>Photo URLs, one per line <textarea name="photos">${esc((item.photos || []).join('\n'))}</textarea></label>
    <button class="btn btn-dark" type="submit">${item.id ? 'Save changes' : 'Add as draft'}</button>
  </form>`;
}
function csvPreview() {
  if (!csvPlan) return `<form class="form" data-form="csv"><label>List Perfectly CSV <input type="file" id="csv-file" accept=".csv,text/csv"></label><p class="meta">Nothing is saved until you confirm. Price becomes the public retail price. Group Price inside Notes becomes the wholesale price and is not shown on the shop. SKU, cost, profit, marketplace columns, and the rest of Notes are not saved. New rows land in Needs Review. Templates named LVIDRAFT are skipped. Sold rows update a matching pair or are skipped. Other boots are left alone.</p></form>`;
  const sum = planSummary(csvPlan);
  const label = { insert: 'Add as draft', update: 'Update, then Needs Review', mark_sold: 'Mark sold', skip_template: 'Skip template', skip_sold: 'Skip sold' };
  return `<div class="banner"><strong>${sum.insert} new drafts, ${sum.update} updates, ${sum.mark_sold} marked sold, ${sum.skip_template} templates skipped, ${sum.skip_sold} sold rows skipped.</strong>
    ${sum.missingWidth ? `<div>${sum.missingWidth} rows have no width. They stay blank and in Needs Review instead of a guessed letter.</div>` : ''}
    ${sum.update ? '<div>Updates go back to Needs Review until you publish them again. Undo restores the previous listing.</div>' : ''}</div>
    <div class="table-scroll"><table class="gridish"><thead><tr><th>Action</th><th>Title</th><th>Size</th><th>Width</th><th>Sole</th><th>Retail</th><th>Wholesale</th><th>Flags</th></tr></thead><tbody>
    ${csvPlan.map(p => `<tr><td>${esc(label[p.action] || p.action)}</td><td>${esc(p.title || '')}</td><td>${esc(p.record?.size ?? '')}</td><td>${esc(p.record?.width || '')}</td><td>${esc(p.sole || '')}</td><td>${p.record?.price ? money(p.record.price) : ''}</td><td>${p.record?.wholesale_price ? money(p.record.wholesale_price) : ''}</td><td>${esc((p.record?.missing || []).join(', '))}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="actions"><button class="btn btn-dark" type="button" data-act="csv-go">Import ${sum.insert + sum.update + sum.mark_sold} rows</button> <button class="btn btn-ghost" type="button" data-act="csv-clear">Cancel</button></p>`;
}
function orderCard(o) {
  const items = Array.isArray(o.items) ? o.items : [];
  return `<div class="row"><img alt=""><div><h3>${esc(o.customer_name || 'Order')} · ${money(o.total)}</h3>
    <div class="meta">${esc(o.channel || '')} · ${esc(o.status || '')} · ${esc(o.created_at || '')}</div>
    <div class="actions"><button class="btn btn-sm btn-ghost" type="button" data-act="receipt" data-id="${o.id}">Receipt</button>
    <button class="btn btn-sm btn-danger" type="button" data-act="del-order" data-id="${o.id}">Delete</button></div>
    <div class="meta">${items.map(i => esc(i.title || i.brand || 'pair')).join(', ')}</div></div></div>`;
}
function renderAdmin(email) {
  const drafts = filtered(rows.filter(p => p.status === 'draft' && !p.wholesale));
  const published = filtered(rows.filter(p => p.status === 'published' && !p.wholesale));
  const wsDrafts = filtered(rows.filter(p => p.status === 'draft' && p.wholesale));
  const wsPub = filtered(rows.filter(p => p.status === 'published' && p.wholesale));
  const archived = filtered(rows.filter(p => p.status === 'archived'));
  const sold = filtered(rows.filter(p => p.status === 'sold'));
  const tabs = [['drafts', `Needs Review (${rows.filter(p => p.status === 'draft' && !p.wholesale).length})`], ['published', 'Published'], ['add', 'Add a pair'], ['csv', 'Import CSV'], ['orders', 'Orders'], ['soldcheck', 'Sold'], ['archived', 'Archived'], ['wsdrafts', 'Needs Review Wholesale'], ['wspublished', 'Wholesale'], ['wsorders', 'Wholesale orders']];
  const body = {
    drafts: drafts.map(p => productRow(p, 'draft')).join('') || '<p>Nothing waiting.</p>',
    published: published.map(p => productRow(p, 'published')).join('') || '<p>Nothing published.</p>',
    add: editForm(editId ? rows.find(p => p.id === editId) : null),
    csv: csvPreview() + '<p><button class="btn btn-ghost" type="button" data-act="undo">Undo last import</button></p>',
    orders: orders.filter(o => o.channel !== 'wholesale').map(orderCard).join('') || '<p>No orders.</p>',
    soldcheck: sold.map(p => productRow(p, 'sold')).join('') || '<p>No sold pairs.</p>',
    archived: archived.map(p => productRow(p, 'archived')).join('') || '<p>Archive is empty.</p>',
    wsdrafts: wsDrafts.map(p => productRow(p, 'draft')).join('') || '<p>No wholesale drafts.</p>',
    wspublished: wsPub.map(p => productRow(p, 'published')).join('') || '<p>No published wholesale pairs.</p>',
    wsorders: orders.filter(o => o.channel === 'wholesale').map(orderCard).join('') || '<p>No wholesale orders.</p>'
  };
  shell('Admin', `<h1>Admin</h1><p class="meta">Signed in as ${esc(email)}. <button class="btn btn-sm btn-ghost" type="button" data-act="admin-out">Sign out</button></p>
    <div class="tabs">${tabs.map(([id, label]) => `<button class="btn btn-sm ${tab === id ? 'btn-dark' : 'btn-ghost'}" type="button" data-act="tab" data-tab="${id}">${label}</button>`).join('')}</div>
    <label>Find <input id="admin-q" type="search" value="${esc(q)}" placeholder="Brand, size, title"></label>
    <div id="panel">${receipt ? receiptHtml(receipt) : body[tab]}</div>`);
}
function receiptHtml(o) {
  const items = Array.isArray(o.items) ? o.items : [];
  return `<article class="receipt"><button class="btn btn-sm btn-ghost" type="button" data-act="close-receipt">Back</button>
    <h2>Receipt</h2><p>${esc(o.customer_name || '')}<br>${esc(o.customer_contact || '')}<br>${esc(o.ship_address || '')}</p>
    ${items.map(i => `<div class="line"><div><strong>${esc(i.brand || '')} ${esc(i.title || '')}</strong><div class="meta">${esc(i.size || '')} ${esc(i.width || '')}</div></div><b>${money(i.price)}</b></div>`).join('')}
    <p><strong>Total ${money(o.total)}</strong></p><p class="meta">${esc(o.note || '')}</p>
    <button class="btn btn-ghost" type="button" data-act="print">Print</button></article>`;
}

function recordFromForm(form, existing) {
  const data = Object.fromEntries(new FormData(form).entries());
  const photos = String(data.photos || '').split(/\n/).map(s => s.trim()).filter(s => s.startsWith('https://'));
  const wholesale_price = num(data.wholesale_price);
  const price = num(data.price);
  const missing = [];
  if (!photos.length && !(existing?.photos || []).length) missing.push('photos');
  if (!price) missing.push('price');
  if (!data.brand) missing.push('brand');
  if (!data.size) missing.push('size');
  if (!data.width && !form.querySelector('[name=no_width]')?.checked) missing.push('width');
  return safeRecord({
    gender: data.gender === 'W' ? 'W' : 'M',
    brand: data.brand || 'Unknown',
    title: data.title || '',
    size: num(data.size),
    width: data.width || '',
    no_width: !!form.querySelector('[name=no_width]')?.checked,
    material: data.material || null,
    price,
    notes: data.notes || null,
    photos: photos.length ? photos : (existing?.photos || []),
    women_size: existing?.women_size ?? null,
    women_width: existing?.women_width ?? null,
    suggest: [],
    missing,
    status: data.status || 'draft',
    wholesale: !!form.querySelector('[name=wholesale]')?.checked || wholesale_price != null,
    wholesale_price
  });
}

async function publish(id) {
  const p = rows.find(x => x.id === id);
  if (!p) return;
  const brand = document.getElementById(`f_${id}_brand`)?.value?.trim() || p.brand;
  const size = num(document.getElementById(`f_${id}_size`)?.value ?? p.size);
  const width = document.getElementById(`f_${id}_width`)?.value?.trim() ?? p.width;
  const price = num(document.getElementById(`f_${id}_price`)?.value ?? p.price);
  const noWidth = !!document.getElementById(`f_${id}_nowidth`)?.checked;
  const missing = [];
  if (!(p.photos || []).length) missing.push('photos');
  if (!price) missing.push('price');
  if (!brand) missing.push('brand');
  if (size == null) missing.push('size');
  if (!width && !noWidth) missing.push('width');
  if (missing.length) return alert('Still missing: ' + missing.join(', '));
  const client = await db();
  const rec = safeRecord({ ...p, brand, size, width: width || '', no_width: noWidth, price, status: 'published', missing: [] });
  delete rec.suggest;
  const { error } = await client.from('products').update(rec).eq('id', id);
  if (error) return alert(error.message);
  tab = 'published';
  admin();
}
async function setStatus(id, status) {
  const client = await db();
  const { error } = await client.from('products').update({ status }).eq('id', id);
  if (error) return alert(error.message);
  admin();
}
async function runImport() {
  if (!csvPlan) return;
  const client = await db();
  const entries = [];
  const inserts = csvPlan.filter(p => p.action === 'insert').map(p => safeRecord(p.record));
  if (inserts.length) {
    const { data, error } = await client.from('products').insert(inserts).select('id');
    if (error) return alert(error.message);
    for (const row of data || []) entries.push({ action: 'insert', id: row.id });
  }
  for (const item of csvPlan.filter(p => p.action === 'update' || p.action === 'mark_sold')) {
    const rec = safeRecord(item.record);
    const { error } = await client.from('products').update(rec).eq('id', item.matchId);
    if (error) return alert(error.message);
    entries.push({ action: item.action, id: item.matchId, previous: item.previous });
  }
  const sum = planSummary(csvPlan);
  const summary = `${sum.insert} added, ${sum.update} updated, ${sum.mark_sold} marked sold`;
  const log = await client.from('import_log').insert({ summary, entries });
  if (log.error) alert('Imported, but the undo log did not save: ' + log.error.message);
  csvPlan = null;
  tab = 'drafts';
  admin();
}
async function undoImport() {
  const client = await db();
  const { data, error } = await client.from('import_log').select('*').eq('undone', false).order('id', { ascending: false }).limit(1);
  if (error) return alert(error.message);
  const log = (data || [])[0];
  if (!log) return alert('Nothing to undo.');
  if (!confirm(log.summary || 'Undo the last import?')) return;
  for (const op of buildUndoOps(log.entries)) {
    if (op.op === 'delete') {
      const res = await client.from('products').delete().eq('id', op.id);
      if (res.error) return alert(res.error.message);
    } else {
      const res = await client.from('products').update(op.record).eq('id', op.id);
      if (res.error) return alert(res.error.message);
    }
  }
  await client.from('import_log').update({ undone: true }).eq('id', log.id);
  admin();
}

function wire() {
  if (wired) return;
  wired = true;
  app().addEventListener('submit', async e => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement) || !app().contains(form)) return;
    e.preventDefault();
    const kind = form.dataset.form;
    try {
      if (kind === 'corral') {
        await postGate({ area: 'corral', password: new FormData(form).get('password') });
        history.pushState(null, '', '/corral');
        return corral();
      }
      if (kind === 'staff-login') {
        await postGate({ area: 'staff', password: new FormData(form).get('password') });
        return staff();
      }
      if (kind === 'admin') {
        const data = new FormData(form);
        const client = await db();
        const { error } = await client.auth.signInWithPassword({ email: String(data.get('email') || ''), password: String(data.get('password') || '') });
        if (error) return alert(error.message);
        return admin();
      }
      if (kind === 'staff') {
        const data = new FormData(form);
        const urls = JSON.parse(document.getElementById('staff-file')?.dataset.urls || '[]');
        const res = await fetch('/api/staff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', id: data.get('id') || null, record: {
          title: data.get('title'), brand: data.get('brand'), material: data.get('material'), gender: data.get('gender'),
          size: data.get('size'), width: data.get('width'), no_width: form.querySelector('[name=no_width]')?.checked,
          wholesale_price: data.get('wholesale_price'), condition: data.get('condition'), notes: data.get('notes'), photos: urls
        } }) });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return alert(body.error || 'Save failed');
        staffEdit = null;
        return staff();
      }
      if (kind === 'edit') {
        const id = Number(new FormData(form).get('id')) || null;
        const existing = rows.find(p => p.id === id);
        const rec = recordFromForm(form, existing);
        const client = await db();
        const res = id ? await client.from('products').update(rec).eq('id', id) : await client.from('products').insert(rec);
        if (res.error) return alert(res.error.message);
        editId = null;
        tab = 'drafts';
        return admin();
      }
    } catch (err) {
      alert(err.message || 'Something went wrong');
    }
  });
  app().addEventListener('change', async e => {
    if (e.target.id !== 'csv-file') return;
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    csvPlan = planImport(parseListPerfectly(text), rows);
    renderAdmin(adminEmail);
  });
  app().addEventListener('input', e => {
    if (e.target.id !== 'admin-q') return;
    q = e.target.value;
    renderAdmin(adminEmail);
    const box = document.getElementById('admin-q');
    if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
  });
  app().addEventListener('click', async e => {
    const btn = e.target.closest('[data-act]');
    if (!btn || !app().contains(btn)) return;
    const act = btn.dataset.act;
    const id = Number(btn.dataset.id);
    if (act === 'logout') { await postGate({ logout: true }).catch(() => {}); history.pushState(null, '', '/corral'); return corral(); }
    if (act === 'admin-out') { await (await db()).auth.signOut(); return admin(); }
    if (act === 'tab') { tab = btn.dataset.tab; receipt = null; editId = tab === 'add' ? null : editId; return admin(); }
    if (act === 'publish') return publish(id);
    if (act === 'sold') return setStatus(id, 'sold');
    if (act === 'relist') return setStatus(id, 'published');
    if (act === 'archive') return setStatus(id, 'archived');
    if (act === 'delete') {
      if (!confirm('Delete this pair?')) return;
      const client = await db();
      const { error } = await client.from('products').delete().eq('id', id);
      if (error) return alert(error.message);
      return admin();
    }
    if (act === 'edit') { editId = id; tab = 'add'; return admin(); }
    if (act === 'csv-go') return runImport();
    if (act === 'csv-clear') { csvPlan = null; return admin(); }
    if (act === 'undo') return undoImport();
    if (act === 'staff-edit') { staffEdit = id; return staff(); }
    if (act === 'receipt') { receipt = orders.find(o => o.id === id) || null; return renderAdmin(adminEmail); }
    if (act === 'print') { window.print(); return; }
    if (act === 'close-receipt') { receipt = null; return admin(); }
    if (act === 'del-order') {
      if (!confirm('Delete this order? The boots stay as they are.')) return;
      const client = await db();
      const { error } = await client.from('orders').delete().eq('id', id);
      if (error) return alert(error.message);
      return admin();
    }
  });
}

export async function open(path) {
  css();
  wire();
  receipt = null;
  if (path === '/wholesale') return wholesale();
  if (path === '/staff') return staff();
  if (path === '/admin') return admin();
  return corral();
}
