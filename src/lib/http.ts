import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

/** Small helpers shared by route handlers. Kept free of Next server-only imports where possible. */

export const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' } as const;

export function jsonError(message: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, ...extra }, { status, headers: NO_STORE });
}

export function jsonOk(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/**
 * Best-effort client IP for rate limiting. On Vercel `x-real-ip` /
 * `x-forwarded-for` are set by the platform edge, not the client.
 */
export function clientIp(req: NextRequest): string {
  const real = req.headers.get('x-real-ip')?.trim();
  if (real) return real.slice(0, 64);
  const fwd = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return (fwd || 'unknown').slice(0, 64);
}

/**
 * Parses a JSON body with a hard byte limit and a zod schema. Returns
 * either the parsed data or a ready-to-return 400/413 response.
 */
export async function readJson<T extends z.ZodTypeAny>(
  req: NextRequest,
  schema: T,
  maxBytes = 64 * 1024,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: NextResponse }> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > maxBytes) return { ok: false, response: jsonError('Request is too large.', 413) };
  let text: string;
  try {
    text = await req.text();
  } catch {
    return { ok: false, response: jsonError('Could not read the request.', 400) };
  }
  if (Buffer.byteLength(text, 'utf8') > maxBytes) return { ok: false, response: jsonError('Request is too large.', 413) };
  let raw: unknown;
  try {
    raw = text.length ? JSON.parse(text) : {};
  } catch {
    return { ok: false, response: jsonError('Invalid JSON body.', 400) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, response: jsonError(first ? `Invalid input: ${first.path.join('.') || 'body'} — ${first.message}` : 'Invalid input.', 400) };
  }
  return { ok: true, data: parsed.data };
}

/** Logs a server-side failure without leaking details to the client. */
export function serverError(context: string, err: unknown, message = 'Something went wrong. Please retry.') {
  const detail = err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : String(err);
  console.error(`[${context}]`, detail.slice(0, 500));
  return jsonError(message, 500);
}

/**
 * Only same-site relative paths are allowed as post-login redirects:
 * must start with a single "/", no protocol-relative "//", no backslashes
 * (browsers treat "/\\evil.com" as "//evil.com"), no control characters.
 */
export function safeNextPath(raw: string | null | undefined, fallback = '/organizer/hub'): string {
  if (!raw || raw.length > 512) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//')) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return fallback;
  try {
    const url = new URL(raw, 'http://local.invalid');
    if (url.origin !== 'http://local.invalid') return fallback;
    return url.pathname + url.search;
  } catch {
    return fallback;
  }
}

export const uuidSchema = z.string().uuid();
