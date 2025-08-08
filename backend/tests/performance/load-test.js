import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { Rate } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');

// Test configuration
export let options = {
  stages: [
    { duration: '2m', target: 100 }, // Ramp up to 100 users
    { duration: '5m', target: 100 }, // Stay at 100 users
    { duration: '2m', target: 200 }, // Ramp up to 200 users
    { duration: '5m', target: 200 }, // Stay at 200 users
    { duration: '2m', target: 0 },   // Ramp down to 0 users
  ],
  thresholds: {
    http_req_duration: ['p(95)<500','p(99)<800'], // P95/P99 latency
    http_req_failed: ['rate<0.01'],    // Error rate must be below 1%
    checks: ['rate>0.95'],
    errors: ['rate<0.01'],             // Custom error rate
  },
};

// Test data
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

const testUsers = [
  { email: 'user1@test.com', password: 'TestPass123!' },
  { email: 'user2@test.com', password: 'TestPass123!' },
  { email: 'user3@test.com', password: 'TestPass123!' },
];

// Helper function to get random user
function getRandomUser() {
  return testUsers[Math.floor(Math.random() * testUsers.length)];
}

// Login and get token
function login() {
  const user = getRandomUser();
  
  const loginResponse = http.post(`${BASE_URL}/api/auth/login`, {
    email: user.email,
    password: user.password,
  }, {
    headers: { 'Content-Type': 'application/json' },
  });

  const loginSuccess = check(loginResponse, {
    'login status is 200': (r) => r.status === 200,
    'login response time < 1000ms': (r) => r.timings.duration < 1000,
  });

  if (!loginSuccess) {
    errorRate.add(1);
    return null;
  }

  const token = loginResponse.json('token');
  // Propagate request-id if exists
  const rid = loginResponse.headers['x-request-id'];
  if (rid) {
    exec.vu.tags['x-request-id'] = rid;
  }
  return token;
}

// Test scenarios
export default function () {
  // Health check
  const healthResponse = http.get(`${BASE_URL}/health`);
  check(healthResponse, {
    'health check status is 200': (r) => r.status === 200,
    'health check response time < 200ms': (r) => r.timings.duration < 200,
  });

  // Authentication flow
  const token = login();
  if (!token) {
    return;
  }

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  // Test fortune generation
  const fortuneTypes = ['tarot', 'horoscope'];
  const fortuneType = fortuneTypes[Math.floor(Math.random() * fortuneTypes.length)];

  let fortunePayload;
  if (fortuneType === 'tarot') {
    fortunePayload = {
      type: 'tarot',
      data: {
        spread: 'single',
        question: 'What does the future hold for me?'
      }
    };
  } else {
    fortunePayload = {
      type: 'horoscope',
      data: {
        sign: 'aries',
        period: 'daily'
      }
    };
  }

  const fortuneResponse = http.post(
    `${BASE_URL}/api/fortunes/${fortuneType}`,
    JSON.stringify(fortunePayload),
    { headers }
  );

  const fortuneSuccess = check(fortuneResponse, {
    'fortune generation status is 200': (r) => r.status === 200,
    'fortune generation response time < 3000ms': (r) => r.timings.duration < 3000,
    'fortune contains content': (r) => r.json('data.content') !== undefined,
  });

  if (!fortuneSuccess) {
    errorRate.add(1);
  }

  // Test reading history
  const historyResponse = http.get(`${BASE_URL}/api/fortunes/history`, { headers });
  check(historyResponse, {
    'history status is 200': (r) => r.status === 200,
    'history response time < 1000ms': (r) => r.timings.duration < 1000,
  });

  // Test user profile
  const profileResponse = http.get(`${BASE_URL}/api/auth/me`, { headers });
  check(profileResponse, {
    'profile status is 200': (r) => r.status === 200,
    'profile response time < 500ms': (r) => r.timings.duration < 500,
  });

  // Test daily horoscopes (public endpoint)
  const horoscopeResponse = http.get(`${BASE_URL}/api/fortunes/horoscope/daily`);
  check(horoscopeResponse, {
    'daily horoscope status is 200': (r) => r.status === 200,
    'daily horoscope response time < 1000ms': (r) => r.timings.duration < 1000,
    'horoscope data contains all signs': (r) => {
      const data = r.json('data');
      return Object.keys(data).length === 12;
    },
  });

  sleep(1); // Wait 1 second between iterations
}