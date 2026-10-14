import { getSession } from '@/lib/auth/session';
import { jsonError, jsonOk } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession({ touch: false });
  if (!session) return jsonError('Not signed in.', 401, { authenticated: false });
  return jsonOk({ authenticated: true, role: session.role, entryNumber: session.entryNumber });
}
