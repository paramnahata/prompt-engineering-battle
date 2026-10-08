import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAnyRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { applyMappingAndValidate, nextEntryCode } from '@/lib/csv/import';

const bodySchema = z.object({
  csvText: z.string().min(1),
  mapping: z.object({
    registration_id: z.string(),
    team_name: z.string().optional(),
    member1_name: z.string(),
    member1_email: z.string().optional(),
    member2_name: z.string().optional(),
    member2_email: z.string().optional(),
  }),
  mode: z.enum(['preview', 'confirm']),
});

export async function POST(req: NextRequest) {
  const session = requireAnyRole(['admin', 'volunteer']);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { csvText, mapping, mode } = parsed.data;

  // payment_status is intentionally not collected — every participant is
  // treated as already paid (see nextEntryCode/mapping: this event doesn't
  // track payment through the CSV import at all).
  const preview = applyMappingAndValidate(csvText, { ...mapping, payment_status: undefined });

  if (mode === 'preview') {
    return NextResponse.json({
      totalRows: preview.totalRows,
      validCount: preview.validRows.length,
      invalidCount: preview.invalidRows.length,
      duplicateRegistrationIds: preview.duplicateRegistrationIds,
      invalidRows: preview.invalidRows.slice(0, 50), // cap payload
      sampleValidRows: preview.validRows.slice(0, 10),
    });
  }

  // mode === 'confirm' — batch inserts instead of one row at a time, so
  // importing 60-80 entries is a handful of round trips, not hundreds.
  const db = supabaseAdmin();

  const { data: existingEntries } = await db.from('entries').select('registration_id, entry_code');
  const existingRegIds = new Set((existingEntries ?? []).map((e) => e.registration_id));
  let maxEntryNum = (existingEntries ?? []).reduce((max, e) => {
    const n = parseInt(e.entry_code.replace(/\D/g, ''), 10);
    return Number.isFinite(n) ? Math.max(max, n) : max;
  }, 0);

  const toInsert = preview.validRows.filter((r) => !existingRegIds.has(r.registration_id!));
  const skippedAsAlreadyImported = preview.validRows.length - toInsert.length;

  if (toInsert.length === 0) {
    return NextResponse.json({ imported: 0, skippedAsAlreadyImported, errors: [] });
  }

  const entryRows = toInsert.map((row) => {
    maxEntryNum += 1;
    return {
      entry_code: nextEntryCode(maxEntryNum - 1),
      registration_id: row.registration_id!,
      team_name: row.team_name || null,
      payment_status: 'paid' as const,
      is_team: Boolean(row.member2_name),
    };
  });

  const { data: insertedEntries, error: entriesErr } = await db
    .from('entries')
    .insert(entryRows)
    .select('id, registration_id');

  if (entriesErr || !insertedEntries) {
    return NextResponse.json({ error: entriesErr?.message ?? 'Batch insert failed' }, { status: 500 });
  }

  const idByRegistrationId = new Map(insertedEntries.map((e) => [e.registration_id, e.id]));

  const memberRows = toInsert.flatMap((row) => {
    const entryId = idByRegistrationId.get(row.registration_id!);
    if (!entryId) return [];
    const rows = [{ entry_id: entryId, member_position: 1, full_name: row.member1_name!, email: row.member1_email || null }];
    if (row.member2_name) {
      rows.push({ entry_id: entryId, member_position: 2, full_name: row.member2_name, email: row.member2_email || null });
    }
    return rows;
  });

  if (memberRows.length > 0) {
    await db.from('team_members').insert(memberRows);
  }

  await db.from('admin_actions').insert({
    admin_id: session.role === 'admin' ? session.userId : null,
    action: 'csv_import',
    new_value: { imported: insertedEntries.length, skippedAsAlreadyImported },
  });

  return NextResponse.json({ imported: insertedEntries.length, skippedAsAlreadyImported, errors: [] });
}
