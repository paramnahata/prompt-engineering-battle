/**
 * Instant, local participant search for the registration desk.
 * Case-insensitive, whitespace-tolerant, every typed word must match
 * somewhere (name, team, entry number, email, phone, registration ID).
 * Exact entry-number matches rank first, then prefix matches on names.
 */

export interface SearchableMember {
  full_name: string;
  email?: string | null;
  phone?: string | null;
}
export interface SearchableEntry {
  entry_number: number;
  registration_id?: string | null;
  team_name?: string | null;
  team_members?: SearchableMember[] | null;
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

function haystack(e: SearchableEntry): string {
  const parts = [String(e.entry_number), e.registration_id ?? '', e.team_name ?? ''];
  for (const m of e.team_members ?? []) {
    parts.push(m.full_name, m.email ?? '', m.phone ?? '', (m.phone ?? '').replace(/\D/g, ''));
  }
  return norm(parts.join(' | '));
}

export function searchParticipants<T extends SearchableEntry>(entries: T[], rawQuery: string, limit = 8): T[] {
  const q = norm(rawQuery.replace(/^#/, ''));
  if (!q) return [];
  const tokens = q.split(' ').filter(Boolean);
  const numeric = /^\d+$/.test(q) ? Number(q) : null;

  const scored: { e: T; score: number }[] = [];
  for (const e of entries) {
    const hay = haystack(e);
    if (!tokens.every((t) => hay.includes(t))) continue;
    let score = 0;
    if (numeric !== null && e.entry_number === numeric) score += 1000;
    else if (numeric !== null && String(e.entry_number).startsWith(q)) score += 300;
    const names = [e.team_name ?? '', ...(e.team_members ?? []).map((m) => m.full_name)].map(norm);
    if (names.some((n) => n.startsWith(q))) score += 200;
    if (names.some((n) => n.split(' ').some((w) => w.startsWith(tokens[0] ?? '')))) score += 100;
    scored.push({ e, score });
  }
  scored.sort((a, b) => b.score - a.score || a.e.entry_number - b.e.entry_number);
  return scored.slice(0, limit).map((s) => s.e);
}

export function matchesFilter(entry: SearchableEntry, rawQuery: string): boolean {
  const q = norm(rawQuery.replace(/^#/, ''));
  if (!q) return true;
  const hay = haystack(entry);
  return q.split(' ').every((t) => hay.includes(t));
}
