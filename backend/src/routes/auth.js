const express = require('express');
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const router = express.Router();
const { getAuth, getFirestore, Collections } = require('../config/firebase');
const { cache, CacheKeys } = require('../config/redis');
const { protect, optionalAuth } = require('../middleware/auth');
const { validateRegister, validateLogin } = require('../middleware/validation');
const logger = require('../utils/logger');

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
router.post('/register', validateRegister, async (req, res) => {
  try {
    const { email, password, name, dateOfBirth, preferences = {} } = req.body;

    // Create user with Firebase Auth
    const userRecord = await getAuth().createUser({
      email,
      password,
      displayName: name,
      emailVerified: false
    });

    // Create user document in Firestore
    const db = getFirestore();
    const userData = {
      id: userRecord.uid,
      email: userRecord.email,
      name,
      dateOfBirth,
      preferences: {
        language: 'tr',
        zodiacSign: preferences.zodiacSign || null,
        notifications: {
          dailyHoroscope: true,
          weeklyHoroscope: true,
          tarotReminders: true,
          communityUpdates: false
        },
        theme: 'dark',
        ...preferences
      },
      subscriptionStatus: 'free',
      subscriptionExpiry: null,
      role: 'user',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastLoginAt: null,
      isActive: true,
      readingsCount: 0,
      totalSpent: 0,
      referralCode: `FAL${Date.now().toString().slice(-6)}`,
      referredBy: null
    };

    await db.collection(Collections.USERS).doc(userRecord.uid).set(userData);

    // Send email verification
    await getAuth().generateEmailVerificationLink(email);

    logger.info(`User registered: ${userRecord.uid}`);

    res.status(201).json({
      success: true,
      message: 'Kullanıcı başarıyla oluşturuldu. Lütfen email adresinizi doğrulayın.',
      user: {
        id: userRecord.uid,
        email: userRecord.email,
        name,
        preferences: userData.preferences
      }
    });

  } catch (error) {
    logger.error('Registration error:', error);

    // Handle Firebase Auth errors
    if (error.code === 'auth/email-already-exists') {
      return res.status(400).json({
        success: false,
        error: 'Bu email adresi zaten kullanımda'
      });
    }

    if (error.code === 'auth/weak-password') {
      return res.status(400).json({
        success: false,
        error: 'Şifre çok zayıf. En az 6 karakter olmalı.'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Kayıt sırasında bir hata oluştu'
    });
  }
});

// Rate-limit & slow-down for auth endpoints to reduce credential stuffing
const authLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
const authSpeedLimiter = slowDown({ windowMs: 5 * 60 * 1000, delayAfter: 10, delayMs: 100 });

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
router.post('/login', authLimiter, authSpeedLimiter, validateLogin, async (req, res) => {
  try {
    const { email, password } = req.body;

    // Note: Firebase client SDK handles login, this endpoint is for additional validation
    // The actual authentication is done on the client side
    
    const userRecord = await getAuth().getUserByEmail(email);
    
    if (!userRecord.emailVerified) {
      return res.status(400).json({
        success: false,
        error: 'Lütfen email adresinizi doğrulayın'
      });
    }

    // Update last login
    const db = getFirestore();
    await db.collection(Collections.USERS).doc(userRecord.uid).update({
      lastLoginAt: new Date(),
      updatedAt: new Date()
    });

    // Clear cached user data to force refresh
    await cache.del(CacheKeys.USER_PROFILE(userRecord.uid));

    logger.info(`User logged in: ${userRecord.uid}`);

    res.json({
      success: true,
      message: 'Giriş başarılı',
      user: {
        id: userRecord.uid,
        email: userRecord.email,
        name: userRecord.displayName,
        emailVerified: userRecord.emailVerified
      }
    });

  } catch (error) {
    logger.error('Login error:', error);

    if (error.code === 'auth/user-not-found') {
      return res.status(401).json({
        success: false,
        error: 'Kullanıcı bulunamadı'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Giriş sırasında bir hata oluştu'
    });
  }
});

// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
router.get('/me', protect, async (req, res) => {
  try {
    const user = req.user;

    // Get fresh subscription status
    const db = getFirestore();
    const userDoc = await db.collection(Collections.USERS).doc(user.id).get();
    const userData = userDoc.data();

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        dateOfBirth: user.dateOfBirth,
        preferences: user.preferences,
        subscriptionStatus: userData.subscriptionStatus,
        subscriptionExpiry: userData.subscriptionExpiry,
        role: user.role,
        readingsCount: userData.readingsCount || 0,
        totalSpent: userData.totalSpent || 0,
        referralCode: userData.referralCode,
        createdAt: user.createdAt,
        lastLoginAt: userData.lastLoginAt
      }
    });

  } catch (error) {
    logger.error('Get current user error:', error);
    res.status(500).json({
      success: false,
      error: 'Kullanıcı bilgileri alınamadı'
    });
  }
});

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
router.post('/logout', protect, async (req, res) => {
  try {
    const userId = req.user.id;

    // Clear cached user data
    await cache.del(CacheKeys.USER_PROFILE(userId));
    await cache.del(CacheKeys.USER_SUBSCRIPTION(userId));

    // Note: Firebase token revocation is handled on the client side
    // This endpoint is for cleanup and logging

    logger.info(`User logged out: ${userId}`);

    res.json({
      success: true,
      message: 'Çıkış başarılı'
    });

  } catch (error) {
    logger.error('Logout error:', error);
    res.status(500).json({
      success: false,
      error: 'Çıkış sırasında bir hata oluştu'
    });
  }
});

