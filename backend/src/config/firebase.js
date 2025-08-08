const admin = require('firebase-admin');
const logger = require('../utils/logger');

let firebaseApp = null;
let firestore = null;

const initializeFirebase = async () => {
  try {
    if (firebaseApp) {
      logger.info('Firebase already initialized');
      return firebaseApp;
    }

    const serviceAccount = {
      type: "service_account",
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
      private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      client_id: process.env.FIREBASE_CLIENT_ID,
      auth_uri: process.env.FIREBASE_AUTH_URI,
      token_uri: process.env.FIREBASE_TOKEN_URI,
      auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
      client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL
    };

    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID,
    });

    firestore = admin.firestore();
    
    // Configure Firestore settings
    firestore.settings({
      timestampsInSnapshots: true,
    });

    logger.info('Firebase initialized successfully');
    return firebaseApp;
  } catch (error) {
    logger.error('Firebase initialization error:', error);
    throw error;
  }
};

const getFirestore = () => {
  if (!firestore) {
    throw new Error('Firestore not initialized. Call initializeFirebase() first.');
  }
  return firestore;
};

const getAuth = () => {
  if (!firebaseApp) {
    throw new Error('Firebase not initialized. Call initializeFirebase() first.');
  }
  return admin.auth();
};

const getStorage = () => {
  if (!firebaseApp) {
    throw new Error('Firebase not initialized. Call initializeFirebase() first.');
  }
  return admin.storage();
};

const verifyIdToken = async (idToken) => {
  try {
    const auth = getAuth();
    const decodedToken = await auth.verifyIdToken(idToken);
    return decodedToken;
  } catch (error) {
    logger.error('Token verification error:', error);
    throw error;
  }
};

// Firestore collections
const Collections = {
  USERS: 'users',
  READINGS: 'readings', 
  TAROT_CARDS: 'tarot_cards',
  TRANSACTIONS: 'transactions',
  FEEDBACK: 'feedback',
  DAILY_HOROSCOPES: 'daily_horoscopes',
  DREAM_INTERPRETATIONS: 'dream_interpretations',
  NUMEROLOGY: 'numerology',
  PALMISTRY: 'palmistry',
  COMMUNITY_POSTS: 'community_posts',
  CHAT_SESSIONS: 'chat_sessions',
  SUBSCRIPTION_PLANS: 'subscription_plans',
  USER_PREFERENCES: 'user_preferences',
  ANALYTICS: 'analytics'
};

module.exports = {
  initializeFirebase,
  getFirestore,
  getAuth,
  getStorage,
  verifyIdToken,
  Collections,
  admin
};