const express = require('express');
const router = express.Router();
const { getFirestore, Collections } = require('../config/firebase');
const { cache, CacheKeys } = require('../config/redis');
const { protect, requireSubscription, optionalAuth, userRateLimit } = require('../middleware/auth');
const { 
  validateFortuneRequest,
  validateTarotReading,
  validateHoroscopeRequest,
  validateDreamInterpretation,
  validateNumerologyReading,
  validatePagination
} = require('../middleware/validation');
const openaiService = require('../services/openaiService');
const logger = require('../utils/logger');

// @desc    Get user's fortune history
// @route   GET /api/fortunes/history
// @access  Private
router.get('/history', protect, validatePagination, async (req, res) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const type = req.query.type; // Optional filter by type

    const db = getFirestore();
    let query = db.collection(Collections.READINGS)
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc');

    if (type) {
      query = query.where('type', '==', type);
    }

    const snapshot = await query
      .limit(limit)
      .offset((page - 1) * limit)
      .get();

    const readings = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    // Get total count for pagination
    const totalSnapshot = await db.collection(Collections.READINGS)
      .where('userId', '==', userId)
      .select()
      .get();

    res.json({
      success: true,
      data: readings,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalSnapshot.size / limit),
        totalCount: totalSnapshot.size,
        hasNext: snapshot.size === limit,
        hasPrev: page > 1
      }
    });

  } catch (error) {
    logger.error('Get fortune history error:', error);
    res.status(500).json({
      success: false,
      error: 'Fal geçmişi alınamadı'
    });
  }
});

// @desc    Generate tarot reading
// @route   POST /api/fortunes/tarot
// @access  Public (with rate limiting)
router.post('/tarot', optionalAuth, userRateLimit(10, 60000), validateTarotReading, async (req, res) => {
  try {
    const { data } = req.body;
    const userId = req.user?.id;

    // Check cache first for similar readings
    const cacheKey = CacheKeys.TAROT_READING(
      userId || 'anonymous',
      new Date().toDateString()
    );
    
    const cachedReading = await cache.get(cacheKey);
    if (cachedReading && !data.question) {
      return res.json({
        success: true,
        data: cachedReading,
        cached: true
      });
    }

    // Generate AI fortune
    const fortune = await openaiService.generateFortune('tarot', data, req.user || {});

    // Create reading record
    const readingData = {
      userId: userId || null,
      type: 'tarot',
      input: data,
      content: fortune.fortune,
      disclaimer: fortune.disclaimer,
      createdAt: new Date(),
      shareableLink: null,
      isPublic: false,
      aiGenerated: true,
      metadata: {
        spread: data.spread,
        question: data.question || null,
        model: 'gpt-4',
        version: '1.0'
      }
    };

    let readingId = null;
    if (userId) {
      // Save to database for logged in users
      const db = getFirestore();
      const docRef = await db.collection(Collections.READINGS).add(readingData);
      readingId = docRef.id;

      // Update user's reading count
      await db.collection(Collections.USERS).doc(userId).update({
        readingsCount: (req.user.readingsCount || 0) + 1,
        updatedAt: new Date()
      });
    }

    // Cache reading for anonymous users
    if (!userId) {
      await cache.set(cacheKey, { ...readingData, id: 'cached' }, 3600);
    }

    logger.info(`Tarot reading generated for user: ${userId || 'anonymous'}`);

    res.json({
      success: true,
      data: {
        id: readingId,
        ...readingData,
        fortune: fortune.fortune
      }
    });

  } catch (error) {
    logger.error('Tarot reading error:', error);
    res.status(500).json({
      success: false,
      error: 'Tarot falı oluşturulamadı'
    });
  }
});

// @desc    Generate horoscope
// @route   POST /api/fortunes/horoscope
// @access  Public
router.post('/horoscope', optionalAuth, userRateLimit(20, 60000), validateHoroscopeRequest, async (req, res) => {
  try {
    const { data } = req.body;
    const userId = req.user?.id;

    // Check cache for daily horoscopes
    const cacheKey = CacheKeys.DAILY_HOROSCOPE(
      data.sign,
      new Date().toDateString()
    );

    const cachedHoroscope = await cache.get(cacheKey);
    if (cachedHoroscope && data.period === 'daily') {
      return res.json({
        success: true,
        data: cachedHoroscope,
        cached: true
      });
    }

    // Generate AI horoscope
    const fortune = await openaiService.generateFortune('horoscope', data, req.user || {});

    const readingData = {
      userId: userId || null,
      type: 'horoscope',
      input: data,
      content: fortune.fortune,
      disclaimer: fortune.disclaimer,
      createdAt: new Date(),
      shareableLink: null,
      isPublic: true, // Horoscopes can be public
      aiGenerated: true,
      metadata: {
        sign: data.sign,
        period: data.period,
        date: new Date().toDateString(),
        model: 'gpt-4',
        version: '1.0'
      }
    };

    let readingId = null;
    if (userId) {
      const db = getFirestore();
      const docRef = await db.collection(Collections.READINGS).add(readingData);
      readingId = docRef.id;

      await db.collection(Collections.USERS).doc(userId).update({
        readingsCount: (req.user.readingsCount || 0) + 1,
        updatedAt: new Date()
      });
    }

    // Cache daily horoscopes for all users
    if (data.period === 'daily') {
      await cache.set(cacheKey, { ...readingData, id: readingId || 'cached' }, 86400); // 24 hours
    }

    logger.info(`Horoscope generated: ${data.sign} - ${data.period}`);

    res.json({
      success: true,
      data: {
        id: readingId,
        ...readingData,
        fortune: fortune.fortune
      }
    });

  } catch (error) {
    logger.error('Horoscope error:', error);
    res.status(500).json({
      success: false,
      error: 'Burç falı oluşturulamadı'
    });
  }
});

