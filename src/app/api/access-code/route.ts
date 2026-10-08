import { NextResponse } from 'next/server';
import { getCurrentAccessCode } from '@/lib/security/access-code';

export const dynamic = 'force-dynamic';

/**
 * Intentionally public, no auth required. The rotating access code is not
 * a secret — its purpose is proof of physical presence (it changes too
 * fast to share remotely with someone off-site), not confidentiality.
 * It's meant to be visible to everyone in the room: on the projector and
 * at the registration desk.
 */
export async function GET() {
  const { code, rotatesAt, serverNow } = getCurrentAccessCode();
  return NextResponse.json({ code, rotatesAt, serverNow });
}
