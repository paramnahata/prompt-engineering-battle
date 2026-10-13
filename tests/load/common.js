import http from 'k6/http';
import crypto from 'k6/crypto';

export const BASE = __ENV.APP_URL || 'http://127.0.0.1:3100';
export const ENTRIES = Number(__ENV.ENTRIES || 200);
export const COOKIE_NAME = __ENV.COOKIE_NAME || '__Host-peb_session';

/** Staging only: the access code is derived from the staging EVENT_SECRET (never use production secrets). */
export function accessCode() {
  const windowIndex = Math.floor(Date.now() / 120000);
  const hex = crypto.hmac('sha256', __ENV.EVENT_SECRET, String(windowIndex), 'hex');
  return String(parseInt(hex.slice(0, 8), 16) % 10000).padStart(4, '0');
}

export function jsonHeaders(cookie) {
  const h = { 'Content-Type': 'application/json' };
  if (cookie) h.Cookie = cookie;
  return { headers: h };
}

export function cookieFrom(res) {
  const c = res.cookies[COOKIE_NAME];
  return c && c.length ? `${COOKIE_NAME}=${c[0].value}` : null;
}

export function studentLogin(n, tags = {}) {
  const res = http.post(`${BASE}/api/student/login`, JSON.stringify({ entryCode: String(n), accessCode: accessCode() }), { headers: { 'Content-Type': 'application/json' }, tags: { name: 'student_login', ...tags } });
  return { res, cookie: res.status === 200 ? cookieFrom(res) : null };
}

export function organizerLogin(email) {
  const res = http.post(`${BASE}/api/organizer/login`, JSON.stringify({ email, password: __ENV.STAGING_PASSWORD }), { headers: { 'Content-Type': 'application/json' }, tags: { name: 'organizer_login' } });
  return cookieFrom(res);
}
