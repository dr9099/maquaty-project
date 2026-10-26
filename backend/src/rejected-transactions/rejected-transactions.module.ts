import { Module } from '@nestjs/common';
import { RejectedTransactionsController } from './rejected-transactions.controller';
import { RejectedTransactionsService } from './rejected-transactions.service';

@Module({
  controllers: [RejectedTransactionsController],
  providers: [RejectedTransactionsService],
  exports: [RejectedTransactionsService],
})
export class RejectedTransactionsModule {}
