import { NextRequest, NextResponse } from 'next/server';

/**
 * Edge middleware for /api:
 * - CSRF: cookie-authenticated mutations must come from this origin.
 *   Browsers always send Origin on cross-site POST/PATCH/DELETE; when it is
 *   absent we fall back to Sec-Fetch-Site. Non-browser clients without
 *   either header (curl, load tests) still need a valid session cookie.
 * - Rejects oversized bodies early (the CSV import has its own larger cap).
 * - Marks every API response as non-cacheable.
 *
 * This is defense in depth only — every route still authenticates and
 * authorizes on its own.
 */

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const DEFAULT_MAX_BYTES = 256 * 1024;
const IMPORT_MAX_BYTES = 3 * 1024 * 1024;

export function middleware(req: NextRequest) {
  if (MUTATING.has(req.method)) {
    const origin = req.headers.get('origin');
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
    if (origin) {
      let originHost: string | null = null;
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = null;
      }
      if (!originHost || originHost !== host) {
        return NextResponse.json({ error: 'Cross-origin request blocked.' }, { status: 403 });
      }
    } else if (req.headers.get('sec-fetch-site') === 'cross-site') {
      return NextResponse.json({ error: 'Cross-origin request blocked.' }, { status: 403 });
    }

    const limit = req.nextUrl.pathname === '/api/admin/participants/import' ? IMPORT_MAX_BYTES : DEFAULT_MAX_BYTES;
    const length = Number(req.headers.get('content-length') ?? '0');
    if (Number.isFinite(length) && length > limit) {
      return NextResponse.json({ error: 'Request is too large.' }, { status: 413 });
    }
  }

  const res = NextResponse.next();
  res.headers.set('Cache-Control', 'no-store, max-age=0');
  return res;
}

export const config = { matcher: ['/api/:path*'] };
