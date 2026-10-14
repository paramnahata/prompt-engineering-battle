import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { paragraphsFromDocumentXml, parseProblemPack, readDocxParagraphs } from '@/lib/round2/pack';

/** Builds a minimal .docx in memory (synthetic content; the real pack is never committed). */
async function docx(paras: [style: string, text: string][], extraXml = ''): Promise<ArrayBuffer> {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const body = paras.map(([style, text]) =>
    `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}${extraXml}</w:body></w:document>`;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file('word/document.xml', xml);
  const u8 = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

const SAMPLE: [string, string][] = [
  ['Title', 'Sample pack'],
  ['Heading1', 'How to use this pack'],
  ['', 'Fairness rule: Do not require the sample wording.'],
  ['Heading1', 'Problem 01: Bakery Pricing'],
  ['', 'Category: Business  |  Difficulty: Hard'],
  ['Heading2', 'A. Main problem statement'],
  ['', 'A bakery sells bread for ₹50 & cakes for ₹400.'],
  ['', 'Second paragraph of the statement.'],
  ['Heading2', 'B. Parallel variant (small change)'],
  ['', 'Bread now costs ₹60 to make.'],
  ['Heading2', 'C. Sample expected prompt'],
  ['', 'Act as a pricing analyst.'],
  ['Heading2', 'D. Expected solution / evaluator flexibility'],
  ['', 'Margin falls; test a modest increase.'],
  ['', '— — — — —'],
  ['Heading1', 'Problem 2: No Variant Here'],
  ['', 'Category: Ops'],
  ['Heading2', 'A. Main problem statement'],
  ['', 'Plan shifts.'],
  ['Heading1', 'Problem 03: Empty'],
  ['Heading2', 'B. Parallel variant'],
  ['', 'Only a variant.'],
  ['Heading1', 'Round 2 evaluator checklist'],
  ['ListBullet', 'Does the prompt define the role?'],
  ['ListBullet', 'Does it flag missing data?'],
  ['Heading1', 'Suggested scoring rubric (10 points)'],
  ['', 'Criterion'], ['', 'Points'], ['', 'What earns full credit'],
  ['', 'Task and context'], ['', '2'], ['', 'Specific role and goal.'],
  ['', 'Output design'], ['', '3'], ['', 'Clear format.'],
  ['', 'Organizer note: keep this private.'],
];

test('parses problems, sections, category/difficulty and the shared rubric from a .docx', async () => {
  const paras = await readDocxParagraphs(await docx(SAMPLE));
  const r = parseProblemPack(paras);
  assert.equal(r.problems.length, 2);
  const [p1, p2] = r.problems;
  assert.equal(p1!.problem_code, 'P01');
  assert.equal(p1!.title, 'Bakery Pricing');
  assert.equal(p1!.category, 'Business');
  assert.equal(p1!.difficulty, 'Hard');
  assert.equal(p1!.problem_statement, 'A bakery sells bread for ₹50 & cakes for ₹400.\n\nSecond paragraph of the statement.');
  assert.equal(p1!.twist_description, 'Bread now costs ₹60 to make.');
  assert.equal(p1!.sample_prompt, 'Act as a pricing analyst.');
  assert.equal(p1!.expected_output, 'Margin falls; test a modest increase.');
  assert.equal(p2!.problem_code, 'P02');
  assert.equal(p2!.twist_description, null);
  assert.ok(r.warnings.some((w) => /P02: no parallel variant/.test(w)));
  assert.ok(r.skipped.some((w) => /Problem 3 .* no main problem statement/.test(w)));
  assert.match(r.criteria, /- Does the prompt define the role\?/);
  assert.match(r.criteria, /- Task and context \(2\): Specific role and goal\./);
  assert.match(r.criteria, /- Output design \(3\): Clear format\./);
  assert.match(r.criteria, /Fairness rule: Do not require the sample wording\./);
  assert.ok(!/Organizer note/.test(r.criteria), 'organizer notes are not copied to the jury');
  assert.equal(p1!.evaluation_criteria, r.criteria);
});

test('plain-text headings (no Word styles), duplicates and XML entities', () => {
  const xml = `<w:body>
    <w:p><w:r><w:t>Problem 7 – Fleet &amp; Fuel</w:t></w:r></w:p>
    <w:p><w:r><w:t>A) Problem statement</w:t></w:r></w:p>
    <w:p><w:r><w:t>Trucks use &lt;20&gt; litres</w:t><w:tab/><w:t>each.</w:t></w:r></w:p>
    <w:p/>
    <w:p><w:r><w:t>B) Twist</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">Fuel price &#8377;110 </w:t></w:r></w:p>
    <w:p><w:r><w:t>Problem 07: Duplicate</w:t></w:r></w:p>
    <w:p><w:r><w:t>A. Main problem statement</w:t></w:r></w:p>
    <w:p><w:r><w:t>Other text</w:t></w:r></w:p>
  </w:body>`;
  const r = parseProblemPack(paragraphsFromDocumentXml(xml));
  assert.equal(r.problems.length, 1);
  assert.equal(r.problems[0]!.title, 'Fleet & Fuel');
  assert.equal(r.problems[0]!.problem_statement, 'Trucks use <20> litres each.');
  assert.equal(r.problems[0]!.twist_description, 'Fuel price ₹110');
  assert.ok(r.skipped.some((s) => /appears more than once/.test(s)));
});

test('rejects non-docx input and reports a document without problems', async () => {
  await assert.rejects(readDocxParagraphs(new TextEncoder().encode('not a zip').buffer as ArrayBuffer), /not a valid \.docx/);
  const zip = new JSZip();
  zip.file('hello.txt', 'x');
  const u8 = await zip.generateAsync({ type: 'uint8array' });
  await assert.rejects(readDocxParagraphs(u8.buffer as ArrayBuffer), /not a Word/);
  const r = parseProblemPack(await readDocxParagraphs(await docx([['', 'Just some notes']])));
  assert.equal(r.problems.length, 0);
  assert.match(r.warnings[0]!, /No problems found/);
});

test('a document that decompresses beyond the size cap is refused', async () => {
  // ~9 MB of highly compressible text compresses to a few KB.
  const big = `<w:p><w:r><w:t>${'a'.repeat(9 * 1024 * 1024)}</w:t></w:r></w:p>`;
  const data = await docx([], big);
  assert.ok(data.byteLength < 200_000, `compressed size ${data.byteLength}`);
  await assert.rejects(readDocxParagraphs(data), /too large/);
});
