import { Injectable, Logger } from '@nestjs/common';
import {
    TransactionsRepository,
    CreateTransactionParams,
} from './transactions.repository';
import {
    CreateTransactionDto,
    TransactionResponseDto,
    BalanceResponseDto,
    TransactionType,
} from './dto';
import {
    InsufficientBalanceException,
    DuplicateTransactionException,
    InvalidAmountException,
} from './exceptions';

@Injectable()
export class TransactionsService {
    private readonly logger = new Logger(TransactionsService.name);

    constructor(private readonly repository: TransactionsRepository) { }

    /**
     * Create a new transaction with idempotency support.
     */
    async createTransaction(
        dto: CreateTransactionDto,
        userId: string,
        idempotencyKey?: string,
    ): Promise<TransactionResponseDto> {
        // Validate amount
        if (dto.amount <= 0) {
            throw new InvalidAmountException(dto.amount);
        }

        try {
            const params: CreateTransactionParams = {
                userId,
                type: dto.type,
                amount: dto.amount,
                idempotencyKey,
            };

            const transaction = await this.repository.createTransactionWithRetry(params);

            const response: TransactionResponseDto = {
                id: transaction.id,
                user_id: transaction.userId,
                amount: transaction.amount,
                type: transaction.type,
            };

            this.logger.log(
                `Transaction created successfully: ${transaction.id} for user ${userId}`,
            );

            return response;
        } catch (error) {
            if (error.message === 'IDEMPOTENCY_DUPLICATE') {
                // Idempotency duplicate detected inside the DB transaction
                const parsed = JSON.parse(error.cachedResponse);
                this.logger.log(
                    `[IDEMPOTENCY_DUPLICATE] Returning cached response for idempotency key: ${idempotencyKey}`,
                );
                // Return the cached response instead of throwing an exception
                return parsed;
            }

            if (error.message === 'INSUFFICIENT_BALANCE') {
                const currentBalance = await this.repository.getBalance(userId);
                throw new InsufficientBalanceException(
                    userId,
                    currentBalance,
                    dto.amount,
                );
            }

            this.logger.error(
                `Failed to create transaction for user ${userId}: ${error.message}`,
                error.stack,
            );
            throw error;
        }
    }

    /**
     * Get transactions for a user with optional type filter
     */
    async getTransactions(
        userId: string,
        type?: TransactionType,
    ): Promise<TransactionResponseDto[]> {
        this.logger.debug(
            `Fetching transactions for user ${userId}, type filter: ${type || 'none'}`,
        );

        const transactions = await this.repository.findByUser(userId, type);

        return transactions.map((t) => ({
            id: t.id,
            user_id: t.userId,
            amount: t.amount,
            type: t.type,
            createdAt: t.createdAt,
        }));
    }

    /**
     * Get current balance for a user
     */
    async getBalance(userId: string): Promise<BalanceResponseDto> {
        this.logger.debug(`Fetching balance for user ${userId}`);

        const balance = await this.repository.getBalance(userId);

        return {
            amount: balance,
        };
    }
}
