'use client';

import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser Supabase client. Uses the PUBLISHABLE key only — this key must
 * never be able to read/write tables directly (see migration 0002_rls.sql).
 * Its only job client-side is subscribing to Realtime channels; all actual
 * data mutation happens through our own authenticated API route handlers.
 */
export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
}
