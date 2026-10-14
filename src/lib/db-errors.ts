/**
 * Recognises errors that mean "this database is behind the code" (a
 * migration was not applied): PostgREST cannot find a function/table/column
 * in its schema cache, or Postgres reports an undefined object.
 */
const SCHEMA_CODES = new Set(['PGRST202', 'PGRST204', 'PGRST205', '42P01', '42883', '42703']);

export function isSchemaMissingError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = 'code' in err ? String((err as { code: unknown }).code ?? '') : '';
  if (SCHEMA_CODES.has(code)) return true;
  const message = 'message' in err ? String((err as { message: unknown }).message ?? '') : '';
  return /could not find the (function|table|column)|schema cache/i.test(message);
}

export const SETUP_REQUIRED_MESSAGE =
  'This deployment’s database is missing required migrations, so this feature is unavailable. An administrator must apply the pending Supabase migrations.';
