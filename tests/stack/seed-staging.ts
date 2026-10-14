/**
 * Synthetic staging data for local API + load tests. Never run against production.
 *   PGHOST=/tmp PGPORT=54329 npx tsx tests/stack/seed-staging.ts peb_stage 220
 */
import { Client } from 'pg';
import { hashPassword } from '../../src/lib/auth/password';
import { hashPin } from '../../src/lib/auth/pin';

/** Deterministic PINs for SYNTHETIC staging entries only (load tests need to know them). */
export function stagingPin(entryNumber: number): string {
  return String((entryNumber * 7919 + 104729) % 1_000_000).padStart(6, '0');
}

export const STAGING_PASSWORD = 'Staging-Only-Password-1';

async function main() {
  const db = process.argv[2] ?? 'peb_stage';
  const entries = Number(process.argv[3] ?? 220);
  if (/supabase|prod/i.test(process.env.PGHOST ?? '')) throw new Error('refusing remote host');
  const c = new Client({ host: process.env.PGHOST ?? '/tmp', port: Number(process.env.PGPORT ?? 54329), user: 'postgres', database: db });
  await c.connect();
  const hash = hashPassword(STAGING_PASSWORD);
  await c.query(`insert into admins (email, password_hash, full_name, role) values
    ('admin@staging.local', $1, 'Staging Admin', 'admin'),
    ('admin2@staging.local', $1, 'Staging Admin 2', 'admin'),
    ('desk@staging.local', $1, 'Staging Desk', 'volunteer')`, [hash]);
  await c.query(`insert into judges (email, password_hash, full_name) values ('judge@staging.local', $1, 'Staging Judge')`, [hash]);
  for (let i = 1; i <= 30; i++) {
    await c.query(`insert into challenges (challenge_code, title, problem_statement, instructions, constraints, prompt_word_limit, output_char_limit, common_slot, difficulty, pool_status, category)
      values ($1, $2, $3, 'Write the best prompt.', 'Stay under the limits.', 120, 1500, $4, $5, 'approved', $6)`,
      [`STG-${String(i).padStart(3, '0')}`, `Staging challenge ${i}`, `Synthetic problem statement ${i}.`, i <= 2 ? i : null,
       ['easy', 'medium', 'hard', 'expert'][i % 4], ['Logic', 'Data', 'Creative', 'Coding'][i % 4]]);
  }
  await c.query('begin');
  for (let i = 1; i <= entries; i++) {
    const { rows } = await c.query(`insert into entries (entry_code, entry_number, registration_id, team_name, is_team, present, payment_status, pin_hash, pin_set_at)
      values ($1, $2, $3, $4, $5, true, 'paid', $6, now()) returning id`,
      [`ENTRY-${String(i).padStart(3, '0')}`, i, `STG-REG-${i}`, i % 3 === 0 ? null : `Team ${i}`, i % 3 !== 0, await hashPin(stagingPin(i))]);
    await c.query(`insert into team_members (entry_id, member_position, full_name, email, phone) values ($1, 1, $2, $3, $4)`,
      [rows[0].id, `Student ${i}A`, `s${i}a@staging.local`, `90000${String(i).padStart(5, '0')}`]);
    if (i % 3 !== 0) await c.query(`insert into team_members (entry_id, member_position, full_name, email, phone) values ($1, 2, $2, $3, $4)`,
      [rows[0].id, `Student ${i}B`, `s${i}b@staging.local`, `91000${String(i).padStart(5, '0')}`]);
  }
  await c.query('commit');
  await c.end();
  console.log(`seeded ${db}: ${entries} entries, 30 challenges, 4 organizer accounts`);
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
