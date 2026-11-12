import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Patch,
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
import { DailyClosingService } from './daily-closing.service';
import { UpdateActualCashDto } from './dto/daily-closing.dto';

// المطابقة والإغلاق اليومي — API_SPEC القسم 9 / R-04 / R-21 / R-36
@Controller('daily-closings')
@UseFilters(ApiExceptionFilter)
@UseGuards(RolesGuard, TenantIsolationGuard)
export class DailyClosingController {
  constructor(private readonly dailyClosing: DailyClosingService) {}

  @Get('today')
  @RequireRoles({ roles: ['STORE_OWNER', 'WORKER'] })
  getToday(@Req() req: Request, @Query('worker_id') workerId?: string) {
    return this.dailyClosing.getToday(getRequestUser(req), workerId);
  }

  @Patch(':id')
  @RequireRoles({ roles: ['STORE_OWNER', 'WORKER'] })
  updateActualCash(
    @Param('id') id: string,
    @Body() dto: UpdateActualCashDto,
    @Req() req: Request,
    @Ip() ip: string,
  ) {
    return this.dailyClosing.updateActualCash(getRequestUser(req), id, dto, ip);
  }

  @Patch(':id/workers/:workerId/cash')
  @RequireRoles({ roles: ['STORE_OWNER', 'WORKER'] })
  updateWorkerActualCash(
    @Param('id') id: string,
    @Param('workerId') workerId: string,
    @Body() dto: UpdateActualCashDto,
    @Req() req: Request,
    @Ip() ip: string,
  ) {
    return this.dailyClosing.updateWorkerActualCash(getRequestUser(req), id, workerId, dto, ip);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequireRoles({ roles: ['STORE_OWNER'] })
  approve(@Param('id') id: string, @Req() req: Request, @Ip() ip: string) {
    return this.dailyClosing.approve(getRequestUser(req), id, ip);
  }
}
