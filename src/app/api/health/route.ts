import { getSession } from '@/lib/auth/session';
import { getHealth } from '@/lib/ops/health';
import { jsonOk } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * Deployment health. Public callers get the overall status only; a signed-in
 * admin also gets the missing migration objects and environment variable
 * NAMES (never values) so a broken preview can be diagnosed from the UI.
 */
export async function GET() {
  const health = await getHealth();
  let admin = false;
  if (health.database === 'ok') {
    const session = await getSession({ touch: false }).catch(() => null);
    admin = session?.role === 'admin';
  }
  const body = { ok: health.ok, database: health.database, schemaVersion: health.schemaVersion, checkedAt: health.checkedAt };
  return jsonOk(admin ? { ...body, ...health } : body, health.ok ? 200 : 503);
}
