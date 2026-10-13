/**
 * Problem-statement (challenge) import from Excel/CSV.
 *
 * The browser reads the workbook (all sheets) into plain string grids and
 * sends them; the server runs this parser, so validation never trusts the
 * client. Built around the organisers' workbook ("Round 1 Task Allocation"):
 * one sheet per author with headers like `PS ID: | Category: | Difficulty: |
 * Challenge Prompt: | Expected Output: | Evaluation Criteria:` plus summary
 * sheets and side tables that must be ignored. Headers are matched
 * flexibly and can be overridden by the admin.
 */

export const MAX_SHEETS = 30;
export const MAX_TOTAL_ROWS = 5000;
export const MAX_TEXT = 10_000;

export type ChallengeField =
  | 'challenge_code' | 'title' | 'category' | 'difficulty' | 'problem_statement' | 'expected_output'
  | 'evaluation_criteria' | 'instructions' | 'constraints' | 'prompt_word_limit' | 'output_char_limit';

export const CHALLENGE_FIELDS: { key: ChallengeField; label: string; required?: boolean }[] = [
  { key: 'challenge_code', label: 'PS ID / challenge code', required: true },
  { key: 'problem_statement', label: 'Problem statement / challenge prompt', required: true },
  { key: 'title', label: 'Title (optional — derived if missing)' },
  { key: 'category', label: 'Category' },
  { key: 'difficulty', label: 'Difficulty' },
  { key: 'expected_output', label: 'Expected output' },
  { key: 'evaluation_criteria', label: 'Evaluation criteria' },
  { key: 'instructions', label: 'Instructions' },
  { key: 'constraints', label: 'Constraints' },
  { key: 'prompt_word_limit', label: 'Prompt word limit' },
  { key: 'output_char_limit', label: 'Output character limit' },
];

const ALIASES: Record<ChallengeField, string[]> = {
  challenge_code: ['psid', 'psno', 'id', 'challengeid', 'challengecode', 'code', 'questionid', 'taskid', 'problemid', 'promptid'],
  title: ['title', 'challengetitle', 'questiontitle', 'name', 'heading'],
  category: ['category', 'type', 'topic', 'domain', 'subcategory'],
  difficulty: ['difficulty', 'level', 'difficultylevel', 'complexity'],
  problem_statement: ['challengeprompt', 'problemstatement', 'prompt', 'question', 'challenge', 'task', 'description', 'problem', 'ps', 'statement'],
  expected_output: ['expectedoutput', 'output', 'expectedanswer', 'answer', 'sampleoutput', 'expectedresult'],
  evaluation_criteria: ['evaluationcriteria', 'criteria', 'rubric', 'evaluation', 'markingscheme', 'scoringcriteria'],
  instructions: ['instructions', 'instruction', 'notes'],
  constraints: ['constraints', 'constraint', 'rules', 'limitations'],
  prompt_word_limit: ['wordlimit', 'promptwordlimit', 'maxwords', 'promptlimit'],
  output_char_limit: ['charlimit', 'outputcharlimit', 'maxcharacters', 'characterlimit', 'outputlimit'],
};

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert' | 'unrated';

export interface SheetInput { name: string; rows: string[][] }
export type ChallengeMapping = Partial<Record<ChallengeField, string>>;

export interface ParsedChallenge {
  challenge_code: string;
  title: string;
  category: string | null;
  difficulty: Difficulty;
  problem_statement: string;
  expected_output: string | null;
  evaluation_criteria: string | null;
  instructions: string | null;
  constraints: string | null;
  prompt_word_limit: number | null;
  output_char_limit: number | null;
  source_ref: string;
}

export interface RowIssue { source_ref: string; code?: string; message: string }

export interface SheetSummary { name: string; used: boolean; reason?: string; headerRow?: number; mapping?: ChallengeMapping; rows: number }

export interface ChallengeImportResult {
  sheets: SheetSummary[];
  challenges: ParsedChallenge[];
  errors: RowIssue[];
  warnings: RowIssue[];
  difficultyCounts: Record<Difficulty, number>;
  categoryCounts: Record<string, number>;
}

export const normHeader = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
const clean = (v: unknown) => String(v ?? '').replace(/ /g, ' ').replace(/\r\n?/g, '\n').trim();

export function normalizeDifficulty(raw: string): { value: Difficulty; recognised: boolean } {
  const v = raw.trim().toLowerCase().replace(/[^a-z]/g, '');
  if (!v) return { value: 'unrated', recognised: true };
  if (['easy', 'e', 'beginner', 'basic', 'simple', 'low'].includes(v)) return { value: 'easy', recognised: true };
  if (['medium', 'mid', 'med', 'moderate', 'intermediate', 'm', 'average'].includes(v)) return { value: 'medium', recognised: true };
  if (['hard', 'h', 'difficult', 'tough', 'high', 'advanced'].includes(v)) return { value: 'hard', recognised: true };
  if (['expert', 'veryhard', 'extreme', 'insane', 'x'].includes(v)) return { value: 'expert', recognised: true };
  return { value: 'unrated', recognised: false };
}

