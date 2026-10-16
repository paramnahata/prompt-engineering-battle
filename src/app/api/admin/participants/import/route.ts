import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { MAX_CSV_BYTES, parseParticipantsCsv, type FieldKey } from '@/lib/csv/import';
import { jsonError, jsonOk, readJson, serverError } from '@/lib/http';
import { limitAction } from '@/lib/ops/rate-limit';
import { applyUpdates, planUpdates } from '@/lib/csv/update-existing';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const fieldKeys = ['sr_no', 'registration_id', 'full_name', 'team_name', 'phone', 'email', 'gender', 'college', 'city',
  'branch', 'study_year', 'registered_at', 'member2_name', 'member2_email', 'member2_phone'] as const satisfies readonly FieldKey[];

const bodySchema = z.object({
  csvText: z.string().min(1).max(MAX_CSV_BYTES),
  mapping: z.record(z.enum(fieldKeys), z.string().max(200)).optional(),
  mode: z.enum(['preview', 'confirm']),
});

/**
 * Two-step import. The server always parses the raw CSV itself (the
 * browser's preview is never trusted). "confirm" re-parses, inserts all
 * valid, not-yet-imported entries in one transaction, and fills in changed or
 * missing details for teams that already exist (src/lib/csv/update-existing.ts).
 * Re-importing an unchanged file is a no-op.
 */
export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, bodySchema, MAX_CSV_BYTES + 64 * 1024);
  if (!body.ok) return body.response;
  try {
    const limited = await limitAction(`participant-import:${auth.session.userId}`, 30, 300);
    if (limited) return limited;
  } catch (err) {
    return serverError('participant-import rate limit', err);
  }

  const preview = parseParticipantsCsv(body.data.csvText, body.data.mapping ?? {});
  if (preview.fileErrors.length) return jsonError(preview.fileErrors.join(' '), 422, { headers: preview.headers, mapping: preview.mapping });

  try {
    const db = supabaseAdmin();
    const ids = preview.entries.map((e) => e.registration_id);
    const existing = new Set<string>();
    for (let i = 0; i < ids.length; i += 500) {
      const { data, error } = await db.from('entries').select('registration_id').in('registration_id', ids.slice(i, i + 500));
      if (error) throw error;
      for (const row of data ?? []) existing.add(row.registration_id);
    }

    const toImport = preview.validEntries.filter((e) => !existing.has(e.registration_id));
    const updates = await planUpdates(db, preview.validEntries.filter((e) => existing.has(e.registration_id)));
    const updateIds = new Set(updates.map((u) => u.registrationId));

    if (body.data.mode === 'preview') {
      return jsonOk({
        headers: preview.headers,
        mapping: preview.mapping,
        headerRow: preview.headerRow,
        totalDataRows: preview.totalDataRows,
        totals: {
          entries: preview.entries.length,
          members: preview.entries.reduce((n, e) => n + e.members.length, 0),
          valid: preview.validEntries.length,
          invalid: preview.invalidEntries.length,
          alreadyImported: preview.validEntries.length - toImport.length,
          toImport: toImport.length,
          toUpdate: updates.length,
        },
        warnings: preview.warnings,
        entries: preview.entries.slice(0, 1000).map((e) => ({
          registrationId: e.registration_id,
          registrationIdGenerated: e.registration_id_generated,
          teamName: e.team_name,
          firstRow: e.first_row,
          members: e.members,
          errors: e.errors,
          warnings: e.warnings,
          alreadyImported: existing.has(e.registration_id),
          willUpdate: updateIds.has(e.registration_id),
        })),
      });
    }

    if (preview.invalidEntries.length > 0) {
      return jsonError(`${preview.invalidEntries.length} entr${preview.invalidEntries.length === 1 ? 'y has' : 'ies have'} errors. Fix the sheet (or the column mapping) and preview again.`, 422);
    }
    const updated = updates.length ? await applyUpdates(db, updates) : 0;
    if (updated) {
      const { error: auditError } = await db.from('admin_actions').insert({ admin_id: auth.session.userId, action: 'csv_update_existing', new_value: { updated } });
      if (auditError) console.error('Could not write the CSV update audit event.');
    }
    if (toImport.length === 0) return jsonOk({ ok: true, imported: 0, updated, skippedExisting: preview.validEntries.length - updated });

    const payload = toImport.map((e) => ({ registration_id: e.registration_id, team_name: e.team_name, members: e.members }));
    const { data, error } = await db.rpc('import_participants', { p_entries: payload, p_admin: auth.session.userId });
    if (error) throw error;
    return jsonOk({ ...data, updated, skippedExisting: Math.max(0, Number(data?.skippedExisting ?? 0)) + (existing.size - updated) });
  } catch (err) {
    return serverError('participant import', err, 'Import failed. Nothing was partially saved — please retry.');
  }
}
