import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/infra/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { TransactionType } from './dto';

export interface CreateTransactionParams {
    userId: string;
    type: TransactionType;
    amount: number;
    idempotencyKey?: string;
}

export interface TransactionResult {
    id: string;
    userId: string;
    type: TransactionType;
    amount: number;
    createdAt: Date;
}

@Injectable()
export class TransactionsRepository {
    private readonly logger = new Logger(TransactionsRepository.name);

    constructor(private readonly prisma: PrismaService) { }

    /**
     * Creates a transaction with pessimistic locking to prevent double-spending
     * Uses SELECT FOR UPDATE to lock the account row during the transaction
     */
    async createTransactionWithLock(
        params: CreateTransactionParams,
    ): Promise<TransactionResult> {
        const { userId, type, amount, idempotencyKey } = params;

        return this.prisma.$transaction(
            async (tx) => {
                // Step 0: Atomic idempotency guard
                // Strategy: INSERT the idempotency key as a placeholder at the very
                // beginning of the transaction. Two concurrent transactions with the
                // same key will both try to INSERT — the second one hits the DB UNIQUE
                // constraint and the entire transaction aborts before touching money.
                if (idempotencyKey) {
                    // First check for an already-completed entry (non-racing duplicate)
                    const existing = await tx.idempotencyKey.findUnique({
                        where: { key: idempotencyKey },
                        select: { response: true, expiresAt: true },
                    });

                    if (existing && existing.expiresAt > new Date()) {
                        // Completed key found — signal duplicate to the service layer
                        throw Object.assign(new Error('IDEMPOTENCY_DUPLICATE'), {
                            cachedResponse: existing.response,
                        });
                    }

                    // Reserve the key with a placeholder BEFORE touching money.
                    // If two concurrent TXs both saw null above, one will win the
                    // INSERT and the other will hit P2002 here, aborting its TX.
                    const ninetyDaysFromNow = new Date();
                    ninetyDaysFromNow.setDate(ninetyDaysFromNow.getDate() + 90);

                    await tx.idempotencyKey.create({
                        data: {
                            key: idempotencyKey,
                            response: '__PENDING__',
                            expiresAt: ninetyDaysFromNow,
                        },
                    });
                }

                // Step 1: Lock the account row using SELECT FOR UPDATE
                const account = await tx.$queryRaw<Array<{ id: string; balance: number; version: number }>>`
          SELECT id, balance, version 
          FROM accounts 
          WHERE user_id = ${userId}
          FOR UPDATE
        `;

                let currentBalance = 0;
                let accountId: string | null = null;
                let currentVersion = 0;

                if (account.length > 0) {
                    accountId = account[0].id;
                    currentBalance = account[0].balance;
                    currentVersion = account[0].version;
                }

                // Step 2: Calculate new balance and validate
                const newBalance = type === TransactionType.CREDIT
                    ? currentBalance + amount
                    : currentBalance - amount;

                if (newBalance < 0) {
                    this.logger.warn(
                        `Insufficient balance for user ${userId}: current=${currentBalance}, requested=${amount}`,
                    );
                    throw new Error('INSUFFICIENT_BALANCE');
                }

                // Step 3: Create transaction record (immutable ledger)
                const transaction = await tx.transaction.create({
                    data: { userId, type, amount, idempotencyKey },
                });

                // Step 4: Update or create account balance atomically
                if (accountId) {
                    // Update existing account with version increment
                    await tx.account.update({
                        where: { id: accountId },
                        data: { balance: newBalance, version: currentVersion + 1 },
                    });
                } else {
                    // Create new account for first-time user
                    await tx.account.create({
                        data: { userId, balance: newBalance, version: 1 },
                    });
                }

                // Step 5: Update idempotency key with response data
                if (idempotencyKey) {
                    const expiresAt = new Date();
                    expiresAt.setHours(expiresAt.getHours() + 24);

                    await tx.idempotencyKey.update({
                        where: { key: idempotencyKey },
                        data: {
                            response: JSON.stringify({
                                id: transaction.id,
                                user_id: userId,
                                amount: transaction.amount,
                                type: transaction.type,
                            }),
                            expiresAt,
                        },
                    });
                }

                this.logger.log(
                    `Transaction created: id=${transaction.id}, user=${userId}, type=${type}, amount=${amount}, new_balance=${newBalance}`,
                );

                return {
                    id: transaction.id,
                    userId: transaction.userId,
                    type: transaction.type as TransactionType,
                    amount: transaction.amount,
                    createdAt: transaction.createdAt,
                };
            },
            {
                isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
                maxWait: 5000,
                timeout: 10000,
            },
        );
    }

