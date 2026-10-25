import { Global, Module } from '@nestjs/common';
import { ChartOfAccountsService } from './chart-of-accounts.service';

@Global()
@Module({
  providers: [ChartOfAccountsService],
  exports: [ChartOfAccountsService],
})
export class AccountingModule {}
