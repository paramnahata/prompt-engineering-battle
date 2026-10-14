/**
 * Round 2 problem pack (.docx) reader.
 *
 * Runs in the admin's browser (like the challenge-pool .xlsx import): only
 * the extracted text is sent to the server, which validates it again.
 *
 * Expected layout (headings may be Word heading styles or plain lines):
 *   Problem 01: Bakery Pricing
 *   Category: Business strategy | Difficulty: Hard
 *   A. Main problem statement          → shown to the team
 *   B. Parallel variant (small change) → that team's surprise twist
 *   C. Sample expected prompt          → jury and AI reference only
 *   D. Expected solution / evaluator…  → jury and AI reference only
 * Sections after the problems ("…checklist", "…rubric") and a "Fairness
 * rule" paragraph become the shared evaluation criteria.
 */

import type JSZip from 'jszip';

export interface Para { style: string; text: string }

export interface PackProblem {
  problem_code: string;
  title: string;
  category: string | null;
  difficulty: string | null;
  problem_statement: string;
  twist_description: string | null;
  sample_prompt: string | null;
  expected_output: string | null;
  evaluation_criteria: string | null;
}

export interface ParsedPack { problems: PackProblem[]; criteria: string; warnings: string[]; skipped: string[] }

const MAX_DOC_XML = 8 * 1024 * 1024;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Extracts paragraphs (style + plain text) from word/document.xml. Table cells come out as their own paragraphs, in order. */
export function paragraphsFromDocumentXml(xml: string): Para[] {
  const out: Para[] = [];
  const paraRe = /<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g;
  for (let m = paraRe.exec(xml); m; m = paraRe.exec(xml)) {
    const inner = m[1] ?? '';
    const style = /<w:pStyle\s+w:val="([^"]*)"/.exec(inner)?.[1] ?? '';
    let text = '';
    const tokenRe = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:(?:br|cr)(?:\s[^>]*)?\/>/g;
    for (let t = tokenRe.exec(inner); t; t = tokenRe.exec(inner)) {
      if (t[1] !== undefined) text += decodeXml(t[1]);
      else text += t[0].startsWith('<w:tab') ? '\t' : '\n';
    }
    out.push({ style, text: text.replace(/[ \t ]+/g, ' ').trim() });
  }
  return out;
}

/** Reads the paragraphs of a .docx file. */
export async function readDocxParagraphs(data: ArrayBuffer): Promise<Para[]> {
  const JSZip = (await import('jszip')).default;
  let zip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new Error('This file is not a valid .docx document.');
  }
  const doc = zip.file('word/document.xml');
  if (!doc) throw new Error('This file is not a Word (.docx) document.');
  const xml = await readCapped(doc, MAX_DOC_XML);
  return paragraphsFromDocumentXml(xml);
}

interface StreamHelper {
  on(event: 'data', fn: (chunk: string) => void): StreamHelper;
  on(event: 'error', fn: (e: Error) => void): StreamHelper;
  on(event: 'end', fn: () => void): StreamHelper;
  pause(): StreamHelper;
  resume(): StreamHelper;
}
/** JSZip objects have internalStream() at runtime, but it is missing from the published typings. */
function hasInternalStream(o: object): o is { internalStream(type: 'string'): StreamHelper } {
  return typeof (o as { internalStream?: unknown }).internalStream === 'function';
}

/** Decompresses with a size cap so a malformed or hostile file cannot exhaust memory. */
async function readCapped(entry: JSZip.JSZipObject, max: number): Promise<string> {
  if (!hasInternalStream(entry)) {
    const all = await entry.async('string');
    if (all.length > max) throw new Error('The document is too large to import.');
    return all;
  }
  const stream = entry.internalStream('string');
  return new Promise((resolve, reject) => {
    let size = 0;
    let failed = false;
    const parts: string[] = [];
    stream.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > max) {
        failed = true;
        stream.pause();
        reject(new Error('The document is too large to import.'));
        return;
      }
      parts.push(chunk);
    });
    stream.on('error', (e) => reject(e));
    stream.on('end', () => resolve(parts.join('')));
    stream.resume();
  });
}

const PROBLEM_RE = /^problem\s*(?:no\.?\s*)?(\d{1,3})\s*[:.\-–—)]\s*(.+)$/i;
const SECTION_RE = /^([A-D])\s*[.)]\s*(.*)$/;
const SEPARATOR_RE = /^[\s—–\-_•·*=~]+$/;

type Section = 'statement' | 'twist' | 'sample' | 'solution';
function sectionOf(letter: string, label: string): Section | null {
  const l = label.toLowerCase();
  if (/variant|twist|change/.test(l)) return 'twist';
  if (/sample|expected prompt|reference prompt/.test(l)) return 'sample';
  if (/solution|evaluator|answer key|flexibility/.test(l)) return 'solution';
  if (/problem|statement|scenario|brief/.test(l)) return 'statement';
  return ({ A: 'statement', B: 'twist', C: 'sample', D: 'solution' } as Record<string, Section>)[letter] ?? null;
}

