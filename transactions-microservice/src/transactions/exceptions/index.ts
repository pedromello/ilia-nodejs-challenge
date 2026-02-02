import { HttpException, HttpStatus } from '@nestjs/common';

export class InsufficientBalanceException extends HttpException {
    constructor(userId: string, currentBalance: number, requestedAmount: number) {
        super(
            {
                statusCode: HttpStatus.BAD_REQUEST,
                message: 'Insufficient balance',
                error: 'INSUFFICIENT_BALANCE',
                details: {
                    userId,
                    currentBalance,
                    requestedAmount,
                    shortage: requestedAmount - currentBalance,
                },
            },
            HttpStatus.BAD_REQUEST,
        );
    }
}

export class DuplicateTransactionException extends HttpException {
    constructor(idempotencyKey: string, cachedResponse: any) {
        super(
            {
                statusCode: HttpStatus.OK,
                message: 'Transaction already processed',
                error: 'DUPLICATE_TRANSACTION',
                data: cachedResponse,
            },
            HttpStatus.OK,
        );
    }
}

export class InvalidAmountException extends HttpException {
    constructor(amount: number) {
        super(
            {
                statusCode: HttpStatus.BAD_REQUEST,
                message: 'Amount must be greater than 0',
                error: 'INVALID_AMOUNT',
                details: {
                    amount,
                },
            },
            HttpStatus.BAD_REQUEST,
        );
    }
}
