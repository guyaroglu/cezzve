const request = require('supertest');
const app = require('../../src/index');
const swaggerParser = require('@apidevtools/swagger-parser');

describe('OpenAPI contract', () => {
  let api;
  beforeAll(async () => {
    api = await swaggerParser.validate(require('path').join(__dirname, '../../openapi.yaml'));
  });

  test('GET /api/payments/availability matches shape', async () => {
    const res = await request(app).get('/api/payments/availability');
    expect([200,429,503]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      expect(typeof res.body.success).toBe('boolean');
      expect(res.body.data).toHaveProperty('dcb');
      expect(Array.isArray(res.body.data.carriers)).toBe(true);
    }
  });
});

