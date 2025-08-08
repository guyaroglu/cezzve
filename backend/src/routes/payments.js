const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const router = express.Router();
const { getFirestore, Collections } = require('../config/firebase');
const { cache, CacheKeys, setIfNotExists } = require('../config/redis');
const Sentry = require('@sentry/node');
// @desc    Payment availability (e.g., DCB and carriers)
// @route   GET /api/payments/availability
// @access  Public (cacheable)
router.get('/availability', async (req, res) => {
  const dcbEnabled = (process.env.PAYMENTS_DCB_ENABLED || 'false').toLowerCase() === 'true';
  const carriersCsv = process.env.PAYMENTS_CARRIERS || 'Turkcell,Vodafone,Turk Telekom';
  const carriers = carriersCsv.split(',').map(c => c.trim()).filter(Boolean);

  const payload = {
    dcb: dcbEnabled,
    carriers,
  };

  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.json({ success: true, data: payload });
});

const { protect } = require('../middleware/auth');
const { validatePayment } = require('../middleware/validation');
const paymentService = require('../services/paymentService');
const logger = require('../utils/logger');

// @desc    Get subscription plans
// @route   GET /api/payments/plans
// @access  Public
router.get('/plans', async (req, res) => {
  try {
    const plans = paymentService.getSubscriptionPlans();
    
    res.json({
      success: true,
      data: plans
    });

  } catch (error) {
    logger.error('Get plans error:', error);
    res.status(500).json({
      success: false,
      error: 'Planlar alınamadı'
    });
  }
});

// @desc    Create subscription payment
// @route   POST /api/payments/subscribe
// @access  Private
// Rate limit and slow down payment initiation to mitigate abuse
const paymentLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

const paymentSpeedLimiter = slowDown({
  windowMs: 5 * 60 * 1000,
  delayAfter: 5,
  delayMs: 250,
});

router.post('/subscribe', protect, paymentLimiter, paymentSpeedLimiter, validatePayment, async (req, res) => {
  try {
    const userId = req.user.id;
    const { planId, paymentMethod, paymentData = {} } = req.body;
    const idempotencyKey = req.headers['idempotency-key'] || req.body.idempotencyKey;

    // Enforce idempotency to prevent duplicate charges
    if (!idempotencyKey || typeof idempotencyKey !== 'string') {
      return res.status(400).json({ success: false, error: 'idempotencyKey gereklidir' });
    }

    const existing = await cache.get(CacheKeys.PAYMENT_IDEMPOTENCY(idempotencyKey));
    if (existing) {
      res.setHeader('Retry-After', '60');
      return res.status(409).json({ success: true, reused: true, data: existing });
    }

    // Check if user already has active subscription
    const db = getFirestore();
    const userDoc = await db.collection(Collections.USERS).doc(userId).get();
    const userData = userDoc.data();

    if (userData.subscriptionStatus === 'active' && 
        userData.subscriptionExpiry && 
        new Date(userData.subscriptionExpiry.toDate()) > new Date()) {
      return res.status(400).json({
        success: false,
        error: 'Zaten aktif bir aboneliğiniz var'
      });
    }

    // Add user info to payment data for Iyzico
    if (paymentMethod === 'iyzico') {
      paymentData.buyer = {
        id: userId,
        name: req.user.name.split(' ')[0] || 'Ad',
        surname: req.user.name.split(' ').slice(1).join(' ') || 'Soyad',
        email: req.user.email,
        phone: paymentData.phone || '+905551234567',
        identityNumber: paymentData.identityNumber || '11111111111',
        address: paymentData.address || 'Adres Bilgisi',
        city: paymentData.city || 'İstanbul',
        zipCode: paymentData.zipCode || '34000',
        registrationDate: userData.createdAt.toDate().toISOString().slice(0, 19).replace('T', ' ')
      };
      paymentData.ip = req.ip || '127.0.0.1';
    }

    // Create payment
    const paymentResult = await paymentService.processSubscriptionPayment(
      userId,
      planId,
      paymentMethod,
      paymentData
    );

    // Create transaction record
    const transactionData = {
      userId,
      paymentId: paymentResult.paymentId,
      planId,
      amount: paymentResult.amount,
      currency: paymentResult.plan.currency,
      paymentMethod,
      status: 'pending',
      createdAt: new Date(),
      plan: paymentResult.plan
    };

    const transactionRef = await db.collection(Collections.TRANSACTIONS).add(transactionData);

    logger.info(`Subscription payment created: ${paymentResult.paymentId} for user ${userId}`);

    const responsePayload = {
      success: true,
      data: {
        paymentId: paymentResult.paymentId,
        transactionId: transactionRef.id,
        clientSecret: paymentResult.clientSecret,
        approvalUrl: paymentResult.approvalUrl,
        amount: paymentResult.amount,
        currency: paymentResult.plan.currency,
        plan: paymentResult.plan,
        status: paymentResult.status
      }
    };

    // Save idempotency record for 15 minutes
    await cache.set(
      CacheKeys.PAYMENT_IDEMPOTENCY(idempotencyKey),
      responsePayload.data,
      15 * 60
    );

    res.json(responsePayload);

  } catch (error) {
    logger.error('Subscribe error:', error);
    res.status(500).json({
      success: false,
      error: 'Abonelik oluşturulamadı'
    });
  }
});

