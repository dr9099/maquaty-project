import { Body, Controller, Ip, Post, Req, UseFilters, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ApiExceptionFilter } from '../common/api-exception.filter';
import { RequireRoles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { TenantIsolationGuard } from '../common/tenant-isolation.guard';
import { getRequestUser } from '../common/types';
import { ReturnsService } from './returns.service';
import { CreateReturnDto } from './dto/create-return.dto';

// المرتجعات — API_SPEC القسم 4 / R-20 / BR-057
@Controller('returns')
@UseFilters(ApiExceptionFilter)
@UseGuards(RolesGuard, TenantIsolationGuard)
export class ReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Post()
  @RequireRoles({ roles: ['STORE_OWNER', 'WORKER'] })
  create(@Body() dto: CreateReturnDto, @Req() req: Request, @Ip() ip: string) {
    return this.returns.create(getRequestUser(req), dto, ip);
  }
}
