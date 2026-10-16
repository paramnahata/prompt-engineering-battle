import type { SupabaseClient } from '@supabase/supabase-js';
import type { ImportEntry, ImportMember } from '@/lib/csv/import';

/**
 * Re-uploading the participant sheet fills in details for teams that already
 * exist (matched by registration ID): a blank or changed email, phone, team
 * name, college… is updated, and a missing second member is added. Nothing is
 * ever removed, entry numbers never change, and a blank cell never erases a
 * stored value.
 */
const MEMBER_FIELDS = ['full_name', 'email', 'phone', 'gender', 'college', 'city', 'branch', 'study_year'] as const;
type MemberField = (typeof MEMBER_FIELDS)[number];

interface StoredMember { id: string; entry_id: string; member_position: number; full_name: string | null; email: string | null; phone: string | null; gender: string | null; college: string | null; city: string | null; branch: string | null; study_year: string | null }
interface StoredEntry { id: string; registration_id: string; team_name: string | null; members: StoredMember[] }

export interface EntryUpdate {
  entryId: string;
  registrationId: string;
  teamName?: string;
  memberPatches: { memberId: string; patch: Partial<Record<MemberField, string>> }[];
  newMembers: ImportMember[];
  memberCount: number;
}

async function loadExisting(db: SupabaseClient, ids: string[]): Promise<Map<string, StoredEntry>> {
  const out = new Map<string, StoredEntry>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error } = await db.from('entries').select('id, registration_id, team_name').in('registration_id', ids.slice(i, i + 300));
    if (error) throw error;
    for (const e of data ?? []) out.set(e.registration_id, { ...e, members: [] });
  }
  const byId = new Map([...out.values()].map((e) => [e.id, e]));
  const entryIds = [...byId.keys()];
  for (let i = 0; i < entryIds.length; i += 300) {
    const { data, error } = await db.from('team_members')
      .select('id, entry_id, member_position, full_name, email, phone, gender, college, city, branch, study_year')
      .in('entry_id', entryIds.slice(i, i + 300));
    if (error) throw error;
    for (const m of (data ?? []) as StoredMember[]) byId.get(m.entry_id)?.members.push(m);
  }
  return out;
}

export function diffEntry(stored: StoredEntry, incoming: ImportEntry): EntryUpdate | null {
  const update: EntryUpdate = { entryId: stored.id, registrationId: stored.registration_id, memberPatches: [], newMembers: [], memberCount: stored.members.length };
  const team = incoming.team_name.trim();
  if (team && team !== (stored.team_name ?? '')) update.teamName = team;
  for (const m of incoming.members) {
    const existing = stored.members.find((s) => s.member_position === m.position);
    if (!existing) {
      if (stored.members.length + update.newMembers.length < 2) update.newMembers.push(m);
      continue;
    }
    const patch: Partial<Record<MemberField, string>> = {};
    for (const f of MEMBER_FIELDS) {
      const v = String(m[f] ?? '').trim();
      if (v && v !== (existing[f] ?? '')) patch[f] = v;
    }
    if (Object.keys(patch).length) update.memberPatches.push({ memberId: existing.id, patch });
  }
  update.memberCount = stored.members.length + update.newMembers.length;
  return update.teamName !== undefined || update.memberPatches.length || update.newMembers.length ? update : null;
}

export async function planUpdates(db: SupabaseClient, entries: ImportEntry[]): Promise<EntryUpdate[]> {
  const stored = await loadExisting(db, entries.map((e) => e.registration_id));
  const updates: EntryUpdate[] = [];
  for (const e of entries) {
    const s = stored.get(e.registration_id);
    if (!s) continue;
    const u = diffEntry(s, e);
    if (u) updates.push(u);
  }
  return updates;
}

export async function applyUpdates(db: SupabaseClient, updates: EntryUpdate[]): Promise<number> {
  let applied = 0;
  for (const u of updates) {
    if (u.teamName !== undefined || u.newMembers.length) {
      const patch: Record<string, unknown> = {};
      if (u.teamName !== undefined) patch.team_name = u.teamName;
      if (u.newMembers.length) patch.is_team = u.memberCount > 1;
      const { error } = await db.from('entries').update(patch).eq('id', u.entryId);
      if (error) throw error;
    }
    for (const p of u.memberPatches) {
      const { error } = await db.from('team_members').update(p.patch).eq('id', p.memberId);
      if (error) throw error;
    }
    if (u.newMembers.length) {
      const { error } = await db.from('team_members').insert(u.newMembers.map((m) => ({
        entry_id: u.entryId, member_position: m.position, full_name: m.full_name,
        email: m.email || null, phone: m.phone || null, gender: m.gender || null, college: m.college || null,
        city: m.city || null, branch: m.branch || null, study_year: m.study_year || null, source_row: m.source_row,
      })));
      if (error) throw error;
    }
    applied += 1;
  }
  return applied;
}
