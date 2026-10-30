import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { CreditModule } from '../credit/credit.module';
import { DamagedGoodsModule } from '../damaged-goods/damaged-goods.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { PurchasesModule } from '../purchases/purchases.module';
import { ReportsModule } from '../reports/reports.module';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({
  imports: [
    SalesModule,
    CreditModule,
    DamagedGoodsModule,
    ExpensesModule,
    SuppliersModule,
    PurchasesModule,
    ReportsModule,
  ],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
