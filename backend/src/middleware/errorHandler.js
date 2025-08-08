const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log error with request-id context when available
  if (req && req.log) {
    req.log.error({ err }, 'Request failed');
  } else {
    logger.error(err);
  }

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    const message = 'Resource not found';
    error = { message, statusCode: 404 };
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const message = 'Duplicate field value entered';
    error = { message, statusCode: 400 };
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message);
    error = { message, statusCode: 400 };
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    const message = 'Invalid token';
    error = { message, statusCode: 401 };
  }

  if (err.name === 'TokenExpiredError') {
    const message = 'Token expired';
    error = { message, statusCode: 401 };
  }

  // Firebase Auth errors
  if (err.code && err.code.startsWith('auth/')) {
    const message = 'Authentication error';
    error = { message, statusCode: 401 };
  }

  // Payment gateway errors
  if (err.type === 'StripeCardError' || err.type === 'IyzicoError') {
    const message = 'Payment processing error';
    error = { message, statusCode: 402 };
  }

  // OpenAI API errors
  if (err.response && err.response.status === 429) {
    const message = 'AI service temporarily unavailable. Please try again later.';
    error = { message, statusCode: 503 };
  }

  // Rate limiting errors
  if (err.message && err.message.includes('Too many requests')) {
    const message = 'Too many requests. Please try again later.';
    error = { message, statusCode: 429 };
  }

  const status = error.statusCode || 500;
  const code = status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR';
  res.status(status).json({
    error: {
      code,
      message: error.message || 'Server Error',
      requestId: req && req.requestId,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    }
  });
};

module.exports = errorHandler;