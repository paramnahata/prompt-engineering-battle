import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { jsonError, jsonOk, readJson, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

const SELECT = 'id, title, message, audience, entry_ids, active, created_at, updated_at, author:admins!announcements_created_by_fkey(full_name)';

export async function GET() {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  try {
    const db = supabaseAdmin();
    const { data, error } = await db.from('announcements').select(SELECT).order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    const ids = [...new Set((data ?? []).flatMap((a) => a.entry_ids ?? []))];
    const { data: entries } = ids.length ? await db.from('entries').select('id, entry_number').in('id', ids) : { data: [] };
    const numbers = new Map((entries ?? []).map((e) => [e.id, e.entry_number]));
    return jsonOk({
      announcements: (data ?? []).map((a) => ({
        ...a, author: (Array.isArray(a.author) ? a.author[0] : a.author)?.full_name ?? (a.audience ? 'System' : null),
        entryNumbers: (a.entry_ids ?? []).map((id: string) => numbers.get(id)).filter(Boolean),
      })),
    });
  } catch (err) {
    return serverError('announcements', err, 'Could not load announcements.');
  }
}

const createSchema = z.object({
  title: z.string().trim().max(120).optional(),
  message: z.string().trim().min(1).max(1000),
  audience: z.enum(['all', 'checked_in', 'round2', 'entries']),
  entryNumbers: z.array(z.number().int().positive()).max(500).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, createSchema, 16 * 1024);
  if (!body.ok) return body.response;
  try {
    const db = supabaseAdmin();
    let entryIds: string[] = [];
    if (body.data.audience === 'entries') {
      const numbers = [...new Set(body.data.entryNumbers ?? [])];
      if (!numbers.length) return jsonError('List at least one entry number for a targeted announcement.', 400);
      const { data, error } = await db.from('entries').select('id, entry_number').in('entry_number', numbers);
      if (error) throw error;
      const found = new Set((data ?? []).map((e) => e.entry_number));
      const missing = numbers.filter((n) => !found.has(n));
      if (missing.length) return jsonError(`Unknown entry number(s): ${missing.slice(0, 10).join(', ')}`, 400);
      entryIds = (data ?? []).map((e) => e.id);
    }
    const { data, error } = await db.from('announcements').insert({
      title: body.data.title || null, message: body.data.message, audience: body.data.audience, entry_ids: entryIds,
      active: true, created_by: auth.session.userId,
    }).select('id').single();
    if (error) throw error;
    await db.from('admin_actions').insert({ admin_id: auth.session.userId, action: 'announcement_publish', new_value: { id: data.id, audience: body.data.audience, recipients: entryIds.length || null } });
    return jsonOk({ ok: true, id: data.id });
  } catch (err) {
    return serverError('announcement create', err, 'Could not publish the announcement.');
  }
}

const patchSchema = z.object({ id: z.string().uuid(), active: z.boolean() });

export async function PATCH(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, patchSchema, 512);
  if (!body.ok) return body.response;
  try {
    const db = supabaseAdmin();
    const { data, error } = await db.from('announcements').update({ active: body.data.active, updated_at: new Date().toISOString(), updated_by: auth.session.userId })
      .eq('id', body.data.id).select('id').maybeSingle();
    if (error) throw error;
    if (!data) return jsonError('Announcement not found.', 404);
    await db.from('admin_actions').insert({ admin_id: auth.session.userId, action: body.data.active ? 'announcement_show' : 'announcement_hide', new_value: { id: body.data.id } });
    return jsonOk({ ok: true });
  } catch (err) {
    return serverError('announcement update', err, 'Could not update the announcement.');
  }
}

const deleteSchema = z.object({ id: z.string().uuid() });

export async function DELETE(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, deleteSchema, 512);
  if (!body.ok) return body.response;
  try {
    const db = supabaseAdmin();
    const { data, error } = await db.from('announcements').delete().eq('id', body.data.id).select('id, message').maybeSingle();
    if (error) throw error;
    if (!data) return jsonError('Announcement not found.', 404);
    await db.from('admin_actions').insert({ admin_id: auth.session.userId, action: 'announcement_delete', old_value: data });
    return jsonOk({ ok: true });
  } catch (err) {
    return serverError('announcement delete', err, 'Could not delete the announcement.');
  }
}
