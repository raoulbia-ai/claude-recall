import { Authentication, authenticateUser } from './authentication';

describe('Authentication', () => {
  let auth: Authentication;

  beforeEach(() => {
    auth = new Authentication();
  });

  describe('createUser', () => {
    it('should create a new user successfully', () => {
      const result = auth.createUser('testuser', 'password123');
      
      expect(result.success).toBe(true);
      expect(result.user).toBeDefined();
      expect(result.user?.username).toBe('testuser');
      expect(result.user?.id).toBeDefined();
      expect(result.user?.passwordHash).toBe('');
      expect(result.user?.salt).toBe('');
    });

    it('should reject duplicate usernames', () => {
      auth.createUser('testuser', 'password123');
      const result = auth.createUser('testuser', 'differentpassword');
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('User already exists');
    });

    it('should reject short usernames', () => {
      const result = auth.createUser('ab', 'password123');
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Username must be at least 3 characters');
    });

    it('should reject short passwords', () => {
      const result = auth.createUser('testuser', 'pass');
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Password must be at least 8 characters');
    });
  });

  describe('authenticateUser', () => {
    beforeEach(() => {
      auth.createUser('testuser', 'password123');
    });

    it('should authenticate valid credentials', () => {
      const result = auth.authenticateUser('testuser', 'password123');
      
      expect(result.success).toBe(true);
      expect(result.user).toBeDefined();
      expect(result.user?.username).toBe('testuser');
    });

    it('should reject invalid username', () => {
      const result = auth.authenticateUser('wronguser', 'password123');
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid username or password');
    });

    it('should reject invalid password', () => {
      const result = auth.authenticateUser('testuser', 'wrongpassword');
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid username or password');
    });
  });

  describe('authenticateUser function', () => {
    it('should work with auth instance', () => {
      auth.createUser('testuser', 'password123');
      const result = authenticateUser('testuser', 'password123', auth);
      
      expect(result.success).toBe(true);
      expect(result.user?.username).toBe('testuser');
    });
  });

  describe('getUserById', () => {
    it('should retrieve user by id', () => {
      const createResult = auth.createUser('testuser', 'password123');
      const userId = createResult.user?.id;
      
      const user = auth.getUserById(userId!);
      
      expect(user).toBeDefined();
      expect(user?.username).toBe('testuser');
      expect(user?.passwordHash).toBe('');
      expect(user?.salt).toBe('');
    });

    it('should return undefined for non-existent id', () => {
      const user = auth.getUserById('non-existent-id');
      
      expect(user).toBeUndefined();
    });
  });

  describe('getAllUsers', () => {
    it('should return all users without sensitive data', () => {
      auth.createUser('user1', 'password123');
      auth.createUser('user2', 'password456');
      
      const users = auth.getAllUsers();
      
      expect(users).toHaveLength(2);
      expect(users[0].passwordHash).toBe('');
      expect(users[0].salt).toBe('');
      expect(users[1].passwordHash).toBe('');
      expect(users[1].salt).toBe('');
    });
  });
});