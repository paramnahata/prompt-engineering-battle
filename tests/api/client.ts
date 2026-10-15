import fs from 'node:fs';
import crypto from 'node:crypto';
import { teamCodeFor, teamCodeKey, teamCodeWindow } from '@/lib/auth/team-code';

/** Minimal cookie-jar HTTP client for tests against the local staging stack. */
export const BASE = process.env.APP_URL ?? 'http://127.0.0.1:3100';

export function loadStackEnv(file = process.env.STACK_ENV ?? '/tmp/peb-stack/app.env'): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]!] = m[2]!;
  }
  return env;
}

export class Actor {
  cookie: string | null = null;
  constructor(public name: string) {}
  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(BASE + path, {
      method,
      redirect: 'manual',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) {
      const pair = c.split(';')[0]!;
      if (/=$/.test(pair) || /max-age=0/i.test(c)) this.cookie = null;
      else this.cookie = pair;
    }
    let json: Record<string, unknown> = {};
    const text = await res.text();
    try { json = JSON.parse(text); } catch { /* html */ }
    return { status: res.status, json, headers: res.headers, text };
  }
}

export function accessCode(eventSecret: string, nowMs = Date.now()) {
  const h = crypto.createHmac('sha256', eventSecret).update(String(Math.floor(nowMs / 120_000))).digest('hex');
  return (parseInt(h.slice(0, 8), 16) % 10_000).toString().padStart(4, '0');
}

export function signToken(secret: string, claims: Record<string, unknown>) {
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', secret).update(body).digest('base64url')}`;
}

export const COOKIE = '__Host-peb_session';

/** The team's current rotating PIN (changes every 60 s), derived like the app does from the staging secrets. */
export function stagingPin(n: number, nowMs = Date.now()): string {
  return teamCodeFor(n, teamCodeWindow(nowMs), teamCodeKey(loadStackEnv()));
}
