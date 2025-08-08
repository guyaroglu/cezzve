const request = require('supertest');
const app = require('../../src/index');

describe('Payments Webhook Verification', () => {
  test('Stripe webhook with invalid signature returns 401', async () => {
    const res = await request(app)
      .post('/api/payments/webhook/stripe')
      .set('stripe-signature', 'invalid')
      .send('{}');
    expect([400,401]).toContain(res.statusCode);
  });

  test('Iyzico webhook with invalid signature returns 401', async () => {
    const res = await request(app)
      .post('/api/payments/webhook/iyzico')
      .set('x-iyzi-signature', 'invalid')
      .send('{}');
    expect([400,401]).toContain(res.statusCode);
  });
});

