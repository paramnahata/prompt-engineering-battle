import { getCurrentAccessCode } from '@/lib/security/access-code';
import { requireApiRole, ORGANIZER_ROLES } from '@/lib/auth/session';
import { jsonOk } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * The rotating code proves a student is physically in the room, so it is
 * only served to signed-in organizers (registration desk + projector).
 * It used to be public, which let anyone online log in as any entry.
 */
export async function GET() {
  const auth = await requireApiRole(ORGANIZER_ROLES);
  if (!auth.ok) return auth.response;
  const { code, rotatesAt, serverNow } = getCurrentAccessCode();
  return jsonOk({ code, rotatesAt, serverNow });
}
