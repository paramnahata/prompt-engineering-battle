/**
 * Entry numbers are what people see and type: 1, 2, 3 …
 * `entries.entry_code` (ENTRY-001) is kept in the database for backwards
 * compatibility but is never shown or required in the UI.
 */

export function formatEntryNumber(entry: { entry_number?: number | null; entry_code?: string | null }): string {
  if (typeof entry.entry_number === 'number' && Number.isFinite(entry.entry_number)) return String(entry.entry_number);
  const digits = entry.entry_code?.match(/(\d+)\s*$/)?.[1];
  return digits ? String(Number(digits)) : entry.entry_code ?? '—';
}

/**
 * Accepts what a student might type — "7", " 07 ", "#7", "ENTRY-007",
 * "entry 7" — and returns the integer entry number, or null.
 */
export function parseEntryNumberInput(raw: string): number | null {
  const cleaned = raw.trim().toUpperCase().replace(/^#/, '').replace(/^ENTRY[\s-]*/, '');
  if (!/^\d{1,5}$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return n >= 1 && n <= 99999 ? n : null;
}
