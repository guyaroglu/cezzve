const express = require('express');
const router = express.Router();
const { getFirestore, Collections } = require('../config/firebase');
const { cache, CacheKeys } = require('../config/redis');
const { protect, optionalAuth } = require('../middleware/auth');
const { validateProfileUpdate, validateFeedback, validatePagination } = require('../middleware/validation');
const logger = require('../utils/logger');

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
router.put('/profile', protect, validateProfileUpdate, async (req, res) => {
  try {
    const userId = req.user.id;
    const updates = req.body;

    // Remove fields that shouldn't be updated directly
    delete updates.id;
    delete updates.email;
    delete updates.role;
    delete updates.subscriptionStatus;
    delete updates.subscriptionExpiry;
    delete updates.createdAt;
    delete updates.readingsCount;
    delete updates.totalSpent;

    updates.updatedAt = new Date();

    const db = getFirestore();
    await db.collection(Collections.USERS).doc(userId).update(updates);

    // Clear cache
    await cache.del(CacheKeys.USER_PROFILE(userId));

    // Get updated user data
    const userDoc = await db.collection(Collections.USERS).doc(userId).get();
    const userData = { id: userDoc.id, ...userDoc.data() };

    // Update cache
    await cache.set(CacheKeys.USER_PROFILE(userId), userData, 3600);

    logger.info(`User profile updated: ${userId}`);

    res.json({
      success: true,
      message: 'Profil başarıyla güncellendi',
      user: userData
    });

  } catch (error) {
    logger.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Profil güncellenemedi'
    });
  }
});

// @desc    Get user statistics
// @route   GET /api/users/stats
// @access  Private
router.get('/stats', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const db = getFirestore();

    // Get user's readings
    const readingsSnapshot = await db.collection(Collections.READINGS)
      .where('userId', '==', userId)
      .get();

    // Calculate statistics
    const totalReadings = readingsSnapshot.size;
    const readingsByType = {};
    const readingsByMonth = {};

    readingsSnapshot.docs.forEach(doc => {
      const reading = doc.data();
      const type = reading.type;
      const month = new Date(reading.createdAt.toDate()).toISOString().slice(0, 7); // YYYY-MM

      readingsByType[type] = (readingsByType[type] || 0) + 1;
      readingsByMonth[month] = (readingsByMonth[month] || 0) + 1;
    });

    // Get subscription info
    const userDoc = await db.collection(Collections.USERS).doc(userId).get();
    const userData = userDoc.data();

    // Get feedback stats
    const feedbackSnapshot = await db.collection(Collections.FEEDBACK)
      .where('userId', '==', userId)
      .get();

    const averageRating = feedbackSnapshot.empty ? 0 : 
      feedbackSnapshot.docs.reduce((sum, doc) => sum + doc.data().rating, 0) / feedbackSnapshot.size;

    const stats = {
      totalReadings,
      readingsByType,
      readingsByMonth,
      subscriptionStatus: userData.subscriptionStatus,
      subscriptionExpiry: userData.subscriptionExpiry,
      memberSince: userData.createdAt,
      totalSpent: userData.totalSpent || 0,
      averageRating: Math.round(averageRating * 10) / 10,
      totalFeedback: feedbackSnapshot.size
    };

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    logger.error('Get user stats error:', error);
    res.status(500).json({
      success: false,
      error: 'İstatistikler alınamadı'
    });
  }
});

// @desc    Submit feedback
// @route   POST /api/users/feedback
// @access  Private
router.post('/feedback', protect, validateFeedback, async (req, res) => {
  try {
    const userId = req.user.id;
    const { rating, comment, readingId } = req.body;

    const db = getFirestore();

    // Check if reading exists and belongs to user
    const readingDoc = await db.collection(Collections.READINGS).doc(readingId).get();
    
    if (!readingDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Fal bulunamadı'
      });
    }

    const reading = readingDoc.data();
    if (reading.userId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Bu fala geri bildirim veremezsiniz'
      });
    }

    // Check if feedback already exists
    const existingFeedback = await db.collection(Collections.FEEDBACK)
      .where('userId', '==', userId)
      .where('readingId', '==', readingId)
      .limit(1)
      .get();

    if (!existingFeedback.empty) {
      return res.status(400).json({
        success: false,
        error: 'Bu fal için zaten geri bildirim verilmiş'
      });
    }

    // Create feedback
    const feedbackData = {
      userId,
      readingId,
      rating,
      comment: comment || '',
      type: reading.type,
      createdAt: new Date(),
      npsScore: rating >= 4 ? 'promoter' : rating >= 3 ? 'passive' : 'detractor'
    };

    const docRef = await db.collection(Collections.FEEDBACK).add(feedbackData);

    // Update reading with feedback flag
    await readingDoc.ref.update({
      hasFeedback: true,
      feedbackRating: rating,
      updatedAt: new Date()
    });

    logger.info(`Feedback submitted: ${docRef.id} by user ${userId}`);

    res.json({
      success: true,
      message: 'Geri bildiriminiz alındı',
      data: {
        id: docRef.id,
        ...feedbackData
      }
    });

  } catch (error) {
    logger.error('Submit feedback error:', error);
    res.status(500).json({
      success: false,
      error: 'Geri bildirim gönderilemedi'
    });
  }
});

