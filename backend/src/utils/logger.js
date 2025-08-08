const winston = require('winston');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Redact sensitive fields from logs (PII/token/payment)
const SENSITIVE_KEYS = new Set([
  'authorization', 'Authorization', 'token', 'idToken', 'accessToken', 'refreshToken',
  'cardNumber', 'cvc', 'expireMonth', 'expireYear', 'identityNumber', 'email'
]);

function maskValue(key, value) {
  if (value == null) return value;
  const str = String(value);
  if (key.toLowerCase().includes('token') || key.toLowerCase() === 'authorization') {
    return '***redacted***';
  }
  if (key === 'cardNumber') {
    const last4 = str.slice(-4);
    return `**** **** **** ${last4}`;
  }
  if (key === 'cvc') return '***';
  if (key === 'expireMonth' || key === 'expireYear') return '**';
  if (key === 'identityNumber') {
    const last2 = str.slice(-2);
    return `***********${last2}`;
  }
  if (key === 'email') {
    const [user, domain] = str.split('@');
    if (!domain) return '***@***';
    const maskedUser = user.length <= 2 ? '*'.repeat(user.length) : `${user[0]}***${user[user.length-1]}`;
    return `${maskedUser}@${domain}`;
  }
  return value;
}

function deepRedact(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(deepRedact);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(k) || k.toLowerCase().includes('token')) {
      out[k] = maskValue(k, v);
    } else if (v && typeof v === 'object') {
      out[k] = deepRedact(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Custom log format with redaction
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format((info) => deepRedact(info))(),
  winston.format.json(),
  winston.format.prettyPrint()
);

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '../../logs');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { service: 'falyolu-backend' },
  transports: [
    // Write all logs with level 'error' and below to error.log
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Write all logs with level 'info' and below to combined.log
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ],
});

// Request-scoped logger factory to inject request-id
logger.withRequest = (req) => {
  const requestId = req.headers['x-request-id'] || uuidv4();
  req.requestId = requestId;
  return logger.child({ requestId });
};

// If we're not in production, log to the console as well
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple(),
      winston.format.printf(({ timestamp, level, message, stack }) => {
        if (stack) {
          return `${timestamp} [${level}]: ${message}\n${stack}`;
        }
        return `${timestamp} [${level}]: ${message}`;
      })
    )
  }));
}

// Create a stream object for Morgan
logger.stream = {
  write: (message) => {
    logger.info(message.trim());
  }
};

module.exports = logger;