// @desc    Generate dream interpretation
// @route   POST /api/fortunes/dream
// @access  Private (Premium feature)
router.post('/dream', protect, requireSubscription, validateDreamInterpretation, async (req, res) => {
  try {
    const { data } = req.body;
    const userId = req.user.id;

    // Extract keywords for caching
    const keywords = data.description
      .toLowerCase()
      .split(' ')
      .filter(word => word.length > 3)
      .slice(0, 5)
      .sort();

    const cacheKey = CacheKeys.DREAM_INTERPRETATION(keywords);
    const cachedInterpretation = await cache.get(cacheKey);

    if (cachedInterpretation) {
      return res.json({
        success: true,
        data: cachedInterpretation,
        cached: true
      });
    }

    // Generate AI interpretation
    const fortune = await openaiService.generateFortune('dream', data, req.user);

    const readingData = {
      userId,
      type: 'dream',
      input: data,
      content: fortune.fortune,
      disclaimer: fortune.disclaimer,
      createdAt: new Date(),
      shareableLink: null,
      isPublic: false,
      aiGenerated: true,
      metadata: {
        keywords,
        emotions: data.emotions || [],
        model: 'gpt-4',
        version: '1.0'
      }
    };

    const db = getFirestore();
    const docRef = await db.collection(Collections.READINGS).add(readingData);

    await db.collection(Collections.USERS).doc(userId).update({
      readingsCount: (req.user.readingsCount || 0) + 1,
      updatedAt: new Date()
    });

    // Cache for similar dream descriptions
    await cache.set(cacheKey, { ...readingData, id: docRef.id }, 7200); // 2 hours

    logger.info(`Dream interpretation generated for user: ${userId}`);

    res.json({
      success: true,
      data: {
        id: docRef.id,
        ...readingData,
        fortune: fortune.fortune
      }
    });

  } catch (error) {
    logger.error('Dream interpretation error:', error);
    res.status(500).json({
      success: false,
      error: 'Rüya yorumu oluşturulamadı'
    });
  }
});

// @desc    Generate numerology reading
// @route   POST /api/fortunes/numerology
// @access  Private (Premium feature)
router.post('/numerology', protect, requireSubscription, validateNumerologyReading, async (req, res) => {
  try {
    const { data } = req.body;
    const userId = req.user.id;

    const cacheKey = CacheKeys.NUMEROLOGY_READING(data.birthDate);
    const cachedReading = await cache.get(cacheKey);

    if (cachedReading) {
      return res.json({
        success: true,
        data: cachedReading,
        cached: true
      });
    }

    // Calculate numerology numbers
    const numerologyData = {
      ...data,
      lifePathNumber: calculateLifePathNumber(data.birthDate),
      destinyNumber: calculateDestinyNumber(data.fullName),
      soulNumber: calculateSoulNumber(data.fullName)
    };

    // Generate AI reading
    const fortune = await openaiService.generateFortune('numerology', numerologyData, req.user);

    const readingData = {
      userId,
      type: 'numerology',
      input: data,
      content: fortune.fortune,
      disclaimer: fortune.disclaimer,
      createdAt: new Date(),
      shareableLink: null,
      isPublic: false,
      aiGenerated: true,
      metadata: {
        lifePathNumber: numerologyData.lifePathNumber,
        destinyNumber: numerologyData.destinyNumber,
        soulNumber: numerologyData.soulNumber,
        model: 'gpt-4',
        version: '1.0'
      }
    };

    const db = getFirestore();
    const docRef = await db.collection(Collections.READINGS).add(readingData);

    await db.collection(Collections.USERS).doc(userId).update({
      readingsCount: (req.user.readingsCount || 0) + 1,
      updatedAt: new Date()
    });

    // Cache numerology readings (they don't change for same birth date)
    await cache.set(cacheKey, { ...readingData, id: docRef.id }, 86400 * 7); // 1 week

    logger.info(`Numerology reading generated for user: ${userId}`);

    res.json({
      success: true,
      data: {
        id: docRef.id,
        ...readingData,
        fortune: fortune.fortune,
        numbers: {
          lifePathNumber: numerologyData.lifePathNumber,
          destinyNumber: numerologyData.destinyNumber,
          soulNumber: numerologyData.soulNumber
        }
      }
    });

  } catch (error) {
    logger.error('Numerology reading error:', error);
    res.status(500).json({
      success: false,
      error: 'Numeroloji falı oluşturulamadı'
    });
  }
});

