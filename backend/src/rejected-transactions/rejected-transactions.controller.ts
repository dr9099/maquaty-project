import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Post,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { RejectedStatus } from '@prisma/client';
import { ApiExceptionFilter } from '../common/api-exception.filter';
import { RequireRoles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { TenantIsolationGuard } from '../common/tenant-isolation.guard';
import { getRequestUser } from '../common/types';
import { RejectedTransactionsService } from './rejected-transactions.service';
import { ResolveRejectedTransactionDto } from './dto/rejected-transactions.dto';

// العمليات المرفوضة — API_SPEC القسم 11 / R-30 (حصري للمالك)
@Controller('rejected-transactions')
@UseFilters(ApiExceptionFilter)
@UseGuards(RolesGuard, TenantIsolationGuard)
export class RejectedTransactionsController {
  constructor(private readonly rejectedService: RejectedTransactionsService) {}

  @Get()
  @RequireRoles({ roles: ['STORE_OWNER'] })
  list(@Req() req: Request, @Query('status') status?: RejectedStatus) {
    return this.rejectedService.list(getRequestUser(req).storeOwnerId!, status);
  }

  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  @RequireRoles({ roles: ['STORE_OWNER'] })
  resolve(
    @Param('id') id: string,
    @Body() dto: ResolveRejectedTransactionDto,
    @Req() req: Request,
    @Ip() ip: string,
  ) {
    return this.rejectedService.resolve(getRequestUser(req).storeOwnerId!, id, dto, ip);
  }
}
