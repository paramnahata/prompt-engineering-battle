import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE, ENTRIES, jsonHeaders, studentLogin } from './common.js';

/**
 * Pre-start waiting room: every team signed in, polling its dashboard
 * (status, team, announcements) every ~4 s with a heartbeat, as the real
 * page does. Staging / synthetic data only.
 */
export const options = {
  scenarios: { waiting: { executor: 'constant-vus', vus: ENTRIES, duration: __ENV.DURATION || '90s', exec: 'waiting' } },
  thresholds: {
    'http_req_failed{scenario:waiting}': ['rate<0.005'],
    'http_req_duration{name:dashboard}': ['p(95)<800'],
  },
};

export function setup() {
  const cookies = [];
  for (let n = 1; n <= ENTRIES; n++) {
    const { res, cookie } = studentLogin(n, { phase: 'setup' });
    if (!cookie) throw new Error(`setup login ${n} failed: ${res.status} ${res.body}`);
    cookies.push(cookie);
  }
  return { cookies };
}

export function waiting(data) {
  const p = jsonHeaders(data.cookies[(__VU - 1) % ENTRIES]);
  sleep(Math.random() * 4);
  for (let i = 0; ; i++) {
    const r = http.get(`${BASE}/api/student/dashboard`, { ...p, tags: { name: 'dashboard' } });
    check(r, { 'dashboard 200': (x) => x.status === 200 && x.json('ok') === true });
    if (i % 5 === 0) http.post(`${BASE}/api/student/heartbeat`, JSON.stringify({ visible: true }), { ...p, tags: { name: 'heartbeat' } });
    sleep(4 * (0.85 + Math.random() * 0.3));
  }
}
