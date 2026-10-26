import { Body, Controller, Get, Post, Query, Req, UseFilters, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ApiExceptionFilter } from '../common/api-exception.filter';
import { RequireRoles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { TenantIsolationGuard } from '../common/tenant-isolation.guard';
import { getRequestUser } from '../common/types';
import { SalesService } from './sales.service';
import { CreateSaleDto } from './dto/create-sale.dto';

// البيع — تسلسل التحقق الكامل داخل معاملة ذرّية (API_SPEC القسم 4) — البادئة v1 عالمية من main.ts
@Controller('sales')
@UseFilters(ApiExceptionFilter)
@UseGuards(RolesGuard, TenantIsolationGuard)
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Post()
  @RequireRoles({ roles: ['STORE_OWNER', 'WORKER'] })
  create(@Body() dto: CreateSaleDto, @Req() req: Request) {
    return this.sales.create(getRequestUser(req), dto);
  }

  @Get('summary-by-item')
  @RequireRoles({ roles: ['STORE_OWNER', 'WORKER'] })
  summaryByItem(@Req() req: Request, @Query('date') date?: string) {
    return this.sales.summaryByItem(getRequestUser(req), date);
  }

  @Get('log')
  @RequireRoles({ roles: ['STORE_OWNER', 'WORKER'] })
  log(@Req() req: Request, @Query('date') date?: string, @Query('worker_id') workerId?: string) {
    return this.sales.log(getRequestUser(req), date, workerId);
  }
}
