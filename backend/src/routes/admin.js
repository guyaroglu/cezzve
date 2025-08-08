const express = require('express');
const router = express.Router();
const { getFirestore, Collections } = require('../config/firebase');
const { cache } = require('../config/redis');
const { protect, authorize } = require('../middleware/auth');
const { validatePagination } = require('../middleware/validation');
const paymentService = require('../services/paymentService');
const openaiService = require('../services/openaiService');
const logger = require('../utils/logger');

// All admin routes require admin role
router.use(protect);
router.use(authorize('admin', 'superadmin'));

// @desc    Get admin dashboard stats
// @route   GET /api/admin/dashboard
// @access  Admin
router.get('/dashboard', async (req, res) => {
  try {
    const db = getFirestore();
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    // Get user statistics
    const totalUsersSnapshot = await db.collection(Collections.USERS).select().get();
    const activeUsersSnapshot = await db.collection(Collections.USERS)
      .where('subscriptionStatus', '==', 'active')
      .select()
      .get();
    
    const newUsersThisMonth = await db.collection(Collections.USERS)
      .where('createdAt', '>=', thisMonth)
      .select()
      .get();

    // Get reading statistics
    const totalReadingsSnapshot = await db.collection(Collections.READINGS).select().get();
    const readingsThisMonth = await db.collection(Collections.READINGS)
      .where('createdAt', '>=', thisMonth)
      .select()
      .get();

    // Get transaction statistics
    const totalTransactionsSnapshot = await db.collection(Collections.TRANSACTIONS)
      .where('status', '==', 'completed')
      .get();
    
    const transactionsThisMonth = await db.collection(Collections.TRANSACTIONS)
      .where('status', '==', 'completed')
      .where('createdAt', '>=', thisMonth)
      .get();

    // Calculate revenue
    const totalRevenue = totalTransactionsSnapshot.docs.reduce((sum, doc) => {
      return sum + (doc.data().amount || 0);
    }, 0);

    const monthlyRevenue = transactionsThisMonth.docs.reduce((sum, doc) => {
      return sum + (doc.data().amount || 0);
    }, 0);

    // Get feedback statistics
    const feedbackSnapshot = await db.collection(Collections.FEEDBACK).get();
    const averageRating = feedbackSnapshot.empty ? 0 : 
      feedbackSnapshot.docs.reduce((sum, doc) => sum + doc.data().rating, 0) / feedbackSnapshot.size;

    // Reading type distribution
    const readingTypes = {};
    totalReadingsSnapshot.docs.forEach(doc => {
      const type = doc.data().type;
      readingTypes[type] = (readingTypes[type] || 0) + 1;
    });

    const stats = {
      users: {
        total: totalUsersSnapshot.size,
        active: activeUsersSnapshot.size,
        newThisMonth: newUsersThisMonth.size,
        conversionRate: totalUsersSnapshot.size > 0 ? 
          ((activeUsersSnapshot.size / totalUsersSnapshot.size) * 100).toFixed(2) : 0
      },
      readings: {
        total: totalReadingsSnapshot.size,
        thisMonth: readingsThisMonth.size,
        byType: readingTypes
      },
      revenue: {
        total: totalRevenue,
        thisMonth: monthlyRevenue,
        transactions: totalTransactionsSnapshot.size,
        averageOrderValue: totalTransactionsSnapshot.size > 0 ? 
          (totalRevenue / totalTransactionsSnapshot.size).toFixed(2) : 0
      },
      feedback: {
        total: feedbackSnapshot.size,
        averageRating: Math.round(averageRating * 10) / 10
      }
    };

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    logger.error('Admin dashboard error:', error);
    res.status(500).json({
      success: false,
      error: 'Dashboard verileri alınamadı'
    });
  }
});

// @desc    Get all users with pagination
// @route   GET /api/admin/users
// @access  Admin
router.get('/users', validatePagination, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const status = req.query.status; // 'active', 'free', 'cancelled'
    const search = req.query.search;

    const db = getFirestore();
    let query = db.collection(Collections.USERS);

    if (status) {
      query = query.where('subscriptionStatus', '==', status);
    }

    const snapshot = await query
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .offset((page - 1) * limit)
      .get();

    let users = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt.toDate().toISOString()
    }));

    // Apply search filter if provided
    if (search) {
      const searchLower = search.toLowerCase();
      users = users.filter(user => 
        user.name.toLowerCase().includes(searchLower) ||
        user.email.toLowerCase().includes(searchLower)
      );
    }

    res.json({
      success: true,
      data: users,
      pagination: {
        currentPage: page,
        hasNext: snapshot.size === limit,
        hasPrev: page > 1
      }
    });

  } catch (error) {
    logger.error('Admin get users error:', error);
    res.status(500).json({
      success: false,
      error: 'Kullanıcılar alınamadı'
    });
  }
});

