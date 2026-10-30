import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { RequireRoles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { TenantIsolationGuard } from '../common/tenant-isolation.guard';
import { getRequestUser } from '../common/types';
import { AccountingService } from './accounting.service';

// استعراض دليل الحسابات ودفتر الأستاذ العام — قراءة فقط (Append-only BR-055) وحصري لمالك المتجر
@Controller('accounting')
@UseGuards(TenantIsolationGuard, RolesGuard)
@RequireRoles({ roles: ['STORE_OWNER'] })
export class AccountingController {
  constructor(private readonly accounting: AccountingService) {}

  @Get('accounts')
  getAccounts(
    @Req() req: Request,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const user = getRequestUser(req);
    return this.accounting.getAccountsWithBalances(user.storeOwnerId!, { from, to });
  }

  @Get('ledger')
  getLedger(
    @Req() req: Request,
    @Query('account_code') accountCode?: string,
    @Query('reference_type') referenceType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('format') format?: string,
  ) {
    const user = getRequestUser(req);
    return this.accounting.getGeneralLedger(user.storeOwnerId!, {
      accountCode,
      referenceType,
      from,
      to,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      format,
    });
  }
}
