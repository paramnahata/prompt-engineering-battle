import 'server-only';
import crypto from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/server';

const SETTING_KEY = 'gemini_api_key_encrypted';
type EncryptedSecret = { version: 1; iv: string; tag: string; ciphertext: string };

function encryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must be configured with a long random value before storing an AI key.');
  }
  return crypto.createHash('sha256').update('prompt-engineering-battle:gemini-key:v1:' + secret).digest();
}

function encryptGeminiKey(apiKey: string): EncryptedSecret {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  return { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}

function decryptGeminiKey(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const secret = value as Partial<EncryptedSecret>;
  if (secret.version !== 1 || !secret.iv || !secret.tag || !secret.ciphertext) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(secret.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(secret.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(secret.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Stored Gemini key could not be decrypted. Re-enter it from Admin → AI Judging.');
  }
}

export async function getGeminiApiKey(): Promise<string | null> {
  const envKey = process.env.GEMINI_API_KEY?.trim();
  if (envKey) return envKey;
  const { data, error } = await supabaseAdmin().from('event_settings').select('value').eq('key', SETTING_KEY).maybeSingle();
  if (error) throw new Error('Could not load Gemini configuration from the database.');
  return decryptGeminiKey(data?.value);
}

export async function saveGeminiApiKey(apiKey: string): Promise<void> {
  const { error } = await supabaseAdmin().from('event_settings').upsert({
    key: SETTING_KEY, value: encryptGeminiKey(apiKey), updated_at: new Date().toISOString(),
  }, { onConflict: 'key' });
  if (error) throw new Error('Could not save the encrypted Gemini configuration.');
}

export async function removeGeminiApiKey(): Promise<void> {
  const { error } = await supabaseAdmin().from('event_settings').delete().eq('key', SETTING_KEY);
  if (error) throw new Error('Could not remove the saved Gemini configuration.');
}

export async function hasStoredGeminiApiKey(): Promise<boolean> {
  const { data, error } = await supabaseAdmin().from('event_settings').select('key').eq('key', SETTING_KEY).maybeSingle();
  if (error) throw new Error('Could not check Gemini configuration.');
  return Boolean(data);
}
