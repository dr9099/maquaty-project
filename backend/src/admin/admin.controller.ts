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
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AdminService } from './admin.service';
import { RequireRoles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { StepUpMfaGuard } from '../common/step-up-mfa.guard';
import { getRequestUser } from '../common/types';
import {
  AuditLogQueryDto,
  BroadcastsQueryDto,
  CreateBroadcastDto,
  CreateSubscriptionDto,
  CreateSubscriptionPlanDto,
  DevicesQueryDto,
  StoreOwnersQueryDto,
  UpdateBroadcastDto,
  UpdateSettingsDto,
  UpdateStoreOwnerStatusDto,
  UpdateSubscriptionDto,
  UpdateSubscriptionPlanDto,
  UpdateWorkerLimitDto,
} from './dto/admin.dto';

@Controller('admin')
@RequireRoles({ roles: ['PLATFORM_ADMIN'] })
@UseGuards(RolesGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ═══════════════════════ إدارة المتاجر وأصحاب المتاجر ═══════════════════════

  @Get('store-owners')
  async getStoreOwners(@Query() query: StoreOwnersQueryDto) {
    return this.adminService.getStoreOwners(query);
  }

  @Get('store-owners/:id')
  async getStoreOwnerById(@Param('id') id: string) {
    return this.adminService.getStoreOwnerById(id);
  }

  @Patch('store-owners/:id/status')
  @UseGuards(StepUpMfaGuard)
  async updateStoreOwnerStatus(
    @Param('id') id: string,
    @Body() dto: UpdateStoreOwnerStatusDto,
    @Req() req: Request,
  ) {
    const user = getRequestUser(req);
    return this.adminService.updateStoreOwnerStatus(id, dto, user.userId, req.ip);
  }

  @Patch('store-owners/:id/worker-limit')
  async updateWorkerLimit(
    @Param('id') id: string,
    @Body() dto: UpdateWorkerLimitDto,
    @Req() req: Request,
  ) {
    const user = getRequestUser(req);
    return this.adminService.updateWorkerLimit(id, dto, user.userId, req.ip);
  }

  @Post('store-owners/:id/generate-temp-password')
  @UseGuards(StepUpMfaGuard)
  async generateTempPassword(@Param('id') id: string, @Req() req: Request) {
    const user = getRequestUser(req);
    return this.adminService.generateTempPassword(id, user.userId, req.ip);
  }

  // ═══════════════════════ خطط الاشتراكات ═══════════════════════

  @Get('subscription-plans')
  async getSubscriptionPlans(@Query('isActive') isActive?: string) {
    const activeBool = isActive !== undefined ? isActive === 'true' : undefined;
    return this.adminService.getSubscriptionPlans(activeBool);
  }

  @Post('subscription-plans')
  async createSubscriptionPlan(
    @Body() dto: CreateSubscriptionPlanDto,
    @Req() req: Request,
  ) {
    const user = getRequestUser(req);
    return this.adminService.createSubscriptionPlan(dto, user.userId, req.ip);
  }

  @Patch('subscription-plans/:id')
  async updateSubscriptionPlan(
    @Param('id') id: string,
    @Body() dto: UpdateSubscriptionPlanDto,
    @Req() req: Request,
  ) {
    const user = getRequestUser(req);
    return this.adminService.updateSubscriptionPlan(id, dto, user.userId, req.ip);
  }

  // ═══════════════════════ اشتراكات المتاجر ═══════════════════════

  @Post('store-owners/:id/subscriptions')
  async createSubscription(
    @Param('id') storeOwnerId: string,
    @Body() dto: CreateSubscriptionDto,
    @Req() req: Request,
  ) {
    const user = getRequestUser(req);
    return this.adminService.createSubscription(storeOwnerId, dto, user.userId, req.ip);
  }

  @Patch('subscriptions/:id')
  async updateSubscription(
    @Param('id') id: string,
    @Body() dto: UpdateSubscriptionDto,
    @Req() req: Request,
  ) {
    const user = getRequestUser(req);
    return this.adminService.updateSubscription(id, dto, user.userId, req.ip);
  }

  // ═══════════════════════ الأجهزة ═══════════════════════

  @Get('devices')
  async getDevices(@Query() query: DevicesQueryDto) {
    return this.adminService.getDevices(query);
  }

  @Patch('devices/:id/block')
  @UseGuards(StepUpMfaGuard)
  async blockDevice(@Param('id') id: string, @Req() req: Request) {
    const user = getRequestUser(req);
    return this.adminService.blockDevice(id, user.userId, req.ip);
  }

  @Patch('devices/:id/unblock')
  @UseGuards(StepUpMfaGuard)
  async unblockDevice(@Param('id') id: string, @Req() req: Request) {
    const user = getRequestUser(req);
    return this.adminService.unblockDevice(id, user.userId, req.ip);
  }

  // ═══════════════════════ الإعلانات والإشعارات ═══════════════════════

  @Get('broadcasts')
  async getBroadcasts(@Query() query: BroadcastsQueryDto) {
    return this.adminService.getBroadcasts(query);
  }

  @Post('broadcasts')
  async createBroadcast(@Body() dto: CreateBroadcastDto, @Req() req: Request) {
    const user = getRequestUser(req);
    return this.adminService.createBroadcast(dto, user.userId, req.ip);
  }

  @Patch('broadcasts/:id')
  async updateBroadcast(
    @Param('id') id: string,
    @Body() dto: UpdateBroadcastDto,
    @Req() req: Request,
  ) {
    const user = getRequestUser(req);
    return this.adminService.updateBroadcast(id, dto, user.userId, req.ip);
  }

  @Delete('broadcasts/:id')
  @UseGuards(StepUpMfaGuard)
  async deleteBroadcast(@Param('id') id: string, @Req() req: Request) {
    const user = getRequestUser(req);
    return this.adminService.deleteBroadcast(id, user.userId, req.ip);
  }

  // ═══════════════════════ إعدادات النظام ═══════════════════════

  @Get('settings')
  async getSettings() {
    return this.adminService.getSettings();
  }

  @Patch('settings')
  async updateSettings(@Body() dto: UpdateSettingsDto, @Req() req: Request) {
    const user = getRequestUser(req);
    return this.adminService.updateSettings(dto, user.userId, req.ip);
  }

  // ═══════════════════════ سجل التدقيق ═══════════════════════

  @Get('audit-log')
  async getAuditLogs(@Query() query: AuditLogQueryDto) {
    return this.adminService.getAuditLogs(query);
  }
}
