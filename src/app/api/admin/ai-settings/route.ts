import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { hasStoredGeminiApiKey, removeGeminiApiKey, saveGeminiApiKey } from '@/lib/gemini/key-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const bodySchema = z.object({ apiKey: z.string().trim().min(20).max(512) });

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  return !origin || new URL(origin).origin === req.nextUrl.origin;
}
function unauthorized() {
  return NextResponse.json({ error: 'Admin access required.' }, { status: 401 });
}

export async function GET() {
  if (!requireRole('admin')) return unauthorized();
  try {
    const environmentConfigured = Boolean(process.env.GEMINI_API_KEY?.trim());
    const savedConfigured = environmentConfigured ? false : await hasStoredGeminiApiKey();
    return NextResponse.json({
      configured: environmentConfigured || savedConfigured,
      source: environmentConfigured ? 'environment' : savedConfigured ? 'admin-panel' : 'none',
      environmentOverride: environmentConfigured,
    });
  } catch {
    return NextResponse.json({ error: 'Could not read AI configuration.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = requireRole('admin');
  if (!session) return unauthorized();
  if (!sameOrigin(req)) return NextResponse.json({ error: 'Cross-origin request blocked.' }, { status: 403 });
  if (process.env.GEMINI_API_KEY?.trim()) {
    return NextResponse.json({ error: 'GEMINI_API_KEY is set in Vercel. Remove that environment variable to use the admin-panel key.' }, { status: 409 });
  }
  let rawBody: unknown;
  try { rawBody = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) return NextResponse.json({ error: 'Enter a valid Gemini API key.' }, { status: 400 });
  const apiKey = parsed.data.apiKey.trim();
  try {
    const testResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with OK.' }] }], generationConfig: { maxOutputTokens: 5, temperature: 0 } }),
      signal: AbortSignal.timeout(10000),
    });
    if (!testResponse.ok) {
      return NextResponse.json({ error: 'Gemini rejected this key or the model is unavailable (HTTP ' + testResponse.status + '). Check Google AI Studio access and quota.' }, { status: 422 });
    }
    await saveGeminiApiKey(apiKey);
    const { error: auditError } = await supabaseAdmin().from('admin_actions').insert({
      admin_id: session.userId, action: 'gemini_api_key_updated',
      reason: 'Gemini key validated and encrypted before storage',
      new_value: { configured: true, storage: 'encrypted_database' },
    });
    if (auditError) console.error('Could not write Gemini settings audit event.');
    return NextResponse.json({ ok: true, configured: true, message: 'Gemini key verified and saved securely.' });
  } catch (error) {
    const message = error instanceof Error && error.name === 'TimeoutError'
      ? 'Gemini validation timed out. Check your connection and try again.'
      : 'Could not validate or save the Gemini key. Check server configuration and try again.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = requireRole('admin');
  if (!session) return unauthorized();
  if (!sameOrigin(req)) return NextResponse.json({ error: 'Cross-origin request blocked.' }, { status: 403 });
  if (process.env.GEMINI_API_KEY?.trim()) {
    return NextResponse.json({ error: 'A deployment environment key is active and cannot be removed here.' }, { status: 409 });
  }
  try {
    await removeGeminiApiKey();
    const { error: auditError } = await supabaseAdmin().from('admin_actions').insert({
      admin_id: session.userId, action: 'gemini_api_key_removed',
      reason: 'Admin removed the encrypted Gemini key', new_value: { configured: false },
    });
    if (auditError) console.error('Could not write Gemini settings audit event.');
    return NextResponse.json({ ok: true, configured: false, message: 'Saved Gemini key removed.' });
  } catch {
    return NextResponse.json({ error: 'Could not remove the saved Gemini key.' }, { status: 500 });
  }
}