/** Uppercase, no whitespace ("BUS -001" → "BUS-001"). */
export function normalizeCode(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}
const CODE_RE = /^[A-Z0-9][A-Z0-9_.\-/]{0,39}$/;

function autoMap(headers: string[]): ChallengeMapping {
  const mapping: ChallengeMapping = {};
  const used = new Set<number>();
  for (const { key } of CHALLENGE_FIELDS) {
    const idx = headers.findIndex((h, i) => !used.has(i) && h && ALIASES[key].includes(normHeader(h)));
    if (idx >= 0) {
      mapping[key] = headers[idx]!;
      used.add(idx);
    }
  }
  return mapping;
}

function findHeaderRow(rows: string[][], overrides: ChallengeMapping): number {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const headers = (rows[i] ?? []).map(clean);
    const m = { ...autoMap(headers), ...pickOverrides(headers, overrides) };
    if (m.challenge_code && m.problem_statement) return i;
  }
  return -1;
}

function pickOverrides(headers: string[], overrides: ChallengeMapping): ChallengeMapping {
  const out: ChallengeMapping = {};
  for (const [k, v] of Object.entries(overrides) as [ChallengeField, string | undefined][]) {
    if (v && headers.includes(v)) out[k] = v;
  }
  return out;
}

function toLimit(raw: string, min: number, max: number): number | null | 'invalid' {
  if (!raw) return null;
  const n = Number(raw.replace(/[, ]/g, ''));
  if (!Number.isInteger(n) || n < min || n > max) return 'invalid';
  return n;
}

