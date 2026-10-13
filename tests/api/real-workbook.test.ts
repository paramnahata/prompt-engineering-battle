import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Actor } from './client';
import { readWorkbook } from '@/lib/challenges/read-workbook';

/**
 * Imports the organisers' real ~600-PS workbook into the LOCAL staging stack
 * (never production) and times preview, publish and pool search.
 * Skipped unless PEB_PS_WORKBOOK points at the file.
 */
const FILE = process.env.PEB_PS_WORKBOOK;

test('600-PS workbook: preview, publish, search and filter performance', { skip: !FILE || !fs.existsSync(FILE) }, async () => {
  const admin = new Actor('admin');
  assert.equal((await admin.req('POST', '/api/organizer/login', { email: 'admin@staging.local', password: 'Staging-Only-Password-1' })).status, 200);
  const buf = fs.readFileSync(FILE!);
  const sheets = await readWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const payload = JSON.stringify({ fileName: 'Round 1 Task Allocation.xlsx', sheets });

  let t = Date.now();
  const pv = await admin.req('POST', '/api/admin/challenges/import', JSON.parse(payload));
  const previewMs = Date.now() - t;
  assert.equal(pv.status, 200, JSON.stringify(pv.json).slice(0, 300));
  const totals = pv.json.totals as Record<string, number>;
  assert.equal(totals.parsed, 599);
  assert.equal(totals.errors, 1);

  t = Date.now();
  const pub = await admin.req('POST', `/api/admin/challenges/import/${pv.json.batchId}`, { action: 'publish', mode: 'merge', poolStatus: 'approved', defaults: { prompt_word_limit: 150, output_char_limit: 2000 } });
  const publishMs = Date.now() - t;
  assert.equal(pub.status, 200, JSON.stringify(pub.json));

  const timings: number[] = [];
  for (const q of ['', 'q=LOG', 'q=json', 'difficulty=hard,expert', 'status=approved&difficulty=medium&page=3', 'category=General%20Knowledge']) {
    t = Date.now();
    const r = await admin.req('GET', `/api/admin/challenges?${q}`);
    timings.push(Date.now() - t);
    assert.equal(r.status, 200);
  }
  const all = await admin.req('GET', '/api/admin/challenges?pageSize=10');
  const facets = all.json.facets as { total: number; difficulty: Record<string, number> };
  console.log(`    payload ${(payload.length / 1024).toFixed(0)} KB · preview ${previewMs} ms · publish ${publishMs} ms (${JSON.stringify(pub.json)}) · list/search ${timings.join('/')} ms · pool ${facets.total} · ${JSON.stringify(facets.difficulty)}`);
  assert.ok(previewMs < 10_000 && publishMs < 10_000);
});
