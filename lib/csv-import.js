/* List Perfectly CSV → safe product records.
   Retail price comes from the Price column.
   Group Price inside Notes becomes wholesale_price and the rest of Notes is dropped.
   Width is parsed from the title, then the Size column, then labeled description lines.
   SKU, cost, profit, marketplace columns, and raw Notes are never part of the saved record.
*/

import { scrubDescription, womensEquivalent } from './catalog.js';

export const WIDTH_SRC = 'AAAA|AAA|AA|BB|[2-6]E|EEEE|EEE|EE|EW|DD|[A-E]|M|N|W';

const SNAP_KEYS = [
  'gender', 'brand', 'title', 'size', 'width', 'no_width', 'material', 'price', 'notes',
  'photos', 'women_size', 'women_width', 'status', 'missing', 'suggest', 'wholesale',
  'wholesale_price', 'condition'
];

const RECORD_KEYS = [
  'gender', 'brand', 'title', 'size', 'width', 'no_width', 'material', 'price', 'notes',
  'photos', 'women_size', 'women_width', 'suggest', 'missing', 'status', 'wholesale',
  'wholesale_price'
];

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQ = false;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; continue; }
        inQ = false;
        continue;
      }
      cur += c;
      continue;
    }
    if (c === '"') { inQ = true; continue; }
    if (c === ',') { row.push(cur); cur = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(cur); cur = ''; rows.push(row); row = []; continue; }
    cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(cell => String(cell).trim() !== ''));
}

export function rowsToObjects(table) {
  if (!table.length) return [];
  const headers = table[0].map(h => h.trim());
  return table.slice(1).map(cells => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cells[i] != null ? cells[i] : ''; });
    return obj;
  }).filter(o => Object.values(o).some(v => String(v).trim() !== ''));
}

function col(row, name) {
  const want = name.toLowerCase();
  for (const k of Object.keys(row)) if (k.trim().toLowerCase() === want) return row[k] == null ? '' : String(row[k]);
  return '';
}

export function parseMoney(raw) {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[$,\s]/g, '').trim();
  if (!cleaned || !/^\d+(?:\.\d{1,2})?$/.test(cleaned)) return null;
  const val = Number(cleaned);
  return val > 0 ? Math.round(val * 100) / 100 : null;
}

export function parseGroupPrice(notes) {
  const m = String(notes || '').match(/group\s*price\s*:?\s*\$?\s*(\d+(?:\.\d{1,2})?)/i);
  if (!m) return null;
  const val = Number(m[1]);
  return val > 0 ? Math.round(val * 100) / 100 : null;
}

