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

const USER_ID = 'user123';

describe('TransactionsService', () => {
  let service: TransactionsService;
  let repository: jest.Mocked<TransactionsRepository>;

  const mockRepository = {
    createTransactionWithRetry: jest.fn(),
    findByUser: jest.fn(),
    getBalance: jest.fn(),
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
        type: TransactionType.CREDIT,
        amount: 1000,
      };

      const mockTransaction = {
        id: 'tx123',
        userId: USER_ID,
        type: TransactionType.CREDIT,
        amount: 1000,
        createdAt: new Date(),
      };

      repository.createTransactionWithRetry.mockResolvedValue(mockTransaction);

      const result = await service.createTransaction(dto, USER_ID, 'key123');

      expect(result).toEqual({
        id: 'tx123',
        user_id: USER_ID,
        amount: 1000,
        type: TransactionType.CREDIT,
      });
      expect(repository.createTransactionWithRetry).toHaveBeenCalledWith({
        userId: USER_ID,
        type: TransactionType.CREDIT,
        amount: 1000,
        idempotencyKey: 'key123',
      });
    });

    it('should create a DEBIT transaction with sufficient balance', async () => {
      const dto: CreateTransactionDto = {
        type: TransactionType.DEBIT,
        amount: 500,
      };

      const mockTransaction = {
        id: 'tx456',
        userId: USER_ID,
        type: TransactionType.DEBIT,
        amount: 500,
        createdAt: new Date(),
      };

      repository.createTransactionWithRetry.mockResolvedValue(mockTransaction);

      const result = await service.createTransaction(dto, USER_ID);

      expect(result.amount).toBe(500);
      expect(result.type).toBe(TransactionType.DEBIT);
    });

    it('should reject DEBIT with insufficient balance', async () => {
      const dto: CreateTransactionDto = {
        type: TransactionType.DEBIT,
        amount: 1500,
      };

      repository.createTransactionWithRetry.mockRejectedValue(
        new Error('INSUFFICIENT_BALANCE'),
      );
      repository.getBalance.mockResolvedValue(1000);

      await expect(service.createTransaction(dto, USER_ID)).rejects.toThrow(
        InsufficientBalanceException,
      );
    });

    it('should reject invalid amount (zero)', async () => {
      const dto: CreateTransactionDto = {
        type: TransactionType.CREDIT,
        amount: 0,
      };

      await expect(service.createTransaction(dto, USER_ID)).rejects.toThrow(
        InvalidAmountException,
      );
    });

    it('should reject invalid amount (negative)', async () => {
      const dto: CreateTransactionDto = {
        type: TransactionType.CREDIT,
        amount: -100,
      };

      await expect(service.createTransaction(dto, USER_ID)).rejects.toThrow(
        InvalidAmountException,
      );
    });
  });

  describe('getTransactions', () => {
    it('should return all transactions for a user', async () => {
      const mockTransactions = [
        {
          id: 'tx1',
          userId: USER_ID,
          type: TransactionType.CREDIT,
          amount: 1000,
          createdAt: new Date(),
        },
        {
          id: 'tx2',
          userId: USER_ID,
          type: TransactionType.DEBIT,
          amount: 500,
          createdAt: new Date(),
        },
      ];

      repository.findByUser.mockResolvedValue(mockTransactions);

      const result = await service.getTransactions(USER_ID);

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe(TransactionType.CREDIT);
      expect(result[1].type).toBe(TransactionType.DEBIT);
    });

    it('should filter transactions by type', async () => {
      const mockTransactions = [
        {
          id: 'tx1',
          userId: USER_ID,
          type: TransactionType.CREDIT,
          amount: 1000,
          createdAt: new Date(),
        },
      ];

      repository.findByUser.mockResolvedValue(mockTransactions);

      const result = await service.getTransactions(
        USER_ID,
        TransactionType.CREDIT,
      );

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe(TransactionType.CREDIT);
      expect(repository.findByUser).toHaveBeenCalledWith(
        USER_ID,
        TransactionType.CREDIT,
      );
    });
  });

  describe('getBalance', () => {
    it('should return current balance', async () => {
      repository.getBalance.mockResolvedValue(1500);

      const result = await service.getBalance(USER_ID);

      expect(result.amount).toBe(1500);
    });

    it('should return zero balance for new user', async () => {
      repository.getBalance.mockResolvedValue(0);

      const result = await service.getBalance('newuser');

      expect(result.amount).toBe(0);
    });
  });
});
