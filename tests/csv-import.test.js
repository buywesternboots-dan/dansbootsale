import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseListPerfectly, planImport, safeRecord, buildUndoOps, planSummary, parseGroupPrice, extractSizeWidth
} from '../lib/csv-import.js';

const csv = readFileSync(new URL('./fixtures/listperfectly-sample.csv', import.meta.url), 'utf8');
const items = parseListPerfectly(csv);
const byTitle = title => items.find(i => i.title === title);

test('price column is retail and group price is wholesale only', () => {
  const row = byTitle("Sample Brand Men's 9.5D Tan Cowboy Boots");
  assert.equal(row.record.price, 150);
  assert.equal(row.record.wholesale_price, 99);
  assert.equal(row.record.wholesale, true);
  assert.doesNotMatch(row.record.notes, /group\s*price/i);
  assert.doesNotMatch(row.record.notes, /private note/i);
  assert.equal(row.record.width, 'D');
  assert.equal(row.record.size, 9.5);
  assert.equal(row.sole, '4.4 in');
  assert.equal(row.record.brand, 'Sample Brand');
});

test('group price formats do not swallow the following date', () => {
  assert.equal(parseGroupPrice('Group Price: $99'), 99);
  assert.equal(parseGroupPrice('Group price: 999'), 999);
  assert.equal(parseGroupPrice('Group price $99 reduced 9/9/99'), 99);
  const reduced = byTitle('Another Sample Mens Boots');
  assert.equal(reduced.record.price, 80);
  assert.equal(reduced.record.wholesale_price, 99);
});

test('width priority is title, then size column, then description', () => {
  const fromSizeCol = byTitle('Plain Title Cowboy Boots');
  assert.equal(fromSizeCol.record.size, 10);
  assert.equal(fromSizeCol.record.width, 'D');
  assert.equal(fromSizeCol.record.price, 220);
  assert.equal(fromSizeCol.record.wholesale_price, 999);

  const fromDesc = byTitle('Another Sample Mens Boots');
  assert.equal(fromDesc.record.size, 9.5);
  assert.equal(fromDesc.record.width, 'D');
  assert.equal(fromDesc.record.missing.includes('width'), false);

  const word = byTitle('Word Width Sample Boots');
  assert.equal(word.record.size, 10);
  assert.equal(word.record.width, 'Wide');
  assert.equal(word.sole, '4.25 in');
});

test('shelf codes are not widths', () => {
  const hit = extractSizeWidth('stored in bin #4E next to boots#6B');
  assert.equal(hit, null);
  const described = byTitle('Another Sample Mens Boots');
  assert.notEqual(described.record.width, 'E');
  assert.notEqual(described.record.width, 'B');
  assert.notEqual(described.record.width, '4E');
});

test('missing width is blank and flagged, EW becomes EE, 2E is kept', () => {
  const none = parseListPerfectly(`Title,Size,Price,Description,Notes,Quantity
No Width Anywhere,,,Public text only,,1`)[0];
  assert.equal(none.record.width, '');
  assert.equal(none.record.no_width, false);
  assert.ok(none.record.missing.includes('width'));

  const ew = byTitle('EW Width Sample Mens 9 EW Boots');
  assert.equal(ew.record.width, 'EE');
  assert.equal(ew.record.size, 9);

  const half = byTitle('Half Size 11.5 2E Sample Boots');
  assert.equal(half.record.size, 11.5);
  assert.equal(half.record.width, '2E');
  assert.equal(half.record.price, 410);
  assert.equal(half.record.wholesale_price, 200);
});

test('templates are skipped and sold signals do not create new public rows', () => {
  assert.equal(byTitle('LVIDRAFT template do not import').actionHint, 'skip_template');
  assert.equal(byTitle('Already Sold Sample Boots').sold, true);
  assert.equal(byTitle('Zero Qty Sample Boots').sold, true);

  const existing = [
    { id: 6, sku: 'SKU-6', title: 'Already Sold Sample Boots', status: 'published', price: 300, width: 'EE' },
    { id: 50, sku: 'OTHER', title: 'Not in this file', status: 'published', price: 100, width: 'D' }
  ];
  const plan = planImport(items, existing);
  assert.equal(plan.find(p => p.title === 'LVIDRAFT template do not import').action, 'skip_template');
  assert.equal(plan.find(p => p.title === 'Already Sold Sample Boots').action, 'mark_sold');
  assert.equal(plan.find(p => p.title === 'Zero Qty Sample Boots').action, 'skip_sold');
  assert.equal(plan.some(p => p.title === 'Not in this file'), false);
  assert.equal(plan.some(p => p.action === 'flag_check'), false);
  const summary = planSummary(plan);
  assert.equal(summary.mark_sold, 1);
  assert.ok(summary.insert >= 1);
});

test('saved records and undo payloads never carry private columns', () => {
  const banned = ['sku', 'cost', 'cost_of_goods', 'sold_price', 'shipping_cost', 'other_costs', 'profit', 'upc', 'ebay', 'etsy', 'facebook', 'matchSku'];
  for (const item of items) {
    if (!item.record) continue;
    const safe = safeRecord(item.record);
    for (const key of banned) assert.equal(key in safe, false, key);
    assert.equal(JSON.stringify(safe).includes('SECRET'), false);
    assert.equal(JSON.stringify(safe).includes('SHOULD-NOT-SAVE'), false);
  }
  const plan = planImport(items, [{ id: 9, sku: 'SKU-9', title: 'Half Size 11.5 2E Sample Boots', status: 'published', price: 10, notes: 'old', width: 'D', size: 11 }]);
  const update = plan.find(p => p.action === 'update' && p.matchId === 9);
  assert.ok(update);
  assert.equal(update.record.status, 'draft');
  assert.equal(update.previous.status, 'published');
  assert.equal('sku' in update.previous, false);
  const ops = buildUndoOps([{ action: 'insert', id: 3 }, { action: 'update', id: 9, previous: update.previous }, { action: 'mark_sold', id: 6, previous: { status: 'published', price: 300 } }]);
  assert.deepEqual(ops.map(o => o.op), ['restore', 'restore', 'delete']);
  assert.equal(ops[2].id, 3);
});

test('title width wins over a conflicting size column', () => {
  const parsed = parseListPerfectly(`Title,Size,Price,Brand,Quantity,Description,Notes
Sample Mens 9.5D Boots,8B,125,Sample Brand,1,Public description text here.,Group Price: $40`)[0];
  assert.equal(parsed.record.size, 9.5);
  assert.equal(parsed.record.width, 'D');
  assert.equal(parsed.record.price, 125);
  assert.equal(parsed.record.wholesale_price, 40);
});