// @desc    Verify payment
// @route   POST /api/payments/verify
// @access  Private
// Rate limit verification calls as well
const verifyLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 30 });
const verifySpeedLimiter = slowDown({ windowMs: 5 * 60 * 1000, delayAfter: 10, delayMs: 100 });

router.post('/verify', protect, verifyLimiter, verifySpeedLimiter, async (req, res) => {
  try {
    const userId = req.user.id;
    const { paymentId, paymentMethod } = req.body;

    if (!paymentId || !paymentMethod) {
      return res.status(400).json({
        success: false,
        error: 'Ödeme ID ve yöntem gerekli'
      });
    }

    // Get payment session from cache
    const sessionData = await cache.get(CacheKeys.PAYMENT_SESSION(paymentId));
    if (!sessionData || sessionData.userId !== userId) {
      return res.status(404).json({
        success: false,
        error: 'Ödeme oturumu bulunamadı'
      });
    }

    // Verify payment with provider
    const paymentStatus = await paymentService.verifyPayment(paymentId, paymentMethod);

    const db = getFirestore();

    // Find transaction
    const transactionSnapshot = await db.collection(Collections.TRANSACTIONS)
      .where('paymentId', '==', paymentId)
      .where('userId', '==', userId)
      .limit(1)
      .get();

    if (transactionSnapshot.empty) {
      return res.status(404).json({
        success: false,
        error: 'İşlem bulunamadı'
      });
    }

    const transactionDoc = transactionSnapshot.docs[0];
    const transactionData = transactionDoc.data();

    // Update transaction status
    await transactionDoc.ref.update({
      status: paymentStatus.success ? 'completed' : 'failed',
      verifiedAt: new Date(),
      paymentResponse: paymentStatus
    });

    if (paymentStatus.success) {
      // Activate subscription
      const plan = paymentService.getSubscriptionPlans()[sessionData.planId];
      const subscriptionExpiry = new Date();
      subscriptionExpiry.setDate(subscriptionExpiry.getDate() + plan.duration);

      await db.collection(Collections.USERS).doc(userId).update({
        subscriptionStatus: 'active',
        subscriptionExpiry: subscriptionExpiry,
        subscriptionPlan: sessionData.planId,
        totalSpent: (req.user.totalSpent || 0) + sessionData.amount,
        updatedAt: new Date()
      });

      // Clear user cache
      await cache.del(CacheKeys.USER_PROFILE(userId));
      await cache.del(CacheKeys.USER_SUBSCRIPTION(userId));

      logger.info(`Subscription activated for user: ${userId}, Plan: ${sessionData.planId}`);

      res.json({
        success: true,
        message: 'Ödeme başarılı! Aboneliğiniz aktif edildi.',
        data: {
          transactionId: transactionDoc.id,
          subscriptionExpiry,
          plan: plan
        }
      });

    } else {
      logger.warn(`Payment verification failed: ${paymentId} for user ${userId}`);

      res.status(400).json({
        success: false,
        error: 'Ödeme doğrulanamadı',
        data: {
          transactionId: transactionDoc.id,
          status: paymentStatus.status
        }
      });
    }

  } catch (error) {
    logger.error('Verify payment error:', error);
    res.status(500).json({
      success: false,
      error: 'Ödeme doğrulanamadı'
    });
  }
});

