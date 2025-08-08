const request = require('supertest');
const app = require('../../src/index');

describe('GET /api/payments/availability', () => {
  test('returns availability with cache-control', async () => {
    process.env.PAYMENTS_DCB_ENABLED = 'true';
    process.env.PAYMENTS_CARRIERS = 'Turkcell,Vodafone';
    const res = await request(app).get('/api/payments/availability');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toMatch(/max-age=300/);
    expect(res.body.success).toBe(true);
    expect(res.body.data.dcb).toBe(true);
    expect(res.body.data.carriers).toEqual(['Turkcell','Vodafone']);
  });
});

