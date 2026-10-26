import { Global, Module } from '@nestjs/common';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { AccountingService } from './accounting.service';

@Global()
@Module({
  providers: [ChartOfAccountsService, AccountingService],
  exports: [ChartOfAccountsService, AccountingService],
})
export class AccountingModule {}
