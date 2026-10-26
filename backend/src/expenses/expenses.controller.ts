import {
  Body,
  Controller,
  Get,
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
import { ExpensesService } from './expenses.service';
import {
  CreateEmployeeAdvanceDto,
  CreateEmployeeDto,
  CreateRentRecordDto,
  CreateUtilityPaymentDto,
  CreateWorkerAdvanceDto,
  PayEmployeeDto,
} from './dto/expenses.dto';

// المصروفات والأجور والإيجارات والخدمات وسلف العمال — API_SPEC القسم 8
@Controller()
@UseFilters(ApiExceptionFilter)
@UseGuards(RolesGuard, TenantIsolationGuard)
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  // === الأجور والموظفون (حصري للمالك) ===

  @Get('employees')
  @RequireRoles({ roles: ['STORE_OWNER'] })
  listEmployees(@Req() req: Request) {
    return this.expenses.listEmployees(getRequestUser(req).storeOwnerId!);
  }

  @Post('employees')
  @RequireRoles({ roles: ['STORE_OWNER'] })
  createEmployee(@Body() dto: CreateEmployeeDto, @Req() req: Request, @Ip() ip: string) {
    return this.expenses.createEmployee(getRequestUser(req).storeOwnerId!, dto, ip);
  }

  @Post('employees/:id/advances')
  @RequireRoles({ roles: ['STORE_OWNER'] })
  recordEmployeeAdvance(
    @Param('id') id: string,
    @Body() dto: CreateEmployeeAdvanceDto,
    @Req() req: Request,
    @Ip() ip: string,
  ) {
    return this.expenses.recordEmployeeAdvance(getRequestUser(req).storeOwnerId!, id, dto, ip);
  }

  @Post('employees/:id/payments')
  @RequireRoles({ roles: ['STORE_OWNER'] })
  payEmployee(
    @Param('id') id: string,
    @Body() dto: PayEmployeeDto,
    @Req() req: Request,
    @Ip() ip: string,
  ) {
    return this.expenses.payEmployee(getRequestUser(req).storeOwnerId!, id, dto, ip);
  }

  @Get('employees/:id/statement')
  @RequireRoles({ roles: ['STORE_OWNER'] })
  employeeStatement(@Param('id') id: string, @Req() req: Request) {
    return this.expenses.getEmployeeStatement(getRequestUser(req).storeOwnerId!, id);
  }

  // === الإيجارات (حصري للمالك) ===

  @Get('rent-records')
  @RequireRoles({ roles: ['STORE_OWNER'] })
  listRentRecords(@Req() req: Request) {
    return this.expenses.listRentRecords(getRequestUser(req).storeOwnerId!);
  }

  @Post('rent-records')
  @RequireRoles({ roles: ['STORE_OWNER'] })
  createRentRecord(@Body() dto: CreateRentRecordDto, @Req() req: Request) {
    return this.expenses.createRentRecord(getRequestUser(req).storeOwnerId!, dto);
  }

  // === الخدمات (حصري للمالك) ===

  @Get('utility-payments')
  @RequireRoles({ roles: ['STORE_OWNER'] })
  listUtilityPayments(@Req() req: Request) {
    return this.expenses.listUtilityPayments(getRequestUser(req).storeOwnerId!);
  }

  @Post('utility-payments')
  @RequireRoles({ roles: ['STORE_OWNER'] })
  createUtilityPayment(@Body() dto: CreateUtilityPaymentDto, @Req() req: Request) {
    return this.expenses.createUtilityPayment(getRequestUser(req).storeOwnerId!, dto);
  }

  // === سلفة العامل المسؤول لنفسه (تبويب «سلفتي» فقط — R-10 / BR-024) ===

  @Post('worker-advances')
  @RequireRoles({ roles: ['WORKER'], responsibleOnly: true })
  recordWorkerAdvance(@Body() dto: CreateWorkerAdvanceDto, @Req() req: Request) {
    return this.expenses.recordWorkerAdvance(getRequestUser(req), dto);
  }

  @Get('worker-advances/my')
  @RequireRoles({ roles: ['WORKER'], responsibleOnly: true })
  myWorkerAdvances(@Req() req: Request) {
    return this.expenses.getMyWorkerAdvances(getRequestUser(req));
  }
}