// @desc    Send password reset email
// @route   POST /api/auth/forgot-password
// @access  Public
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email adresi gerekli'
      });
    }

    // Generate password reset link
    await getAuth().generatePasswordResetLink(email);

    logger.info(`Password reset email sent: ${email}`);

    res.json({
      success: true,
      message: 'Şifre sıfırlama linki email adresinize gönderildi'
    });

  } catch (error) {
    logger.error('Forgot password error:', error);

    if (error.code === 'auth/user-not-found') {
      return res.status(404).json({
        success: false,
        error: 'Bu email adresi ile kayıtlı kullanıcı bulunamadı'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Şifre sıfırlama sırasında bir hata oluştu'
    });
  }
});

// @desc    Verify email
// @route   POST /api/auth/verify-email
// @access  Private
router.post('/verify-email', protect, async (req, res) => {
  try {
    const userId = req.user.id;

    // Send email verification
    const link = await getAuth().generateEmailVerificationLink(req.user.email);

    logger.info(`Email verification sent: ${userId}`);

    res.json({
      success: true,
      message: 'Email doğrulama linki gönderildi',
      verificationLink: link
    });

  } catch (error) {
    logger.error('Email verification error:', error);
    res.status(500).json({
      success: false,
      error: 'Email doğrulama sırasında bir hata oluştu'
    });
  }
});

// @desc    Delete account
// @route   DELETE /api/auth/delete-account
// @access  Private
router.delete('/delete-account', protect, async (req, res) => {
  try {
    const userId = req.user.id;

    // Delete user data from Firestore
    const db = getFirestore();
    
    // Delete user document
    await db.collection(Collections.USERS).doc(userId).delete();
    
    // Delete user's readings
    const readingsSnapshot = await db.collection(Collections.READINGS)
      .where('userId', '==', userId)
      .get();
    
    const batch = db.batch();
    readingsSnapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();

    // Delete Firebase Auth user
    await getAuth().deleteUser(userId);

    // Clear cache
    await cache.del(CacheKeys.USER_PROFILE(userId));
    await cache.del(CacheKeys.USER_SUBSCRIPTION(userId));

    logger.info(`User account deleted: ${userId}`);

    res.json({
      success: true,
      message: 'Hesabınız başarıyla silindi'
    });

  } catch (error) {
    logger.error('Delete account error:', error);
    res.status(500).json({
      success: false,
      error: 'Hesap silme sırasında bir hata oluştu'
    });
  }
});

module.exports = router;