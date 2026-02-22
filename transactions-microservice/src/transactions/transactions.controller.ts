import {
    Controller,
    Post,
    Get,
    Body,
    Query,
    UseGuards,
    Headers,
    ValidationPipe,
    HttpStatus,
    HttpCode,
    Logger,
    Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TransactionsService } from './transactions.service';
import {
    CreateTransactionDto,
    TransactionResponseDto,
    BalanceResponseDto,
    TransactionType,
} from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Transactions')
@Controller()
export class TransactionsController {
    private readonly logger = new Logger(TransactionsController.name);

    constructor(private readonly transactionsService: TransactionsService) { }

    @Post('transactions')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Create a new transaction' })
    @ApiResponse({
        status: 200,
        description: 'Transaction created successfully',
        type: TransactionResponseDto,
    })
    @ApiResponse({ status: 400, description: 'Invalid request or insufficient balance' })
    @ApiResponse({ status: 401, description: 'Unauthorized' })
    async createTransaction(
        @Body(ValidationPipe) dto: CreateTransactionDto,
        @Headers('x-idempotency-key') idempotencyKey: string | undefined,
        @Req() req: any,
    ): Promise<TransactionResponseDto> {
        // Get userId from JWT token
        const userId = req.user.userId;

        this.logger.log(
            `Creating transaction for user ${userId}: type=${dto.type}, amount=${dto.amount}, idempotencyKey=${idempotencyKey || 'none'}`,
        );

        return this.transactionsService.createTransaction(dto, userId, idempotencyKey);
    }

    @Get('transactions')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Get all transactions for the authenticated user' })
    @ApiQuery({ name: 'type', required: false, enum: TransactionType })
    @ApiResponse({
        status: 200,
        description: 'List of transactions',
        type: [TransactionResponseDto],
    })
    @ApiResponse({ status: 401, description: 'Unauthorized' })
    async getTransactions(
        @Query('type') type: TransactionType | undefined,
        @Req() req: any,
    ): Promise<TransactionResponseDto[]> {
        const userId = req.user.userId;

        this.logger.log(
            `Fetching transactions for user ${userId}, type filter: ${type || 'all'}`,
        );

        return this.transactionsService.getTransactions(userId, type);
    }

    @Get('balance')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Get current balance for the authenticated user' })
    @ApiResponse({
        status: 200,
        description: 'Current balance',
        type: BalanceResponseDto,
    })
    @ApiResponse({ status: 401, description: 'Unauthorized' })
    async getBalance(@Req() req: any): Promise<BalanceResponseDto> {
        const userId = req.user.userId;

        this.logger.log(`Fetching balance for user ${userId}`);

        return this.transactionsService.getBalance(userId);
    }
}
