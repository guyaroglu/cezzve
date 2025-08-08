import { api } from './index';

export const authAPI = {
  register: (userData: any) => api.post('/auth/register', userData),
  login: (credentials: any) => api.post('/auth/login', credentials),
  getCurrentUser: () => api.get('/auth/me'),
  logout: () => api.post('/auth/logout'),
  forgotPassword: (email: string) => api.post('/auth/forgot-password', { email }),
  updateProfile: (profileData: any) => api.put('/users/profile', profileData),
  deleteAccount: () => api.delete('/auth/delete-account'),
  verifyEmail: () => api.post('/auth/verify-email'),
};