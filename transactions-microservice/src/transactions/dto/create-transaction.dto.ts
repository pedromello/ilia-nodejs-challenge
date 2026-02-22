import { IsEnum, IsInt, IsNotEmpty, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum TransactionType {
    CREDIT = 'CREDIT',
    DEBIT = 'DEBIT',
}

export class CreateTransactionDto {
    @ApiProperty({
        description: 'Transaction amount in cents (must be positive)',
        example: 10000,
        minimum: 1,
    })
    @IsInt()
    @Min(1, { message: 'Amount must be greater than 0' })
    amount: number;

    @ApiProperty({
        description: 'Transaction type',
        enum: TransactionType,
        example: TransactionType.CREDIT,
    })
    @IsEnum(TransactionType)
    @IsNotEmpty()
    type: TransactionType;
}
