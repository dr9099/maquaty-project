import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
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
import { SyncService } from './sync.service';
import { AckBroadcastDto, DeviceSyncDto, PullBroadcastsDto } from './dto/sync.dto';

// مزامنة الأجهزة والرسائل — API_SPEC القسم 14 / R-26 / R-30
@Controller('device')
@UseFilters(ApiExceptionFilter)
@UseGuards(RolesGuard, TenantIsolationGuard)
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @RequireRoles({ roles: ['STORE_OWNER', 'WORKER'] })
  sync(@Body() dto: DeviceSyncDto, @Req() req: Request, @Ip() ip: string) {
    return this.syncService.sync(getRequestUser(req), dto, ip);
  }

  @Post('broadcasts/pull')
  @HttpCode(HttpStatus.OK)
  @RequireRoles({ roles: ['STORE_OWNER', 'WORKER'] })
  pullBroadcasts(@Body() dto: PullBroadcastsDto, @Req() req: Request) {
    return this.syncService.pullBroadcasts(getRequestUser(req), dto);
  }

  @Post('broadcasts/:id/ack')
  @HttpCode(HttpStatus.OK)
  @RequireRoles({ roles: ['STORE_OWNER', 'WORKER'] })
  ackBroadcast(
    @Param('id') id: string,
    @Body() dto: AckBroadcastDto,
    @Req() req: Request,
  ) {
    return this.syncService.ackBroadcast(getRequestUser(req), id, dto);
  }
}
