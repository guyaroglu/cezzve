import { api } from './index';

export const userAPI = {
  getStats: () => api.get('/users/stats'),
  submitFeedback: (feedbackData: any) => api.post('/users/feedback', feedbackData),
  getReferralInfo: () => api.get('/users/referral'),
  applyReferralCode: (referralCode: string) => api.post('/users/referral/apply', { referralCode }),
  getNotifications: () => api.get('/users/notifications'),
  updateNotifications: (notifications: any) => api.put('/users/notifications', { notifications }),
};