import {
  Body,
  Controller,
  Delete,
  Get,
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
import { WorkersService } from './workers.service';
import {
  ChangeWorkerPasswordDto,
  CreateWorkerDto,
  PromoteResponsibleDto,
  SuspendWorkerDto,
  UpdateWorkerDto,
} from './dto/workers.dto';

// إدارة العمال + العمال المدارين — المصادقة وحالة الحساب يُفحصان عالمياً
@Controller()
@UseFilters(ApiExceptionFilter)
@UseGuards(RolesGuard, TenantIsolationGuard)
export class WorkersController {
  constructor(private readonly workers: WorkersService) {}

  // === إدارة العمال (حصري للمالك) ===

  @Get('workers')
  @RequireRoles({ roles: ['STORE_OWNER'] })
  list(@Req() req: Request) {
    return this.workers.list(getRequestUser(req).storeOwnerId!);
  }

  @Post('workers')
  @RequireRoles({ roles: ['STORE_OWNER'] })
  create(@Body() dto: CreateWorkerDto, @Req() req: Request, @Ip() ip: string) {
    return this.workers.create(getRequestUser(req).storeOwnerId!, dto, ip);
  }

  @Get('workers/:id')
  @RequireRoles({ roles: ['STORE_OWNER'] })
  getOne(@Param('id') id: string, @Req() req: Request) {
    return this.workers.getOne(getRequestUser(req).storeOwnerId!, id);
  }

  @Patch('workers/:id')
  @RequireRoles({ roles: ['STORE_OWNER'] })
  update(@Param('id') id: string, @Body() dto: UpdateWorkerDto, @Req() req: Request, @Ip() ip: string) {
    return this.workers.update(getRequestUser(req).storeOwnerId!, id, dto, ip);
  }

  @Patch('workers/:id/password')
  @RequireRoles({ roles: ['STORE_OWNER'] })
  changePassword(
    @Param('id') id: string,
    @Body() dto: ChangeWorkerPasswordDto,
    @Req() req: Request,
    @Ip() ip: string,
  ) {
    return this.workers.changePassword(
      getRequestUser(req).storeOwnerId!,
      id,
      dto.newPassword,
      dto.newPasswordConfirmation,
      ip,
    );
  }

  @Patch('workers/:id/suspend')
  @RequireRoles({ roles: ['STORE_OWNER'] })
  suspend(@Param('id') id: string, @Body() dto: SuspendWorkerDto, @Req() req: Request, @Ip() ip: string) {
    return this.workers.suspend(getRequestUser(req).storeOwnerId!, id, dto.suspended, ip);
  }

  @Delete('workers/:id')
  @RequireRoles({ roles: ['STORE_OWNER'] })
  remove(@Param('id') id: string, @Req() req: Request, @Ip() ip: string) {
    return this.workers.remove(getRequestUser(req).storeOwnerId!, id, ip);
  }

  @Post('workers/:id/promote-responsible')
  @RequireRoles({ roles: ['STORE_OWNER'] })
  promote(@Param('id') id: string, @Body() dto: PromoteResponsibleDto, @Req() req: Request, @Ip() ip: string) {
    return this.workers.promoteResponsible(getRequestUser(req).storeOwnerId!, id, dto.confirmReplace ?? false, ip);
  }

  @Post('workers/:id/demote-responsible')
  @RequireRoles({ roles: ['STORE_OWNER'] })
  demote(@Param('id') id: string, @Req() req: Request, @Ip() ip: string) {
    return this.workers.demoteResponsible(getRequestUser(req).storeOwnerId!, id, ip);
  }

  // === العمال المدارين (حصري للعامل المسؤول — اطلاع Read-only) ===

  @Get('managed-workers')
  @RequireRoles({ roles: ['WORKER'], responsibleOnly: true })
  managedList(@Req() req: Request) {
    return this.workers.managedList(getRequestUser(req).storeOwnerId!);
  }

  @Get('managed-workers/:workerId/sales-summary')
  @RequireRoles({ roles: ['WORKER'], responsibleOnly: true })
  managedSummary(@Param('workerId') workerId: string, @Req() req: Request, @Query('date') date?: string) {
    return this.workers.managedSalesSummary(getRequestUser(req).storeOwnerId!, workerId, date);
  }
}
