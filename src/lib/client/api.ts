'use client';

/**
 * Small fetch wrapper for client components: JSON in/out, no caching,
 * typed errors that carry the server's message, status and code. A 401
 * sends the user to the right sign-in page instead of spinning forever.
 */
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public body?: Record<string, unknown>) {
    super(message);
  }
}

/**
 * Abort signal for slow venue networks: a request that hangs is cut off so the
 * caller's retry / backoff can run instead of waiting minutes for the browser.
 * (Plain AbortController so older phones without AbortSignal.timeout work too.)
 */
export function timeoutSignal(ms: number): AbortSignal {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

export async function api<T = Record<string, unknown>>(
  url: string,
  options: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown; loginPath?: string; signal?: AbortSignal } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: options.method ?? 'GET',
      headers: options.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      cache: 'no-store',
      signal: options.signal ?? timeoutSignal(20_000),
    });
  } catch (err) {
    if (options.signal && err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError('Network problem — check your connection and try again.', 0, 'network');
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401 && options.loginPath && typeof window !== 'undefined') {
    window.location.replace(options.loginPath);
  }
  if (!res.ok) {
    throw new ApiError(typeof body.error === 'string' ? body.error : `Request failed (HTTP ${res.status}).`, res.status, typeof body.code === 'string' ? body.code : undefined, body);
  }
  return body as T;
}

export const errorMessage = (e: unknown, fallback = 'Something went wrong.') => (e instanceof Error ? e.message : fallback);

export function organizerLogin(next: string) {
  return `/organizer/login?next=${encodeURIComponent(next)}`;
}
