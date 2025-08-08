const { createClient } = require('redis');
const logger = require('../utils/logger');

let redisClient = null;

const connectRedis = async () => {
  try {
    if (redisClient && redisClient.isOpen) {
      logger.info('Redis already connected');
      return redisClient;
    }

    const redisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT) || 6379,
      db: parseInt(process.env.REDIS_DB) || 0,
    };

    if (process.env.REDIS_PASSWORD) {
      redisConfig.password = process.env.REDIS_PASSWORD;
    }

    redisClient = createClient({
      socket: {
        host: redisConfig.host,
        port: redisConfig.port,
      },
      password: redisConfig.password,
      database: redisConfig.db,
      retry_strategy: (options) => {
        if (options.error && options.error.code === 'ECONNREFUSED') {
          logger.error('Redis server refused connection');
          return new Error('Redis server refused connection');
        }
        if (options.total_retry_time > 1000 * 60 * 60) {
          logger.error('Redis retry time exhausted');
          return new Error('Retry time exhausted');
        }
        if (options.attempt > 10) {
          logger.error('Redis max attempts reached');
          return undefined;
        }
        // Exponential backoff
        return Math.min(options.attempt * 100, 3000);
      }
    });

    redisClient.on('error', (err) => {
      logger.error('Redis Client Error:', err);
    });

    redisClient.on('connect', () => {
      logger.info('Redis Client Connected');
    });

    redisClient.on('ready', () => {
      logger.info('Redis Client Ready');
    });

    redisClient.on('end', () => {
      logger.info('Redis Client Disconnected');
    });

    await redisClient.connect();
    logger.info('Redis connected successfully');
    
    return redisClient;
  } catch (error) {
    logger.error('Redis connection error:', error);
    throw error;
  }
};

const getRedisClient = () => {
  if (!redisClient || !redisClient.isOpen) {
    throw new Error('Redis not connected. Call connectRedis() first.');
  }
  return redisClient;
};

// Cache helper functions
const cache = {
  set: async (key, value, expireInSeconds = 3600) => {
    try {
      const client = getRedisClient();
      const serializedValue = JSON.stringify(value);
      await client.setEx(key, expireInSeconds, serializedValue);
      logger.debug(`Cache set: ${key} (expires in ${expireInSeconds}s)`);
    } catch (error) {
      logger.error('Cache set error:', error);
      throw error;
    }
  },

  get: async (key) => {
    try {
      const client = getRedisClient();
      const value = await client.get(key);
      if (value) {
        logger.debug(`Cache hit: ${key}`);
        return JSON.parse(value);
      }
      logger.debug(`Cache miss: ${key}`);
      return null;
    } catch (error) {
      logger.error('Cache get error:', error);
      return null; // Return null on error to not break the app
    }
  },

  del: async (key) => {
    try {
      const client = getRedisClient();
      await client.del(key);
      logger.debug(`Cache deleted: ${key}`);
    } catch (error) {
      logger.error('Cache delete error:', error);
      throw error;
    }
  },

  exists: async (key) => {
    try {
      const client = getRedisClient();
      const exists = await client.exists(key);
      return exists === 1;
    } catch (error) {
      logger.error('Cache exists error:', error);
      return false;
    }
  },

  flush: async () => {
    try {
      const client = getRedisClient();
      await client.flushDb();
      logger.info('Cache flushed');
    } catch (error) {
      logger.error('Cache flush error:', error);
      throw error;
    }
  },

  // Set with hash for complex objects
  hset: async (key, field, value, expireInSeconds = 3600) => {
    try {
      const client = getRedisClient();
      const serializedValue = JSON.stringify(value);
      await client.hSet(key, field, serializedValue);
      await client.expire(key, expireInSeconds);
      logger.debug(`Hash cache set: ${key}.${field}`);
    } catch (error) {
      logger.error('Hash cache set error:', error);
      throw error;
    }
  },

  hget: async (key, field) => {
    try {
      const client = getRedisClient();
      const value = await client.hGet(key, field);
      if (value) {
        logger.debug(`Hash cache hit: ${key}.${field}`);
        return JSON.parse(value);
      }
      logger.debug(`Hash cache miss: ${key}.${field}`);
      return null;
    } catch (error) {
      logger.error('Hash cache get error:', error);
      return null;
    }
  }
};

// Cache keys constants
const CacheKeys = {
  USER_PROFILE: (userId) => `user:profile:${userId}`,
  DAILY_HOROSCOPE: (sign, date) => `horoscope:${sign}:${date}`,
  TAROT_READING: (userId, date) => `tarot:${userId}:${date}`,
  OPENAI_RESPONSE: (prompt) => `ai:${Buffer.from(prompt).toString('base64')}`,
  PAYMENT_SESSION: (sessionId) => `payment:session:${sessionId}`,
  RATE_LIMIT: (ip) => `rate_limit:${ip}`,
  USER_SUBSCRIPTION: (userId) => `subscription:${userId}`,
  COMMUNITY_POSTS: (page) => `community:posts:${page}`,
  DREAM_INTERPRETATION: (keywords) => `dream:${keywords.sort().join(':')}`,
  NUMEROLOGY_READING: (birthDate) => `numerology:${birthDate}`,
  // Idempotency keys for payment initiation to prevent duplicates
  PAYMENT_IDEMPOTENCY: (key) => `payment:idempotency:${key}`,
  // Processed webhook events cache to avoid reprocessing
  WEBHOOK_EVENT: (eventId) => `webhook:event:${eventId}`,
};

module.exports = {
  connectRedis,
  getRedisClient,
  cache,
  CacheKeys
};