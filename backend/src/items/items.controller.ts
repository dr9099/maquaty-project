import {
  Body,
  Controller,
  Delete,
  Get,
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
import { CreateWalletDto } from './dto/wallets.dto';

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

  // === الأصناف (حصري للمالك — ITEMS_MANAGE) ===

  @Post('items')
  @RequireRoles({ roles: ['STORE_OWNER'] })
  create(@Body() dto: CreateItemDto, @Req() req: Request) {
    return this.items.create(getRequestUser(req).storeOwnerId!, dto);
  }

  @Get('items')
  @RequireRoles({ roles: ['STORE_OWNER'] })
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
  async inventory(@Req() req: Request, @Query('search') search?: string) {
    const user = getRequestUser(req);
    if (user.role === 'WORKER') {
      const worker = await this.prisma.worker.findUniqueOrThrow({
        where: { id: user.workerId! },
        select: { permShowSellPricesInventory: true },
      });
      return this.items.inventory(
        user.storeOwnerId!,
        { isWorker: true, showSellPrices: worker.permShowSellPricesInventory },
        search,
      );
    }
    return this.items.inventory(user.storeOwnerId!, { isWorker: false, showSellPrices: true }, search);
  }

  // === المحافظ (إدارة: المالك — عرض: المالك والعامل المسؤول) ===

  @Post('wallets')
  @RequireRoles({ roles: ['STORE_OWNER'] })
  createWallet(@Body() dto: CreateWalletDto, @Req() req: Request) {
    return this.wallets.create(getRequestUser(req).storeOwnerId!, dto);
  }

  @Get('wallets')
  @RequireRoles({ roles: ['STORE_OWNER', 'WORKER'], responsibleOnly: true })
  listWallets(@Req() req: Request) {
    return this.wallets.list(getRequestUser(req).storeOwnerId!);
  }
}