const isHeading = (p: Para) => /^(heading|title)/i.test(p.style);

/** Turns the paragraphs of a problem pack into importable problems. */
export function parseProblemPack(paras: Para[]): ParsedPack {
  const problems: PackProblem[] = [];
  const warnings: string[] = [];
  const skipped: string[] = [];
  const appendix = new Map<string, string[]>();
  const intro: string[] = [];
  let cur: { num: number; title: string; category: string | null; difficulty: string | null; parts: Record<Section, string[]> } | null = null;
  let section: Section | null = null;
  let appendixKey: string | null = null;
  const seen = new Set<string>();

  const close = () => {
    if (!cur) return;
    const code = `P${String(cur.num).padStart(2, '0')}`;
    const join = (s: Section) => cur!.parts[s].join('\n\n').trim();
    const statement = join('statement');
    if (seen.has(code)) {
      skipped.push(`Problem ${cur.num} appears more than once; only the first is used.`);
    } else if (!statement) {
      skipped.push(`Problem ${cur.num} (“${cur.title}”) has no main problem statement and was skipped.`);
    } else {
      seen.add(code);
      const twist = join('twist');
      if (!twist) warnings.push(`${code}: no parallel variant, so this problem has no twist.`);
      if (!join('sample')) warnings.push(`${code}: no sample prompt for the jury.`);
      if (!join('solution')) warnings.push(`${code}: no expected solution for the jury.`);
      problems.push({
        problem_code: code, title: cur.title.slice(0, 200), category: cur.category, difficulty: cur.difficulty,
        problem_statement: statement.slice(0, 10_000), twist_description: twist ? twist.slice(0, 10_000) : null,
        sample_prompt: join('sample').slice(0, 10_000) || null, expected_output: join('solution').slice(0, 10_000) || null,
        evaluation_criteria: null,
      });
    }
    cur = null;
    section = null;
  };

  for (const p of paras) {
    const text = p.text.trim();
    if (!text || SEPARATOR_RE.test(text)) continue;
    const prob = PROBLEM_RE.exec(text);
    if (prob && (isHeading(p) || text.length < 160)) {
      close();
      appendixKey = null;
      cur = { num: Number(prob[1]), title: prob[2]!.trim(), category: null, difficulty: null, parts: { statement: [], twist: [], sample: [], solution: [] } };
      continue;
    }
    if (isHeading(p) && /^heading\s*1$|^title$/i.test(p.style)) {
      // Any other top-level heading ends the current problem.
      close();
      appendixKey = text;
      appendix.set(text, []);
      continue;
    }
    if (cur) {
      if (/^category\s*:/i.test(text) && section === null) {
        for (const part of text.split('|')) {
          const [k, ...v] = part.split(':');
          const value = v.join(':').trim();
          if (/category/i.test(k ?? '')) cur.category = value.slice(0, 120) || null;
          if (/difficulty|level/i.test(k ?? '')) cur.difficulty = value.slice(0, 60) || null;
        }
        continue;
      }
      const sec = SECTION_RE.exec(text);
      if (sec && (isHeading(p) || text.length < 90)) {
        const s = sectionOf(sec[1]!, sec[2] ?? '');
        if (s) { section = s; continue; }
      }
      if (section) cur.parts[section].push(text);
      else cur.parts.statement.push(text);
      continue;
    }
    if (appendixKey) appendix.get(appendixKey)!.push(text);
    else intro.push(text);
  }
  close();

  const blocks: string[] = [];
  for (const [heading, lines] of appendix) {
    if (!lines.length) continue;
    if (/rubric|scoring/i.test(heading)) {
      const tableHeader = /criterion/i.test(lines[0] ?? '') && /points?|marks?/i.test(lines[1] ?? '');
      let rows: string[];
      if (tableHeader) {
        rows = [];
        let i = 3;
        for (; i + 2 < lines.length && /^\d+(\.\d+)?$/.test(lines[i + 1] ?? ''); i += 3) rows.push(`- ${lines[i]} (${lines[i + 1]}): ${lines[i + 2]}`);
        rows.push(...lines.slice(i));
      } else {
        rows = lines.map((l) => `- ${l}`);
      }
      // A trailing organizer note is for organizers, not the jury.
      blocks.push(`${heading}\n${rows.filter((r) => !/organi[sz]er note/i.test(r)).join('\n')}`);
    } else if (/checklist|evaluat|judg/i.test(heading)) {
      blocks.push(`${heading}\n${lines.map((l) => `- ${l}`).join('\n')}`);
    }
  }
  const fairness = [...intro, ...[...appendix.values()].flat()].find((l) => /^fairness/i.test(l));
  if (fairness) blocks.push(fairness);
  const criteria = blocks.join('\n\n').slice(0, 5000);
  for (const p of problems) p.evaluation_criteria = criteria || null;
  if (problems.length === 0) warnings.unshift('No problems found. Each problem must start with a line like “Problem 01: Title”.');
  return { problems, criteria, warnings, skipped };
}
