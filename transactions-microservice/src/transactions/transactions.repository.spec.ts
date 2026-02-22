import { Logger } from '@nestjs/common';
import { TransactionsRepository } from './transactions.repository';
import { TransactionType } from './dto';
import { Prisma } from '../generated/prisma/client';

// Helpers to build a typed mock Prisma interactive transaction client.
function buildTxMock(overrides: Partial<ReturnType<typeof defaultTxMock>> = {}) {
    return { ...defaultTxMock(), ...overrides };
}

function defaultTxMock() {
    return {
        idempotencyKey: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue(undefined),
            update: jest.fn().mockResolvedValue(undefined),
        },
        account: {
            // Returns null by default, simulating a brand-new user (balance = 0)
            findUnique: jest.fn().mockResolvedValue(null),
            upsert: jest.fn().mockResolvedValue({ id: 'acc-1', balance: 1000, version: 1 }),
        },
        transaction: {
            create: jest.fn().mockResolvedValue({
                id: 'tx-1',
                userId: 'user-1',
                type: TransactionType.CREDIT,
                amount: 1000,
                createdAt: new Date('2026-01-01'),
            }),
        },
    };
}

function buildPrismaMock(txMock: ReturnType<typeof buildTxMock>) {
    return {
        $transaction: jest.fn().mockImplementation((fn: (tx: typeof txMock) => Promise<unknown>, _opts?: unknown) =>
            fn(txMock),
        ),
    };
}

// Factory: creates a repository backed by a mock Prisma service.
function buildRepository(txMock: ReturnType<typeof buildTxMock>) {
    const prismaMock = buildPrismaMock(txMock);
    // Suppress logger noise in tests
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const repo = new TransactionsRepository(prismaMock as any);
    return { repo, prismaMock, txMock };
}

