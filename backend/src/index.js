require('dotenv').config();
require('express-async-errors');

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const logger = require('./utils/logger');
const { parseEnv } = require('./config/env');
const errorHandler = require('./middleware/errorHandler');
const notFound = require('./middleware/notFound');
const { initializeFirebase } = require('./config/firebase');
const { connectRedis } = require('./config/redis');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const fortuneRoutes = require('./routes/fortunes');
const paymentRoutes = require('./routes/payments');
const adminRoutes = require('./routes/admin');

const app = express();
// Validate environment
const env = parseEnv(process.env);
const PORT = env.PORT || 3000;

// Initialize services
async function initializeServices() {
  try {
    await initializeFirebase();
    await connectRedis();
    logger.info('All services initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize services:', error);
    process.exit(1);
  }
}

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// Rate limiting
const crypto = require('crypto');
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res /*next*/, options) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const hashedIp = crypto.createHash('sha256').update(String(ip)).digest('hex').slice(0, 16);
    if (req && req.log) {
      req.log.warn({ hashedIp }, 'Rate limit exceeded');
    } else {
      logger.warn({ hashedIp }, 'Rate limit exceeded');
    }
    res.setHeader('Retry-After', Math.ceil((options.windowMs || 0) / 1000));
    res.status(options.statusCode || 429).json({
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many requests. Please try again later.',
        requestId: req && req.requestId,
      }
    });
  }
});

app.use(limiter);

// Webhook endpoints require raw body for signature verification
// Place BEFORE JSON body parser
app.use('/api/payments/webhook', express.raw({ type: '*/*', limit: '2mb' }));

// Body parsing middleware (after webhook raw)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Compression
app.use(compression());

// Inject request-id and structured logging
app.use((req, res, next) => {
  const childLogger = logger.withRequest(req);
  req.log = childLogger;
  res.setHeader('x-request-id', req.requestId);
  next();
});

// Logging (disable Morgan to avoid duplicate logs; structured logs via winston)
// If you prefer Morgan, set ENABLE_MORGAN=true in env
if (process.env.ENABLE_MORGAN === 'true' && process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: {
      write: (message) => logger.info(message.trim())
    }
  }));
}

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    version: '1.0.0',
    requestId: req.requestId,
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/fortunes', fortuneRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);

// Catch-all for undefined routes
app.use(notFound);

// Error handling middleware (must be last)
app.use(errorHandler);

// Start server
async function startServer() {
  try {
    await initializeServices();
    
    const server = app.listen(PORT, () => {
      logger.info(`FalYolu Backend Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      logger.info('SIGTERM received, shutting down gracefully');
      server.close(() => {
        logger.info('Process terminated');
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      logger.info('SIGINT received, shutting down gracefully');
      server.close(() => {
        logger.info('Process terminated');
        process.exit(0);
      });
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Only start server if this file is run directly
if (require.main === module) {
  startServer();
}

module.exports = app;