// @desc    Get user details
// @route   GET /api/admin/users/:id
// @access  Admin
router.get('/users/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    const db = getFirestore();

    // Get user data
    const userDoc = await db.collection(Collections.USERS).doc(userId).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Kullanıcı bulunamadı'
      });
    }

    const userData = { id: userDoc.id, ...userDoc.data() };

    // Get user's readings
    const readingsSnapshot = await db.collection(Collections.READINGS)
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();

    const readings = readingsSnapshot.docs.map(doc => ({
      id: doc.id,
      type: doc.data().type,
      createdAt: doc.data().createdAt.toDate().toISOString()
    }));

    // Get user's transactions
    const transactionsSnapshot = await db.collection(Collections.TRANSACTIONS)
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();

    const transactions = transactionsSnapshot.docs.map(doc => ({
      id: doc.id,
      amount: doc.data().amount,
      status: doc.data().status,
      createdAt: doc.data().createdAt.toDate().toISOString()
    }));

    res.json({
      success: true,
      data: {
        user: userData,
        readings,
        transactions,
        stats: {
          totalReadings: readingsSnapshot.size,
          totalTransactions: transactionsSnapshot.size
        }
      }
    });

  } catch (error) {
    logger.error('Admin get user details error:', error);
    res.status(500).json({
      success: false,
      error: 'Kullanıcı detayları alınamadı'
    });
  }
});

// @desc    Update user subscription
// @route   PUT /api/admin/users/:id/subscription
// @access  Admin
router.put('/users/:id/subscription', async (req, res) => {
  try {
    const userId = req.params.id;
    const { status, planId, expiryDate } = req.body;

    const db = getFirestore();
    const userDoc = await db.collection(Collections.USERS).doc(userId).get();

    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Kullanıcı bulunamadı'
      });
    }

    const updateData = {
      subscriptionStatus: status,
      updatedAt: new Date()
    };

    if (planId) {
      updateData.subscriptionPlan = planId;
    }

    if (expiryDate) {
      updateData.subscriptionExpiry = new Date(expiryDate);
    }

    await userDoc.ref.update(updateData);

    logger.info(`Admin updated subscription for user ${userId}: ${status}`);

    res.json({
      success: true,
      message: 'Kullanıcı aboneliği güncellendi',
      data: updateData
    });

  } catch (error) {
    logger.error('Admin update subscription error:', error);
    res.status(500).json({
      success: false,
      error: 'Abonelik güncellenemedi'
    });
  }
});

// @desc    Get all transactions
// @route   GET /api/admin/transactions
// @access  Admin
router.get('/transactions', validatePagination, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const status = req.query.status;

    const db = getFirestore();
    let query = db.collection(Collections.TRANSACTIONS);

    if (status) {
      query = query.where('status', '==', status);
    }

    const snapshot = await query
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .offset((page - 1) * limit)
      .get();

    const transactions = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt.toDate().toISOString()
    }));

    res.json({
      success: true,
      data: transactions,
      pagination: {
        currentPage: page,
        hasNext: snapshot.size === limit,
        hasPrev: page > 1
      }
    });

  } catch (error) {
    logger.error('Admin get transactions error:', error);
    res.status(500).json({
      success: false,
      error: 'İşlemler alınamadı'
    });
  }
});

