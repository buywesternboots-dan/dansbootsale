/* Pure catalog helpers shared by the storefront, tests, and the OG/sitemap functions.
   No secrets, no network. */

export const SITE = 'https://www.dansbootsale.com';
export const PHONE_E164 = '+14044880174';
export const PHONE_TXT = '404-488-0174';
export const EMAIL = 'dansbootsale@gmail.com';
export const FACEBOOK = 'https://www.facebook.com/HOFFYWOOD/';
export const REDDIT = 'https://www.reddit.com/user/SpadesQuiz/';
export const SB_URL = 'https://ckwvaykmsbpckepczcsd.supabase.co';
/* Publishable key. Safe in the browser; row access is limited by RLS + public_catalog(). */
export const SB_KEY = 'sb_publishable__FERRSso9CAnparqSlk3gg_MSfIM352';

export const PAGE_SIZE = 48;
export const SOLD_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const NEW_WINDOW_MS = 21 * 24 * 60 * 60 * 1000;

/* Columns the public client may ask PostgREST for on the legacy (pre-migration) path.
   sku, notes, wholesale_price, wholesale, and cost are intentionally absent.
   After the migration, the client uses rpc/public_catalog and does not touch the table. */
export const PUBLIC_COLUMNS = [
  'id', 'gender', 'brand', 'title', 'size', 'width', 'no_width', 'material', 'price',
  'photos', 'women_size', 'women_width', 'status', 'updated_at', 'created_at', 'sold_at'
];

export const SECRET_FIELDS = ['sku', 'notes', 'cost', 'wholesale_price', 'wholesale'];

export const PRICES = [
  ['u150', 'Under $150', 0, 150],
  ['150-300', '$150–300', 150, 300],
  ['300-600', '$300–600', 300, 600],
  ['600', '$600+', 600, 1e9]
];

const EXOTIC = /ostrich|alligator|gator|caiman|crocodile|python|snake|rattlesnake|lizard|teju|stingray|shark|eel|elephant|buffalo|bull ?neck|hippo|frog|cobra|anteater|pangolin|turtle/i;
export const LEATHER_GROUPS = [
  ['Ostrich', /ostrich/i],
  ['Gator & caiman', /alligator|gator|caiman|crocodile/i],
  ['Snake', /python|snake|rattlesnake|cobra/i],
  ['Lizard', /lizard|teju/i],
  ['Stingray & shark', /stingray|shark/i],
  ['Other exotic', /elephant|buffalo|bull ?neck|hippo|eel|frog/i],
  ['Cowhide & calf', /^(leather|calf|cowhide)/i],
  ['Suede', /suede|roughout/i]
];
const RESTRICTED = /\b(sea turtles?|pangolins?|anteaters?)\b/i;

export const FILTER_DEFAULTS = {
  g: 'all', sizes: [], widths: [], leather: [], brand: '', price: '', q: '', sort: 'new', exotic: ''
};

export function money(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  const whole = Math.abs(v - Math.round(v)) < 0.001;
  return whole
    ? '$' + Math.round(v).toLocaleString('en-US')
    : '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtSize(n) {
  if (n == null || n === '') return '?';
  const v = Number(n);
  if (!Number.isFinite(v)) return '?';
  return (v % 1) ? v.toFixed(1).replace(/\.0$/, '') : String(v);
}

export function leatherGroup(material) {
  const m = material || '';
  for (const [name, re] of LEATHER_GROUPS) if (re.test(m)) return name;
  return 'Cowhide & calf';
}

export function womensEquivalent(size, width) {
  if (size == null || !Number.isFinite(Number(size))) return { ws: null, ww: '' };
  const narrow = new Set(['N', 'B', 'A', 'AA', 'AAA', 'AAAA', 'NARROW']);
  const offset = narrow.has(String(width || '').toUpperCase()) ? 1 : 1.5;
  return { ws: Number((Number(size) + offset).toFixed(1)), ww: '' };
}

