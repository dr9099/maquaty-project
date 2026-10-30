import { Body, Controller, Get, Ip, Patch, Req, UseFilters, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ApiExceptionFilter } from '../common/api-exception.filter';
import { RequireRoles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { TenantIsolationGuard } from '../common/tenant-isolation.guard';
import { getRequestUser } from '../common/types';
import { SettingsService } from './settings.service';
import { UpdateStoreSettingsDto } from './dto/settings.dto';

@Controller('settings/store')
@UseFilters(ApiExceptionFilter)
@UseGuards(RolesGuard, TenantIsolationGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @RequireRoles({ roles: ['STORE_OWNER', 'WORKER'] })
  getSettings(@Req() req: Request) {
    return this.settingsService.getStoreSettings(getRequestUser(req));
  }

  @Patch()
  @RequireRoles({ roles: ['STORE_OWNER'] })
  updateSettings(@Req() req: Request, @Body() dto: UpdateStoreSettingsDto, @Ip() ip: string) {
    return this.settingsService.updateStoreSettings(getRequestUser(req), dto, ip);
  }
}