// @desc    Process refund
// @route   POST /api/admin/transactions/:id/refund
// @access  Admin
router.post('/transactions/:id/refund', async (req, res) => {
  try {
    const transactionId = req.params.id;
    const { amount, reason } = req.body;

    const db = getFirestore();
    const transactionDoc = await db.collection(Collections.TRANSACTIONS).doc(transactionId).get();

    if (!transactionDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'İşlem bulunamadı'
      });
    }

    const transaction = transactionDoc.data();

    if (transaction.status !== 'completed') {
      return res.status(400).json({
        success: false,
        error: 'Sadece tamamlanmış işlemler iade edilebilir'
      });
    }

    // Process refund with payment provider
    const refundResult = await paymentService.processRefund(
      transaction.paymentId,
      amount || transaction.amount,
      transaction.paymentMethod
    );

    // Update transaction
    await transactionDoc.ref.update({
      refundStatus: refundResult.success ? 'completed' : 'failed',
      refundAmount: amount || transaction.amount,
      refundReason: reason,
      refundProcessedAt: new Date(),
      refundProcessedBy: req.user.id,
      updatedAt: new Date()
    });

    if (refundResult.success) {
      // Update user subscription if needed
      await db.collection(Collections.USERS).doc(transaction.userId).update({
        subscriptionStatus: 'cancelled',
        subscriptionExpiry: new Date(), // Expire immediately
        updatedAt: new Date()
      });
    }

    logger.info(`Refund processed by admin ${req.user.id} for transaction ${transactionId}`);

    res.json({
      success: true,
      message: refundResult.success ? 'İade başarıyla işlendi' : 'İade işlenemedi',
      data: refundResult
    });

  } catch (error) {
    logger.error('Admin process refund error:', error);
    res.status(500).json({
      success: false,
      error: 'İade işlenemedi'
    });
  }
});

// @desc    Get all feedback
// @route   GET /api/admin/feedback
// @access  Admin
router.get('/feedback', validatePagination, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const rating = req.query.rating;

    const db = getFirestore();
    let query = db.collection(Collections.FEEDBACK);

    if (rating) {
      query = query.where('rating', '==', parseInt(rating));
    }

    const snapshot = await query
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .offset((page - 1) * limit)
      .get();

    const feedback = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt.toDate().toISOString()
    }));

    res.json({
      success: true,
      data: feedback,
      pagination: {
        currentPage: page,
        hasNext: snapshot.size === limit,
        hasPrev: page > 1
      }
    });

  } catch (error) {
    logger.error('Admin get feedback error:', error);
    res.status(500).json({
      success: false,
      error: 'Geri bildirimler alınamadı'
    });
  }
});

// @desc    Get system status
// @route   GET /api/admin/system
// @access  Admin
router.get('/system', async (req, res) => {
  try {
    // Check OpenAI status
    const openaiStatus = await openaiService.checkUsage();

    // Check cache status
    let cacheStatus;
    try {
      await cache.set('health_check', 'ok', 10);
      const cacheTest = await cache.get('health_check');
      cacheStatus = cacheTest === 'ok' ? 'healthy' : 'unhealthy';
    } catch (error) {
      cacheStatus = 'unhealthy';
    }

    // Check database status
    let dbStatus;
    try {
      const db = getFirestore();
      await db.collection('health_check').limit(1).get();
      dbStatus = 'healthy';
    } catch (error) {
      dbStatus = 'unhealthy';
    }

    const systemStatus = {
      openai: openaiStatus,
      cache: { status: cacheStatus },
      database: { status: dbStatus },
      server: {
        status: 'healthy',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        nodeVersion: process.version,
        environment: process.env.NODE_ENV
      }
    };

    res.json({
      success: true,
      data: systemStatus
    });

  } catch (error) {
    logger.error('Admin system status error:', error);
    res.status(500).json({
      success: false,
      error: 'Sistem durumu alınamadı'
    });
  }
});

// @desc    Clear cache
// @route   POST /api/admin/cache/clear
// @access  Admin
router.post('/cache/clear', async (req, res) => {
  try {
    await cache.flush();

    logger.info(`Cache cleared by admin ${req.user.id}`);

    res.json({
      success: true,
      message: 'Önbellek temizlendi'
    });

  } catch (error) {
    logger.error('Admin clear cache error:', error);
    res.status(500).json({
      success: false,
      error: 'Önbellek temizlenemedi'
    });
  }
});

// @desc    Send broadcast notification
// @route   POST /api/admin/broadcast
// @access  Admin
router.post('/broadcast', async (req, res) => {
  try {
    const { title, message, targetUsers = 'all' } = req.body;

    if (!title || !message) {
      return res.status(400).json({
        success: false,
        error: 'Başlık ve mesaj gerekli'
      });
    }

    // This would integrate with Firebase Cloud Messaging
    // For now, we'll just log the broadcast
    logger.info(`Broadcast sent by admin ${req.user.id}: ${title} - ${message}`);

    res.json({
      success: true,
      message: 'Bildirim gönderildi',
      data: {
        title,
        message,
        targetUsers,
        sentAt: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Admin broadcast error:', error);
    res.status(500).json({
      success: false,
      error: 'Bildirim gönderilemedi'
    });
  }
});

module.exports = router;