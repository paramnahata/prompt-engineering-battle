import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-only Supabase client using SUPABASE_SECRET_KEY (service role).
 * NEVER import this file from a Client Component. It must only be used
 * inside route handlers, server actions, and server components.
 */
let cached: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    throw new Error(
      'Missing SUPABASE_URL or SUPABASE_SECRET_KEY environment variables.'
    );
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return cached;
}
