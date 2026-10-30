import { Global, Module } from '@nestjs/common';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { AccountingService } from './accounting.service';
import { AccountingController } from './accounting.controller';

@Global()
@Module({
  controllers: [AccountingController],
  providers: [ChartOfAccountsService, AccountingService],
  exports: [ChartOfAccountsService, AccountingService],
})
export class AccountingModule {}
