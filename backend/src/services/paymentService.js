const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Iyzipay = require('iyzipay');
const logger = require('../utils/logger');
const { cache, CacheKeys } = require('../config/redis');

class PaymentService {
  constructor() {
    // Initialize Iyzico
    this.iyzipay = new Iyzipay({
      apiKey: process.env.IYZICO_API_KEY,
      secretKey: process.env.IYZICO_SECRET_KEY,
      uri: process.env.IYZICO_BASE_URL || 'https://sandbox-api.iyzipay.com'
    });

    // Subscription plans
    this.subscriptionPlans = {
      weekly: {
        id: 'weekly_premium',
        name: 'Haftalık Premium',
        price: 29.99,
        currency: 'TRY',
        duration: 7,
        features: ['AI Kişisel Fallar', 'Sınırsız Okuma', 'Uzman Sohbet', 'Topluluk Erişimi']
      },
      monthly: {
        id: 'monthly_premium',
        name: 'Aylık Premium',
        price: 89.99,
        currency: 'TRY',
        duration: 30,
        features: ['AI Kişisel Fallar', 'Sınırsız Okuma', 'Uzman Sohbet', 'Topluluk Erişimi', 'Öncelikli Destek']
      },
      yearly: {
        id: 'yearly_premium',
        name: 'Yıllık Premium',
        price: 799.99,
        currency: 'TRY',
        duration: 365,
        features: ['AI Kişisel Fallar', 'Sınırsız Okuma', 'Uzman Sohbet', 'Topluluk Erişimi', 'Öncelikli Destek', '%25 İndirim']
      }
    };
  }

  // Create payment intent with Stripe
  async createStripePayment(amount, currency, metadata = {}, idempotencyKey) {
    try {
      const createParams = {
        amount: Math.round(amount * 100), // Convert to cents
        currency: currency.toLowerCase(),
        metadata: {
          ...metadata,
          provider: 'stripe'
        },
        automatic_payment_methods: {
          enabled: true,
        },
      };

      const paymentIntent = await stripe.paymentIntents.create(
        createParams,
        idempotencyKey ? { idempotencyKey } : undefined
      );

      logger.info(`Stripe payment intent created: ${paymentIntent.id}`);
      
      return {
        success: true,
        paymentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        amount: amount,
        currency: currency,
        status: paymentIntent.status
      };

    } catch (error) {
      logger.error('Stripe payment error:', error);
      throw new Error('Payment creation failed');
    }
  }

  // Create payment with Iyzico
  async createIyzicoPayment(paymentData) {
    try {
      const request = {
        locale: Iyzipay.LOCALE.TR,
        conversationId: paymentData.conversationId || Date.now().toString(),
        price: paymentData.amount.toString(),
        paidPrice: paymentData.amount.toString(),
        currency: Iyzipay.CURRENCY.TRY,
        installment: '1',
        basketId: paymentData.basketId || Date.now().toString(),
        paymentChannel: Iyzipay.PAYMENT_CHANNEL.WEB,
        paymentGroup: Iyzipay.PAYMENT_GROUP.PRODUCT,
        paymentCard: {
          cardHolderName: paymentData.cardHolderName,
          cardNumber: paymentData.cardNumber,
          expireMonth: paymentData.expireMonth,
          expireYear: paymentData.expireYear,
          cvc: paymentData.cvc,
          registerCard: '0'
        },
        buyer: {
          id: paymentData.buyer.id,
          name: paymentData.buyer.name,
          surname: paymentData.buyer.surname,
          gsmNumber: paymentData.buyer.phone,
          email: paymentData.buyer.email,
          identityNumber: paymentData.buyer.identityNumber,
          lastLoginDate: new Date().toISOString().slice(0, 19).replace('T', ' '),
          registrationDate: paymentData.buyer.registrationDate,
          registrationAddress: paymentData.buyer.address,
          ip: paymentData.ip,
          city: paymentData.buyer.city,
          country: 'Turkey',
          zipCode: paymentData.buyer.zipCode
        },
        shippingAddress: {
          contactName: `${paymentData.buyer.name} ${paymentData.buyer.surname}`,
          city: paymentData.buyer.city,
          country: 'Turkey',
          address: paymentData.buyer.address,
          zipCode: paymentData.buyer.zipCode
        },
        billingAddress: {
          contactName: `${paymentData.buyer.name} ${paymentData.buyer.surname}`,
          city: paymentData.buyer.city,
          country: 'Turkey',
          address: paymentData.buyer.address,
          zipCode: paymentData.buyer.zipCode
        },
        basketItems: [{
          id: paymentData.productId || 'premium_subscription',
          name: paymentData.productName || 'Premium Üyelik',
          category1: 'Subscription',
          category2: 'Premium',
          itemType: Iyzipay.BASKET_ITEM_TYPE.VIRTUAL,
          price: paymentData.amount.toString()
        }]
      };

      return new Promise((resolve, reject) => {
        this.iyzipay.payment.create(request, (err, result) => {
          if (err) {
            logger.error('Iyzico payment error:', err);
            reject(new Error('Payment creation failed'));
          } else {
            logger.info(`Iyzico payment created: ${result.paymentId}`);
            resolve({
              success: result.status === 'success',
              paymentId: result.paymentId,
              status: result.status,
              errorMessage: result.errorMessage,
              amount: paymentData.amount,
              currency: 'TRY'
            });
          }
        });
      });

    } catch (error) {
      logger.error('Iyzico payment error:', error);
      throw new Error('Payment creation failed');
    }
  }

