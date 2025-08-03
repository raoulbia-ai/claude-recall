import * as crypto from 'crypto';

interface User {
  id: string;
  username: string;
  passwordHash: string;
  salt: string;
  createdAt: Date;
}

interface AuthResult {
  success: boolean;
  user?: User;
  error?: string;
}

export class Authentication {
  private users: Map<string, User> = new Map();

  private hashPassword(password: string, salt: string): string {
    return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  }

  private generateSalt(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  private generateId(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  public createUser(username: string, password: string): AuthResult {
    if (this.users.has(username)) {
      return { success: false, error: 'User already exists' };
    }

    if (!username || username.length < 3) {
      return { success: false, error: 'Username must be at least 3 characters' };
    }

    if (!password || password.length < 8) {
      return { success: false, error: 'Password must be at least 8 characters' };
    }

    const salt = this.generateSalt();
    const passwordHash = this.hashPassword(password, salt);
    
    const user: User = {
      id: this.generateId(),
      username,
      passwordHash,
      salt,
      createdAt: new Date()
    };

    this.users.set(username, user);
    
    return { 
      success: true, 
      user: { ...user, passwordHash: '', salt: '' } 
    };
  }

  public authenticateUser(username: string, password: string): AuthResult {
    const user = this.users.get(username);
    
    if (!user) {
      return { success: false, error: 'Invalid username or password' };
    }

    const passwordHash = this.hashPassword(password, user.salt);
    
    if (passwordHash !== user.passwordHash) {
      return { success: false, error: 'Invalid username or password' };
    }

    return { 
      success: true, 
      user: { ...user, passwordHash: '', salt: '' } 
    };
  }

  public getUserById(id: string): User | undefined {
    for (const user of this.users.values()) {
      if (user.id === id) {
        return { ...user, passwordHash: '', salt: '' };
      }
    }
    return undefined;
  }

  public getAllUsers(): User[] {
    return Array.from(this.users.values()).map(user => ({
      ...user,
      passwordHash: '',
      salt: ''
    }));
  }
}

export function authenticateUser(username: string, password: string, authInstance: Authentication): AuthResult {
  return authInstance.authenticateUser(username, password);
}