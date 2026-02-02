import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../infra/prisma.service';
import { TransactionType } from './dto';
import { Prisma } from '../generated/prisma/client';

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
                // Step 1: Lock the account row using SELECT FOR UPDATE
                // This prevents concurrent transactions from reading stale balance
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
                    data: {
                        userId,
                        type,
                        amount,
                        idempotencyKey,
                    },
                });

                // Step 4: Update or create account balance atomically
                if (accountId) {
                    // Update existing account with version increment
                    await tx.account.update({
                        where: { id: accountId },
                        data: {
                            balance: newBalance,
                            version: currentVersion + 1,
                        },
                    });
                } else {
                    // Create new account for first-time user
                    await tx.account.create({
                        data: {
                            userId,
                            balance: newBalance,
                            version: 1,
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
            orderBy: {
                createdAt: 'desc',
            },
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
        const account = await this.prisma.account.findUnique({
            where: { userId },
            select: { balance: true },
        });

        if (account) {
            return account.balance;
        }

        // Fallback: Calculate from transaction history if account doesn't exist
        const aggregation = await this.prisma.transaction.aggregate({
            where: { userId },
            _sum: {
                amount: true,
            },
        });

        // Calculate balance: sum of CREDIT - sum of DEBIT
        const credits = await this.prisma.transaction.aggregate({
            where: { userId, type: 'CREDIT' },
            _sum: { amount: true },
        });

        const debits = await this.prisma.transaction.aggregate({
            where: { userId, type: 'DEBIT' },
            _sum: { amount: true },
        });

        const balance = (credits._sum.amount || 0) - (debits._sum.amount || 0);

        this.logger.debug(
            `Balance calculated from ledger for user ${userId}: ${balance}`,
        );

        return balance;
    }

    /**
     * Check if idempotency key exists and return cached response
     */
    async checkIdempotencyKey(key: string): Promise<string | null> {
        const result = await this.prisma.idempotencyKey.findUnique({
            where: { key },
            select: { response: true, expiresAt: true },
        });

        if (!result) {
            return null;
        }

        // Check if key has expired
        if (result.expiresAt < new Date()) {
            this.logger.debug(`Idempotency key expired: ${key}`);
            return null;
        }

        this.logger.log(`Idempotency key found: ${key}`);
        return result.response;
    }

    /**
     * Store idempotency key with response
     */
    async storeIdempotencyKey(
        key: string,
        response: any,
        ttlHours: number = 24,
    ): Promise<void> {
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + ttlHours);

        await this.prisma.idempotencyKey.create({
            data: {
                key,
                response: JSON.stringify(response),
                expiresAt,
            },
        });

        this.logger.debug(`Stored idempotency key: ${key}, expires: ${expiresAt}`);
    }

    /**
     * Cleanup expired idempotency keys (can be called by a cron job)
     */
    async cleanupExpiredKeys(): Promise<number> {
        const result = await this.prisma.idempotencyKey.deleteMany({
            where: {
                expiresAt: {
                    lt: new Date(),
                },
            },
        });

        this.logger.log(`Cleaned up ${result.count} expired idempotency keys`);
        return result.count;
    }

    async onModuleDestroy() {
        await this.prisma.$disconnect();
    }
}
