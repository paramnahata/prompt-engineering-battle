import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/server';
import { isSchemaMissingError } from '@/lib/db-errors';

/**
 * Deployment health: required environment variables (names only — values
 * are never read into the response) and whether the database has every
 * function/table this version of the app needs. Cached briefly so a public
 * health check can't be used to hammer the database.
 */
export const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SESSION_SECRET', 'EVENT_SECRET'] as const;
export const RECOMMENDED_ENV = ['PIN_PEPPER'] as const;
export const EXPECTED_SCHEMA_VERSION = 6;

export interface Health {
  ok: boolean;
  database: 'ok' | 'migrations_missing' | 'unreachable' | 'not_configured';
  schemaVersion: number | null;
  missingFunctions: string[];
  missingTables: string[];
  missingEnv: string[];
  missingRecommendedEnv: string[];
  checkedAt: string;
}

let cache: { at: number; value: Health } | null = null;

export async function getHealth(maxAgeMs = 30_000): Promise<Health> {
  if (cache && Date.now() - cache.at < maxAgeMs) return cache.value;
  const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k] || (k === 'SESSION_SECRET' && (process.env[k]?.length ?? 0) < 32));
  const missingRecommendedEnv = RECOMMENDED_ENV.filter((k) => !process.env[k]);
  const base = { missingEnv, missingRecommendedEnv, checkedAt: new Date().toISOString() };
  let value: Health;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    value = { ...base, ok: false, database: 'not_configured', schemaVersion: null, missingFunctions: [], missingTables: [] };
  } else {
    try {
      const { data, error } = await supabaseAdmin().rpc('app_schema_status');
      if (error) throw error;
      const missingFunctions = (data?.missingFunctions ?? []) as string[];
      const missingTables = (data?.missingTables ?? []) as string[];
      const version = Number(data?.version ?? 0);
      const complete = missingFunctions.length === 0 && missingTables.length === 0 && version >= EXPECTED_SCHEMA_VERSION;
      value = { ...base, ok: complete && missingEnv.length === 0, database: complete ? 'ok' : 'migrations_missing',
        schemaVersion: version, missingFunctions, missingTables };
    } catch (err) {
      value = isSchemaMissingError(err)
        ? { ...base, ok: false, database: 'migrations_missing', schemaVersion: null, missingFunctions: ['app_schema_status (migration 0006)'], missingTables: [] }
        : { ...base, ok: false, database: 'unreachable', schemaVersion: null, missingFunctions: [], missingTables: [] };
    }
  }
  cache = { at: Date.now(), value };
  return value;
}

/** One-line, non-sensitive description for login screens. */
export function describeHealthProblem(h: Health): string | null {
  if (h.database === 'not_configured' || h.missingEnv.length) return 'The server is not fully configured yet. Sign-in will not work until an administrator finishes setup.';
  if (h.database === 'migrations_missing') return 'This deployment’s database is missing required migrations. Sign-in is unavailable until an administrator applies them.';
  if (h.database === 'unreachable') return 'The database could not be reached. Please try again in a moment.';
  return null;
}
