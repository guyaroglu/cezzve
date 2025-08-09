import http from 'k6/http';
import { check, sleep } from 'k6';

export let options = {
  scenarios: {
    login_scn: {
      executor: 'constant-vus',
      vus: 10,
      duration: '30s',
      exec: 'loginScenario',
    },
    subscribe_scn: {
      executor: 'constant-vus',
      vus: 5,
      duration: '30s',
      exec: 'subscribeScenario',
    },
    webhook_scn: {
      executor: 'per-vu-iterations',
      vus: 3,
      iterations: 5,
      exec: 'webhookScenario',
    },
    purchase_success_scn: {
      executor: 'constant-vus',
      vus: 5,
      duration: '30s',
      exec: 'purchaseSuccessScenario',
    },
    purchase_fail_scn: {
      executor: 'constant-vus',
      vus: 3,
      duration: '30s',
      exec: 'purchaseFailScenario',
    },
    availability_cache_hit_scn: {
      executor: 'per-vu-iterations',
      vus: 5,
      iterations: 3,
      exec: 'availabilityCacheHitScenario',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500','p(99)<800'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.95'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export function loginScenario() {
  const res = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({ email: 'user@test.com', password: 'TestPass123!' }), { headers: { 'Content-Type': 'application/json' }});
  check(res, { 'login 200': (r) => r.status === 200 });
  sleep(1);
}

export function subscribeScenario() {
  const idem = `perf-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  const res = http.post(`${BASE_URL}/api/payments/subscribe`, JSON.stringify({ planId: 'monthly', paymentMethod: 'paypal', paymentData: {} }), {
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idem }
  });
  const retryAfter = res.headers['Retry-After'];
  if (res.status === 409 && retryAfter) {
    sleep(parseInt(retryAfter, 10));
    const res2 = http.post(`${BASE_URL}/api/payments/subscribe`, JSON.stringify({ planId: 'monthly', paymentMethod: 'paypal', paymentData: {} }), {
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idem }
    });
    check(res2, { 'subscribe 200/201/409': (r) => [200,201,409].includes(r.status) });
  } else {
    check(res, { 'subscribe 200/201/409': (r) => [200,201,409].includes(r.status) });
  }
  sleep(1);
}

export function webhookScenario() {
  // Invalid signatures should fail
  const stripe = http.post(`${BASE_URL}/api/payments/webhook/stripe`, '{}', { headers: { 'Content-Type': 'application/json', 'stripe-signature': 'invalid' }});
  const iyzico = http.post(`${BASE_URL}/api/payments/webhook/iyzico`, '{}', { headers: { 'Content-Type': 'application/json', 'x-iyzi-signature': 'invalid' }});
  check(stripe, { 'stripe 401/400': (r) => [400,401].includes(r.status) });
  check(iyzico, { 'iyzico 401/400': (r) => [400,401].includes(r.status) });
  sleep(1);
}

export function purchaseSuccessScenario() {
  const idem = `ok-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  const res = http.post(`${BASE_URL}/api/payments/subscribe`, JSON.stringify({ planId: 'monthly', paymentMethod: 'paypal', paymentData: {} }), {
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idem }
  });
  check(res, { 'purchase success status': (r) => [200,201,409].includes(r.status) });
  sleep(1);
}

export function purchaseFailScenario() {
  // Intentionally use stripe without proper setup to simulate failure
  const idem = `fail-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  const res = http.post(`${BASE_URL}/api/payments/subscribe`, JSON.stringify({ planId: 'monthly', paymentMethod: 'stripe', paymentData: {} }), {
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idem }
  });
  check(res, { 'purchase fail (non-2xx)': (r) => r.status >= 400 });
  sleep(1);
}

export function availabilityCacheHitScenario() {
  // First call warms cache
  const r1 = http.get(`${BASE_URL}/api/payments/availability`);
  check(r1, { 'availability 200': (r) => r.status === 200 });
  // Subsequent calls should be faster (cache hit). Target < 50ms
  const r2 = http.get(`${BASE_URL}/api/payments/availability`);
  const r3 = http.get(`${BASE_URL}/api/payments/availability`);
  check(r2, { 'availability cache-hit fast': (r) => r.timings.duration < 50 });
  check(r3, { 'availability cache-hit fast 2': (r) => r.timings.duration < 50 });
  sleep(1);
}

 