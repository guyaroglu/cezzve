const { getRedisClient } = require('../config/redis');

function rateLimitRedis({ bucket, windowSec = 60, max = 60, useUserId = false }) {
  return async (req, res, next) => {
    try {
      const client = getRedisClient();
      const identifier = useUserId && req.user ? req.user.id : (req.ip || req.headers['x-forwarded-for'] || 'unknown');
      const key = `rl:${bucket}:${identifier}`;
      const count = await client.incr(key);
      if (count === 1) {
        await client.expire(key, windowSec);
      }
      if (count > max) {
        const ttl = await client.ttl(key);
        res.setHeader('Retry-After', Math.max(ttl, 1));
        return res.status(429).json({
          error: {
            code: 'TOO_MANY_REQUESTS',
            message: 'Too many requests. Please try again later.',
            requestId: req && req.requestId,
          }
        });
      }
      return next();
    } catch (err) {
      // On redis failure, fail-open
      if (req && req.log) req.log.warn({ err }, 'rateLimitRedis failed open');
      return next();
    }
  };
}

module.exports = { rateLimitRedis };

