import { ApiProperty } from '@nestjs/swagger';
import { TransactionType } from './create-transaction.dto';

export class TransactionResponseDto {
    @ApiProperty({
        description: 'Transaction ID',
        example: 'clx123abc456def789',
    })
    id: string;

    @ApiProperty({
        description: 'User ID',
        example: 'clx123abc456',
    })
    user_id: string;

    @ApiProperty({
        description: 'Transaction amount in cents',
        example: 10000,
    })
    amount: number;

    @ApiProperty({
        description: 'Transaction type',
        enum: TransactionType,
        example: TransactionType.CREDIT,
    })
    type: TransactionType;

    @ApiProperty({
        description: 'Transaction creation timestamp',
        example: '2026-02-02T12:30:00.000Z',
    })
    createdAt?: Date;
}
