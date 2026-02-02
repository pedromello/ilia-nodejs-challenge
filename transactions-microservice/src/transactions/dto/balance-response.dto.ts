import { ApiProperty } from '@nestjs/swagger';

export class BalanceResponseDto {
    @ApiProperty({
        description: 'Current account balance in cents',
        example: 15000,
    })
    amount: number;
}
