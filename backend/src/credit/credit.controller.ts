import {
  Body,
  Controller,
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
import { CreditService } from './credit.service';
import {
  CreateCreditCustomerDto,
  RecordCreditPaymentDto,
  UpdateCreditCustomerDto,
} from './dto/credit.dto';

// الآجل — API_SPEC القسم 7 (حصري للمالك والعامل المسؤول: R-11 / R-12)
@Controller('credit-customers')
@UseFilters(ApiExceptionFilter)
@UseGuards(RolesGuard, TenantIsolationGuard)
export class CreditController {
  constructor(private readonly credit: CreditService) {}

  @Get()
  @RequireRoles({ roles: ['STORE_OWNER', 'WORKER'], responsibleOnly: true })
  list(@Req() req: Request, @Query('search') search?: string) {
    return this.credit.list(getRequestUser(req).storeOwnerId!, search);
  }

  @Post()
  @RequireRoles({ roles: ['STORE_OWNER', 'WORKER'], responsibleOnly: true })
  create(@Body() dto: CreateCreditCustomerDto, @Req() req: Request, @Ip() ip: string) {
    return this.credit.create(getRequestUser(req), dto, ip);
  }

  @Patch(':id')
  @RequireRoles({ roles: ['STORE_OWNER', 'WORKER'], responsibleOnly: true })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCreditCustomerDto,
    @Req() req: Request,
    @Ip() ip: string,
  ) {
    return this.credit.update(getRequestUser(req).storeOwnerId!, id, dto, ip);
  }

  @Get(':id/debts')
  @RequireRoles({ roles: ['STORE_OWNER', 'WORKER'], responsibleOnly: true })
  debts(@Param('id') id: string, @Req() req: Request) {
    return this.credit.getDebts(getRequestUser(req).storeOwnerId!, id);
  }

  @Get(':id/payments')
  @RequireRoles({ roles: ['STORE_OWNER', 'WORKER'], responsibleOnly: true })
  payments(@Param('id') id: string, @Req() req: Request) {
    return this.credit.getPayments(getRequestUser(req).storeOwnerId!, id);
  }

  @Post(':id/payments')
  @RequireRoles({ roles: ['STORE_OWNER', 'WORKER'], responsibleOnly: true })
  recordPayment(
    @Param('id') id: string,
    @Body() dto: RecordCreditPaymentDto,
    @Req() req: Request,
    @Ip() ip: string,
  ) {
    return this.credit.recordPayment(getRequestUser(req), id, dto, ip);
  }

  @Get(':id/statement')
  @RequireRoles({ roles: ['STORE_OWNER', 'WORKER'], responsibleOnly: true })
  statement(@Param('id') id: string, @Req() req: Request) {
    return this.credit.getStatement(getRequestUser(req).storeOwnerId!, id);
  }
}
