import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bootSlug, idFromSlug, smsBody, scrubDescription, parseNotes, queryCatalog, normalizeProduct,
  readFilters, writeFilters, PUBLIC_COLUMNS, SECRET_FIELDS, allowedImageUrl, isRestricted, contactLinks
} from '../lib/catalog.js';

test('slug, share text, and contact links name the pair', () => {
  const p = normalizeProduct({
    id: 102, gender: 'M', brand: 'Lucchese', material: 'Caiman', size: 10, width: 'D', price: 288, status: 'published', photos: []
  });
  assert.equal(bootSlug(p), '102-lucchese-caiman-10d');
  assert.equal(idFromSlug('102-lucchese-caiman-10d'), 102);
  assert.equal(idFromSlug('nope'), null);
  const body = smsBody(p);
  assert.match(body, /Lucchese/);
  assert.match(body, /Men's 10 D/);
  assert.match(body, /\$288/);
  assert.match(body, /https:\/\/www\.dansbootsale\.com\/boot\/102-lucchese-caiman-10d/);
  const links = contactLinks(p);
  assert.match(links.sms, /^sms:\+14044880174/);
  assert.match(links.call, /^tel:\+14044880174/);
  assert.match(links.wa, /^https:\/\/wa\.me\/14044880174/);
  assert.match(links.mail, /dansbootsale@gmail\.com/);
});

test('public columns exclude private fields and notes scrub drops group price', () => {
  for (const secret of SECRET_FIELDS) assert.equal(PUBLIC_COLUMNS.includes(secret), false);
  const clean = scrubDescription('Color: Tan\nGroup Price: $99\nSKU: ABC\nCost: 40\nNice pair');
  assert.equal(clean.includes('99'), false);
  assert.equal(clean.includes('ABC'), false);
  assert.match(clean, /Nice pair/);
});

test('condition report and sole width parse from the description', () => {
  const notes = parseNotes(`Color: Tan
==Honest Condition Report==
Uppers: 8/10 Light creasing
Measurements (approx.):
Sole widest part: 4.4 in
Shaft Height: 12 in`);
  assert.equal(notes.cond[0].part, 'Uppers');
  assert.equal(notes.cond[0].score, 8);
  assert.equal(notes.sole, '4.4 in');
  assert.deepEqual(notes.meas, [['Shaft Height', '12 in']]);
  assert.equal(notes.color, 'Tan');
});

test('filters round-trip and hide restricted species and stale sold pairs', () => {
  const now = Date.parse('2026-10-21T00:00:00Z');
  const products = [
    normalizeProduct({ id: 1, gender: 'M', brand: 'A', material: 'Caiman', size: 10, width: 'D', price: 200, status: 'published', women_size: 11.5, created_at: '2026-10-20T00:00:00Z' }),
    normalizeProduct({ id: 2, gender: 'M', brand: 'B', material: 'Sea Turtle', size: 9, width: 'D', price: 100, status: 'published' }),
    normalizeProduct({ id: 3, gender: 'W', brand: 'C', material: 'Ostrich', size: 7, width: 'B', price: 180, status: 'sold', updated_at: '2026-10-01T00:00:00Z' }),
    normalizeProduct({ id: 4, gender: 'M', brand: 'D', material: 'Cowhide', size: 12, width: 'EE', price: 90, status: 'sold', updated_at: '2026-01-01T00:00:00Z' }),
    normalizeProduct({ id: 5, gender: 'M', brand: 'E', material: 'Leather', size: 8, width: '', price: null, status: 'published', wholesale: true, wholesale_price: 40 })
  ];
  assert.equal(isRestricted(products[1]), true);
  const all = queryCatalog(products, readFilters(''), now);
  assert.deepEqual(all.available.map(p => p.id), [1]);
  assert.deepEqual(all.sold.map(p => p.id), [3]);
  const women = queryCatalog(products, readFilters('?g=W'), now);
  assert.deepEqual(women.available.map(p => p.id), [1]);
  const filters = readFilters('?g=M&sizes=10&leather=Gator%20%26%20caiman&sort=low');
  assert.equal(writeFilters(filters), '/?g=M&sizes=10&leather=Gator+%26+caiman&sort=low');
  const priced = normalizeProduct({ id: 9, brand: 'Z', material: 'Leather', size: 9, width: 'D', price: 50, status: 'published', gender: 'M', sku: 'HIDE', notes: 'secret', wholesale_price: 10, cost: 5 });
  assert.equal('sku' in priced, false);
  assert.equal('notes' in priced, false);
  assert.equal('wholesale_price' in priced, false);
  assert.equal(priced.description, 'secret');
});

test('image proxy allowlist rejects internal hosts', () => {
  assert.equal(allowedImageUrl('https://media.listperfectly.com/a.jpg'), true);
  assert.equal(allowedImageUrl('https://ckwvaykmsbpckepczcsd.supabase.co/storage/v1/object/public/wholesale-photos/a.jpg'), true);
  assert.equal(allowedImageUrl('http://169.254.169.254/latest/meta-data'), false);
  assert.equal(allowedImageUrl('https://evil.example/a.jpg'), false);
  assert.equal(allowedImageUrl('not a url'), false);
});
