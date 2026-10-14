import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { jsonError, jsonOk, readJson, serverError } from '@/lib/http';
import { COMPARED_FIELDS, MAX_SHEETS, MAX_TOTAL_ROWS, parseChallengeSheets, type ChallengeField } from '@/lib/challenges/import';
import { limitAction } from '@/lib/ops/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const fieldKeys = ['challenge_code', 'title', 'category', 'difficulty', 'problem_statement', 'expected_output', 'evaluation_criteria',
  'instructions', 'constraints', 'prompt_word_limit', 'output_char_limit'] as const satisfies readonly ChallengeField[];

const bodySchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  sheets: z.array(z.object({
    name: z.string().max(80),
    rows: z.array(z.array(z.string().max(10_500)).max(40)).max(MAX_TOTAL_ROWS),
  })).min(1).max(MAX_SHEETS),
  mapping: z.record(z.enum(fieldKeys), z.string().max(200)).optional(),
  excludedSheets: z.array(z.string().max(80)).max(MAX_SHEETS).optional(),
});

/** Recent import drafts/publishes and pool audit events. */
export async function GET() {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  try {
    const db = supabaseAdmin();
    const [batches, events] = await Promise.all([
      db.from('challenge_import_batches').select('id, file_name, status, summary, created_at, published_at, publish_mode, uploaded_by, published_by').order('created_at', { ascending: false }).limit(30),
      db.from('admin_actions').select('id, action, new_value, created_at, admin:admins(full_name, email)')
        .or('action.like.challenge_%,action.eq.assignment_rules_update').order('created_at', { ascending: false }).limit(100),
    ]);
    if (batches.error) throw batches.error;
    if (events.error) throw events.error;
    const { data: admins } = await db.from('admins').select('id, full_name');
    const name = new Map((admins ?? []).map((a) => [a.id, a.full_name]));
    return jsonOk({
      batches: (batches.data ?? []).map((b) => ({ ...b, uploaded_by: name.get(b.uploaded_by) ?? null, published_by: name.get(b.published_by) ?? null })),
      events: events.data ?? [],
    });
  } catch (err) {
    return serverError('import history', err, 'Could not load import history.');
  }
}

/**
 * Upload step: parse the workbook server-side, compare with the live pool
 * and store a DRAFT. Nothing changes in the pool until the draft is
 * published (POST /api/admin/challenges/import/:batchId).
 */
export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, bodySchema, 6 * 1024 * 1024);
  if (!body.ok) return body.response;
  try {
    const limited = await limitAction(`challenge-import:${auth.session.userId}`, 30, 300);
    if (limited) return limited;
  } catch (err) {
    return serverError('challenge-import rate limit', err);
  }

  const result = parseChallengeSheets(body.data.sheets, { mapping: body.data.mapping, excludedSheets: body.data.excludedSheets });
  const headers = [...new Set(body.data.sheets.flatMap((s) => s.rows.slice(0, 3).flat().map((h) => h.trim()).filter((h) => h && h.length <= 60)))].slice(0, 200);
  if (result.challenges.length === 0) {
    return jsonError(result.errors[0]?.message ?? 'No problem statements found. Map the PS ID and problem-statement columns.', 422, {
      sheets: result.sheets, headers, errors: result.errors.slice(0, 200),
    });
  }

  try {
    const db = supabaseAdmin();
    const { data: existing, error } = await db.from('challenges')
      .select('challenge_code, pool_status, active, title, category, difficulty, problem_statement, expected_output, evaluation_criteria, instructions, constraints').limit(10_000);
    if (error) throw error;
    const byCode = new Map((existing ?? []).map((c) => [c.challenge_code, c as unknown as Record<string, unknown>]));
    const inFile = new Set(result.challenges.map((c) => c.challenge_code));

    const items = result.challenges.map((c) => {
      const old = byCode.get(c.challenge_code);
      const changes = old ? COMPARED_FIELDS.filter((f) => (old[f] ?? null) !== (c[f] ?? null)) : [];
      return {
        code: c.challenge_code, title: c.title, category: c.category, difficulty: c.difficulty, source_ref: c.source_ref,
        statement: c.problem_statement.slice(0, 220), status: !old ? 'new' : changes.length ? 'changed' : 'unchanged',
        changes, currentStatus: old?.pool_status ?? null,
      };
    });
    const missing = (existing ?? []).filter((c) => !inFile.has(c.challenge_code) && c.pool_status !== 'test' && c.pool_status !== 'archived')
      .map((c) => c.challenge_code);
    const totals = {
      parsed: result.challenges.length,
      new: items.filter((i) => i.status === 'new').length,
      changed: items.filter((i) => i.status === 'changed').length,
      unchanged: items.filter((i) => i.status === 'unchanged').length,
      errors: result.errors.length,
      warnings: result.warnings.length,
      missingFromFile: missing.length,
    };

    await db.from('challenge_import_batches').update({ status: 'discarded' }).eq('status', 'draft');
    const { data: batch, error: insErr } = await db.from('challenge_import_batches').insert({
      file_name: body.data.fileName,
      mapping: { mapping: body.data.mapping ?? {}, excludedSheets: body.data.excludedSheets ?? [] },
      rows: result.challenges,
      row_errors: result.errors,
      summary: { ...totals, difficultyCounts: result.difficultyCounts, sheets: result.sheets.map((s) => ({ name: s.name, used: s.used, rows: s.rows })) },
      uploaded_by: auth.session.userId,
    }).select('id').single();
    if (insErr) throw insErr;
    await db.from('admin_actions').insert({ admin_id: auth.session.userId, action: 'challenge_import_draft', new_value: { batch_id: batch.id, file: body.data.fileName, ...totals } });

    return jsonOk({
      batchId: batch.id, fileName: body.data.fileName, totals, sheets: result.sheets, headers,
      difficultyCounts: result.difficultyCounts, categoryCounts: result.categoryCounts,
      items, errors: result.errors.slice(0, 500), warnings: result.warnings.slice(0, 500), missing: missing.slice(0, 500),
    });
  } catch (err) {
    return serverError('challenge import preview', err, 'Could not prepare the import. Nothing was changed.');
  }
}
