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
import { DamagedGoodsService } from './damaged-goods.service';
import { RecordDamagedGoodsDto } from './dto/damaged-goods.dto';

// التالف — API_SPEC القسم 6 / BR-013..017
@Controller('damaged-goods')
@UseFilters(ApiExceptionFilter)
@UseGuards(RolesGuard, TenantIsolationGuard)
export class DamagedGoodsController {
  constructor(private readonly damagedGoods: DamagedGoodsService) {}

  @Post()
  @RequireRoles({ roles: ['STORE_OWNER', 'WORKER'] })
  record(@Body() dto: RecordDamagedGoodsDto, @Req() req: Request, @Ip() ip: string) {
    return this.damagedGoods.record(getRequestUser(req), dto, ip);
  }

  @Get()
  @RequireRoles({ roles: ['STORE_OWNER'] })
  report(@Req() req: Request, @Query('date') date?: string) {
    return this.damagedGoods.report(getRequestUser(req).storeOwnerId!, date);
  }
}
