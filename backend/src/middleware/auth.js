const jwt = require('jsonwebtoken');
const { getAuth, getFirestore, Collections } = require('../config/firebase');
const { cache, CacheKeys } = require('../config/redis');
const logger = require('../utils/logger');

// Protect routes - verify JWT token
const protect = async (req, res, next) => {
  try {
    let token;

    // Get token from header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    // Make sure token exists
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Not authorized to access this route'
      });
    }

    try {
      // Verify Firebase ID token
      const decodedToken = await getAuth().verifyIdToken(token);
      
      // Get user from cache first
      const cachedUser = await cache.get(CacheKeys.USER_PROFILE(decodedToken.uid));
      
      if (cachedUser) {
        req.user = cachedUser;
      } else {
        // Get user from Firestore if not in cache
        const db = getFirestore();
        const userDoc = await db.collection(Collections.USERS).doc(decodedToken.uid).get();
        
        if (!userDoc.exists) {
          return res.status(401).json({
            success: false,
            error: 'User not found'
          });
        }

        const userData = { id: userDoc.id, ...userDoc.data() };
        
        // Cache user data for 1 hour
        await cache.set(CacheKeys.USER_PROFILE(decodedToken.uid), userData, 3600);
        
        req.user = userData;
      }

      next();
    } catch (error) {
      logger.error('Token verification error:', error);
      return res.status(401).json({
        success: false,
        error: 'Not authorized to access this route'
      });
    }
  } catch (error) {
    logger.error('Auth middleware error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error during authentication'
    });
  }
};

// Admin role authorization
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Not authorized to access this route'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'User role is not authorized to access this route'
      });
    }

    next();
  };
};

// Check if user has active subscription
const requireSubscription = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'Not authorized to access this route'
    });
  }

  if (!req.user.subscriptionStatus || req.user.subscriptionStatus !== 'active') {
    return res.status(403).json({
      success: false,
      error: 'Active subscription required to access this feature'
    });
  }

  next();
};

// Optional authentication - continues even if no token
const optionalAuth = async (req, res, next) => {
  try {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (token) {
      try {
        const decodedToken = await getAuth().verifyIdToken(token);
        
        const cachedUser = await cache.get(CacheKeys.USER_PROFILE(decodedToken.uid));
        
        if (cachedUser) {
          req.user = cachedUser;
        } else {
          const db = getFirestore();
          const userDoc = await db.collection(Collections.USERS).doc(decodedToken.uid).get();
          
          if (userDoc.exists) {
            const userData = { id: userDoc.id, ...userDoc.data() };
            await cache.set(CacheKeys.USER_PROFILE(decodedToken.uid), userData, 3600);
            req.user = userData;
          }
        }
      } catch (error) {
        logger.warn('Optional auth token verification failed:', error);
        // Continue without setting req.user
      }
    }

    next();
  } catch (error) {
    logger.error('Optional auth middleware error:', error);
    next(); // Continue even on error
  }
};

// Rate limiting per user
const userRateLimit = (maxRequests = 100, windowMs = 15 * 60 * 1000) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return next();
      }

      const key = CacheKeys.RATE_LIMIT(req.user.id);
      const current = await cache.get(key);
      
      if (current && current.count >= maxRequests) {
        return res.status(429).json({
          success: false,
          error: 'Too many requests. Please try again later.',
          retryAfter: Math.ceil(windowMs / 1000)
        });
      }

      const newCount = current ? current.count + 1 : 1;
      await cache.set(key, { count: newCount }, Math.ceil(windowMs / 1000));
      
      next();
    } catch (error) {
      logger.error('User rate limit error:', error);
      next(); // Continue on error
    }
  };
};

module.exports = {
  protect,
  authorize,
  requireSubscription,
  optionalAuth,
  userRateLimit
};