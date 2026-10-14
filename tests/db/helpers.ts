import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { Client, Pool } from 'pg';

/**
 * Database-function tests run against a throwaway LOCAL Postgres database
 * built from the repository migrations (tests/db/reset.sh). They never
 * touch the production project.
 *   PGHOST=/tmp PGPORT=54329 npm run test:db
 */
export const PGHOST = process.env.PGHOST ?? '/tmp';
export const PGPORT = Number(process.env.PGPORT ?? 54329);

export function resetDb(name: string) {
  if (/prod|supabase\.co/i.test(PGHOST)) throw new Error('Refusing to run DB tests against a remote host');
  execFileSync(path.join(__dirname, 'reset.sh'), [name], { env: { ...process.env, PGHOST, PGPORT: String(PGPORT) }, stdio: 'pipe' });
}

export function pool(name: string) {
  return new Pool({ host: PGHOST, port: PGPORT, user: 'postgres', database: name, max: 20 });
}

export async function one<T = Record<string, unknown>>(db: Pool | Client, sql: string, params: unknown[] = []): Promise<T> {
  const r = await db.query(sql, params);
  return r.rows[0] as T;
}

export async function rpc<T = Record<string, unknown>>(db: Pool, fn: string, args: unknown[]): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
  const r = await db.query(`select ${fn}(${placeholders}) as r`, args);
  return r.rows[0].r as T;
}

/** Seeds challenges, an admin and entries. Returns ids. */
export async function seed(db: Pool, opts: { entries?: number; present?: number; pool?: number } = {}) {
  const entries = opts.entries ?? 4;
  const present = opts.present ?? entries;
  const poolSize = opts.pool ?? 6;
  const admin = await one<{ id: string }>(db, `insert into admins (email, password_hash, full_name, role) values ('admin@test.local', 'x:y', 'Test Admin', 'admin') returning id`);
  const challengeIds: string[] = [];
  for (let i = 1; i <= poolSize + 2; i++) {
    const c = await one<{ id: string }>(db,
      `insert into challenges (challenge_code, title, problem_statement, prompt_word_limit, output_char_limit, difficulty, pool_status, category)
       values ($1, $2, 'Write a prompt', 20, 200, 'medium', 'approved', $3) returning id`,
      [`T-${String(i).padStart(3, '0')}`, `Challenge ${i}`, `Cat ${i % 3}`]);
    challengeIds.push(c.id);
  }
  const entryIds: string[] = [];
  for (let i = 1; i <= entries; i++) {
    const e = await one<{ id: string }>(db,
      `insert into entries (entry_code, entry_number, registration_id, team_name, present, pin_hash) values ($1, $2, $3, $4, $5, 'test-hash') returning id`,
      [`ENTRY-${String(i).padStart(3, '0')}`, i, `REG-${i}`, `Team ${i}`, i <= present]);
    await db.query(`insert into team_members (entry_id, member_position, full_name, email) values ($1, 1, $2, $3)`, [e.id, `Member ${i}`, `m${i}@test.local`]);
    entryIds.push(e.id);
  }
  return { adminId: admin.id, challengeIds, entryIds };
}

export async function setCommon(db: Pool, challengeIds: string[]) {
  await db.query('update challenges set common_slot = 1 where id = $1', [challengeIds[0]]);
  await db.query('update challenges set common_slot = 2 where id = $1', [challengeIds[1]]);
}

export async function studentSession(db: Pool, entryId: string) {
  const s = await one<{ id: string }>(db,
    `insert into auth_sessions (role, subject_id, entry_id, expires_at) values ('student', $1, $1, now() + interval '1 hour') returning id`, [entryId]);
  return s.id;
}
