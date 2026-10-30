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
import { SuppliersService } from './suppliers.service';
import {
  CreateSupplierDto,
  QueryStatementDto,
  QuerySuppliersDto,
  RecordSupplierPaymentDto,
  UpdateSupplierDto,
} from './dto/suppliers.dto';

@Controller('suppliers')
@UseFilters(ApiExceptionFilter)
@UseGuards(RolesGuard, TenantIsolationGuard)
@RequireRoles({ roles: ['STORE_OWNER', 'WORKER'], purchasesAccess: true })
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Get()
  list(@Req() req: Request, @Query() query: QuerySuppliersDto) {
    return this.suppliersService.list(getRequestUser(req).storeOwnerId!, query);
  }

  @Post()
  create(@Req() req: Request, @Body() dto: CreateSupplierDto, @Ip() ip: string) {
    return this.suppliersService.create(getRequestUser(req), dto, ip);
  }

  @Get(':id')
  getById(@Req() req: Request, @Param('id') id: string) {
    return this.suppliersService.getById(getRequestUser(req).storeOwnerId!, id);
  }

  @Patch(':id')
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
    @Ip() ip: string,
  ) {
    return this.suppliersService.update(getRequestUser(req).storeOwnerId!, id, dto, ip);
  }

  @Delete(':id')
  remove(@Req() req: Request, @Param('id') id: string, @Ip() ip: string) {
    return this.suppliersService.remove(getRequestUser(req).storeOwnerId!, id, ip);
  }

  @Post(':id/payments')
  recordPayment(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: RecordSupplierPaymentDto,
    @Ip() ip: string,
  ) {
    return this.suppliersService.recordPayment(getRequestUser(req), id, dto, ip);
  }

  @Get(':id/payments')
  listPayments(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.suppliersService.listPayments(
      getRequestUser(req).storeOwnerId!,
      id,
      limit ? Number(limit) : undefined,
      offset ? Number(offset) : undefined,
    );
  }

  @Get(':id/statement')
  statement(@Req() req: Request, @Param('id') id: string, @Query() query: QueryStatementDto) {
    return this.suppliersService.getStatement(getRequestUser(req).storeOwnerId!, id, query);
  }

  @Get(':id/aging')
  aging(@Req() req: Request, @Param('id') id: string) {
    return this.suppliersService.getAging(getRequestUser(req).storeOwnerId!, id);
  }
}
