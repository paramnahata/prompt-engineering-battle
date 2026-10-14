import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { jsonError, jsonOk, readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ visible: z.boolean().optional() });

/** Marks the student's session as alive (drives the live participants panel). */
export async function POST(req: NextRequest) {
  const body = await readJson(req, bodySchema, 1024);
  if (!body.ok) return body.response;
  const session = await getSession({ touch: true, visible: body.data.visible ?? true });
  if (!session) return jsonError('Your session has ended. Please sign in again.', 401);
  if (session.role !== 'student') return jsonError('Students only.', 403);
  return jsonOk({ ok: true, serverNow: new Date().toISOString() });
}
