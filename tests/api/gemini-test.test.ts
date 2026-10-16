import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Actor } from './client';

/** Admin → AI Judging "Test Gemini now" (PUT /api/admin/ai-settings) against the mock Gemini. */
const PASSWORD = 'Staging-Only-Password-1';

test('admin can test Gemini and sees which model answered', async () => {
  const admin = new Actor('admin');
  const login = await admin.req('POST', '/api/organizer/login', { email: 'admin@staging.local', password: PASSWORD });
  assert.equal(login.status, 200);

  const status = await admin.req('GET', '/api/admin/ai-settings');
  assert.equal(status.status, 200);
  const s = status.json as { models: string[]; model: string };
  assert.ok(Array.isArray(s.models) && s.models[0] === s.model, 'status lists the model chain, primary first');

  // The mock injects occasional 429/500s; a real admin would just press the button again.
  let last: { status: number; json: unknown } | null = null;
  for (let i = 0; i < 6; i++) {
    last = await admin.req('PUT', '/api/admin/ai-settings');
    if (last.status === 200) break;
    assert.ok([429, 502].includes(last.status), `unexpected status ${last.status}`);
  }
  assert.equal(last!.status, 200, JSON.stringify(last!.json));
  const body = last!.json as { ok: boolean; model: string; message: string };
  assert.equal(body.ok, true);
  assert.ok(s.models.includes(body.model));
  assert.match(body.message, /Gemini works/);
});

test('non-admins cannot run the Gemini test', async () => {
  const anon = new Actor('anon');
  const r = await anon.req('PUT', '/api/admin/ai-settings');
  assert.ok([401, 403].includes(r.status));
});
