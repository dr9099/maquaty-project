import {
  Controller,
  Get,
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
import { QueryReportsDto } from './dto/reports.dto';

// الأموال والتقارير — API_SPEC القسم 10
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

  @Get('reports')
  @RequireRoles({ roles: ['STORE_OWNER', 'WORKER'] })
  reports(@Req() req: Request, @Query() dto: QueryReportsDto) {
    return this.reportsService.getReport(getRequestUser(req), dto);
  }
}