// @desc    Get user's payment history
// @route   GET /api/payments/history
// @access  Private
router.get('/history', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const db = getFirestore();
    const transactionsSnapshot = await db.collection(Collections.TRANSACTIONS)
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .offset((page - 1) * limit)
      .get();

    const transactions = transactionsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt.toDate().toISOString()
    }));

    res.json({
      success: true,
      data: transactions,
      pagination: {
        currentPage: page,
        hasNext: transactionsSnapshot.size === limit,
        hasPrev: page > 1
      }
    });

  } catch (error) {
    logger.error('Get payment history error:', error);
    res.status(500).json({
      success: false,
      error: 'Ödeme geçmişi alınamadı'
    });
  }
});

// @desc    Cancel subscription
// @route   POST /api/payments/cancel-subscription
// @access  Private
router.post('/cancel-subscription', protect, async (req, res) => {
  try {
    const userId = req.user.id;

    const db = getFirestore();
    const userDoc = await db.collection(Collections.USERS).doc(userId).get();
    const userData = userDoc.data();

    if (userData.subscriptionStatus !== 'active') {
      return res.status(400).json({
        success: false,
        error: 'Aktif abonelik bulunamadı'
      });
    }

    // Cancel subscription (mark as cancelled but keep active until expiry)
    await userDoc.ref.update({
      subscriptionStatus: 'cancelled',
      cancelledAt: new Date(),
      updatedAt: new Date()
    });

    // Clear cache
    await cache.del(CacheKeys.USER_PROFILE(userId));
    await cache.del(CacheKeys.USER_SUBSCRIPTION(userId));

    logger.info(`Subscription cancelled for user: ${userId}`);

    res.json({
      success: true,
      message: 'Abonelik iptal edildi. Mevcut dönem sonuna kadar kullanabilirsiniz.',
      data: {
        expiresAt: userData.subscriptionExpiry
      }
    });

  } catch (error) {
    logger.error('Cancel subscription error:', error);
    res.status(500).json({
      success: false,
      error: 'Abonelik iptal edilemedi'
    });
  }
});

// @desc    Request refund
// @route   POST /api/payments/refund
// @access  Private
router.post('/refund', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const { transactionId, reason } = req.body;

    if (!transactionId || !reason) {
      return res.status(400).json({
        success: false,
        error: 'İşlem ID ve neden gerekli'
      });
    }

    const db = getFirestore();
    
    // Get transaction
    const transactionDoc = await db.collection(Collections.TRANSACTIONS).doc(transactionId).get();
    
    if (!transactionDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'İşlem bulunamadı'
      });
    }

    const transaction = transactionDoc.data();
    
    if (transaction.userId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Bu işleme erişim yetkiniz yok'
      });
    }

    if (transaction.status !== 'completed') {
      return res.status(400).json({
        success: false,
        error: 'Sadece tamamlanmış işlemler için iade talep edilebilir'
      });
    }

    // Check if refund already requested
    if (transaction.refundStatus) {
      return res.status(400).json({
        success: false,
        error: 'Bu işlem için zaten iade talebi var'
      });
    }

    // Create refund request (manual approval required)
    await transactionDoc.ref.update({
      refundStatus: 'requested',
      refundReason: reason,
      refundRequestedAt: new Date(),
      updatedAt: new Date()
    });

    logger.info(`Refund requested: ${transactionId} by user ${userId}, Reason: ${reason}`);

    res.json({
      success: true,
      message: 'İade talebiniz alındı. En kısa sürede değerlendirilerek bilgilendirme yapılacaktır.',
      data: {
        transactionId,
        status: 'requested'
      }
    });

  } catch (error) {
    logger.error('Request refund error:', error);
    res.status(500).json({
      success: false,
      error: 'İade talebi oluşturulamadı'
    });
  }
});