  // Create PayPal payment
  async createPayPalPayment(amount, currency, description) {
    try {
      // PayPal SDK integration would go here
      // This is a simplified implementation
      const paymentId = `paypal_${Date.now()}`;
      
      logger.info(`PayPal payment created: ${paymentId}`);
      
      return {
        success: true,
        paymentId: paymentId,
        approvalUrl: `https://www.sandbox.paypal.com/cgi-bin/webscr?cmd=_express-checkout&token=${paymentId}`,
        amount: amount,
        currency: currency
      };

    } catch (error) {
      logger.error('PayPal payment error:', error);
      throw new Error('Payment creation failed');
    }
  }

  // Process subscription payment
  async processSubscriptionPayment(userId, planId, paymentMethod, paymentData) {
    try {
      const plan = this.subscriptionPlans[planId];
      if (!plan) {
        throw new Error('Invalid subscription plan');
      }

      let paymentResult;

      switch (paymentMethod) {
        case 'stripe':
          paymentResult = await this.createStripePayment(
            plan.price,
            plan.currency,
            { userId, planId, type: 'subscription' },
            paymentData && paymentData.idempotencyKey
          );
          break;

        case 'iyzico':
          paymentResult = await this.createIyzicoPayment({
            ...paymentData,
            amount: plan.price,
            productId: plan.id,
            productName: plan.name
          });
          break;

        case 'paypal':
          paymentResult = await this.createPayPalPayment(
            plan.price,
            plan.currency,
            `FalYolu ${plan.name} Subscription`
          );
          break;

        default:
          throw new Error('Invalid payment method');
      }

      // Cache payment session for verification
      const sessionData = {
        userId,
        planId,
        paymentMethod,
        amount: plan.price,
        currency: plan.currency,
        createdAt: new Date().toISOString()
      };

      await cache.set(
        CacheKeys.PAYMENT_SESSION(paymentResult.paymentId),
        sessionData,
        1800 // 30 minutes
      );

      return {
        ...paymentResult,
        plan: plan
      };

    } catch (error) {
      logger.error('Subscription payment error:', error);
      throw error;
    }
  }

  // Verify payment completion
  async verifyPayment(paymentId, paymentMethod) {
    try {
      let paymentStatus;

      switch (paymentMethod) {
        case 'stripe':
          const paymentIntent = await stripe.paymentIntents.retrieve(paymentId);
          paymentStatus = {
            success: paymentIntent.status === 'succeeded',
            status: paymentIntent.status,
            amount: paymentIntent.amount / 100,
            currency: paymentIntent.currency.toUpperCase()
          };
          break;

        case 'iyzico':
          paymentStatus = await this.verifyIyzicoPayment(paymentId);
          break;

        case 'paypal':
          paymentStatus = await this.verifyPayPalPayment(paymentId);
          break;

        default:
          throw new Error('Invalid payment method');
      }

      logger.info(`Payment verified: ${paymentId}, Success: ${paymentStatus.success}`);
      return paymentStatus;

    } catch (error) {
      logger.error('Payment verification error:', error);
      throw error;
    }
  }

  // Verify Iyzico payment
  async verifyIyzicoPayment(paymentId) {
    return new Promise((resolve, reject) => {
      this.iyzipay.payment.retrieve({
        locale: Iyzipay.LOCALE.TR,
        conversationId: Date.now().toString(),
        paymentId: paymentId
      }, (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve({
            success: result.status === 'success',
            status: result.status,
            amount: parseFloat(result.paidPrice),
            currency: 'TRY'
          });
        }
      });
    });
  }

  // Verify PayPal payment (simplified)
  async verifyPayPalPayment(paymentId) {
    // PayPal verification would go here
    return {
      success: true,
      status: 'completed',
      amount: 0,
      currency: 'USD'
    };
  }

  // Get subscription plans
  getSubscriptionPlans() {
    return this.subscriptionPlans;
  }

  // Process refund
  async processRefund(paymentId, amount, paymentMethod) {
    try {
      let refundResult;

      switch (paymentMethod) {
        case 'stripe':
          const refund = await stripe.refunds.create({
            payment_intent: paymentId,
            amount: Math.round(amount * 100)
          });
          refundResult = {
            success: refund.status === 'succeeded',
            refundId: refund.id,
            amount: refund.amount / 100,
            status: refund.status
          };
          break;

        case 'iyzico':
          refundResult = await this.processIyzicoRefund(paymentId, amount);
          break;

        case 'paypal':
          refundResult = await this.processPayPalRefund(paymentId, amount);
          break;

        default:
          throw new Error('Invalid payment method');
      }

      logger.info(`Refund processed: ${paymentId}, Amount: ${amount}`);
      return refundResult;

    } catch (error) {
      logger.error('Refund processing error:', error);
      throw error;
    }
  }

  // Process Iyzico refund
  async processIyzicoRefund(paymentId, amount) {
    return new Promise((resolve, reject) => {
      this.iyzipay.refund.create({
        locale: Iyzipay.LOCALE.TR,
        conversationId: Date.now().toString(),
        paymentTransactionId: paymentId,
        price: amount.toString(),
        ip: '127.0.0.1'
      }, (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve({
            success: result.status === 'success',
            refundId: result.refundId,
            amount: parseFloat(result.price),
            status: result.status
          });
        }
      });
    });
  }

  // Process PayPal refund (simplified)
  async processPayPalRefund(paymentId, amount) {
    return {
      success: true,
      refundId: `refund_${Date.now()}`,
      amount: amount,
      status: 'completed'
    };
  }
}

module.exports = new PaymentService();