describe('TransactionsRepository — createTransactionWithLock', () => {
    beforeEach(() => jest.clearAllMocks());

    describe('Phantom Lock — new user first transaction', () => {
        it('should call account.upsert (not account.create) to prevent Phantom Lock', async () => {
            const txMock = buildTxMock();
            const { repo } = buildRepository(txMock);

            await repo.createTransactionWithLock({
                userId: 'new-user',
                type: TransactionType.CREDIT,
                amount: 1000,
            });

            expect(txMock.account.upsert).toHaveBeenCalledTimes(1);
            expect(txMock.account.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { userId: 'new-user' },
                    create: expect.objectContaining({ userId: 'new-user', balance: 1000, version: 1 }),
                }),
            );
        });

        it('should NOT call the raw query for SELECT FOR UPDATE', async () => {
            const txMock = buildTxMock() as any;
            txMock.$queryRaw = jest.fn();
            const { repo } = buildRepository(txMock);

            await repo.createTransactionWithLock({
                userId: 'new-user',
                type: TransactionType.CREDIT,
                amount: 500,
            });

            // Raw SELECT FOR UPDATE must be gone
            expect(txMock.$queryRaw).not.toHaveBeenCalled();
        });
    });

    describe('CREDIT transaction', () => {
        it('should return a TransactionResult with correct fields', async () => {
            const txMock = buildTxMock();
            const { repo } = buildRepository(txMock);

            const result = await repo.createTransactionWithLock({
                userId: 'user-1',
                type: TransactionType.CREDIT,
                amount: 1000,
            });

            expect(result).toEqual({
                id: 'tx-1',
                userId: 'user-1',
                type: TransactionType.CREDIT,
                amount: 1000,
                createdAt: expect.any(Date),
            });
        });

        it('should create the transaction record in the ledger', async () => {
            const txMock = buildTxMock();
            const { repo } = buildRepository(txMock);

            await repo.createTransactionWithLock({
                userId: 'user-1',
                type: TransactionType.CREDIT,
                amount: 1000,
            });

            expect(txMock.transaction.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        userId: 'user-1',
                        type: TransactionType.CREDIT,
                        amount: 1000,
                    }),
                }),
            );
        });
    });

    describe('DEBIT transaction', () => {
        it('should upsert account with newBalance = currentBalance - amount', async () => {
            const txMock = buildTxMock();
            // Simulate an existing account with balance 1000 (enough for a 400 debit)
            txMock.account.findUnique.mockResolvedValue({ balance: 1000, version: 1 });
            txMock.account.upsert.mockResolvedValue({ id: 'acc-1', balance: 600, version: 2 });
            txMock.transaction.create.mockResolvedValue({
                id: 'tx-2',
                userId: 'user-1',
                type: TransactionType.DEBIT,
                amount: 400,
                createdAt: new Date('2026-01-01'),
            });
            const { repo } = buildRepository(txMock);

            const result = await repo.createTransactionWithLock({
                userId: 'user-1',
                type: TransactionType.DEBIT,
                amount: 400,
            });

            expect(result.type).toBe(TransactionType.DEBIT);
            expect(result.amount).toBe(400);
            expect(txMock.account.upsert).toHaveBeenCalledTimes(1);
            // Verify the update clause computes the correct new balance
            expect(txMock.account.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    update: expect.objectContaining({ balance: 600 }),
                }),
            );
        });
    });

    describe('DEBIT with insufficient balance', () => {
        it('should throw INSUFFICIENT_BALANCE error', async () => {
            const txMock = buildTxMock();
            const { repo } = buildRepository(txMock);

            await expect(
                repo.createTransactionWithLock({
                    userId: 'new-user',
                    type: TransactionType.DEBIT,
                    amount: 500, // new user → balance=0 → 0-500 < 0
                }),
            ).rejects.toThrow('INSUFFICIENT_BALANCE');
        });

        it('should NOT create a transaction record when balance is insufficient', async () => {
            const txMock = buildTxMock();
            const { repo } = buildRepository(txMock);

            await expect(
                repo.createTransactionWithLock({
                    userId: 'new-user',
                    type: TransactionType.DEBIT,
                    amount: 1,
                }),
            ).rejects.toThrow('INSUFFICIENT_BALANCE');

            expect(txMock.transaction.create).not.toHaveBeenCalled();
        });
    });

    describe('Idempotency — completed key', () => {
        it('should throw IDEMPOTENCY_DUPLICATE when a valid completed key is found', async () => {
            const dayInSeconds = 86_400_000;
            const cachedResponse = JSON.stringify({ id: 'tx-old', user_id: 'user-1', amount: 1000, type: 'CREDIT' });
            const txMock = buildTxMock();
            txMock.idempotencyKey.findUnique.mockResolvedValue({
                response: cachedResponse,
                expiresAt: new Date(Date.now() + dayInSeconds),
            });
            const { repo } = buildRepository(txMock);

            const error = await repo
                .createTransactionWithLock({
                    userId: 'user-1',
                    type: TransactionType.CREDIT,
                    amount: 1000,
                    idempotencyKey: 'key-abc',
                })
                .catch((e) => e);

            expect(error.message).toBe('IDEMPOTENCY_DUPLICATE');
            expect(error.cachedResponse).toBe(cachedResponse);
        });

        it('should NOT reserve a key or process money when key is already completed', async () => {
            const txMock = buildTxMock();
            txMock.idempotencyKey.findUnique.mockResolvedValue({
                response: '{}',
                expiresAt: new Date(Date.now() + 86_400_000),
            });
            const { repo } = buildRepository(txMock);

            await repo
                .createTransactionWithLock({
                    userId: 'user-1',
                    type: TransactionType.CREDIT,
                    amount: 1000,
                    idempotencyKey: 'key-abc',
                })
                .catch(() => undefined);

            expect(txMock.idempotencyKey.create).not.toHaveBeenCalled();
            expect(txMock.transaction.create).not.toHaveBeenCalled();
        });
    });

    describe('Idempotency — racing duplicate (P2002 must bubble through)', () => {
        it('should re-throw P2002 from idempotencyKey.create without swallowing it', async () => {
            const txMock = buildTxMock();
            const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
            txMock.idempotencyKey.create.mockRejectedValue(p2002);
            const { repo } = buildRepository(txMock);

            await expect(
                repo.createTransactionWithLock({
                    userId: 'user-1',
                    type: TransactionType.CREDIT,
                    amount: 1000,
                    idempotencyKey: 'racing-key',
                }),
            ).rejects.toMatchObject({ code: 'P2002' });
        });
    });

    describe('Idempotency — key finalization', () => {
        it('should update the idempotency key with the real response after success', async () => {
            const txMock = buildTxMock();
            const { repo } = buildRepository(txMock);

            await repo.createTransactionWithLock({
                userId: 'user-1',
                type: TransactionType.CREDIT,
                amount: 1000,
                idempotencyKey: 'key-abc',
            });

            expect(txMock.idempotencyKey.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { key: 'key-abc' },
                    data: expect.objectContaining({
                        response: expect.stringContaining('tx-1'),
                    }),
                }),
            );
        });

        it('should skip idempotency steps when no idempotencyKey is provided', async () => {
            const txMock = buildTxMock();
            const { repo } = buildRepository(txMock);

            await repo.createTransactionWithLock({
                userId: 'user-1',
                type: TransactionType.CREDIT,
                amount: 1000,
                // no idempotencyKey
            });

            expect(txMock.idempotencyKey.findUnique).not.toHaveBeenCalled();
            expect(txMock.idempotencyKey.create).not.toHaveBeenCalled();
            expect(txMock.idempotencyKey.update).not.toHaveBeenCalled();
        });
    });

    // -----------------------------------------------------------------------
    // RED #8 — Transaction isolation level is Serializable
    // -----------------------------------------------------------------------
    describe('Transaction isolation', () => {
        it('should use Serializable isolation level', async () => {
            const txMock = buildTxMock();
            const { repo, prismaMock } = buildRepository(txMock);

            await repo.createTransactionWithLock({
                userId: 'user-1',
                type: TransactionType.CREDIT,
                amount: 1000,
            });

            expect(prismaMock.$transaction).toHaveBeenCalledWith(
                expect.any(Function),
                expect.objectContaining({
                    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
                }),
            );
        });
    });
});
