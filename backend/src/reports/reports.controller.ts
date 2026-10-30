import {
  Body,
  Controller,
  Get,
  Ip,
  Post,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiExceptionFilter } from '../common/api-exception.filter';
import { RequireRoles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { TenantIsolationGuard } from '../common/tenant-isolation.guard';
import { getRequestUser } from '../common/types';
import { ReportsService } from './reports.service';
import { CreateOwnerTransactionDto, QueryRangeDto, QueryReportsDto } from './dto/reports.dto';

// الأموال والتقارير وإيداعات/مسحوبات المالك — API_SPEC القسم 10 + تقارير المشتريات والموردين وقائمة الدخل
@Controller()
@UseFilters(ApiExceptionFilter)
@UseGuards(RolesGuard, TenantIsolationGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('funds/summary')
  @RequireRoles({ roles: ['STORE_OWNER', 'WORKER'], responsibleOnly: true })
  fundsSummary(@Req() req: Request, @Query('date') date?: string) {
    return this.reportsService.getFundsSummary(getRequestUser(req), date);
  }

  @Get('funds/owner-transactions')
  @RequireRoles({ roles: ['STORE_OWNER'] })
  listOwnerTransactions(@Req() req: Request, @Query() dto: QueryRangeDto) {
    return this.reportsService.listOwnerTransactions(getRequestUser(req).storeOwnerId!, dto);
  }

  @Post('funds/owner-transactions')
  @RequireRoles({ roles: ['STORE_OWNER'] })
  createOwnerTransaction(
    @Req() req: Request,
    @Body() dto: CreateOwnerTransactionDto,
    @Ip() ip: string,
  ) {
    return this.reportsService.createOwnerTransaction(getRequestUser(req).storeOwnerId!, dto, ip);
  }

  @Get('reports')
  @RequireRoles({ roles: ['STORE_OWNER', 'WORKER'] })
  reports(@Req() req: Request, @Query() dto: QueryReportsDto) {
    return this.reportsService.getReport(getRequestUser(req), dto);
  }

  @Get('reports/purchases-by-supplier')
  @RequireRoles({ roles: ['STORE_OWNER', 'WORKER'], purchasesAccess: true })
  purchasesBySupplier(@Req() req: Request, @Query() dto: QueryRangeDto) {
    return this.reportsService.getPurchasesBySupplier(getRequestUser(req).storeOwnerId!, dto);
  }

  @Get('reports/purchases-by-item')
  @RequireRoles({ roles: ['STORE_OWNER', 'WORKER'], purchasesAccess: true })
  purchasesByItem(@Req() req: Request, @Query() dto: QueryRangeDto) {
    return this.reportsService.getPurchasesByItem(getRequestUser(req).storeOwnerId!, dto);
  }

  @Get('reports/supplier-payables')
  @RequireRoles({ roles: ['STORE_OWNER', 'WORKER'], purchasesAccess: true })
  supplierPayables(@Req() req: Request, @Query() dto: QueryRangeDto) {
    return this.reportsService.getSupplierPayables(getRequestUser(req).storeOwnerId!, dto);
  }

  @Get('reports/profit-margin')
  @RequireRoles({ roles: ['STORE_OWNER'] })
  profitMargin(@Req() req: Request, @Query() dto: QueryRangeDto) {
    return this.reportsService.getProfitMargin(getRequestUser(req).storeOwnerId!, dto);
  }
}
