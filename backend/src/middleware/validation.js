const { body, query, param, validationResult } = require('express-validator');

// Validation error handler
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation Error',
      details: errors.array()
    });
  }
  next();
};

// Auth validations
const validateRegister = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number and one special character'),
  body('name')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters')
    .matches(/^[a-zA-ZğüşıöçĞÜŞİÖÇ\s]+$/)
    .withMessage('Name can only contain letters and spaces'),
  body('dateOfBirth')
    .isISO8601()
    .withMessage('Please provide a valid date of birth in ISO format')
    .custom((value) => {
      const birthDate = new Date(value);
      const today = new Date();
      const age = today.getFullYear() - birthDate.getFullYear();
      if (age < 13 || age > 120) {
        throw new Error('Age must be between 13 and 120 years');
      }
      return true;
    }),
  handleValidationErrors
];

const validateLogin = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
  handleValidationErrors
];

// Fortune validations
const validateFortuneRequest = [
  body('type')
    .isIn(['tarot', 'horoscope', 'palmistry', 'numerology', 'dream'])
    .withMessage('Invalid fortune type'),
  body('data')
    .isObject()
    .withMessage('Fortune data must be an object'),
  handleValidationErrors
];

const validateTarotReading = [
  body('type').equals('tarot'),
  body('data.spread')
    .isIn(['single', 'three-card', 'celtic-cross'])
    .withMessage('Invalid tarot spread type'),
  body('data.question')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Question must be no more than 500 characters'),
  handleValidationErrors
];

const validateHoroscopeRequest = [
  body('type').equals('horoscope'),
  body('data.sign')
    .isIn(['aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces'])
    .withMessage('Invalid zodiac sign'),
  body('data.period')
    .isIn(['daily', 'weekly', 'monthly'])
    .withMessage('Invalid horoscope period'),
  handleValidationErrors
];

const validateDreamInterpretation = [
  body('type').equals('dream'),
  body('data.description')
    .trim()
    .isLength({ min: 10, max: 2000 })
    .withMessage('Dream description must be between 10 and 2000 characters'),
  body('data.emotions')
    .optional()
    .isArray()
    .withMessage('Emotions must be an array'),
  handleValidationErrors
];

const validateNumerologyReading = [
  body('type').equals('numerology'),
  body('data.birthDate')
    .isISO8601()
    .withMessage('Please provide a valid birth date'),
  body('data.fullName')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Full name must be between 2 and 100 characters'),
  handleValidationErrors
];

// Payment validations
const validatePayment = [
  body('amount')
    .isFloat({ min: 0.01 })
    .withMessage('Amount must be greater than 0'),
  body('currency')
    .isIn(['TRY', 'USD', 'EUR'])
    .withMessage('Invalid currency'),
  body('paymentMethod')
    .isIn(['stripe', 'iyzico', 'paypal'])
    .withMessage('Invalid payment method'),
  handleValidationErrors
];

// User profile validations
const validateProfileUpdate = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters'),
  body('dateOfBirth')
    .optional()
    .isISO8601()
    .withMessage('Please provide a valid date of birth'),
  body('preferences')
    .optional()
    .isObject()
    .withMessage('Preferences must be an object'),
  body('preferences.zodiacSign')
    .optional()
    .isIn(['aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces'])
    .withMessage('Invalid zodiac sign'),
  body('preferences.language')
    .optional()
    .isIn(['tr', 'en', 'es', 'th'])
    .withMessage('Invalid language'),
  handleValidationErrors
];

// Feedback validations
const validateFeedback = [
  body('rating')
    .isInt({ min: 1, max: 5 })
    .withMessage('Rating must be between 1 and 5'),
  body('comment')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Comment must be no more than 1000 characters'),
  body('readingId')
    .notEmpty()
    .withMessage('Reading ID is required'),
  handleValidationErrors
];

// Community post validations
const validateCommunityPost = [
  body('title')
    .trim()
    .isLength({ min: 5, max: 200 })
    .withMessage('Title must be between 5 and 200 characters'),
  body('content')
    .trim()
    .isLength({ min: 10, max: 5000 })
    .withMessage('Content must be between 10 and 5000 characters'),
  body('category')
    .isIn(['general', 'dreams', 'horoscope', 'tarot', 'numerology', 'palmistry'])
    .withMessage('Invalid category'),
  body('tags')
    .optional()
    .isArray({ max: 5 })
    .withMessage('Maximum 5 tags allowed'),
  handleValidationErrors
];

// Query parameter validations
const validatePagination = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  handleValidationErrors
];

// MongoDB ObjectId validation
const validateObjectId = (paramName) => [
  param(paramName)
    .matches(/^[0-9a-fA-F]{24}$/)
    .withMessage(`Invalid ${paramName} format`),
  handleValidationErrors
];

module.exports = {
  handleValidationErrors,
  validateRegister,
  validateLogin,
  validateFortuneRequest,
  validateTarotReading,
  validateHoroscopeRequest,
  validateDreamInterpretation,
  validateNumerologyReading,
  validatePayment,
  validateProfileUpdate,
  validateFeedback,
  validateCommunityPost,
  validatePagination,
  validateObjectId
};