    /**
     * Wraps createTransactionWithLock with retry logic for serialization failures.
     * PostgreSQL Serializable isolation can abort transactions with error code 40001
     * ("could not serialize access due to concurrent update"). This is expected
     * behaviour and should be retried with exponential backoff + jitter.
     * Prisma surfaces this as error code P2034.
     */
    async createTransactionWithRetry(
        params: CreateTransactionParams,
        maxAttempts = 10,
    ): Promise<TransactionResult> {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await this.createTransactionWithLock(params);
            } catch (error) {
                const isSerializationFailure =
                    error?.code === 'P2034' ||
                    error?.message?.includes('could not serialize access');

                if (isSerializationFailure && attempt < maxAttempts) {
                    // Exponential backoff: 100ms, 200ms, 400ms … with ±50ms jitter
                    const backoff = Math.pow(2, attempt - 1) * 100 + Math.random() * 50;
                    this.logger.warn(
                        `Serialization failure (attempt ${attempt}/${maxAttempts}), retrying in ${Math.round(backoff)}ms…`,
                    );
                    await new Promise((resolve) => setTimeout(resolve, backoff));
                    continue;
                }

                throw error;
            }
        }
        throw new Error('Unreachable: retry loop exhausted without throw');
    }

    /**
     * Find transactions by user with optional type filter
     */
    async findByUser(
        userId: string,
        type?: TransactionType,
    ): Promise<TransactionResult[]> {
        const transactions = await this.prisma.transaction.findMany({
            where: {
                userId,
                ...(type && { type }),
            },
            orderBy: { createdAt: 'desc' },
        });

        return transactions.map((t) => ({
            id: t.id,
            userId: t.userId,
            type: t.type as TransactionType,
            amount: t.amount,
            createdAt: t.createdAt,
        }));
    }

    /**
     * Get current balance from Account snapshot
     * Falls back to calculation if account doesn't exist
     */
    async getBalance(userId: string): Promise<number> {
        // Try the account table first (fast path)
        const account = await this.prisma.account.findUnique({
            where: { userId },
            select: { balance: true },
        });

        if (account) {
            return account.balance;
        }

        // Fallback: compute from transaction history
        const aggregation = await this.prisma.transaction.groupBy({
            by: ['type'],
            where: { userId },
            _sum: { amount: true },
        });

        const credits = aggregation.find((a) => a.type === TransactionType.CREDIT)?._sum?.amount ?? 0;
        const debits = aggregation.find((a) => a.type === TransactionType.DEBIT)?._sum?.amount ?? 0;
        const balance = credits - debits;

        this.logger.debug(
            `Balance computed from transactions for user ${userId}: credits=${credits}, debits=${debits}, balance=${balance}`,
        );

        return balance;
    }

    /**
     * Check if an idempotency key exists and is not expired
     * @returns The cached response JSON string if found, null otherwise
     */
    async checkIdempotencyKey(key: string): Promise<string | null> {
        const result = await this.prisma.idempotencyKey.findUnique({
            where: { key },
            select: { response: true, expiresAt: true },
        });

        if (!result) return null;

        // Check if key is expired
        if (result.expiresAt < new Date()) {
            return null;
        }

        return result.response;
    }

    /**
     * Store idempotency key with response and TTL
     */
    async storeIdempotencyKey(
        key: string,
        response: any,
        ttlHours: number = 24,
    ): Promise<void> {
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + ttlHours);

        await this.prisma.idempotencyKey.upsert({
            where: { key },
            create: {
                key,
                response: JSON.stringify(response),
                expiresAt,
            },
            update: {
                response: JSON.stringify(response),
                expiresAt,
            },
        });
    }

    /**
     * Cleanup expired idempotency keys (can be called by a cron job)
     */
    async cleanupExpiredKeys(): Promise<number> {
        const result = await this.prisma.idempotencyKey.deleteMany({
            where: {
                expiresAt: { lt: new Date() },
            },
        });

        this.logger.log(`Cleaned up ${result.count} expired idempotency keys`);
        return result.count;
    }

    async onModuleDestroy() {
        await this.prisma.$disconnect();
    }
}
