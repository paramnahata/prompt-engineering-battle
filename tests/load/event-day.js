// Scenarios 2-6: 200 students active in the arena (typing → autosave, status
// polling, heartbeats) + organizer dashboards + registration desk. The round
// is configured with a short challenge timer so every client's timer expires
// at the same moment → synchronized advance storm (each sent twice).
// Run only against STAGING with synthetic data (tests/stack/start.sh).
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { BASE, ENTRIES, jsonHeaders, organizerLogin, studentLogin } from './common.js';

const ARENA = __ENV.ARENA_DURATION || '4m';
const conflicts = new Counter('unexpected_409');

export const options = {
  setupTimeout: '120s',
  scenarios: {
    arena: { executor: 'constant-vus', vus: ENTRIES, duration: ARENA, exec: 'arena' },
    admin_dashboard: { executor: 'constant-vus', vus: 2, duration: ARENA, exec: 'adminDashboard' },
    registration_desk: { executor: 'constant-vus', vus: 3, duration: ARENA, exec: 'desk' },
  },
  thresholds: {
    'http_req_failed{scenario:arena}': ['rate<0.005'],
    'http_req_duration{scenario:arena}': ['p(95)<800', 'p(99)<2000'],
    'http_req_duration{name:autosave}': ['p(95)<800'],
    'http_req_duration{scenario:admin_dashboard}': ['p(95)<1500'],
    'http_req_duration{scenario:registration_desk}': ['p(95)<1500'],
    'http_req_duration{name:advance}': ['p(95)<2500'],
    unexpected_409: ['count<1'],
  },
};

export function setup() {
  const cookies = [];
  for (let n = 1; n <= ENTRIES; n++) {
    const { res, cookie } = studentLogin(n, { phase: 'setup' });
    if (!cookie) throw new Error(`setup login ${n} failed: ${res.status} ${res.body}`);
    cookies.push(cookie);
  }
  return { cookies, admin: organizerLogin('admin@staging.local'), desk: organizerLogin('desk@staging.local') };
}

const words = ['clear', 'concise', 'role', 'context', 'format', 'audience', 'tone', 'example', 'constraint', 'steps'];

export function arena(data) {
  const cookie = data.cookies[(__VU - 1) % ENTRIES];
  const p = jsonHeaders(cookie);
  let current = null;
  let endAtMs = null;
  let offsetMs = 0;
  const refresh = () => {
    const s = http.get(`${BASE}/api/student/round1/state`, { ...p, tags: { name: 'state' } });
    check(s, { 'state 200': (r) => r.status === 200 });
    if (s.status !== 200) return;
    current = s.json('currentSubmissionId');
    offsetMs = Date.parse(s.json('serverNow')) - Date.now();
    const subs = s.json('submissions') || [];
    const sub = subs.find((x) => x.id === current);
    endAtMs = sub && sub.question_end_at ? Date.parse(sub.question_end_at) : null;
  };
  refresh();
  let text = '';
  for (let i = 0; i < 10000; i++) {
    const now = Date.now() + offsetMs;
    if (current && endAtMs && now >= endAtMs) {
      // Timer expired: every client fires advance at the same moment (sent twice: timer + button).
      const body = JSON.stringify({ submissionId: current, promptText: text, aiOutputText: 'final output' });
      const res = http.batch([
        ['POST', `${BASE}/api/student/round1/advance`, body, { ...p, tags: { name: 'advance' } }],
        ['POST', `${BASE}/api/student/round1/advance`, body, { ...p, tags: { name: 'advance' } }],
      ]);
      check(res[0], { 'advance ok': (r) => r.status === 200 });
      check(res[1], { 'duplicate advance harmless': (r) => r.status === 200 });
      text = '';
      refresh();
      continue;
    }
    text += ` ${words[(i + __VU) % words.length]}`;
    if (text.split(' ').length > 100) text = 'restart';
    if (current) {
      const r = http.post(`${BASE}/api/student/round1/autosave`, JSON.stringify({ submissionId: current, promptText: text, aiOutputText: `output ${i}` }), { ...p, tags: { name: 'autosave' } });
      check(r, { 'autosave ok': (x) => x.status === 200 });
      if (r.status === 409) conflicts.add(1, { code: String(r.json('code')) });
    }
    if (i % 4 === 0) http.post(`${BASE}/api/student/heartbeat`, JSON.stringify({ visible: true }), { ...p, tags: { name: 'heartbeat' } });
    http.get(`${BASE}/api/student/waiting/state`, { ...p, tags: { name: 'round_status' } });
    if (i % 6 === 5) refresh();
    const untilEnd = endAtMs ? (endAtMs - (Date.now() + offsetMs)) / 1000 : 99;
    sleep(Math.max(0.05, Math.min(4 + Math.random() * 2, untilEnd)));
  }
}

export function adminDashboard(data) {
  const p = jsonHeaders(data.admin);
  http.get(`${BASE}/api/admin/round1/status`, { ...p, tags: { name: 'admin_status' } });
  http.get(`${BASE}/api/admin/student-logins`, { ...p, tags: { name: 'live_participants' } });
  http.get(`${BASE}/api/display/stats`, { ...p, tags: { name: 'display_stats' } });
  sleep(5);
}

export function desk(data) {
  const p = jsonHeaders(data.desk);
  const list = http.get(`${BASE}/api/admin/participants`, { ...p, tags: { name: 'participants' } });
  check(list, { 'participants 200': (r) => r.status === 200 });
  http.get(`${BASE}/api/access-code`, { ...p, tags: { name: 'access_code' } });
  sleep(10);
}