// @desc    Get user's referral info
// @route   GET /api/users/referral
// @access  Private
router.get('/referral', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const db = getFirestore();

    // Get user's referral code
    const userDoc = await db.collection(Collections.USERS).doc(userId).get();
    const userData = userDoc.data();

    // Get referred users count
    const referredUsersSnapshot = await db.collection(Collections.USERS)
      .where('referredBy', '==', userData.referralCode)
      .get();

    // Calculate referral rewards (example: 10 TL per referral)
    const referralReward = 10;
    const totalReferrals = referredUsersSnapshot.size;
    const totalEarnings = totalReferrals * referralReward;

    const referralInfo = {
      referralCode: userData.referralCode,
      totalReferrals,
      totalEarnings,
      referralReward,
      referralLink: `https://falyolu.com/referral/${userData.referralCode}`,
      referredUsers: referredUsersSnapshot.docs.map(doc => ({
        name: doc.data().name,
        joinedAt: doc.data().createdAt,
        status: doc.data().subscriptionStatus
      }))
    };

    res.json({
      success: true,
      data: referralInfo
    });

  } catch (error) {
    logger.error('Get referral info error:', error);
    res.status(500).json({
      success: false,
      error: 'Davetiye bilgileri alınamadı'
    });
  }
});

// @desc    Apply referral code
// @route   POST /api/users/referral/apply
// @access  Private
router.post('/referral/apply', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const { referralCode } = req.body;

    if (!referralCode) {
      return res.status(400).json({
        success: false,
        error: 'Davetiye kodu gerekli'
      });
    }

    const db = getFirestore();
    
    // Check if user already used a referral code
    const userDoc = await db.collection(Collections.USERS).doc(userId).get();
    const userData = userDoc.data();

    if (userData.referredBy) {
      return res.status(400).json({
        success: false,
        error: 'Zaten bir davetiye kodu kullanmışsınız'
      });
    }

    // Find referrer
    const referrerSnapshot = await db.collection(Collections.USERS)
      .where('referralCode', '==', referralCode)
      .limit(1)
      .get();

    if (referrerSnapshot.empty) {
      return res.status(404).json({
        success: false,
        error: 'Geçersiz davetiye kodu'
      });
    }

    // Can't refer yourself
    const referrer = referrerSnapshot.docs[0];
    if (referrer.id === userId) {
      return res.status(400).json({
        success: false,
        error: 'Kendi davetiye kodunuzu kullanamazsınız'
      });
    }

    // Apply referral
    await userDoc.ref.update({
      referredBy: referralCode,
      referralAppliedAt: new Date(),
      updatedAt: new Date()
    });

    // Give bonus to both users (example: 3 days free premium)
    const bonusExpiry = new Date();
    bonusExpiry.setDate(bonusExpiry.getDate() + 3);

    await userDoc.ref.update({
      subscriptionStatus: 'active',
      subscriptionExpiry: bonusExpiry,
      referralBonus: 3
    });

    logger.info(`Referral applied: ${referralCode} by user ${userId}`);

    res.json({
      success: true,
      message: 'Davetiye kodu başarıyla uygulandı! 3 gün ücretsiz premium kazandınız.',
      bonus: {
        days: 3,
        expiresAt: bonusExpiry
      }
    });

  } catch (error) {
    logger.error('Apply referral error:', error);
    res.status(500).json({
      success: false,
      error: 'Davetiye kodu uygulanamadı'
    });
  }
});

// @desc    Get notification preferences
// @route   GET /api/users/notifications
// @access  Private
router.get('/notifications', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = req.user;

    res.json({
      success: true,
      data: {
        preferences: user.preferences?.notifications || {
          dailyHoroscope: true,
          weeklyHoroscope: true,
          tarotReminders: true,
          communityUpdates: false,
          promotions: true,
          email: true,
          push: true
        }
      }
    });

  } catch (error) {
    logger.error('Get notifications error:', error);
    res.status(500).json({
      success: false,
      error: 'Bildirim ayarları alınamadı'
    });
  }
});

