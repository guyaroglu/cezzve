const request = require('supertest');
const app = require('../../src/index');
const { getAuth } = require('../../src/config/firebase');

// Mock Firebase Admin
jest.mock('../../src/config/firebase');

describe('Auth Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/auth/register', () => {
    it('should register a new user successfully', async () => {
      const mockUserRecord = {
        uid: 'test-user-id',
        email: 'test@example.com',
        displayName: 'Test User'
      };

      getAuth.mockReturnValue({
        createUser: jest.fn().mockResolvedValue(mockUserRecord),
        generateEmailVerificationLink: jest.fn().mockResolvedValue('verification-link')
      });

      const userData = {
        email: 'test@example.com',
        password: 'TestPass123!',
        name: 'Test User',
        dateOfBirth: '1990-01-01',
        preferences: {
          zodiacSign: 'aries'
        }
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.user.email).toBe(userData.email);
      expect(response.body.user.name).toBe(userData.name);
    });

    it('should return validation error for invalid email', async () => {
      const userData = {
        email: 'invalid-email',
        password: 'TestPass123!',
        name: 'Test User',
        dateOfBirth: '1990-01-01'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation Error');
    });

    it('should return error for weak password', async () => {
      const userData = {
        email: 'test@example.com',
        password: '123',
        name: 'Test User',
        dateOfBirth: '1990-01-01'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/auth/login', () => {
    it('should login user successfully', async () => {
      const mockUserRecord = {
        uid: 'test-user-id',
        email: 'test@example.com',
        emailVerified: true
      };

      getAuth.mockReturnValue({
        getUserByEmail: jest.fn().mockResolvedValue(mockUserRecord)
      });

      const credentials = {
        email: 'test@example.com',
        password: 'TestPass123!'
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(credentials)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Giriş başarılı');
    });

    it('should return error for unverified email', async () => {
      const mockUserRecord = {
        uid: 'test-user-id',
        email: 'test@example.com',
        emailVerified: false
      };

      getAuth.mockReturnValue({
        getUserByEmail: jest.fn().mockResolvedValue(mockUserRecord)
      });

      const credentials = {
        email: 'test@example.com',
        password: 'TestPass123!'
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(credentials)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Lütfen email adresinizi doğrulayın');
    });
  });

  describe('GET /api/auth/me', () => {
    it('should return current user data', async () => {
      // Mock authentication middleware
      const mockUser = {
        id: 'test-user-id',
        email: 'test@example.com',
        name: 'Test User'
      };

      // This would require mocking the protect middleware
      // Implementation depends on your test setup
    });
  });

  describe('POST /api/auth/forgot-password', () => {
    it('should send password reset email', async () => {
      getAuth.mockReturnValue({
        generatePasswordResetLink: jest.fn().mockResolvedValue('reset-link')
      });

      const response = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'test@example.com' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Şifre sıfırlama linki email adresinize gönderildi');
    });

    it('should return error for missing email', async () => {
      const response = await request(app)
        .post('/api/auth/forgot-password')
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Email adresi gerekli');
    });
  });
});