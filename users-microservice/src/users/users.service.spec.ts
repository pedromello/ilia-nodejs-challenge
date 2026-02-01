import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersRepository } from './users.repository';
import * as bcrypt from 'bcrypt';

// Mock bcrypt module to avoid "Cannot redefine property" errors
jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

describe('UsersService', () => {
  let service: UsersService;
  let repository: UsersRepository;

  const mockUser = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    email: 'test@example.com',
    firstName: 'John',
    lastName: 'Doe',
    password: '$2b$10$hashedpassword',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockRepository = {
    create: jest.fn(),
    findAll: jest.fn(),
    findById: jest.fn(),
    findByEmail: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: UsersRepository,
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    repository = module.get<UsersRepository>(UsersRepository);

    jest.clearAllMocks();
  });

  afterEach(() => {
    // Restore all spies (including bcrypt) after each test
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    const createUserDto = {
      email: 'newuser@example.com',
      first_name: 'Jane',
      last_name: 'Smith',
      password: 'password123',
    };

    it('should create a new user successfully', async () => {
      mockRepository.findByEmail.mockResolvedValue(null);
      mockRepository.create.mockResolvedValue({ ...mockUser, ...createUserDto });
      (bcrypt.hash as jest.Mock).mockImplementation(() =>
        Promise.resolve('$2b$10$hashedpassword'),
      );

      const result = await service.create(createUserDto);

      expect(result).toBeDefined();
      expect(result.email).toBe(createUserDto.email);
      expect((result as any).password).toBeUndefined();
      expect(result).toHaveProperty('first_name');
      expect(result).toHaveProperty('last_name');
    });

    it('should hash password before creating user', async () => {
      mockRepository.findByEmail.mockResolvedValue(null);
      mockRepository.create.mockResolvedValue(mockUser);

      (bcrypt.hash as jest.Mock).mockImplementation(() => Promise.resolve('$2b$10$hashedpassword'));

      await service.create(createUserDto);

      expect(bcrypt.hash).toHaveBeenCalledWith(createUserDto.password, 10);
      expect(mockRepository.create).toHaveBeenCalledWith({
        ...createUserDto,
        password: '$2b$10$hashedpassword',
      });
    });

    it('should throw ConflictException if email already exists', async () => {
      mockRepository.findByEmail.mockResolvedValue(mockUser);

      await expect(service.create(createUserDto)).rejects.toThrow(ConflictException);
      await expect(service.create(createUserDto)).rejects.toThrow('Email already exists');
      expect(mockRepository.create).not.toHaveBeenCalled();
    });

    it('should use snake_case in response', async () => {
      mockRepository.findByEmail.mockResolvedValue(null);
      mockRepository.create.mockResolvedValue(mockUser);
      (bcrypt.hash as jest.Mock).mockImplementation(() =>
        Promise.resolve('$2b$10$hashedpassword'),
      );

      const result = await service.create(createUserDto);
      expect(result).toHaveProperty('first_name');
      expect(result).toHaveProperty('last_name');
      expect(result).not.toHaveProperty('firstName');
      expect(result).not.toHaveProperty('lastName');
    });
  });

  describe('findAll', () => {
    it('should return all users without passwords', async () => {
      const users = [mockUser, { ...mockUser, id: 'another-id' }];
      mockRepository.findAll.mockResolvedValue(users);

      const result = await service.findAll();

      expect(result).toHaveLength(2);
      result.forEach((user) => {
        expect((user as any).password).toBeUndefined();
        expect(user).toHaveProperty('id');
        expect(user).toHaveProperty('email');
        expect(user).toHaveProperty('first_name');
        expect(user).toHaveProperty('last_name');
      });
    });

    it('should return empty array when no users exist', async () => {
      mockRepository.findAll.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });
  });

  describe('findOne', () => {
    it('should return a user by id without password', async () => {
      mockRepository.findById.mockResolvedValue(mockUser);

      const result = await service.findOne(mockUser.id);

      expect(result).toBeDefined();
      expect(result.id).toBe(mockUser.id);
      expect((result as any).password).toBeUndefined();
      expect(mockRepository.findById).toHaveBeenCalledWith(mockUser.id);
    });

    it('should throw NotFoundException when user does not exist', async () => {
      mockRepository.findById.mockResolvedValue(null);

      await expect(service.findOne('non-existent-id')).rejects.toThrow(NotFoundException);
      await expect(service.findOne('non-existent-id')).rejects.toThrow('User not found');
    });

    it('should throw UnauthorizedException when requesterId does not match user id', async () => {
      await expect(service.findOne(mockUser.id, 'wrong-id')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('update', () => {
    const updateUserDto = {
      first_name: 'UpdatedName',
      last_name: 'UpdatedLastName',
    };

    it('should update user successfully', async () => {
      mockRepository.findById.mockResolvedValue(mockUser);
      mockRepository.update.mockResolvedValue({ ...mockUser, ...updateUserDto });

      const result = await service.update(mockUser.id, updateUserDto);

      expect(result).toBeDefined();
      // ✅ CRITICAL: Password must NOT be in response
      expect((result as any).password).toBeUndefined();
      expect(mockRepository.update).toHaveBeenCalledWith(mockUser.id, updateUserDto);
    });

    it('should throw NotFoundException when user does not exist', async () => {
      mockRepository.findById.mockResolvedValue(null);

      await expect(service.update('non-existent-id', updateUserDto)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockRepository.update).not.toHaveBeenCalled();
    });

    it('should hash password when password is being updated', async () => {
      const updateWithPassword = {
        ...updateUserDto,
        password: 'newPassword123',
      };

      mockRepository.findById.mockResolvedValue(mockUser);
      mockRepository.update.mockResolvedValue(mockUser);

      (bcrypt.hash as jest.Mock).mockImplementation(() => Promise.resolve('$2b$10$newhashedpassword'));

      await service.update(mockUser.id, updateWithPassword);

      expect(bcrypt.hash).toHaveBeenCalledWith('newPassword123', 10);
      expect(mockRepository.update).toHaveBeenCalledWith(mockUser.id, {
        ...updateWithPassword,
        password: '$2b$10$newhashedpassword',
      });
    });

    it('should throw UnauthorizedException when requesterId does not match user id during update', async () => {
      await expect(
        service.update(mockUser.id, updateUserDto, 'wrong-id'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should not hash password when password is not being updated', async () => {
      mockRepository.findById.mockResolvedValue(mockUser);
      mockRepository.update.mockResolvedValue(mockUser);

      await service.update(mockUser.id, updateUserDto);

      expect(bcrypt.hash).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should delete user successfully', async () => {
      mockRepository.findById.mockResolvedValue(mockUser);
      mockRepository.delete.mockResolvedValue(mockUser);

      await service.remove(mockUser.id);

      expect(mockRepository.delete).toHaveBeenCalledWith(mockUser.id);
    });

    it('should throw NotFoundException when user does not exist', async () => {
      mockRepository.findById.mockResolvedValue(null);

      await expect(service.remove('non-existent-id')).rejects.toThrow(NotFoundException);
      expect(mockRepository.delete).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when requesterId does not match user id during removal', async () => {
      await expect(service.remove(mockUser.id, 'wrong-id')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('findByEmail', () => {
    it('should return user by email (for internal use)', async () => {
      mockRepository.findByEmail.mockResolvedValue(mockUser);

      const result = await service.findByEmail('test@example.com');

      expect(result).toBeDefined();
      expect(result?.email).toBe(mockUser.email);
      expect(mockRepository.findByEmail).toHaveBeenCalledWith('test@example.com');
    });

    it('should return null when user does not exist', async () => {
      mockRepository.findByEmail.mockResolvedValue(null);

      const result = await service.findByEmail('nonexistent@example.com');

      expect(result).toBeNull();
    });
  });

  describe('Security Tests', () => {
    it('should NEVER expose password in any response', async () => {
      // Test all methods that return user data
      mockRepository.create.mockResolvedValue(mockUser);
      mockRepository.findAll.mockResolvedValue([mockUser]);
      mockRepository.findById.mockResolvedValue(mockUser);
      mockRepository.findByEmail.mockResolvedValue(null);
      mockRepository.update.mockResolvedValue(mockUser);

      (bcrypt.hash as jest.Mock).mockImplementation(() =>
        Promise.resolve('$2b$10$hash'),
      );

      const createDto = {
        email: 'test@test.com',
        first_name: 'Test',
        last_name: 'User',
        password: 'password',
      };

      // Test create
      const created = await service.create(createDto);
      expect((created as any).password).toBeUndefined();

      // Test findAll
      mockRepository.findByEmail.mockResolvedValue(mockUser);
      const all = await service.findAll();
      all.forEach((user) => expect((user as any).password).toBeUndefined());

      // Test findOne
      const one = await service.findOne(mockUser.id);
      expect((one as any).password).toBeUndefined();

      // Test update
      const updated = await service.update(mockUser.id, { first_name: 'Updated' });
      expect((updated as any).password).toBeUndefined();
    });

    it('should use snake_case in all responses', async () => {
      mockRepository.findById.mockResolvedValue(mockUser);

      const result = await service.findOne(mockUser.id);

      expect(result).toHaveProperty('first_name');
      expect(result).toHaveProperty('last_name');
      expect(result).not.toHaveProperty('firstName');
      expect(result).not.toHaveProperty('lastName');
    });
  });
});
