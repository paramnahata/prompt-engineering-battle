import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { jsonError, jsonOk, readJson, serverError } from '@/lib/http';
import { challengeFieldsSchema, DIFFICULTIES, poolLockedResponse, POOL_STATUSES, safeSearch, toRow } from '@/lib/challenges/server';

export const dynamic = 'force-dynamic';

const LIST_COLUMNS = 'id, challenge_code, title, category, difficulty, active, pool_status, common_slot, prompt_word_limit, output_char_limit, updated_at, source_ref';

/**
 * Paginated, filtered challenge list + facet counts for the whole pool.
 * ?q= &difficulty=a,b &status=a,b &category= &active=true|false &page= &pageSize=
 */
export async function GET(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  try {
    const sp = req.nextUrl.searchParams;
    const page = Math.max(1, Number(sp.get('page')) || 1);
    const pageSize = Math.min(100, Math.max(10, Number(sp.get('pageSize')) || 50));
    const q = safeSearch(sp.get('q'));
    const difficulty = (sp.get('difficulty') ?? '').split(',').filter((d) => (DIFFICULTIES as readonly string[]).includes(d));
    const status = (sp.get('status') ?? '').split(',').filter((s) => (POOL_STATUSES as readonly string[]).includes(s));
    const category = (sp.get('category') ?? '').trim().slice(0, 120);
    const active = sp.get('active');

    const db = supabaseAdmin();
    let query = db.from('challenges').select(LIST_COLUMNS, { count: 'exact' });
    if (q) query = query.or(`challenge_code.ilike.%${q}%,title.ilike.%${q}%,category.ilike.%${q}%,problem_statement.ilike.%${q}%`);
    if (difficulty.length) query = query.in('difficulty', difficulty);
    if (status.length) query = query.in('pool_status', status);
    if (category) query = query.ilike('category', category.replace(/[%_\\]/g, (m) => `\\${m}`));
    if (active === 'true' || active === 'false') query = query.eq('active', active === 'true');
    const from = (page - 1) * pageSize;
    const [list, all, pre] = await Promise.all([
      query.order('challenge_code', { ascending: true }).range(from, from + pageSize - 1),
      db.from('challenges').select('difficulty, pool_status, active, category, common_slot').limit(10_000),
      db.rpc('round1_preflight'),
    ]);
    if (list.error) throw list.error;
    if (all.error) throw all.error;

    const facets = { difficulty: {} as Record<string, number>, status: {} as Record<string, number>, category: {} as Record<string, number>, total: 0, active: 0 };
    for (const c of all.data ?? []) {
      facets.total += 1;
      if (c.active) facets.active += 1;
      facets.difficulty[c.difficulty] = (facets.difficulty[c.difficulty] ?? 0) + 1;
      facets.status[c.pool_status] = (facets.status[c.pool_status] ?? 0) + 1;
      const cat = c.category ?? '(none)';
      facets.category[cat] = (facets.category[cat] ?? 0) + 1;
    }
    return jsonOk({ items: list.data ?? [], total: list.count ?? 0, page, pageSize, facets, preflight: pre.data ?? null });
  } catch (err) {
    return serverError('challenges list', err, 'Could not load challenges.');
  }
}

/** Create one challenge manually. */
export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, challengeFieldsSchema, 64 * 1024);
  if (!body.ok) return body.response;
  try {
    const db = supabaseAdmin();
    const locked = await poolLockedResponse(db);
    if (locked) return locked;
    const { data, error } = await db.from('challenges')
      .insert({ ...toRow(body.data), active: body.data.active ?? true, created_by: auth.session.userId, updated_by: auth.session.userId })
      .select('id').single();
    if (error) {
      if (error.code === '23505') return jsonError(`PS ID ${body.data.challenge_code} already exists.`, 409);
      throw error;
    }
    await db.from('admin_actions').insert({ admin_id: auth.session.userId, action: 'challenge_create', new_value: { id: data.id, code: body.data.challenge_code } });
    return jsonOk({ ok: true, id: data.id });
  } catch (err) {
    return serverError('challenge create', err, 'Could not create the challenge.');
  }
}

