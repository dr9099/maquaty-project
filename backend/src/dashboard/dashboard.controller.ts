import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
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
import { DashboardService } from './dashboard.service';

// لوحة ملخص الشاشة الرئيسية — API_SPEC القسم 15
@Controller('dashboard')
@UseFilters(ApiExceptionFilter)
@UseGuards(RolesGuard, TenantIsolationGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Post('summary')
  @HttpCode(HttpStatus.OK)
  @RequireRoles({ roles: ['STORE_OWNER', 'WORKER'] })
  postSummary(@Req() req: Request) {
    return this.dashboard.getSummary(getRequestUser(req));
  }

  @Get('summary')
  @RequireRoles({ roles: ['STORE_OWNER', 'WORKER'] })
  getSummary(@Req() req: Request) {
    return this.dashboard.getSummary(getRequestUser(req));
  }
}
