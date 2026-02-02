import { Test, TestingModule } from '@nestjs/testing';
import { TransactionsService } from './transactions.service';
import { TransactionsRepository } from './transactions.repository';
import {
  CreateTransactionDto,
  TransactionType,
} from './dto';
import {
  InsufficientBalanceException,
  DuplicateTransactionException,
  InvalidAmountException,
} from './exceptions';

describe('TransactionsService', () => {
  let service: TransactionsService;
  let repository: jest.Mocked<TransactionsRepository>;

  const mockRepository = {
    createTransactionWithLock: jest.fn(),
    findByUser: jest.fn(),
    getBalance: jest.fn(),
    checkIdempotencyKey: jest.fn(),
    storeIdempotencyKey: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionsService,
        {
          provide: TransactionsRepository,
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<TransactionsService>(TransactionsService);
    repository = module.get(TransactionsRepository);

    // Reset mocks
    jest.clearAllMocks();
  });

  describe('createTransaction', () => {
    it('should create a CREDIT transaction successfully', async () => {
      const dto: CreateTransactionDto = {
        user_id: 'user123',
        type: TransactionType.CREDIT,
        amount: 1000,
      };

      const mockTransaction = {
        id: 'tx123',
        userId: 'user123',
        type: TransactionType.CREDIT,
        amount: 1000,
        createdAt: new Date(),
      };

      repository.checkIdempotencyKey.mockResolvedValue(null);
      repository.createTransactionWithLock.mockResolvedValue(mockTransaction);
      repository.storeIdempotencyKey.mockResolvedValue(undefined);

      const result = await service.createTransaction(dto, 'key123');

      expect(result).toEqual({
        id: 'tx123',
        user_id: 'user123',
        amount: 1000,
        type: TransactionType.CREDIT,
      });
      expect(repository.createTransactionWithLock).toHaveBeenCalledWith({
        userId: 'user123',
        type: TransactionType.CREDIT,
        amount: 1000,
        idempotencyKey: 'key123',
      });
      expect(repository.storeIdempotencyKey).toHaveBeenCalled();
    });

    it('should create a DEBIT transaction with sufficient balance', async () => {
      const dto: CreateTransactionDto = {
        user_id: 'user123',
        type: TransactionType.DEBIT,
        amount: 500,
      };

      const mockTransaction = {
        id: 'tx456',
        userId: 'user123',
        type: TransactionType.DEBIT,
        amount: 500,
        createdAt: new Date(),
      };

      repository.checkIdempotencyKey.mockResolvedValue(null);
      repository.createTransactionWithLock.mockResolvedValue(mockTransaction);

      const result = await service.createTransaction(dto);

      expect(result.amount).toBe(500);
      expect(result.type).toBe(TransactionType.DEBIT);
    });

    it('should reject DEBIT with insufficient balance', async () => {
      const dto: CreateTransactionDto = {
        user_id: 'user123',
        type: TransactionType.DEBIT,
        amount: 1500,
      };

      repository.checkIdempotencyKey.mockResolvedValue(null);
      repository.createTransactionWithLock.mockRejectedValue(
        new Error('INSUFFICIENT_BALANCE'),
      );
      repository.getBalance.mockResolvedValue(1000);

      await expect(service.createTransaction(dto)).rejects.toThrow(
        InsufficientBalanceException,
      );
    });

    it('should return cached response for duplicate idempotency key', async () => {
      const dto: CreateTransactionDto = {
        user_id: 'user123',
        type: TransactionType.CREDIT,
        amount: 1000,
      };

      const cachedResponse = {
        id: 'tx123',
        user_id: 'user123',
        amount: 1000,
        type: TransactionType.CREDIT,
      };

      repository.checkIdempotencyKey.mockResolvedValue(
        JSON.stringify(cachedResponse),
      );

      await expect(
        service.createTransaction(dto, 'duplicate-key'),
      ).rejects.toThrow(DuplicateTransactionException);

      // Should not create a new transaction
      expect(repository.createTransactionWithLock).not.toHaveBeenCalled();
    });

    it('should reject invalid amount (zero)', async () => {
      const dto: CreateTransactionDto = {
        user_id: 'user123',
        type: TransactionType.CREDIT,
        amount: 0,
      };

      await expect(service.createTransaction(dto)).rejects.toThrow(
        InvalidAmountException,
      );
    });

    it('should reject invalid amount (negative)', async () => {
      const dto: CreateTransactionDto = {
        user_id: 'user123',
        type: TransactionType.CREDIT,
        amount: -100,
      };

      await expect(service.createTransaction(dto)).rejects.toThrow(
        InvalidAmountException,
      );
    });
  });

  describe('getTransactions', () => {
    it('should return all transactions for a user', async () => {
      const mockTransactions = [
        {
          id: 'tx1',
          userId: 'user123',
          type: TransactionType.CREDIT,
          amount: 1000,
          createdAt: new Date(),
        },
        {
          id: 'tx2',
          userId: 'user123',
          type: TransactionType.DEBIT,
          amount: 500,
          createdAt: new Date(),
        },
      ];

      repository.findByUser.mockResolvedValue(mockTransactions);

      const result = await service.getTransactions('user123');

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe(TransactionType.CREDIT);
      expect(result[1].type).toBe(TransactionType.DEBIT);
    });

    it('should filter transactions by type', async () => {
      const mockTransactions = [
        {
          id: 'tx1',
          userId: 'user123',
          type: TransactionType.CREDIT,
          amount: 1000,
          createdAt: new Date(),
        },
      ];

      repository.findByUser.mockResolvedValue(mockTransactions);

      const result = await service.getTransactions(
        'user123',
        TransactionType.CREDIT,
      );

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe(TransactionType.CREDIT);
      expect(repository.findByUser).toHaveBeenCalledWith(
        'user123',
        TransactionType.CREDIT,
      );
    });
  });

  describe('getBalance', () => {
    it('should return current balance', async () => {
      repository.getBalance.mockResolvedValue(1500);

      const result = await service.getBalance('user123');

      expect(result.amount).toBe(1500);
    });

    it('should return zero balance for new user', async () => {
      repository.getBalance.mockResolvedValue(0);

      const result = await service.getBalance('newuser');

      expect(result.amount).toBe(0);
    });
  });
});