export function widthGroup(width, gender) {
  const w = (width || '').toUpperCase().replace(/\s+/g, ' ');
  if (!w) return 'Unlisted';
  if (w === 'NARROW') return 'Narrow';
  if (w === 'REGULAR' || w === 'MEDIUM') return 'Regular';
  if (w === 'WIDE' || w === 'EXTRA WIDE') return 'Wide';
  if (gender === 'W') return /^(AAA*|A|N)$/.test(w) ? 'Narrow' : /^(B|M)$/.test(w) ? 'Regular' : 'Wide';
  return /^(A+|B|C|N)$/.test(w) ? 'Narrow' : /^(D|M)$/.test(w) ? 'Regular' : 'Wide';
}

export function isExotic(p) {
  return EXOTIC.test(`${p.material || ''} ${p.title || ''}`);
}

export function isRestricted(p) {
  return RESTRICTED.test(`${p.material || ''} ${p.title || ''} ${p.brand || ''}`);
}

export function scrubDescription(src) {
  return String(src ?? '')
    .split(/\n/)
    .filter(line => {
      if (/group\s*price/i.test(line)) return false;
      if (/^\s*(sku|cost|cogs|wholesale(\s*price)?|internal|my cost)\b/i.test(line)) return false;
      if (/(wholesale\s*price|unit\s*cost|my\s*cost)\s*[:=]/i.test(line)) return false;
      if (/\b(sku|cost|profit)\s*[:=]/i.test(line)) return false;
      if (/cost of goods|sold price|shipping cost|other costs/i.test(line)) return false;
      return true;
    })
    .join('\n')
    .trim();
}

export function bootSlug(p) {
  const raw = `${p.brand || ''} ${p.material || ''} ${fmtSize(p.size)}${p.width || ''}`;
  const tail = raw.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${p.id}-${tail || 'boots'}`;
}

export function idFromSlug(slug) {
  const m = String(slug || '').match(/^(\d+)/);
  return m ? Number(m[1]) : null;
}

export function bootPath(p) {
  return `/boot/${bootSlug(p)}`;
}

export function materialName(p) {
  return (p.material || 'Leather').replace(/,\s*/g, ' & ');
}

export function sizeLine(p) {
  const who = p.gender === 'W' ? "Women's" : "Men's";
  return `${who} ${fmtSize(p.size)}${p.width ? ' ' + p.width : ''}`;
}

export function smsBody(p) {
  if (!p) return 'Hi Dan, I found you on dansbootsale.com and have a question about boots.';
  return `Hi Dan, is the ${p.brand} ${materialName(p)} (${sizeLine(p)}, ${money(p.price)}) still available? ${SITE}${bootPath(p)}`;
}

export function contactLinks(p) {
  const body = encodeURIComponent(smsBody(p));
  const subject = encodeURIComponent(p ? `DBS: ${p.brand} ${sizeLine(p)}` : 'DBS question');
  return {
    sms: `sms:${PHONE_E164}?&body=${body}`,
    call: `tel:${PHONE_E164}`,
    wa: `https://wa.me/${PHONE_E164.slice(1)}?text=${body}`,
    mail: `mailto:${EMAIL}?subject=${subject}&body=${body}`,
    fb: FACEBOOK,
    reddit: REDDIT
  };
}

export function isRecentSold(p, now = Date.now()) {
  if (p.status !== 'sold') return false;
  const t = Date.parse(p.sold_at || p.updated_at || '');
  if (!t) return true;
  return now - t < SOLD_WINDOW_MS;
}

export function isNewBoot(p, now = Date.now()) {
  if (p.status === 'sold') return false;
  const t = Date.parse(p.created_at || '');
  if (!t) return false;
  return now - t < NEW_WINDOW_MS;
}

