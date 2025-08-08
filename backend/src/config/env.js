const { z } = require('zod');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.string().transform(Number).default('3000'),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.string().transform(Number).default('6379'),
  REDIS_DB: z.string().transform(Number).default('0'),
  REDIS_PASSWORD: z.string().optional().or(z.literal('')),

  // Stripe
  STRIPE_SECRET_KEY: z.string().min(1, 'STRIPE_SECRET_KEY is required'),
  STRIPE_WEBHOOK_SECRET: z.string().min(1, 'STRIPE_WEBHOOK_SECRET is required'),

  // Iyzico
  IYZICO_API_KEY: z.string().min(1, 'IYZICO_API_KEY is required'),
  IYZICO_SECRET_KEY: z.string().min(1, 'IYZICO_SECRET_KEY is required'),
  IYZICO_BASE_URL: z.string().url().default('https://sandbox-api.iyzipay.com'),
  IYZICO_WEBHOOK_SECRET: z.string().min(1, 'IYZICO_WEBHOOK_SECRET is required'),

  // CORS
  FRONTEND_URL: z.string().url().default('http://localhost:19006'),
});

function parseEnv(env) {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    const formatted = result.error.format();
    // Throw a readable error
    throw new Error(`Invalid environment configuration: ${JSON.stringify(formatted, null, 2)}`);
  }
  return result.data;
}

module.exports = { parseEnv };