// @desc    Get single reading
// @route   GET /api/fortunes/:id
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const readingId = req.params.id;
    const userId = req.user.id;

    const db = getFirestore();
    const readingDoc = await db.collection(Collections.READINGS).doc(readingId).get();

    if (!readingDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Fal bulunamadı'
      });
    }

    const reading = { id: readingDoc.id, ...readingDoc.data() };

    // Check if user owns this reading or if it's public
    if (reading.userId !== userId && !reading.isPublic) {
      return res.status(403).json({
        success: false,
        error: 'Bu fala erişim yetkiniz yok'
      });
    }

    res.json({
      success: true,
      data: reading
    });

  } catch (error) {
    logger.error('Get reading error:', error);
    res.status(500).json({
      success: false,
      error: 'Fal alınamadı'
    });
  }
});

// @desc    Share reading (create shareable link)
// @route   POST /api/fortunes/:id/share
// @access  Private
router.post('/:id/share', protect, async (req, res) => {
  try {
    const readingId = req.params.id;
    const userId = req.user.id;

    const db = getFirestore();
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
        error: 'Bu fala erişim yetkiniz yok'
      });
    }

    // Generate shareable link
    const shareableLink = `https://falyolu.com/share/${readingId}`;

    await readingDoc.ref.update({
      shareableLink,
      isPublic: true,
      sharedAt: new Date(),
      updatedAt: new Date()
    });

    logger.info(`Reading shared: ${readingId}`);

    res.json({
      success: true,
      data: {
        shareableLink,
        message: 'Fal başarıyla paylaşıldı'
      }
    });

  } catch (error) {
    logger.error('Share reading error:', error);
    res.status(500).json({
      success: false,
      error: 'Fal paylaşılamadı'
    });
  }
});

// @desc    Get daily horoscope for all signs
// @route   GET /api/fortunes/horoscope/daily
// @access  Public
router.get('/horoscope/daily', async (req, res) => {
  try {
    const today = new Date().toDateString();
    const signs = [
      'aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo',
      'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces'
    ];

    const horoscopes = {};

    for (const sign of signs) {
      const cacheKey = CacheKeys.DAILY_HOROSCOPE(sign, today);
      let horoscope = await cache.get(cacheKey);

      if (!horoscope) {
        // Generate horoscope if not cached
        const fortune = await openaiService.generateFortune('horoscope', { sign, period: 'daily' });
        horoscope = {
          sign,
          content: fortune.fortune,
          date: today,
          generatedAt: new Date().toISOString()
        };
        await cache.set(cacheKey, horoscope, 86400); // 24 hours
      }

      horoscopes[sign] = horoscope;
    }

    res.json({
      success: true,
      data: horoscopes,
      date: today
    });

  } catch (error) {
    logger.error('Daily horoscope error:', error);
    res.status(500).json({
      success: false,
      error: 'Günlük burç falları alınamadı'
    });
  }
});

// Helper functions for numerology calculations
function calculateLifePathNumber(birthDate) {
  const date = new Date(birthDate);
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  
  let sum = day + month + year;
  while (sum > 9 && sum !== 11 && sum !== 22) {
    sum = sum.toString().split('').reduce((a, b) => parseInt(a) + parseInt(b), 0);
  }
  return sum;
}

function calculateDestinyNumber(fullName) {
  const letterValues = {
    a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9,
    j: 1, k: 2, l: 3, m: 4, n: 5, o: 6, p: 7, q: 8, r: 9,
    s: 1, t: 2, u: 3, v: 4, w: 5, x: 6, y: 7, z: 8
  };
  
  let sum = fullName.toLowerCase().replace(/[^a-z]/g, '').split('')
    .reduce((total, letter) => total + (letterValues[letter] || 0), 0);
  
  while (sum > 9 && sum !== 11 && sum !== 22) {
    sum = sum.toString().split('').reduce((a, b) => parseInt(a) + parseInt(b), 0);
  }
  return sum;
}

function calculateSoulNumber(fullName) {
  const vowels = 'aeiou';
  const letterValues = {
    a: 1, e: 5, i: 9, o: 6, u: 3
  };
  
  let sum = fullName.toLowerCase().split('')
    .filter(letter => vowels.includes(letter))
    .reduce((total, vowel) => total + (letterValues[vowel] || 0), 0);
  
  while (sum > 9 && sum !== 11 && sum !== 22) {
    sum = sum.toString().split('').reduce((a, b) => parseInt(a) + parseInt(b), 0);
  }
  return sum;
}

module.exports = router;