import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';

const bodySchema = z.object({ event_type: z.string().min(1).max(64), metadata: z.record(z.any()).optional() });

export async function POST(req: NextRequest) {
  const session = requireRole('student');
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });

  const db = supabaseAdmin();
  await db.from('activity_logs').insert({
    entry_id: session.userId,
    event_type: parsed.data.event_type,
    metadata: parsed.data.metadata ?? {},
  });

  return NextResponse.json({ ok: true });
}
