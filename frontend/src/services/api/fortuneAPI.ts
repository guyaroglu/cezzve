import { api } from './index';

export const fortuneAPI = {
  generateTarot: (data: any) => api.post('/fortunes/tarot', { type: 'tarot', data }),
  generateHoroscope: (data: any) => api.post('/fortunes/horoscope', { type: 'horoscope', data }),
  generateDreamInterpretation: (data: any) => api.post('/fortunes/dream', { type: 'dream', data }),
  generateNumerology: (data: any) => api.post('/fortunes/numerology', { type: 'numerology', data }),
  getReadingHistory: (params: any) => api.get('/fortunes/history', { params }),
  getReading: (id: string) => api.get(`/fortunes/${id}`),
  shareReading: (id: string) => api.post(`/fortunes/${id}/share`),
  getDailyHoroscopes: () => api.get('/fortunes/horoscope/daily'),
  addToFavorites: (id: string) => api.post(`/users/favorites/${id}`),
  removeFromFavorites: (id: string) => api.delete(`/users/favorites/${id}`),
  getFavorites: (params: any) => api.get('/users/favorites', { params }),
};