export function stripLocations(text) {
  return String(text || '')
    .replace(/\b(?:bins?|boots?|box(?:es)?|shel(?:f|ves)|loc(?:ation)?)\s*#\s*\d+[a-z]?\b/gi, ' ')
    .replace(/\b(?:bins?|boots?|box(?:es)?|shel(?:f|ves))\s*#\d+[a-z]?\b/gi, ' ')
    .replace(/#\s*\d+[a-z]?\b/gi, ' ')
    .replace(/[ \t]{2,}/g, ' ');
}

export function normalizeWidth(token) {
  if (!token) return '';
  const compact = String(token).trim().replace(/[\s-]+/g, ' ');
  const upper = compact.toUpperCase();
  if (!upper) return '';
  if (upper === 'EW') return 'EE';
  if (upper === 'EXTRA WIDE' || upper === 'X WIDE' || upper === 'XWIDE') return 'Extra Wide';
  if (upper === 'WIDE') return 'Wide';
  if (upper === 'NARROW') return 'Narrow';
  if (upper === 'REGULAR') return 'Regular';
  if (upper === 'MEDIUM') return 'Medium';
  if (new RegExp(`^(?:${WIDTH_SRC})$`, 'i').test(upper)) return upper === 'EW' ? 'EE' : upper;
  return '';
}

function plausibleSize(n) {
  if (!Number.isFinite(n) || n < 3.5 || n > 17) return false;
  return Math.abs(n * 2 - Math.round(n * 2)) < 1e-6;
}

/* Pull a shoe size and an optional width token out of a short string.
   Measurements like 4.25 are rejected (not a half size). */
export function extractSizeWidth(text) {
  const cleaned = stripLocations(text);
  const re = new RegExp(`(?<!\\d)(\\d{1,2}(?:\\.\\d{1,2})?)\\s*(${WIDTH_SRC})?(?![A-Za-z0-9])`, 'gi');
  let best = null;
  for (const m of cleaned.matchAll(re)) {
    const size = Number(m[1]);
    if (!plausibleSize(size)) continue;
    const after = cleaned.slice(m.index + m[0].length);
    if (/^\s*(?:in(?:ch(?:es)?)?|cm)\b/i.test(after)) continue;
    const width = m[2] ? normalizeWidth(m[2]) : '';
    const score = (width ? 2 : 1);
    if (!best || score > best.score || (score === best.score && m.index > best.index)) {
      best = { size, width, score, index: m.index };
    }
  }
  return best;
}

function wordWidth(text) {
  const t = stripLocations(text).trim();
  const m = t.match(/\b(extra[\s-]*wide|x[\s-]*wide|narrow|regular|medium|wide)\b/i);
  return m ? normalizeWidth(m[1]) : '';
}

export function parseDescriptionSizing(description) {
  let size = null;
  let width = '';
  let gender = null;
  const lines = String(description || '').split(/\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || /sole widest part/i.test(line)) continue;
    const widthLine = line.match(/^Width\s*:\s*(.+)$/i);
    if (widthLine) {
      const val = stripLocations(widthLine[1]);
      const only = val.trim().match(new RegExp(`^(${WIDTH_SRC})$`, 'i'));
      const token = only ? normalizeWidth(only[1]) : '';
      const fromNum = extractSizeWidth(val);
      const word = wordWidth(val);
      const found = token || fromNum?.width || word || '';
      if (found && !width) width = found;
      if (fromNum && size == null) size = fromNum.size;
      continue;
    }
    const sizeLine = line.match(/^(?:US\s*)?(Men'?s|Mens|Women'?s|Womens|Men|Women)?\s*Size\s*:\s*(.+)$/i);
    if (!sizeLine) continue;
    if (/women/i.test(sizeLine[1] || '')) gender = 'W';
    else if (/men/i.test(sizeLine[1] || '')) gender = 'M';
    const val = stripLocations(sizeLine[2]);
    const parsed = extractSizeWidth(val);
    if (parsed) {
      if (size == null) size = parsed.size;
      if (parsed.width && !width) width = parsed.width;
    }
    if (!width) {
      const word = wordWidth(val);
      if (word) width = word;
    }
  }
  return { size, width, gender };
}

export function genderFromText(...parts) {
  const hay = parts.filter(Boolean).join(' ');
  if (/\bcowgirl\b|\bladies\b|\blady'?s\b|\bwomen'?s?\b|\bwomens\b/i.test(hay)) return 'W';
  if (/\bcowboy\b|\bmen'?s\b|\bmens\b/i.test(hay)) return 'M';
  return null;
}

function brandFromTitle(title) {
  const m = String(title || '').match(/^(?:Vintage\s+)?([A-Za-z][A-Za-z0-9.&']+(?:\s+[A-Za-z][A-Za-z0-9.&']+){0,3})(?=\s+(?:Men'?s|Women'?s|Mens|Womens|Cowboy|Cowgirl|Boots|\d))/i);
  return m ? m[1].trim() : '';
}

function materialFromText(material, description, title) {
  const given = String(material || '').trim();
  if (given) return given;
  const hay = `${description || ''} ${title || ''}`;
  const m = hay.match(/\b(ostrich|alligator|crocodile|caiman|python|rattlesnake|snakeskin|lizard|teju|stingray|shark|elephant|calfskin|calf|suede|goat|leather)\b/i);
  return m ? m[1] : '';
}

function photoUrls(...cells) {
  const out = [];
  for (const cell of cells) {
    const found = String(cell || '').match(/https?:\/\/[^\s,;|"']+/g) || [];
    for (const u of found) if (!out.includes(u)) out.push(u);
  }
  return out.slice(0, 30);
}

export function parseSoleWidth(description) {
  const m = String(description || '').match(/sole widest part\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*(in(?:ch(?:es)?)?|cm)?/i);
  if (!m) return '';
  const unit = m[2] && /^c/i.test(m[2]) ? 'cm' : 'in';
  return `${m[1]} ${unit}`;
}

function isTemplate(title) {
  return /lvidraft/i.test(title || '');
}

function isSold(row) {
  const flag = col(row, 'SOLD').trim();
  if (flag && !/^(?:0+(?:\.0+)?|no|n|false|unsold)$/i.test(flag)) return true;
  if (col(row, 'Sold Date').trim()) return true;
  if (parseMoney(col(row, 'Sold Price'))) return true;
  const qty = col(row, 'Quantity').trim();
  if (qty !== '' && Number(qty) === 0) return true;
  return false;
}

function publicDescription(description, color) {
  let text = scrubDescription(description);
  if (color && !/^colou?r\s*:/im.test(text)) {
    text = `Color: ${color.trim()}${text ? '\n' + text : ''}`;
  }
  return text;
}

export function resolveSizing(title, sizeCell, description) {
  const fromTitle = extractSizeWidth(title);
  const fromCell = extractSizeWidth(sizeCell);
  const cellWord = fromCell?.width ? '' : wordWidth(sizeCell);
  const fromDesc = parseDescriptionSizing(description);
  let size = null;
  let width = '';
  if (fromTitle?.width) {
    size = fromTitle.size;
    width = fromTitle.width;
  } else if (fromCell?.width || cellWord) {
    width = fromCell?.width || cellWord;
    size = fromTitle?.size ?? fromCell?.size ?? fromDesc.size;
  } else if (fromDesc.width) {
    width = fromDesc.width;
    size = fromTitle?.size ?? fromCell?.size ?? fromDesc.size;
  } else {
    size = fromTitle?.size ?? fromCell?.size ?? fromDesc.size ?? null;
    width = '';
  }
  const gender = genderFromText(title, sizeCell) || fromDesc.gender || (genderFromText(description) ) || 'M';
  return { size: size == null ? null : size, width, gender };
}

function buildRecord(row) {
  const title = col(row, 'Title').trim();
  const description = col(row, 'Description');
  const sizing = resolveSizing(title, col(row, 'Size'), description);
  const price = parseMoney(col(row, 'Price'));
  const wholesale_price = parseGroupPrice(col(row, 'Notes'));
  const photos = photoUrls(col(row, 'Main Image'), col(row, 'Image Gallery'));
  const brand = col(row, 'Brand').trim() || brandFromTitle(title) || 'Unknown';
  const material = materialFromText(col(row, 'Material'), description, title);
  const color = col(row, 'Color').trim();
  const notes = publicDescription(description, color);
  const sole = parseSoleWidth(description);
  const women = sizing.gender === 'M' ? womensEquivalent(sizing.size, sizing.width) : { ws: null, ww: '' };
  const missing = [];
  if (!photos.length) missing.push('photos');
  if (!price) missing.push('price');
  if (!brand || brand.toLowerCase() === 'unknown') missing.push('brand');
  if (sizing.size == null) missing.push('size');
  if (!sizing.width) missing.push('width');
  const record = {
    gender: sizing.gender,
    brand,
    title,
    size: sizing.size,
    width: sizing.width,
    no_width: false,
    material: material || null,
    price,
    notes,
    photos,
    women_size: women.ws,
    women_width: women.ww || null,
    suggest: [],
    missing,
    status: 'draft',
    wholesale: wholesale_price != null,
    wholesale_price
  };
  return { record, sole, matchSku: col(row, 'SKU').trim() || null, missing };
}

export function parseListPerfectly(csvText) {
  const objects = rowsToObjects(parseCsv(String(csvText || '').replace(/^\uFEFF/, '')));
  return objects.map(row => {
    const title = col(row, 'Title').trim();
    if (!title) return null;
    if (isTemplate(title)) {
      return { actionHint: 'skip_template', title, record: null, matchSku: null, sole: '', sold: false };
    }
    const built = buildRecord(row);
    return {
      actionHint: isSold(row) ? 'sold' : 'draft',
      title,
      sold: isSold(row),
      sole: built.sole,
      matchSku: built.matchSku,
      record: built.record
    };
  }).filter(Boolean);
}

export function snapshotProduct(p) {
  const out = {};
  if (!p) return out;
  for (const k of SNAP_KEYS) if (k in p) out[k] = p[k];
  return out;
}

function findMatch(item, existing) {
  if (item.matchSku) {
    const bySku = existing.find(p => p.sku && String(p.sku) === item.matchSku);
    if (bySku) return bySku;
  }
  const title = (item.title || '').trim().toLowerCase();
  if (!title) return null;
  return existing.find(p => (p.title || '').trim().toLowerCase() === title) || null;
}

export function planImport(items, existing = []) {
  const plan = [];
  for (const item of items) {
    if (!item || item.actionHint === 'skip_template') {
      plan.push({ action: 'skip_template', title: item?.title || '', sole: '', record: null });
      continue;
    }
    const match = findMatch(item, existing);
    if (item.sold || item.actionHint === 'sold') {
      if (!match) {
        plan.push({ action: 'skip_sold', title: item.title, sole: item.sole, record: null });
        continue;
      }
      plan.push({
        action: 'mark_sold',
        title: item.title,
        sole: item.sole,
        matchId: match.id,
        previous: snapshotProduct(match),
        record: { ...item.record, status: 'sold' }
      });
      continue;
    }
    const record = { ...item.record, status: 'draft' };
    if (match) {
      plan.push({
        action: 'update',
        title: item.title,
        sole: item.sole,
        matchId: match.id,
        previous: snapshotProduct(match),
        record
      });
    } else {
      plan.push({ action: 'insert', title: item.title, sole: item.sole, record });
    }
  }
  return plan;
}

export function safeRecord(record) {
  const out = {};
  for (const k of RECORD_KEYS) if (record && k in record) out[k] = record[k];
  if (out.notes && /group\s*price/i.test(out.notes)) out.notes = scrubDescription(out.notes);
  return out;
}

export function buildUndoOps(entries) {
  const ops = [];
  for (const e of [...(entries || [])].reverse()) {
    if (e.action === 'insert') ops.push({ op: 'delete', id: e.id });
    else if (e.action === 'update' || e.action === 'mark_sold') ops.push({ op: 'restore', id: e.id, record: safeRecord(e.previous || {}) });
  }
  return ops;
}

export function planSummary(plan) {
  const n = action => plan.filter(p => p.action === action).length;
  const missingWidth = plan.filter(p => p.record && (p.record.missing || []).includes('width')).length;
  return {
    insert: n('insert'),
    update: n('update'),
    mark_sold: n('mark_sold'),
    skip_template: n('skip_template'),
    skip_sold: n('skip_sold'),
    missingWidth
  };
}
