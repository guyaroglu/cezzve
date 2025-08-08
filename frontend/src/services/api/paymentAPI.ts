import { api } from './index';

export const paymentAPI = {
  getPlans: () => api.get('/payments/plans'),
  createSubscription: (subscriptionData: any) => api.post('/payments/subscribe', subscriptionData),
  verifyPayment: (paymentData: any) => api.post('/payments/verify', paymentData),
  getPaymentHistory: (params: any) => api.get('/payments/history', { params }),
  cancelSubscription: () => api.post('/payments/cancel-subscription'),
  requestRefund: (refundData: any) => api.post('/payments/refund', refundData),
  getSubscription: () => api.get('/payments/subscription'),
};