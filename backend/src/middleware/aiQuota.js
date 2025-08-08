const { getRedisClient } = require('../config/redis');

function secondsUntilEndOfDay() {
  const now = new Date();
  const end = new Date(now);
  end.setHours(24, 0, 0, 0);
  return Math.max(1, Math.floor((end - now) / 1000));
}

function aiDailyQuota({ limit = 20 }) {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.id) return next(); // anonymous users skip quota
      const client = getRedisClient();
      const key = `aiq:${req.user.id}:${new Date().toISOString().slice(0,10)}`;
      const current = await client.get(key);
      const used = current ? parseInt(current, 10) : 0;
      if (used >= limit) {
        const ttl = await client.ttl(key);
        res.setHeader('Retry-After', Math.max(ttl, 1));
        return res.status(429).json({
          error: {
            code: 'ai_quota_exceeded',
            message: 'Günlük AI kullanım limitiniz doldu. Lütfen yarın tekrar deneyin.',
            requestId: req && req.requestId,
          }
        });
      }
      req.__aiQuotaKey = key;
      next();
    } catch (e) {
      // Fail-open on quota errors
      return next();
    }
  };
}

async function consumeAiQuota(req) {
  try {
    if (!req.__aiQuotaKey) return;
    const client = getRedisClient();
    const count = await client.incr(req.__aiQuotaKey);
    if (count === 1) {
      await client.expire(req.__aiQuotaKey, secondsUntilEndOfDay());
    }
  } catch (_) {}
}

module.exports = { aiDailyQuota, consumeAiQuota };

