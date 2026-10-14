import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { generatePin, hashPin } from '@/lib/auth/pin';
import { jsonError, jsonOk, readJson, serverError } from '@/lib/http';
import { limitAction } from '@/lib/ops/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('issue_missing') }),
  z.object({ action: z.literal('reissue'), entryId: z.string().uuid() }),
]);

/**
 * Issues team PINs. The plain PIN appears in this response exactly once,
 * to the signed-in organizer, so it can be handed to the team; only a hash
 * is stored, and no API ever returns it again. Responses are no-store and
 * PINs are never logged.
 *
 * issue_missing (admin): PINs for every entry that has none.
 * reissue (admin or registration desk): new PIN for one entry; its live
 * sessions are ended immediately.
 */
export async function POST(req: NextRequest) {
  const body = await readJson(req, bodySchema, 1024);
  if (!body.ok) return body.response;
  const auth = await requireApiRole(body.data.action === 'issue_missing' ? ['admin'] : ['admin', 'volunteer']);
  if (!auth.ok) return auth.response;

  try {
    const limited = await limitAction(`pins:${auth.session.userId}`, 40, 300);
    if (limited) return limited;
    const db = supabaseAdmin();
    const query = db.from('entries').select('id, entry_number, team_name, team_members(member_position, full_name)').order('entry_number').limit(2000);
    const { data: targets, error } = body.data.action === 'issue_missing'
      ? await query.is('pin_hash', null)
      : await query.eq('id', body.data.entryId);
    if (error) throw error;
    if (!targets?.length) {
      return body.data.action === 'reissue' ? jsonError('Entry not found.', 404) : jsonOk({ ok: true, issued: [] });
    }

    const issued: { entryId: string; entryNumber: number; teamName: string | null; members: string[]; pin: string }[] = [];
    const rows: { entry_id: string; pin_hash: string }[] = [];
    const queue = [...targets];
    // Bounded parallelism: scrypt runs on the libuv pool.
    await Promise.all(Array.from({ length: 4 }, async () => {
      for (let t = queue.shift(); t; t = queue.shift()) {
        const pin = generatePin();
        rows.push({ entry_id: t.id, pin_hash: await hashPin(pin) });
        issued.push({
          entryId: t.id, entryNumber: t.entry_number, teamName: t.team_name,
          members: [...(t.team_members ?? [])].sort((a, b) => a.member_position - b.member_position).map((m) => m.full_name),
          pin,
        });
      }
    }));

    const { data: res, error: setErr } = await db.rpc('set_entry_pins', {
      p_pins: rows, p_admin: auth.session.userId, p_only_missing: body.data.action === 'issue_missing',
    });
    if (setErr) throw setErr;
    issued.sort((a, b) => a.entryNumber - b.entryNumber);
    // Only PINs that were actually stored are shown (another organizer may have issued some at the same moment).
    const stored = new Set<string>((res?.updatedIds ?? []) as string[]);
    const shown = issued.filter((i) => stored.has(i.entryId));
    if (body.data.action === 'reissue' && shown.length === 0) return jsonError('Entry not found.', 404);
    return jsonOk({ ok: true, issued: shown, skipped: issued.length - shown.length });
  } catch (err) {
    return serverError('issue pins', err, 'Could not issue PINs. Nothing was changed for entries that failed.');
  }
}