export function normalizeProduct(raw) {
  const p = {
    id: Number(raw.id),
    gender: raw.gender === 'W' ? 'W' : raw.gender === 'M' ? 'M' : null,
    brand: raw.brand || 'Unbranded',
    title: raw.title || '',
    size: raw.size == null || raw.size === '' ? null : Number(raw.size),
    width: raw.width || '',
    no_width: !!raw.no_width,
    material: raw.material || '',
    price: raw.price == null || raw.price === '' ? null : Number(raw.price),
    photos: Array.isArray(raw.photos) ? raw.photos.filter(u => typeof u === 'string' && /^https?:\/\//.test(u)) : [],
    women_size: raw.women_size == null || raw.women_size === '' ? null : Number(raw.women_size),
    women_width: raw.women_width || '',
    status: raw.status || '',
    updated_at: raw.updated_at || null,
    created_at: raw.created_at || null,
    sold_at: raw.sold_at || null,
    description: scrubDescription(raw.description != null ? raw.description : raw.notes)
  };
  p.exotic = isExotic(p);
  p.lgroup = leatherGroup(p.material);
  p.wgroup = widthGroup(p.width, p.gender);
  return p;
}

export function fitSize(p, g) {
  if (g === 'W') return p.gender === 'W' ? p.size : p.women_size;
  return p.size;
}

export function readFilters(search) {
  const u = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const S = { ...FILTER_DEFAULTS, sizes: [], widths: [], leather: [] };
  for (const k of ['g', 'brand', 'price', 'q', 'sort', 'exotic']) {
    const v = u.get(k);
    if (v) S[k] = v;
  }
  if (S.g !== 'M' && S.g !== 'W' && S.g !== 'all') S.g = 'all';
  if (!['new', 'low', 'high', 'size'].includes(S.sort)) S.sort = 'new';
  for (const k of ['sizes', 'widths', 'leather']) {
    const v = u.get(k);
    if (v) S[k] = v.split(',').map(s => s.trim()).filter(Boolean);
  }
  return S;
}

export function writeFilters(S) {
  const u = new URLSearchParams();
  for (const k of Object.keys(FILTER_DEFAULTS)) {
    const v = S[k];
    const empty = Array.isArray(v) ? v.length === 0 : (v == null || v === '' || v === FILTER_DEFAULTS[k]);
    if (!empty) u.set(k, Array.isArray(v) ? v.join(',') : v);
  }
  const s = u.toString();
  return s ? '/?' + s : '/';
}

function inGender(p, g) {
  if (g === 'M') return p.gender === 'M';
  if (g === 'W') return p.gender === 'W' || (p.gender === 'M' && p.women_size != null);
  return true;
}

export function matches(p, S, skip) {
  if (!inGender(p, S.g)) return false;
  if (skip !== 'sizes' && S.sizes.length && !S.sizes.includes(fmtSize(fitSize(p, S.g)))) return false;
  if (skip !== 'widths' && S.widths.length && !S.widths.includes(p.wgroup)) return false;
  if (skip !== 'leather' && S.leather.length && !S.leather.includes(p.lgroup)) return false;
  if (S.exotic && !p.exotic) return false;
  if (S.brand && p.brand !== S.brand) return false;
  if (S.price) {
    const b = PRICES.find(x => x[0] === S.price);
    if (b && !(p.price >= b[2] && p.price < b[3])) return false;
  }
  if (S.q) {
    const hay = `${p.brand} ${p.title} ${p.material || ''} ${sizeLine(p)}`.toLowerCase();
    if (!S.q.toLowerCase().split(/\s+/).every(w => w && hay.includes(w))) return false;
  }
  return true;
}

export function publicPool(products) {
  return products.filter(p => {
    if (isRestricted(p)) return false;
    if (p.status === 'published') return p.price > 0;
    if (p.status === 'sold') return p.price > 0;
    return false;
  });
}

export function queryCatalog(products, S, now = Date.now()) {
  const pool = publicPool(products);
  const matched = pool.filter(p => matches(p, S));
  const sorters = {
    new: (a, b) => (Date.parse(b.created_at || '') || b.id) - (Date.parse(a.created_at || '') || a.id) || b.id - a.id,
    low: (a, b) => a.price - b.price || a.id - b.id,
    high: (a, b) => b.price - a.price || b.id - a.id,
    size: (a, b) => (fitSize(a, S.g) ?? 99) - (fitSize(b, S.g) ?? 99) || a.id - b.id
  };
  const sort = sorters[S.sort] || sorters.new;
  const available = matched.filter(p => p.status !== 'sold').sort(sort);
  const sold = matched.filter(p => isRecentSold(p, now)).sort(sort);
  return { available, sold, pool };
}

export function parseSole(text) {
  const m = String(text || '').match(/sole widest part\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*(in(?:ch(?:es)?)?|cm)?/i);
  if (!m) return '';
  const unit = m[2] && /^c/i.test(m[2]) ? 'cm' : 'in';
  return `${m[1]} ${unit}`;
}

export function parseNotes(text) {
  const lines = String(text || '').split(/\n/).map(s => s.trim()).filter(Boolean);
  const cond = [];
  const meas = [];
  let color = '', made = '', desc = '', fine = '', mode = '';
  for (const l of lines) {
    if (/^==.+==$/.test(l) || /condition report/i.test(l)) {
      if (/condition/i.test(l)) mode = 'cond';
      else if (/measure/i.test(l)) mode = 'meas';
      else mode = '';
      if (/condition report|^==/i.test(l)) continue;
    }
    if (/^measurements/i.test(l)) { mode = 'meas'; continue; }
    let m;
    if ((m = l.match(/^(Uppers|Linings|Outsoles|Insoles|Heels|Soles)\s*:\s*(\d+(?:\.\d)?)\s*\/\s*10\s*(.*)$/i))) {
      cond.push({ part: m[1][0].toUpperCase() + m[1].slice(1).toLowerCase(), score: Number(m[2]), why: m[3].replace(/^[-–—]\s*/, '') });
      continue;
    }
    if (/^sole widest part\s*:/i.test(l)) continue;
    if (mode === 'meas' && (m = l.match(/^([A-Za-z][A-Za-z \-']+?)\s*:\s*(.+)$/))) {
      meas.push([m[1].trim(), m[2].trim()]);
      continue;
    }
    if ((m = l.match(/^Colou?r\s*:\s*(.+)$/i))) { color = m[1]; continue; }
    if (/made in|crafted in/i.test(l) && l.length < 80) {
      made = l.replace(/^(crafted|made) in\s*/i, '').replace(/\.$/, '');
      continue;
    }
    if (/display only|props?\b/i.test(l)) { fine = l; continue; }
    if (l.length > 80 && !desc) { desc = l; mode = ''; }
  }
  return { cond, meas, color, made, desc, fine, sole: parseSole(text) };
}

export function ogTitle(p) {
  const sold = p.status === 'sold' ? 'SOLD · ' : '';
  return `${sold}${p.brand} ${materialName(p)} · ${sizeLine(p)} · ${money(p.price)}`;
}

export function ogDescription(p) {
  const base = `${p.brand} ${materialName(p)}, ${sizeLine(p)}. ${money(p.price)}.`;
  if (p.status === 'sold') return `SOLD. ${base} Text Dan if you want something similar.`;
  return `${base} One of a kind, inspected and measured by hand. Text Dan to claim this pair. Free US shipping and returns.`;
}

export function allowedImageHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (h === 'media.listperfectly.com' || h === 'cdn.listperfectly.com') return true;
  if (h.endsWith('.supabase.co') || h.endsWith('.supabase.in')) return true;
  return false;
}

export function allowedImageUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    return allowedImageHost(u.hostname);
  } catch {
    return false;
  }
}
