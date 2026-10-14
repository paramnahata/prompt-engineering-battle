import { destroySession } from '@/lib/auth/session';
import { jsonOk, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await destroySession();
    return jsonOk({ ok: true });
  } catch (err) {
    return serverError('logout', err);
  }
}
