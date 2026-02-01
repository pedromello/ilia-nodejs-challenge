import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';

// Mock bcrypt module to avoid "Cannot redefine property" errors
jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

describe('AuthService', () => {
  let authService: AuthService;
  let usersService: UsersService;
  let jwtService: JwtService;

  const mockUser = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    email: 'test@example.com',
    firstName: 'John',
    lastName: 'Doe',
    password: '$2b$10$abcdefghijklmnopqrstuvwxyz', // hashed password
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockUsersService = {
    findByEmail: jest.fn(),
  };

  const mockJwtService = {
    sign: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    usersService = module.get<UsersService>(UsersService);
    jwtService = module.get<JwtService>(JwtService);

    // Reset mocks before each test
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Restore all spies (including bcrypt) after each test
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(authService).toBeDefined();
  });

  describe('validateUser', () => {
    it('should return user without password when credentials are valid', async () => {
      mockUsersService.findByEmail.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockImplementation(() => Promise.resolve(true));

      const result = await authService.validateUser('test@example.com', 'validPassword');

      expect(result).toBeDefined();
      expect(result.id).toBe(mockUser.id);
      expect(result.email).toBe(mockUser.email);
      expect(result.password).toBeUndefined(); // ✅ Password must not be present
      expect(mockUsersService.findByEmail).toHaveBeenCalledWith('test@example.com');
    });

    it('should return null when user does not exist', async () => {
      mockUsersService.findByEmail.mockResolvedValue(null);

      const result = await authService.validateUser('nonexistent@example.com', 'password');

      expect(result).toBeNull();
      expect(mockUsersService.findByEmail).toHaveBeenCalledWith('nonexistent@example.com');
    });

    it('should return null when password is invalid', async () => {
      mockUsersService.findByEmail.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockImplementation(() => Promise.resolve(false));

      const result = await authService.validateUser('test@example.com', 'wrongPassword');

      expect(result).toBeNull();
    });
  });

  describe('login', () => {
    const loginDto = {
      email: 'test@example.com',
      password: 'validPassword',
    };

    it('should return access token and user data (without password) on successful login', async () => {
      const validatedUser = { ...mockUser };
      delete (validatedUser as any).password;

      jest.spyOn(authService, 'validateUser').mockResolvedValue(validatedUser);
      mockJwtService.sign.mockReturnValue('mock-jwt-token');

      const result = await authService.login(loginDto);

      expect(result).toEqual({
        user: {
          id: mockUser.id,
          email: mockUser.email,
          first_name: mockUser.firstName,
          last_name: mockUser.lastName,
        },
        access_token: 'mock-jwt-token',
      });

      // ✅ Verify password is NOT in response
      expect((result.user as any).password).toBeUndefined();

      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: mockUser.id,
        email: mockUser.email,
      });
    });

    it('should throw UnauthorizedException when credentials are invalid', async () => {
      jest.spyOn(authService, 'validateUser').mockResolvedValue(null);

      await expect(authService.login(loginDto)).rejects.toThrow(UnauthorizedException);
      await expect(authService.login(loginDto)).rejects.toThrow('Invalid credentials');
    });

    it('should throw UnauthorizedException when user is null', async () => {
      jest.spyOn(authService, 'validateUser').mockResolvedValue(null);

      await expect(authService.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should generate JWT token with correct payload', async () => {
      const validatedUser = { ...mockUser };
      delete (validatedUser as any).password;

      jest.spyOn(authService, 'validateUser').mockResolvedValue(validatedUser);
      mockJwtService.sign.mockReturnValue('mock-jwt-token');

      await authService.login(loginDto);

      expect(jwtService.sign).toHaveBeenCalledTimes(1);
      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: mockUser.id,
        email: mockUser.email,
      });
    });

    it('should use snake_case in response fields', async () => {
      const validatedUser = { ...mockUser };
      delete (validatedUser as any).password;

      jest.spyOn(authService, 'validateUser').mockResolvedValue(validatedUser);
      mockJwtService.sign.mockReturnValue('mock-jwt-token');

      const result = await authService.login(loginDto);

      // ✅ Verify snake_case format
      expect(result.user).toHaveProperty('first_name');
      expect(result.user).toHaveProperty('last_name');
      expect(result).toHaveProperty('access_token');

      // ✅ Verify NOT camelCase
      expect(result.user).not.toHaveProperty('firstName');
      expect(result.user).not.toHaveProperty('lastName');
    });
  });
});