// @desc    Get current subscription status
// @route   GET /api/payments/subscription
// @access  Private
router.get('/subscription', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Check cache first
    const cachedSubscription = await cache.get(CacheKeys.USER_SUBSCRIPTION(userId));
    if (cachedSubscription) {
      return res.json({
        success: true,
        data: cachedSubscription,
        cached: true
      });
    }

    const db = getFirestore();
    const userDoc = await db.collection(Collections.USERS).doc(userId).get();
    const userData = userDoc.data();

    const subscription = {
      status: userData.subscriptionStatus || 'free',
      plan: userData.subscriptionPlan || null,
      expiresAt: userData.subscriptionExpiry || null,
      cancelledAt: userData.cancelledAt || null,
      isActive: userData.subscriptionStatus === 'active' && 
                userData.subscriptionExpiry && 
                new Date(userData.subscriptionExpiry.toDate()) > new Date(),
      daysRemaining: userData.subscriptionExpiry ? 
        Math.max(0, Math.ceil((userData.subscriptionExpiry.toDate() - new Date()) / (1000 * 60 * 60 * 24))) : 0
    };

    // Cache for 1 hour
    await cache.set(CacheKeys.USER_SUBSCRIPTION(userId), subscription, 3600);

    res.json({
      success: true,
      data: subscription
    });

  } catch (error) {
    logger.error('Get subscription error:', error);
    res.status(500).json({
      success: false,
      error: 'Abonelik bilgileri alınamadı'
    });
  }
});

// @desc    Webhook for payment provider notifications
// @route   POST /api/payments/webhook/:provider
// @access  Public (but secured with signature verification)
// Stripe/Iyzico webhooks require raw body for signature verification.
// Bu rota özelinde JSON yerine raw body kullanımı, index.js tarafında tanımlı global parsers'tan önce bağlanmalıdır.
router.post('/webhook/:provider', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    const provider = req.params.provider;
    const rawBody = req.body; // Buffer
    const headers = req.headers;

    logger.info(`Payment webhook received from ${provider}`);

    // Verify webhook signature based on provider
    let isValid = false;
    let eventId = undefined;
    
    switch (provider) {
      case 'stripe':
        try {
          const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
          const sig = headers['stripe-signature'];
          const secret = process.env.STRIPE_WEBHOOK_SECRET;
          const event = stripe.webhooks.constructEvent(rawBody, sig, secret);
          isValid = true;
          eventId = event.id;
        } catch (e) {
          logger.warn('Stripe webhook verification failed:', e.message);
          if (process.env.SENTRY_DSN) { try { Sentry.captureMessage('stripe_invalid_sig'); } catch(_) {} }
          isValid = false;
        }
        break;
        
      case 'iyzico':
        try {
          // Iyzico genellikle header/body üzerinden gönderilen token/imza ile doğrulanır
          const receivedSignature = headers['x-iyzi-signature'] || headers['iyzi-signature'];
          const secret = process.env.IYZICO_WEBHOOK_SECRET;
          const computed = crypto
            .createHmac('sha256', secret)
            .update(rawBody)
            .digest('hex');
          isValid = receivedSignature && computed && receivedSignature === computed;
          // Event ID üretimi (Iyzico olaylarında benzersiz bir id varsa onu kullan)
          eventId = headers['x-event-id'] || undefined;
        } catch (e) {
          logger.warn('Iyzico webhook verification failed:', e.message);
          if (process.env.SENTRY_DSN) { try { Sentry.captureMessage('iyzico_invalid_sig'); } catch(_) {} }
          isValid = false;
        }
        break;
        
      case 'paypal':
        // Verify PayPal webhook signature
        isValid = true; // TODO: PayPal verification implementation
        break;
        
      default:
        return res.status(400).json({ error: 'Unknown provider' });
    }

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Idempotency for webhooks (avoid processing duplicates)
    if (eventId) {
      const key = CacheKeys.WEBHOOK_EVENT(eventId);
      const ok = await setIfNotExists(key, true, 600); // 10 dk dedup
      if (!ok) {
        return res.status(200).end();
      }
    }

    // Process webhook based on event type
    // This would update payment status, subscription status, etc.
    
    res.json({ received: true });

  } catch (error) {
    logger.error('Webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

module.exports = router;