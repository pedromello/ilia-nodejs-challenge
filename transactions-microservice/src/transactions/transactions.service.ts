import { Injectable, Logger } from '@nestjs/common';
import {
    TransactionsRepository,
    CreateTransactionParams,
    TransactionResult,
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
     * Create a new transaction with idempotency support
     */
    async createTransaction(
        dto: CreateTransactionDto,
        idempotencyKey?: string,
    ): Promise<TransactionResponseDto> {
        // Step 1: Check idempotency key if provided
        if (idempotencyKey) {
            const cachedResponse = await this.repository.checkIdempotencyKey(
                idempotencyKey,
            );
            if (cachedResponse) {
                const parsed = JSON.parse(cachedResponse);
                this.logger.log(
                    `Returning cached response for idempotency key: ${idempotencyKey}`,
                );
                throw new DuplicateTransactionException(idempotencyKey, parsed);
            }
        }

        // Step 2: Validate amount
        if (dto.amount <= 0) {
            throw new InvalidAmountException(dto.amount);
        }

        // Step 3: Create transaction with locking
        try {
            const params: CreateTransactionParams = {
                userId: dto.user_id,
                type: dto.type,
                amount: dto.amount,
                idempotencyKey,
            };

            const transaction = await this.repository.createTransactionWithLock(params);

            const response: TransactionResponseDto = {
                id: transaction.id,
                user_id: transaction.userId,
                amount: transaction.amount,
                type: transaction.type,
            };

            // Step 4: Store idempotency key with response
            if (idempotencyKey) {
                await this.repository.storeIdempotencyKey(idempotencyKey, response);
            }

            this.logger.log(
                `Transaction created successfully: ${transaction.id} for user ${dto.user_id}`,
            );

            return response;
        } catch (error) {
            if (error.message === 'INSUFFICIENT_BALANCE') {
                const currentBalance = await this.repository.getBalance(dto.user_id);
                throw new InsufficientBalanceException(
                    dto.user_id,
                    currentBalance,
                    dto.amount,
                );
            }

            this.logger.error(
                `Failed to create transaction for user ${dto.user_id}: ${error.message}`,
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
