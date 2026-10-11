import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/server';
import { isAccessCodeValid } from '@/lib/security/access-code';
import { createSession } from '@/lib/auth/session';

const bodySchema = z.object({
  entryCode: z.string().min(1),
  accessCode: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  const { accessCode } = parsed.data;
  const rawEntryCode = parsed.data.entryCode.trim().toUpperCase();
  // The registration desk may give students a simple number; accept 1 as ENTRY-001.
  const entryCode = /^\\d{1,3}$/.test(rawEntryCode) ? `ENTRY-${rawEntryCode.padStart(3, '0')}` : rawEntryCode;

  if (!isAccessCodeValid(accessCode)) {
    return NextResponse.json({ error: 'Access code is incorrect or has expired' }, { status: 401 });
  }

  let entry;
  try {
    const db = supabaseAdmin();
    const { data, error } = await db
      .from('entries')
      .select('id, entry_code, present, disqualified')
      .eq('entry_code', entryCode.trim().toUpperCase())
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    entry = data;
  } catch (err) {
    console.error('[student login] Supabase error:', err);
    return NextResponse.json(
      { error: 'Server misconfigured: could not reach the database. Check SUPABASE_URL / SUPABASE_SECRET_KEY.' },
      { status: 500 }
    );
  }

  if (!entry) {
    return NextResponse.json({ error: 'Entry ID not found' }, { status: 404 });
  }
  if (entry.disqualified) {
    return NextResponse.json({ error: 'This entry has been disqualified' }, { status: 403 });
  }
  if (!entry.present) {
    return NextResponse.json({ error: 'Attendance not marked yet — see a volunteer' }, { status: 403 });
  }

  const db = supabaseAdmin();
  createSession({ role: 'student', userId: entry.id, entryCode: entry.entry_code, issuedAt: Date.now() });

  await db.from('activity_logs').insert({
    entry_id: entry.id,
    event_type: 'login',
    metadata: {},
  });

  return NextResponse.json({ ok: true });
}
