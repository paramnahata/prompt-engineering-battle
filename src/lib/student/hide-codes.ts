/**
 * Students never see internal problem-statement IDs (e.g. "CRW-016", "P04").
 * Applied to every student API response that carries challenge or problem data:
 * removes code fields from nested objects and strips a leading ID from titles
 * ("CRW-003: Creative writing" → "Creative writing").
 */
const CODE_KEYS = new Set(['code', 'challenge_code', 'problem_code', 'source_ref', 'challengeCode', 'problemCode']);
const LEADING_ID = /^\s*[A-Za-z]{1,6}[-_ ]?\d{1,4}\s*[:\-–—·|.)]\s*/;

export function stripLeadingId(title: string): string {
  const stripped = title.replace(LEADING_ID, '').trim();
  return stripped || title;
}

function walk(value: unknown, depth: number): unknown {
  if (Array.isArray(value)) return value.map((v) => walk(v, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    // Top-level "code" is an error/status code, not a problem ID; nested ones are IDs.
    if (depth > 0 && CODE_KEYS.has(k)) continue;
    out[k] = (k === 'title' || k === 'twist_title') && typeof v === 'string' ? stripLeadingId(v) : walk(v, depth + 1);
  }
  return out;
}

export function hideProblemCodes<T>(data: T): T {
  return walk(data, 0) as T;
}