// @desc    Update notification preferences
// @route   PUT /api/users/notifications
// @access  Private
router.put('/notifications', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const { notifications } = req.body;

    const db = getFirestore();
    await db.collection(Collections.USERS).doc(userId).update({
      'preferences.notifications': notifications,
      updatedAt: new Date()
    });

    // Clear cache
    await cache.del(CacheKeys.USER_PROFILE(userId));

    logger.info(`Notification preferences updated: ${userId}`);

    res.json({
      success: true,
      message: 'Bildirim ayarları güncellendi',
      data: { notifications }
    });

  } catch (error) {
    logger.error('Update notifications error:', error);
    res.status(500).json({
      success: false,
      error: 'Bildirim ayarları güncellenemedi'
    });
  }
});

// @desc    Get user's favorite readings
// @route   GET /api/users/favorites
// @access  Private
router.get('/favorites', protect, validatePagination, async (req, res) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const db = getFirestore();
    
    // Get user's favorited readings
    const favoritesSnapshot = await db.collection(Collections.USERS)
      .doc(userId)
      .collection('favorites')
      .orderBy('addedAt', 'desc')
      .limit(limit)
      .offset((page - 1) * limit)
      .get();

    const favorites = [];
    
    for (const favoriteDoc of favoritesSnapshot.docs) {
      const favoriteData = favoriteDoc.data();
      const readingDoc = await db.collection(Collections.READINGS)
        .doc(favoriteData.readingId)
        .get();
      
      if (readingDoc.exists) {
        favorites.push({
          favoriteId: favoriteDoc.id,
          addedAt: favoriteData.addedAt,
          reading: {
            id: readingDoc.id,
            ...readingDoc.data()
          }
        });
      }
    }

    res.json({
      success: true,
      data: favorites,
      pagination: {
        currentPage: page,
        hasNext: favoritesSnapshot.size === limit,
        hasPrev: page > 1
      }
    });

  } catch (error) {
    logger.error('Get favorites error:', error);
    res.status(500).json({
      success: false,
      error: 'Favori fallar alınamadı'
    });
  }
});

// @desc    Add reading to favorites
// @route   POST /api/users/favorites/:readingId
// @access  Private
router.post('/favorites/:readingId', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const { readingId } = req.params;

    const db = getFirestore();
    
    // Check if reading exists
    const readingDoc = await db.collection(Collections.READINGS).doc(readingId).get();
    if (!readingDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Fal bulunamadı'
      });
    }

    // Check if already favorited
    const existingFavorite = await db.collection(Collections.USERS)
      .doc(userId)
      .collection('favorites')
      .where('readingId', '==', readingId)
      .limit(1)
      .get();

    if (!existingFavorite.empty) {
      return res.status(400).json({
        success: false,
        error: 'Bu fal zaten favorilerde'
      });
    }

    // Add to favorites
    await db.collection(Collections.USERS)
      .doc(userId)
      .collection('favorites')
      .add({
        readingId,
        addedAt: new Date()
      });

    logger.info(`Reading added to favorites: ${readingId} by user ${userId}`);

    res.json({
      success: true,
      message: 'Fal favorilere eklendi'
    });

  } catch (error) {
    logger.error('Add to favorites error:', error);
    res.status(500).json({
      success: false,
      error: 'Favorilere eklenemedi'
    });
  }
});

// @desc    Remove reading from favorites
// @route   DELETE /api/users/favorites/:readingId
// @access  Private
router.delete('/favorites/:readingId', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const { readingId } = req.params;

    const db = getFirestore();
    
    // Find and delete favorite
    const favoriteSnapshot = await db.collection(Collections.USERS)
      .doc(userId)
      .collection('favorites')
      .where('readingId', '==', readingId)
      .limit(1)
      .get();

    if (favoriteSnapshot.empty) {
      return res.status(404).json({
        success: false,
        error: 'Favoride bulunamadı'
      });
    }

    await favoriteSnapshot.docs[0].ref.delete();

    logger.info(`Reading removed from favorites: ${readingId} by user ${userId}`);

    res.json({
      success: true,
      message: 'Fal favorilerden çıkarıldı'
    });

  } catch (error) {
    logger.error('Remove from favorites error:', error);
    res.status(500).json({
      success: false,
      error: 'Favorilerden çıkarılamadı'
    });
  }
});

module.exports = router;