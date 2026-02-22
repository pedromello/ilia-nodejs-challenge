import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/infra/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { TransactionType } from './dto';

/** Prisma error code for PostgreSQL serialization failures (SQL state 40001). */
const PRISMA_SERIALIZATION_ERROR_CODE = 'P2034';

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
     * Creates a transaction with an atomic account upsert to prevent double-spending.
     */
    async createTransactionWithLock(
        params: CreateTransactionParams,
    ): Promise<TransactionResult> {
        const { userId, type, amount, idempotencyKey } = params;

        return this.prisma.$transaction(
            async (tx) => {
                await this.checkIdempotency(tx, idempotencyKey);

                const { currentBalance, currentVersion } = await this.readCurrentAccount(tx, userId);
                const newBalance = this.calculateNewBalance(currentBalance, type, amount, userId);

                const transaction = await tx.transaction.create({
                    data: { userId, type, amount, idempotencyKey },
                });

                await this.processAccount(tx, userId, newBalance, currentVersion);
                await this.finalizeIdempotency(tx, idempotencyKey, transaction, userId);

                this.logger.log(
                    `Transaction created: id=${transaction.id}, user=${userId}, type=${type}, amount=${amount}, new_balance=${newBalance}`,
                );

                return this.mapToResult(transaction);
            },
            {
                isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
                maxWait: 5000,
                timeout: 10000,
            },
        );
    }

    /**
     * Checks for an existing idempotency key and reserves a new one.
     *
     * - If a valid completed key exists, throws IDEMPOTENCY_DUPLICATE so the
     *   service layer can return the cached response.
     * - If no key exists, inserts a __PENDING__ placeholder. A concurrent
     *   transaction with the same key will hit the DB unique constraint (P2002)
     *   and its wrapping $transaction will abort cleanly.
     */
    private async checkIdempotency(
        tx: Awaited<Parameters<Parameters<typeof this.prisma.$transaction>[0]>[0]>,
        idempotencyKey: string | undefined,
    ): Promise<void> {
        if (!idempotencyKey) return;

        const existing = await tx.idempotencyKey.findUnique({
            where: { key: idempotencyKey },
            select: { response: true, expiresAt: true },
        });

        if (existing && existing.expiresAt > new Date()) {
            throw Object.assign(new Error('IDEMPOTENCY_DUPLICATE'), {
                cachedResponse: existing.response,
            });
        }

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

    /**
     * Reads the current account snapshot inside the active transaction.
     * Returns balance=0 and version=0 for brand-new users (no account row yet).
     */
    private async readCurrentAccount(
        tx: Awaited<Parameters<Parameters<typeof this.prisma.$transaction>[0]>[0]>,
        userId: string,
    ): Promise<{ currentBalance: number; currentVersion: number }> {
        const account = await tx.account.findUnique({
            where: { userId },
            select: { balance: true, version: true },
        });

        return {
            currentBalance: account?.balance ?? 0,
            currentVersion: account?.version ?? 0,
        };
    }

    /**
     * Computes the new balance after applying a CREDIT or DEBIT.
     * Throws INSUFFICIENT_BALANCE if the resulting balance would be negative.
     */
    private calculateNewBalance(
        currentBalance: number,
        type: TransactionType,
        amount: number,
        userId: string,
    ): number {
        const newBalance = type === TransactionType.CREDIT
            ? currentBalance + amount
            : currentBalance - amount;

        if (newBalance < 0) {
            this.logger.warn(
                `Insufficient balance for user ${userId}: current=${currentBalance}, requested=${amount}`,
            );
            throw new Error('INSUFFICIENT_BALANCE');
        }

        return newBalance;
    }

    /**
     * Atomically creates or updates the account balance.
     */
    private async processAccount(
        tx: Awaited<Parameters<Parameters<typeof this.prisma.$transaction>[0]>[0]>,
        userId: string,
        newBalance: number,
        currentVersion: number,
    ): Promise<void> {
        await tx.account.upsert({
            where: { userId },
            create: {
                userId,
                balance: newBalance,
                version: 1,
            },
            update: {
                balance: newBalance,
                version: currentVersion + 1,
            },
        });
    }

    /**
     * Updates the idempotency key record from __PENDING__ to the real
     * transaction response, with a 24-hour TTL.
     * No-ops if no idempotency key was provided.
     */
    private async finalizeIdempotency(
        tx: Awaited<Parameters<Parameters<typeof this.prisma.$transaction>[0]>[0]>,
        idempotencyKey: string | undefined,
        transaction: { id: string; amount: number; type: string },
        userId: string,
    ): Promise<void> {
        if (!idempotencyKey) return;

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

    /**
     * Maps a Prisma transaction record to the public TransactionResult DTO.
     */
    private mapToResult(transaction: {
        id: string;
        userId: string;
        type: string;
        amount: number;
        createdAt: Date;
    }): TransactionResult {
        return {
            id: transaction.id,
            userId: transaction.userId,
            type: transaction.type as TransactionType,
            amount: transaction.amount,
            createdAt: transaction.createdAt,
        };
    }

    /**
     * Wraps createTransactionWithLock with retry logic (backoff + jitter) for serialization failures.
     * This is a simple and effective way to handle serialization failures.
     * Although a more robbust solution would be to use a queue system (like BullMQ)
     * to better process those transaction requests.
     * Key benefits of a Queue approach:
     * - Better retry logic
     * - Easier handling of failed jobs
     * - Scalability with multiple workers
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
                    error?.code === PRISMA_SERIALIZATION_ERROR_CODE ||
                    error?.message?.includes('could not serialize access');

                if (isSerializationFailure && attempt < maxAttempts) {
                    const backoff = this.computeBackoffMs(attempt);
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
     * Computes the delay (in ms) for a given retry attempt using
     * exponential backoff with random jitter:
     *   attempt 1 →  100ms ± 50ms (random value between 0 - 50)
     *   attempt 2 →  200ms ± 16ms (random value between 0 - 50)
     *   attempt 3 →  400ms ± 37ms (random value between 0 - 50) …
     */
    private computeBackoffMs(attempt: number): number {
        const baseMs = Math.pow(2, attempt - 1) * 100;
        const jitterMs = Math.random() * 50;
        return baseMs + jitterMs;
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
