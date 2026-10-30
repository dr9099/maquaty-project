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
import { PrismaService } from '../prisma/prisma.service';
import { ApiExceptionFilter } from '../common/api-exception.filter';
import { RequireRoles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { TenantIsolationGuard } from '../common/tenant-isolation.guard';
import { getRequestUser } from '../common/types';
import { ItemsService } from './items.service';
import { WalletsService } from './wallets.service';
import { CreateItemDto, UpdateItemDto } from './dto/items.dto';
import { CreateWalletDto, SettleWalletDto } from './dto/wallets.dto';

// الأصناف والمخزون والمحافظ — البادئة v1 تُضاف عالمياً من main.ts
@Controller()
@UseFilters(ApiExceptionFilter)
@UseGuards(RolesGuard, TenantIsolationGuard)
export class ItemsController {
  constructor(
    private readonly items: ItemsService,
    private readonly wallets: WalletsService,
    private readonly prisma: PrismaService,
  ) {}

  // === الأصناف (للمالك، أو العامل المسؤول عند تفعيل صلاحية المشتريات من الإعدادات) ===

  @Post('items')
  @RequireRoles({ roles: ['STORE_OWNER', 'WORKER'], purchasesAccess: true })
  create(@Body() dto: CreateItemDto, @Req() req: Request) {
    return this.items.create(getRequestUser(req).storeOwnerId!, dto);
  }

  @Get('items')
  @RequireRoles({ roles: ['STORE_OWNER', 'WORKER'], purchasesAccess: true })
  list(@Req() req: Request, @Query('date') date?: string) {
    return this.items.listForOwner(getRequestUser(req).storeOwnerId!, date);
  }

  @Patch('items/:id')
  @RequireRoles({ roles: ['STORE_OWNER'] })
  update(@Param('id') id: string, @Body() dto: UpdateItemDto, @Req() req: Request) {
    return this.items.update(getRequestUser(req).storeOwnerId!, id, dto);
  }

  @Delete('items/:id')
  @RequireRoles({ roles: ['STORE_OWNER'] })
  remove(@Param('id') id: string, @Req() req: Request) {
    return this.items.remove(getRequestUser(req).storeOwnerId!, id);
  }

  // === المخزون (INVENTORY — O+R+W) ===
  // حماية خادمية: remaining_value يُحذف للعامل دون صلاحية، وcost_price لا يُعاد للعامل أبداً
  @Get('inventory')
  @RequireRoles({ roles: ['STORE_OWNER', 'WORKER'] })
  async inventory(
    @Req() req: Request,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const user = getRequestUser(req);
    const parsedLimit = limit ? Number(limit) : undefined;
    const parsedOffset = offset ? Number(offset) : undefined;
    if (user.role === 'WORKER') {
      const worker = await this.prisma.worker.findUniqueOrThrow({
        where: { id: user.workerId! },
        select: { permShowSellPricesInventory: true },
      });
      return this.items.inventory(
        user.storeOwnerId!,
        { isWorker: true, showSellPrices: worker.permShowSellPricesInventory },
        search,
        parsedLimit,
        parsedOffset,
      );
    }
    return this.items.inventory(
      user.storeOwnerId!,
      { isWorker: false, showSellPrices: true },
      search,
      parsedLimit,
      parsedOffset,
    );
  }

  // === المحافظ الإلكترونية (إدارة وتسوية: المالك — عرض القائمة للاختيار في البيع/التحصيل: المالك والعامل المسؤول والعامل عند البيع الإلكتروني) ===

  @Post('wallets')
  @RequireRoles({ roles: ['STORE_OWNER'] })
  createWallet(@Body() dto: CreateWalletDto, @Req() req: Request, @Ip() ip: string) {
    return this.wallets.create(getRequestUser(req).storeOwnerId!, dto, ip);
  }

  @Get('wallets')
  @RequireRoles({ roles: ['STORE_OWNER', 'WORKER'] })
  listWallets(@Req() req: Request) {
    const user = getRequestUser(req);
    return this.wallets.list(user.storeOwnerId!, user.role === 'STORE_OWNER');
  }

  @Get('wallets/:id/transactions')
  @RequireRoles({ roles: ['STORE_OWNER'] })
  walletTransactions(@Param('id') id: string, @Req() req: Request) {
    return this.wallets.getTransactions(getRequestUser(req).storeOwnerId!, id);
  }

  @Post('wallets/:id/settle')
  @RequireRoles({ roles: ['STORE_OWNER'] })
  settleWallet(
    @Param('id') id: string,
    @Body() dto: SettleWalletDto,
    @Req() req: Request,
    @Ip() ip: string,
  ) {
    return this.wallets.settle(getRequestUser(req).storeOwnerId!, id, dto, ip);
  }
}
