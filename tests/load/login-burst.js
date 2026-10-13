// Scenario 1: 200 students press "Enter the arena" within the same few seconds.
import { check } from 'k6';
import { studentLogin, ENTRIES } from './common.js';

export const options = {
  scenarios: {
    login_burst: { executor: 'per-vu-iterations', vus: ENTRIES, iterations: 1, maxDuration: '60s' },
  },
  thresholds: {
    'http_req_failed{name:student_login}': ['rate<0.01'],
    'http_req_duration{name:student_login}': ['p(95)<2000', 'p(99)<4000'],
  },
};

export default function () {
  const { res } = studentLogin(__VU);
  check(res, { 'login 200': (r) => r.status === 200 });
}
