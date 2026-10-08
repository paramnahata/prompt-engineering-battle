import crypto from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/server';

const ROTATE_SECONDS = 120;

/** 4-digit code derived from EVENT_SECRET + the current rotation window. */
function deriveCode(windowIndex: number): string {
  const secret = process.env.EVENT_SECRET;
  if (!secret) throw new Error('Missing EVENT_SECRET environment variable.');
  const h = crypto.createHmac('sha256', secret).update(String(windowIndex)).digest('hex');
  const num = parseInt(h.slice(0, 8), 16) % 10_000;
  return num.toString().padStart(4, '0');
}

function currentWindowIndex(nowMs = Date.now()): number {
  return Math.floor(nowMs / (ROTATE_SECONDS * 1000));
}

/** Returns the currently valid code + when it rotates next, using server time. */
export function getCurrentAccessCode() {
  const now = Date.now();
  const windowIndex = currentWindowIndex(now);
  const code = deriveCode(windowIndex);
  const rotatesAt = (windowIndex + 1) * ROTATE_SECONDS * 1000;
  return { code, rotatesAt, serverNow: now };
}

/** Validates a submitted code against the CURRENT window only — an old code stops working the instant it rotates. */
export function isAccessCodeValid(submitted: string): boolean {
  const now = Date.now();
  const windowIndex = currentWindowIndex(now);
  return submitted.trim() === deriveCode(windowIndex);
}

/** Optionally persists each generated code for audit purposes. */
export async function logAccessCodeGeneration(adminId: string) {
  const { code, rotatesAt } = getCurrentAccessCode();
  const db = supabaseAdmin();
  await db.from('event_access_codes').insert({
    code,
    valid_from: new Date().toISOString(),
    valid_to: new Date(rotatesAt).toISOString(),
    generated_by: adminId,
  });
}
