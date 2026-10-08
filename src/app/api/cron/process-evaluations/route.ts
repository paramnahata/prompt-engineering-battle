import { NextRequest, NextResponse } from 'next/server';
import { processEvaluationQueue } from '@/lib/evaluation/queue';

export const dynamic = 'force-dynamic';

/**
 * Configure in vercel.json to run every 10-15s during the evaluation
 * window (or trigger manually from the admin "RUN EVALUATION" button via
 * this same route). Protect with CRON secret header in production.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const result = await processEvaluationQueue(20);
  return NextResponse.json(result);
}
