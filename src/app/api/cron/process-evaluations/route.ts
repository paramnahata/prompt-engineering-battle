import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { processEvaluationQueue } from '@/lib/evaluation/queue';
import { jsonError, jsonOk, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Optional scheduled worker (Vercel Cron sends `Authorization: Bearer
 * $CRON_SECRET`). Fails closed: if CRON_SECRET is not configured the route
 * is disabled — it used to be callable by anyone, burning Gemini quota.
 * The admin dashboard's "Run evaluation" does the same work on demand.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return jsonError('Not found.', 404);
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(req.headers.get('authorization') ?? '');
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    return jsonError('Unauthorized.', 401);
  }
  try {
    return jsonOk(await processEvaluationQueue({ timeBudgetMs: 45_000 }));
  } catch (err) {
    return serverError('cron evaluations', err);
  }
}
