import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { CreditModule } from '../credit/credit.module';
import { DamagedGoodsModule } from '../damaged-goods/damaged-goods.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({
  imports: [SalesModule, CreditModule, DamagedGoodsModule, ExpensesModule],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
