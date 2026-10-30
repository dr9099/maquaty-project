import {
  Body,
  Controller,
  Get,
  HttpCode,
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
import { PurchasesService } from './purchases.service';
import {
  CreatePurchaseDto,
  CreatePurchaseReturnDto,
  PostPurchaseDto,
  PurchaseLineInputDto,
  QueryPurchasesDto,
  UpdateDraftPurchaseDto,
  VoidPurchaseDto,
} from './dto/purchases.dto';
import { IsArray, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class PreviewCostingDto {
  @IsOptional()
  @IsString()
  invoiceDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  taxAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  discountAmount?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineInputDto)
  items: PurchaseLineInputDto[];
}

@Controller('purchases')
@UseFilters(ApiExceptionFilter)
@UseGuards(RolesGuard, TenantIsolationGuard)
@RequireRoles({ roles: ['STORE_OWNER', 'WORKER'], purchasesAccess: true })
export class PurchasesController {
  constructor(private readonly purchasesService: PurchasesService) {}

  @Post('preview-costing')
  @HttpCode(200)
  previewCosting(@Req() req: Request, @Body() dto: PreviewCostingDto) {
    return this.purchasesService.previewCosting(getRequestUser(req).storeOwnerId!, dto);
  }

  @Get()
  list(@Req() req: Request, @Query() query: QueryPurchasesDto) {
    return this.purchasesService.list(getRequestUser(req).storeOwnerId!, query);
  }

  @Post()
  create(@Req() req: Request, @Body() dto: CreatePurchaseDto, @Ip() ip: string) {
    return this.purchasesService.create(getRequestUser(req), dto, ip);
  }

  @Get(':id')
  getById(@Req() req: Request, @Param('id') id: string) {
    return this.purchasesService.getById(getRequestUser(req).storeOwnerId!, id);
  }

  @Patch(':id')
  updateDraft(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateDraftPurchaseDto,
    @Ip() ip: string,
  ) {
    return this.purchasesService.updateDraft(getRequestUser(req).storeOwnerId!, id, dto, ip);
  }

  @Post(':id/post')
  @HttpCode(200)
  postDraft(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: PostPurchaseDto,
    @Ip() ip: string,
  ) {
    return this.purchasesService.postDraft(getRequestUser(req), id, dto, ip);
  }

  @Post(':id/void')
  @RequireRoles({ roles: ['STORE_OWNER'] })
  @HttpCode(200)
  voidInvoice(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: VoidPurchaseDto,
    @Ip() ip: string,
  ) {
    return this.purchasesService.voidInvoice(getRequestUser(req).storeOwnerId!, id, dto, ip);
  }

  @Post(':id/returns')
  createReturn(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: CreatePurchaseReturnDto,
    @Ip() ip: string,
  ) {
    return this.purchasesService.createReturn(getRequestUser(req), id, dto, ip);
  }

  @Get(':id/returns')
  listReturns(@Req() req: Request, @Param('id') id: string) {
    return this.purchasesService.listReturns(getRequestUser(req).storeOwnerId!, id);
  }
}
