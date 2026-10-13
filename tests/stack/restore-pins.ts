/**
 * Resets synthetic staging entries 1..N to their deterministic staging PINs.
 * Staging only:  PGHOST=/tmp PGPORT=54329 SESSION_SECRET=… npx tsx tests/stack/restore-pins.ts peb_stage 220
 */
import { Client } from 'pg';
import { hashPin } from '../../src/lib/auth/pin';
import { stagingPin } from './seed-staging';

async function main() {
  const db = process.argv[2] ?? 'peb_stage';
  const n = Number(process.argv[3] ?? 220);
  if (/supabase|prod/i.test(`${process.env.PGHOST ?? ''} ${db}`)) throw new Error('refusing non-staging target');
  const c = new Client({ host: process.env.PGHOST ?? '/tmp', port: Number(process.env.PGPORT ?? 54329), user: 'postgres', database: db });
  await c.connect();
  const { rows } = await c.query<{ entry_number: number }>(`select entry_number from entries where registration_id like 'STG-REG-%' and entry_number <= $1`, [n]);
  const pins = await Promise.all(rows.map(async (r) => [r.entry_number, await hashPin(stagingPin(r.entry_number))] as const));
  await c.query(`update entries e set pin_hash = v.h, pin_set_at = now() from unnest($1::int[], $2::text[]) v(n, h) where e.entry_number = v.n`,
    [pins.map((p) => p[0]), pins.map((p) => p[1])]);
  await c.end();
  console.log(`restored ${pins.length} staging PINs`);
}
main().catch((e) => { console.error(e); process.exit(1); });