const ids = z.array(z.string().uuid()).min(1).max(1000);
const patchSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('bulk_update'), ids,
    set: z.object({
      active: z.boolean().optional(),
      pool_status: z.enum(['approved', 'review', 'test']).optional(),
      difficulty: z.enum(DIFFICULTIES).optional(),
      category: z.string().trim().max(120).optional(),
    }).refine((s) => Object.keys(s).length > 0, 'Nothing to change'),
  }),
  z.object({ action: z.literal('set_common'), slot: z.union([z.literal(1), z.literal(2)]), id: z.string().uuid().nullable() }),
]);

/** Bulk enable/disable/approve/mark-test/re-rate/re-categorise, and choosing Common A/B. */
export async function PATCH(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, patchSchema, 64 * 1024);
  if (!body.ok) return body.response;
  try {
    const db = supabaseAdmin();
    const locked = await poolLockedResponse(db);
    if (locked) return locked;
    const meta = { updated_at: new Date().toISOString(), updated_by: auth.session.userId };
    if (body.data.action === 'bulk_update') {
      const set: Record<string, unknown> = { ...body.data.set, ...meta };
      if (set.category === '') set.category = null;
      const { data, error } = await db.from('challenges').update(set).in('id', body.data.ids).neq('pool_status', 'archived').select('id');
      if (error) throw error;
      // A common challenge must stay approved and active.
      if (body.data.set.active === false || (body.data.set.pool_status && body.data.set.pool_status !== 'approved')) {
        await db.from('challenges').update({ common_slot: null }).in('id', body.data.ids);
      }
      await db.from('admin_actions').insert({ admin_id: auth.session.userId, action: 'challenge_bulk_update', new_value: { count: data?.length ?? 0, set: body.data.set } });
      return jsonOk({ ok: true, updated: data?.length ?? 0 });
    }
    const { slot, id } = body.data;
    if (id) {
      const { data: c, error } = await db.from('challenges').select('id, active, pool_status, challenge_code').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!c) return jsonError('Challenge not found.', 404);
      if (!c.active || c.pool_status !== 'approved') return jsonError(`${c.challenge_code} must be active and approved to be a common challenge.`, 409);
    }
    const { error: clearErr } = await db.from('challenges').update({ common_slot: null }).eq('common_slot', slot);
    if (clearErr) throw clearErr;
    if (id) {
      const { error } = await db.from('challenges').update({ common_slot: slot, ...meta }).eq('id', id);
      if (error) throw error;
    }
    await db.from('admin_actions').insert({ admin_id: auth.session.userId, action: 'challenge_set_common', new_value: { slot, id } });
    return jsonOk({ ok: true });
  } catch (err) {
    return serverError('challenges update', err, 'Could not update challenges.');
  }
}

const deleteSchema = z.object({ ids, confirm: z.literal('DELETE') });

/**
 * Deletes challenges. Ones that were ever assigned are archived instead
 * (inactive, kept for history) — completed submissions keep their reference.
 */
export async function DELETE(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, deleteSchema, 64 * 1024);
  if (!body.ok) return jsonError('Confirm deletion by sending confirm: "DELETE".', 400);
  try {
    const db = supabaseAdmin();
    const locked = await poolLockedResponse(db);
    if (locked) return locked;
    const { data: used, error: usedErr } = await db.from('challenge_assignments').select('challenge_id').in('challenge_id', body.data.ids);
    if (usedErr) throw usedErr;
    const referenced = [...new Set((used ?? []).map((u) => u.challenge_id))];
    const free = body.data.ids.filter((id) => !referenced.includes(id));
    let deleted = 0;
    if (free.length) {
      const { data, error } = await db.from('challenges').delete().in('id', free).select('id');
      if (error) throw error;
      deleted = data?.length ?? 0;
    }
    let archived = 0;
    if (referenced.length) {
      const { data, error } = await db.from('challenges')
        .update({ active: false, pool_status: 'archived', common_slot: null, updated_at: new Date().toISOString(), updated_by: auth.session.userId })
        .in('id', referenced).select('id');
      if (error) throw error;
      archived = data?.length ?? 0;
    }
    await db.from('admin_actions').insert({ admin_id: auth.session.userId, action: 'challenge_delete', new_value: { deleted, archived } });
    return jsonOk({ ok: true, deleted, archived });
  } catch (err) {
    return serverError('challenges delete', err, 'Could not delete challenges.');
  }
}
