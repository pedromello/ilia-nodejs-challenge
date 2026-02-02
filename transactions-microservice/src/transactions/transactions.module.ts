import { Module } from '@nestjs/common';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { TransactionsRepository } from './transactions.repository';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from 'src/infra/prisma.service';

@Module({
  imports: [AuthModule],
  controllers: [TransactionsController],
  providers: [TransactionsService, TransactionsRepository, PrismaService],
  exports: [TransactionsService],
})
export class TransactionsModule { }
