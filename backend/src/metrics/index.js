const client = require('prom-client');

// Create a Registry which registers the metrics
const register = new client.Registry();

// Default metrics
client.collectDefaultMetrics({ register });

// Custom metrics
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.05, 0.1, 0.2, 0.5, 1, 2, 5]
});

const redisCacheHits = new client.Counter({
  name: 'redis_cache_hits_total',
  help: 'Total number of redis cache hits'
});

const redisCacheMisses = new client.Counter({
  name: 'redis_cache_misses_total',
  help: 'Total number of redis cache misses'
});

const aiQuotaUsed = new client.Counter({
  name: 'ai_quota_used_total',
  help: 'Total AI quota consumptions'
});

const httpTooManyRequests = new client.Counter({
  name: 'http_429_total',
  help: 'Total number of HTTP 429 responses'
});

register.registerMetric(httpRequestDuration);
register.registerMetric(redisCacheHits);
register.registerMetric(redisCacheMisses);
register.registerMetric(aiQuotaUsed);
register.registerMetric(httpTooManyRequests);

// Middleware to measure request durations
function metricsMiddleware(req, res, next) {
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    const route = req.route && req.route.path ? req.route.path : req.originalUrl.split('?')[0];
    end({ method: req.method, route, status_code: res.statusCode });
  });
  next();
}

module.exports = {
  register,
  metricsMiddleware,
  counters: {
    redisCacheHits,
    redisCacheMisses,
    aiQuotaUsed,
    httpTooManyRequests,
  }
};