export function parseChallengeSheets(
  sheets: SheetInput[],
  options: { mapping?: ChallengeMapping; excludedSheets?: string[] } = {},
): ChallengeImportResult {
  const overrides = options.mapping ?? {};
  const excluded = new Set(options.excludedSheets ?? []);
  const errors: RowIssue[] = [];
  const warnings: RowIssue[] = [];
  const summaries: SheetSummary[] = [];
  const challenges: ParsedChallenge[] = [];
  const firstSeen = new Map<string, string>();

  if (sheets.length > MAX_SHEETS) {
    errors.push({ source_ref: 'file', message: `The workbook has ${sheets.length} sheets; the limit is ${MAX_SHEETS}.` });
    return finish();
  }
  const totalRows = sheets.reduce((n, s) => n + s.rows.length, 0);
  if (totalRows > MAX_TOTAL_ROWS) {
    errors.push({ source_ref: 'file', message: `The file has ${totalRows} rows; the limit is ${MAX_TOTAL_ROWS}.` });
    return finish();
  }

  for (const sheet of sheets) {
    if (excluded.has(sheet.name)) {
      summaries.push({ name: sheet.name, used: false, reason: 'Excluded by you', rows: 0 });
      continue;
    }
    const headerIndex = findHeaderRow(sheet.rows, overrides);
    if (headerIndex < 0) {
      summaries.push({ name: sheet.name, used: false, reason: 'No PS ID and problem-statement columns found (summary or notes sheet)', rows: 0 });
      continue;
    }
    const headers = (sheet.rows[headerIndex] ?? []).map(clean);
    const mapping: ChallengeMapping = { ...autoMap(headers), ...pickOverrides(headers, overrides) };
    for (const [k, v] of Object.entries(overrides) as [ChallengeField, string | undefined][]) if (v === '') delete mapping[k];
    const col = (k: ChallengeField) => (mapping[k] ? headers.indexOf(mapping[k]!) : -1);
    const idx = Object.fromEntries(CHALLENGE_FIELDS.map(({ key }) => [key, col(key)])) as Record<ChallengeField, number>;
    const get = (row: string[], k: ChallengeField) => (idx[k] >= 0 ? clean(row[idx[k]]) : '');

    let count = 0;
    sheet.rows.slice(headerIndex + 1).forEach((row, i) => {
      const ref = `${sheet.name} · row ${headerIndex + i + 2}`;
      const rawCode = get(row, 'challenge_code');
      const statement = get(row, 'problem_statement');
      if (!rawCode && !statement) return; // blank or side-table row
      if (!rawCode) { errors.push({ source_ref: ref, message: 'Problem statement has no PS ID.' }); return; }
      const code = normalizeCode(rawCode);
      if (!statement) { errors.push({ source_ref: ref, code, message: `${code} has no problem statement.` }); return; }
      if (!CODE_RE.test(code)) { errors.push({ source_ref: ref, code, message: `"${rawCode}" is not a usable PS ID (letters, digits, - _ . / only, max 40).` }); return; }
      if (code !== rawCode.trim().toUpperCase()) warnings.push({ source_ref: ref, code, message: `PS ID "${rawCode}" normalised to "${code}".` });
      if (/--/.test(code)) warnings.push({ source_ref: ref, code, message: `PS ID "${code}" contains a double dash — check it.` });
      const prev = firstSeen.get(code);
      if (prev) { errors.push({ source_ref: ref, code, message: `Duplicate PS ID ${code} (first used at ${prev}). Rename one of them.` }); return; }
      firstSeen.set(code, ref);

      const fields = { statement, expected: get(row, 'expected_output'), criteria: get(row, 'evaluation_criteria'), instructions: get(row, 'instructions'), constraints: get(row, 'constraints') };
      if (Object.values(fields).some((v) => v.length > MAX_TEXT)) { errors.push({ source_ref: ref, code, message: `${code}: a text cell is longer than ${MAX_TEXT} characters.` }); return; }

      const rawDifficulty = get(row, 'difficulty');
      const diff = normalizeDifficulty(rawDifficulty);
      if (!rawDifficulty) warnings.push({ source_ref: ref, code, message: `${code} has no difficulty — imported as "unrated" (not eligible until you rate it).` });
      else if (!diff.recognised) warnings.push({ source_ref: ref, code, message: `${code}: difficulty "${rawDifficulty}" not recognised — imported as "unrated".` });

      const category = get(row, 'category').replace(/\s+/g, ' ') || null;
      if (!category) warnings.push({ source_ref: ref, code, message: `${code} has no category.` });
      if (!fields.expected) warnings.push({ source_ref: ref, code, message: `${code} has no expected output.` });
      if (!fields.criteria) warnings.push({ source_ref: ref, code, message: `${code} has no evaluation criteria.` });

      const words = toLimit(get(row, 'prompt_word_limit'), 10, 2000);
      const chars = toLimit(get(row, 'output_char_limit'), 100, 50_000);
      if (words === 'invalid') warnings.push({ source_ref: ref, code, message: `${code}: word limit ignored (must be 10–2000).` });
      if (chars === 'invalid') warnings.push({ source_ref: ref, code, message: `${code}: character limit ignored (must be 100–50000).` });

      const title = get(row, 'title').slice(0, 200) || `${category ?? 'Challenge'} · ${code}`;
      challenges.push({
        challenge_code: code, title, category, difficulty: diff.value, problem_statement: fields.statement,
        expected_output: fields.expected || null, evaluation_criteria: fields.criteria || null,
        instructions: fields.instructions || null, constraints: fields.constraints || null,
        prompt_word_limit: typeof words === 'number' ? words : null, output_char_limit: typeof chars === 'number' ? chars : null,
        source_ref: ref,
      });
      count += 1;
    });
    summaries.push({ name: sheet.name, used: true, headerRow: headerIndex + 1, mapping, rows: count });
  }

  // Unify category spelling that differs only by case/spacing ("content generation" vs "Content Generation"):
  // keep the most frequent spelling. Different words (typos) are left for the admin to edit.
  const groups = new Map<string, Map<string, number>>();
  for (const c of challenges) {
    if (!c.category) continue;
    const key = c.category.toLowerCase();
    const g = groups.get(key) ?? new Map<string, number>();
    g.set(c.category, (g.get(c.category) ?? 0) + 1);
    groups.set(key, g);
  }
  const canonical = new Map<string, string>();
  for (const [key, g] of groups) {
    const best = [...g.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
    canonical.set(key, best);
    if (g.size > 1) warnings.push({ source_ref: 'file', message: `Category spellings ${[...g.keys()].map((x) => `"${x}"`).join(', ')} unified as "${best}".` });
  }
  for (const c of challenges) if (c.category) {
    const best = canonical.get(c.category.toLowerCase())!;
    if (best !== c.category) {
      if (c.title.startsWith(`${c.category} · `)) c.title = `${best} · ${c.challenge_code}`;
      c.category = best;
    }
  }
  return finish();

  function finish(): ChallengeImportResult {
    const difficultyCounts: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0, expert: 0, unrated: 0 };
    const categoryCounts: Record<string, number> = {};
    for (const c of challenges) {
      difficultyCounts[c.difficulty] += 1;
      const cat = c.category ?? '(none)';
      categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;
    }
    return { sheets: summaries, challenges, errors, warnings, difficultyCounts, categoryCounts };
  }
}

/** Fields compared to decide whether an existing challenge changes on publish. */
export const COMPARED_FIELDS = ['title', 'category', 'difficulty', 'problem_statement', 'expected_output', 'evaluation_criteria', 'instructions', 'constraints'] as const;
