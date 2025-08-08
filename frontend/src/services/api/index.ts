import axios from 'axios';
import { Platform } from 'react-native';
import { store } from '../../store';
import { logoutUser } from '../../store/slices/authSlice';
import Config from 'react-native-config';
import * as Application from 'expo-application';

const API_BASE_URL = Config.API_BASE_URL || 'http://localhost:3000/api';

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor for auth token
api.interceptors.request.use(
  (config) => {
    const state = store.getState();
    const token = state.auth.idToken;
    // Idempotency-Key üretimi: deviceId + timestamp + nonce
    const deviceId = Platform.select({
      ios: Application.getIosIdForVendorAsync ? undefined : undefined,
      android: Application.androidId,
      default: undefined,
    }) || 'unknown-device';
    const nonce = Math.random().toString(36).slice(2, 10);
    const idem = `${deviceId}-${Date.now()}-${nonce}`;
    config.headers['Idempotency-Key'] = idem;
    
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => {
    // x-request-id'yi Sentry veya hata raporlarına eklemek için geri döndür
    const requestId = response.headers['x-request-id'];
    // Burada Sentry etiketleme yapılabilir: Sentry.setTag('x-request-id', requestId)
    return response;
  },
  async (error) => {
    if (error.response?.status === 401) {
      // Token expired or invalid
      store.dispatch(logoutUser());
    }
    
    return Promise.reject(error);
  }
);

export default api;