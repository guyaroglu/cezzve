# FalYolu Backend

## Yeni Middleware ve İzleme

- aiQuota (`src/middleware/aiQuota.js`)
  - Kullanıcı bazlı günlük AI kota kontrolü (Redis)
  - Limit aşımında 429 + Retry-After (günün kalan süresi)
- rateLimitRedis (`src/middleware/rateLimitRedis.js`)
  - Redis tabanlı rate-limit kovaları (payments/webhook)
- /metrics (`src/metrics/index.js`)
  - Prometheus metrikleri: `http_request_duration_seconds`, `redis_cache_hits_total`, `redis_cache_misses_total`, `ai_quota_used_total`, `http_429_total`

## OpenAPI & Contract Test

- OpenAPI şeması: `backend/openapi.yaml`
- Contract test: `backend/tests/integration/openapiContract.test.js` (swagger-parser ile doğrulama)
- CI’de swagger-cli validate adımı ekleyin (önerilir)

## Config ve Feature Flag Kullanımı

Bkz: `backend/README-CONFIG.md`

## Ödeme Uygunluğu

Bkz: `backend/README-PAYMENTS-AVAILABILITY.md`

## Çalıştırma

```
npm ci
npm run dev
```

Env değişkenleri için `.env` dosyasını doldurun.
