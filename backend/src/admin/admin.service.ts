import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  ActorType,
  AuditResult,
  BroadcastPriority,
  BroadcastTargetType,
  BroadcastType,
  DeviceStatus,
  Prisma,
  StoreOwnerStatus,
  SubscriptionStatus,
  WorkerStatus,
} from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import { AccountStatusGuard } from '../common/account-status.guard';
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

const ALLOWED_SETTING_KEYS = [
  'trial_sales_limit',
  'trial_days_default',
  'trial_warning_threshold',
  'max_workers_default',
  'contact_phone',
  'contact_whatsapp',
  'admin_notice',
  'app_min_version',
  'min_app_version',
  'backup_retention_days',
  'default_emergency_price_mode',
  'trial_expired_message',
  'subscription_expired_message',
  'suspended_message',
];

@Injectable()
export class AdminService implements OnModuleInit {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit() {
    await this.seedInitialAdminAndSettings();
  }

  async seedInitialAdminAndSettings() {
    try {
      const email = process.env.ADMIN_INITIAL_EMAIL;
      const phone = process.env.ADMIN_INITIAL_PHONE || email;
      const password = process.env.ADMIN_INITIAL_PASSWORD;

      if ((email || phone) && password) {
        const adminCount = await this.prisma.platformAdmin.count();
        if (adminCount === 0) {
          const passwordHash = await hash(password);
          await this.prisma.platformAdmin.create({
            data: {
              fullName: 'مدير المنصة',
              phone: (phone || email)!.trim(),
              passwordHash,
            },
          });
          this.logger.log('تم إنشاء حساب مدير المنصة الأولي بنجاح');
        }
      }

      // Upsert default system settings if missing
      const defaultSettings: Array<{ key: string; value: any }> = [
        { key: 'trial_sales_limit', value: 50 },
        { key: 'trial_warning_threshold', value: 30 },
        { key: 'contact_phone', value: '735717710' },
      ];

      for (const setting of defaultSettings) {
        const existing = await this.prisma.systemSetting.findUnique({
          where: { key: setting.key },
        });
        if (!existing) {
          await this.prisma.systemSetting.create({
            data: {
              key: setting.key,
              value: { v: setting.value },
            },
          });
        }
      }
    } catch (err: any) {
      this.logger.warn(`تعذر استكمال التهيئة الأولية: ${err.message}`);
    }
  }

  // ═══════════════════════ إدارة المتاجر وأصحاب المتاجر ═══════════════════════

  async getStoreOwners(query: StoreOwnersQueryDto) {
    const where: Prisma.StoreOwnerWhereInput = {
      deletedAt: null,
    };

    if (query.phone) {
      const normalizedDigits = query.phone.replace(/\D/g, '');
      where.phone = { contains: normalizedDigits };
    }

    if (query.status) {
      where.status = query.status;
    }

    const [items, total] = await Promise.all([
      this.prisma.storeOwner.findMany({
        where,
        take: query.limit,
        skip: query.offset,
        orderBy: { createdAt: 'desc' },
        include: {
          subscriptions: {
            where: { status: SubscriptionStatus.ACTIVE },
            orderBy: { expiresAt: 'desc' },
            take: 1,
            include: { plan: true },
          },
          _count: {
            select: {
              workers: { where: { deletedAt: null } },
              devices: true,
              sales: true,
            },
          },
        },
      }),
      this.prisma.storeOwner.count({ where }),
    ]);

    return {
      items: items.map((owner) => {
        const activeSub = owner.subscriptions[0] ?? null;
        return {
          id: owner.id,
          fullName: owner.fullName,
          storeName: owner.storeName,
          phone: owner.phone,
          status: owner.status,
          trialSalesUsed: owner.trialSalesUsed,
          trialSalesLimit: owner.trialSalesLimit,
          maxWorkersAllowed: owner.maxWorkersAllowed,
          currency: owner.currency,
          createdAt: owner.createdAt,
          activeSubscription: activeSub
            ? {
                id: activeSub.id,
                planName: activeSub.plan.name,
                startsAt: activeSub.startsAt,
                expiresAt: activeSub.expiresAt,
                status: activeSub.status,
              }
            : null,
          counts: {
            workers: owner._count.workers,
            devices: owner._count.devices,
            sales: owner._count.sales,
          },
        };
      }),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async getStoreOwnerById(id: string) {
    const owner = await this.prisma.storeOwner.findUnique({
      where: { id },
      include: {
        subscriptions: {
          orderBy: { createdAt: 'desc' },
          include: { plan: true, activatedByAdmin: { select: { id: true, fullName: true } } },
        },
        devices: {
          orderBy: { lastSeenAt: 'desc' },
        },
        workers: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            fullName: true,
            phone: true,
            status: true,
            isResponsible: true,
            lastLoginAt: true,
            createdAt: true,
          },
        },
        _count: {
          select: {
            sales: true,
            items: { where: { deletedAt: null } },
            wallets: true,
          },
        },
      },
    });

    if (!owner) {
      throw ApiError.notFound('المتجر غير موجود.');
    }

    return owner;
  }

  async updateStoreOwnerStatus(
    id: string,
    dto: UpdateStoreOwnerStatusDto,
    adminId: string,
    ipAddress?: string,
  ) {
    const owner = await this.prisma.storeOwner.findUnique({ where: { id } });
    if (!owner) {
      throw ApiError.notFound('المتجر غير موجود.');
    }

    if (dto.status === 'SUSPENDED') {
      if (owner.status === StoreOwnerStatus.SUSPENDED) {
        throw ApiError.conflict('ALREADY_SUSPENDED', 'المتجر موقوف بالفعل.');
      }

      const updated = await this.prisma.storeOwner.update({
        where: { id },
        data: {
          status: StoreOwnerStatus.SUSPENDED,
          suspendedFromStatus: owner.status,
          suspendedAt: new Date(),
        },
      });

      await this.audit.log({
        actorType: ActorType.PLATFORM_ADMIN,
        actorId: adminId,
        actionType: 'STORE_OWNER_SUSPENDED',
        targetType: 'StoreOwner',
        targetId: id,
        oldValue: { status: owner.status },
        newValue: { status: StoreOwnerStatus.SUSPENDED, reason: dto.reason },
        result: AuditResult.SUCCESS,
        ipAddress,
      });

      AccountStatusGuard.invalidateOwner(id);

      return updated;
    }

    // استئناف المتجر (dto.status === 'ACTIVE')
    if (owner.status !== StoreOwnerStatus.SUSPENDED) {
      throw ApiError.conflict('NOT_SUSPENDED', 'المتجر ليس في حالة إيقاف ليتم استئنافه.');
    }

    const suspendedAt = owner.suspendedAt ?? new Date();
    const gapMs = Math.max(0, Date.now() - suspendedAt.getTime());
    const restoredStatus = owner.suspendedFromStatus ?? StoreOwnerStatus.ACTIVE;

    const result = await this.prisma.$transaction(async (tx) => {
      // إذا كان هناك اشتراك نشط وقت الإيقاف، يتم تمديد تاريخ انتهائه بفترة التوقف (D-07)
      const activeSub = await tx.subscription.findFirst({
        where: {
          storeOwnerId: id,
          status: SubscriptionStatus.ACTIVE,
        },
        orderBy: { expiresAt: 'desc' },
      });

      if (activeSub && gapMs > 0) {
        await tx.subscription.update({
          where: { id: activeSub.id },
          data: {
            expiresAt: new Date(activeSub.expiresAt.getTime() + gapMs),
          },
        });
      }

      return tx.storeOwner.update({
        where: { id },
        data: {
          status: restoredStatus,
          suspendedFromStatus: null,
          suspendedAt: null,
        },
      });
    });

    await this.audit.log({
      actorType: ActorType.PLATFORM_ADMIN,
      actorId: adminId,
      actionType: 'STORE_OWNER_RESUMED',
      targetType: 'StoreOwner',
      targetId: id,
      oldValue: { status: owner.status, suspendedAt: owner.suspendedAt },
      newValue: { status: restoredStatus, extendedGapMs: gapMs, reason: dto.reason },
      result: AuditResult.SUCCESS,
      ipAddress,
    });

    AccountStatusGuard.invalidateOwner(id);

    return result;
  }

  async updateWorkerLimit(
    id: string,
    dto: UpdateWorkerLimitDto,
    adminId: string,
    ipAddress?: string,
  ) {
    const owner = await this.prisma.storeOwner.findUnique({ where: { id } });
    if (!owner) {
      throw ApiError.notFound('المتجر غير موجود.');
    }

    const oldLimit = owner.maxWorkersAllowed;
    const newLimit = dto.maxWorkersAllowed;

    const suspendedWorkerIds: string[] = [];

    await this.prisma.$transaction(async (tx) => {
      await tx.storeOwner.update({
        where: { id },
        data: { maxWorkersAllowed: newLimit },
      });

      // إذا انخفض الحد، نطبق LIFO على العمال العاديين النشطين دون المساس بالعامل المسؤول (D-05)
      if (newLimit < oldLimit) {
        const activeResponsibleCount = await tx.worker.count({
          where: {
            storeOwnerId: id,
            status: WorkerStatus.ACTIVE,
            isResponsible: true,
            deletedAt: null,
          },
        });

        const allowedNormalSlots = Math.max(0, newLimit - activeResponsibleCount);

        const activeNormalWorkers = await tx.worker.findMany({
          where: {
            storeOwnerId: id,
            status: WorkerStatus.ACTIVE,
            isResponsible: false,
            deletedAt: null,
          },
          orderBy: { createdAt: 'desc' }, // LIFO: الأحدث أولاً
        });

        if (activeNormalWorkers.length > allowedNormalSlots) {
          const excessCount = activeNormalWorkers.length - allowedNormalSlots;
          const workersToSuspend = activeNormalWorkers.slice(0, excessCount);

          for (const worker of workersToSuspend) {
            suspendedWorkerIds.push(worker.id);
            await tx.worker.update({
              where: { id: worker.id },
              data: { status: WorkerStatus.SUSPENDED },
            });
          }
        }
      }
    });

    for (const workerId of suspendedWorkerIds) {
      AccountStatusGuard.invalidateWorker(workerId);
    }

    await this.audit.log({
      actorType: ActorType.PLATFORM_ADMIN,
      actorId: adminId,
      actionType: 'STORE_OWNER_WORKER_LIMIT_UPDATED',
      targetType: 'StoreOwner',
      targetId: id,
      oldValue: { maxWorkersAllowed: oldLimit },
      newValue: {
        maxWorkersAllowed: newLimit,
        autoSuspendedWorkers: suspendedWorkerIds,
      },
      result: AuditResult.SUCCESS,
      ipAddress,
    });

    return {
      success: true,
      storeOwnerId: id,
      maxWorkersAllowed: newLimit,
      suspendedWorkersCount: suspendedWorkerIds.length,
      suspendedWorkerIds,
    };
  }

  async generateTempPassword(id: string, adminId: string, ipAddress?: string) {
    const owner = await this.prisma.storeOwner.findUnique({ where: { id } });
    if (!owner) {
      throw ApiError.notFound('المتجر غير موجود.');
    }

    // توليد كلمة مرور مؤقتة عشوائية آمنة من 8 خانات سهلة القراءة
    const plainTemp = randomBytes(4).toString('hex').toUpperCase();
    const passwordHash = await hash(plainTemp);
    const validityHours = Number(process.env.TEMP_PASSWORD_VALIDITY_HOURS ?? 24);
    const expiresAt = new Date(Date.now() + validityHours * 3_600_000);

    await this.prisma.$transaction(async (tx) => {
      await tx.storeOwner.update({
        where: { id },
        data: {
          tempPasswordHash: passwordHash,
          tempPasswordGeneratedAt: new Date(),
          mustChangePassword: true,
        },
      });

      await tx.tempPasswordAudit.create({
        data: {
          adminId,
          storeOwnerId: id,
          expiresAt,
        },
      });
    });

    await this.audit.log({
      actorType: ActorType.PLATFORM_ADMIN,
      actorId: adminId,
      actionType: 'STORE_OWNER_TEMP_PASSWORD_GENERATED',
      targetType: 'StoreOwner',
      targetId: id,
      newValue: { expiresAt },
      result: AuditResult.SUCCESS,
      ipAddress,
    });

    return {
      tempPassword: plainTemp,
      expiresAt,
    };
  }

  // ═══════════════════════ خطط الاشتراكات ═══════════════════════

  async getSubscriptionPlans(isActive?: boolean) {
    const where: Prisma.SubscriptionPlanWhereInput = {};
    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    return this.prisma.subscriptionPlan.findMany({
      where,
      orderBy: { durationDays: 'asc' },
    });
  }

  async createSubscriptionPlan(
    dto: CreateSubscriptionPlanDto,
    adminId: string,
    ipAddress?: string,
  ) {
    const plan = await this.prisma.subscriptionPlan.create({
      data: {
        name: dto.name,
        durationDays: dto.durationDays,
        isCustom: dto.isCustom ?? false,
        isActive: dto.isActive ?? true,
      },
    });

    await this.audit.log({
      actorType: ActorType.PLATFORM_ADMIN,
      actorId: adminId,
      actionType: 'SUBSCRIPTION_PLAN_CREATED',
      targetType: 'SubscriptionPlan',
      targetId: plan.id,
      newValue: { ...dto },
      result: AuditResult.SUCCESS,
      ipAddress,
    });

    return plan;
  }

  async updateSubscriptionPlan(
    id: string,
    dto: UpdateSubscriptionPlanDto,
    adminId: string,
    ipAddress?: string,
  ) {
    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id } });
    if (!plan) {
      throw ApiError.notFound('خطة الاشتراك غير موجودة.');
    }

    const updated = await this.prisma.subscriptionPlan.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.durationDays !== undefined && { durationDays: dto.durationDays }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    await this.audit.log({
      actorType: ActorType.PLATFORM_ADMIN,
      actorId: adminId,
      actionType: 'SUBSCRIPTION_PLAN_UPDATED',
      targetType: 'SubscriptionPlan',
      targetId: id,
      oldValue: { name: plan.name, durationDays: plan.durationDays, isActive: plan.isActive },
      newValue: { ...dto },
      result: AuditResult.SUCCESS,
      ipAddress,
    });

    return updated;
  }

  // ═══════════════════════ اشتراكات المتاجر ═══════════════════════

  async createSubscription(
    storeOwnerId: string,
    dto: CreateSubscriptionDto,
    adminId: string,
    ipAddress?: string,
  ) {
    const owner = await this.prisma.storeOwner.findUnique({
      where: { id: storeOwnerId },
    });
    if (!owner) {
      throw ApiError.notFound('المتجر غير موجود.');
    }

    // فحص عدم وجود اشتراك نشط بالفعل (D-05)
    const existingActive = await this.prisma.subscription.findFirst({
      where: {
        storeOwnerId,
        status: SubscriptionStatus.ACTIVE,
        expiresAt: { gt: new Date() },
      },
    });

    if (existingActive) {
      throw ApiError.conflict(
        'SUBSCRIPTION_ALREADY_ACTIVE',
        'المتجر يمتلك اشتراكاً نشطاً بالفعل. لتمديد المدة، استخدم عملية تمديد الاشتراك القائم.',
      );
    }

    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: dto.planId },
    });
    if (!plan) {
      throw ApiError.notFound('خطة الاشتراك غير موجودة.');
    }

    const durationDays = dto.durationDays ?? plan.durationDays;
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : new Date();
    const expiresAt = new Date(startsAt.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const subscription = await this.prisma.$transaction(async (tx) => {
      const sub = await tx.subscription.create({
        data: {
          storeOwnerId,
          planId: plan.id,
          activatedBy: adminId,
          startsAt,
          expiresAt,
          status: SubscriptionStatus.ACTIVE,
          agreedAmount: dto.agreedAmount ? new Prisma.Decimal(dto.agreedAmount) : null,
        },
        include: { plan: true },
      });

      // إذا كان المتجر في حالة تجربة أو اشتراك منتهٍ، يصبح نشطاً
      if (
        owner.status === StoreOwnerStatus.TRIAL ||
        owner.status === StoreOwnerStatus.TRIAL_WARNING ||
        owner.status === StoreOwnerStatus.TRIAL_EXPIRED ||
        owner.status === StoreOwnerStatus.EXPIRED
      ) {
        await tx.storeOwner.update({
          where: { id: storeOwnerId },
          data: { status: StoreOwnerStatus.ACTIVE },
        });
      }

      return sub;
    });

    await this.audit.log({
      actorType: ActorType.PLATFORM_ADMIN,
      actorId: adminId,
      actionType: 'SUBSCRIPTION_ACTIVATED',
      targetType: 'Subscription',
      targetId: subscription.id,
      newValue: {
        storeOwnerId,
        planId: plan.id,
        durationDays,
        startsAt,
        expiresAt,
        agreedAmount: dto.agreedAmount,
      },
      result: AuditResult.SUCCESS,
      ipAddress,
    });

    AccountStatusGuard.invalidateOwner(storeOwnerId);

    return subscription;
  }

  async updateSubscription(
    id: string,
    dto: UpdateSubscriptionDto,
    adminId: string,
    ipAddress?: string,
  ) {
    const sub = await this.prisma.subscription.findUnique({
      where: { id },
      include: { storeOwner: true },
    });
    if (!sub) {
      throw ApiError.notFound('الاشتراك غير موجود.');
    }

    let updated: any;

    if (dto.action === 'extend') {
      if (!dto.days || dto.days <= 0) {
        throw ApiError.badRequest('VALIDATION_ERROR', 'عدد الأيام للتمديد يجب أن يكون أكبر من صفر.');
      }

      // إذا كان الاشتراك لا يزال نشطاً، نمدد من تاريخ انتهائه؛ إن كان منتهياً، نمدد من الآن
      const baseDate = sub.expiresAt > new Date() ? sub.expiresAt : new Date();
      const newExpiresAt = new Date(baseDate.getTime() + dto.days * 24 * 60 * 60 * 1000);

      updated = await this.prisma.$transaction(async (tx) => {
        const res = await tx.subscription.update({
          where: { id },
          data: {
            expiresAt: newExpiresAt,
            status: SubscriptionStatus.ACTIVE,
          },
        });

        if (sub.storeOwner.status === StoreOwnerStatus.EXPIRED) {
          await tx.storeOwner.update({
            where: { id: sub.storeOwnerId },
            data: { status: StoreOwnerStatus.ACTIVE },
          });
        }

        return res;
      });
    } else if (dto.action === 'cancel') {
      updated = await this.prisma.subscription.update({
        where: { id },
        data: { status: SubscriptionStatus.CANCELLED },
      });
    } else if (dto.action === 'reactivate') {
      updated = await this.prisma.subscription.update({
        where: { id },
        data: { status: SubscriptionStatus.ACTIVE },
      });
    } else if (dto.action === 'change_duration') {
      if (!dto.newExpiresAt) {
        throw ApiError.badRequest('VALIDATION_ERROR', 'تاريخ الانتهاء الجديد مطلوب.');
      }
      updated = await this.prisma.subscription.update({
        where: { id },
        data: { expiresAt: new Date(dto.newExpiresAt) },
      });
    }

    await this.audit.log({
      actorType: ActorType.PLATFORM_ADMIN,
      actorId: adminId,
      actionType: 'SUBSCRIPTION_UPDATED',
      targetType: 'Subscription',
      targetId: id,
      oldValue: { status: sub.status, expiresAt: sub.expiresAt },
      newValue: { ...dto },
      result: AuditResult.SUCCESS,
      ipAddress,
    });

    AccountStatusGuard.invalidateOwner(sub.storeOwnerId);

    return updated;
  }

  // ═══════════════════════ الأجهزة ═══════════════════════

  async getDevices(query: DevicesQueryDto) {
    const where: Prisma.DeviceWhereInput = {};

    if (query.storeOwnerId) {
      where.storeOwnerId = query.storeOwnerId;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.search) {
      where.OR = [
        { deviceFingerprint: { contains: query.search } },
        { appVersion: { contains: query.search } },
        { os: { contains: query.search } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.device.findMany({
        where,
        take: query.limit,
        skip: query.offset,
        orderBy: { lastSeenAt: 'desc' },
        include: {
          storeOwner: { select: { id: true, storeName: true, phone: true } },
          worker: { select: { id: true, fullName: true, phone: true } },
        },
      }),
      this.prisma.device.count({ where }),
    ]);

    return {
      items,
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async blockDevice(id: string, adminId: string, ipAddress?: string) {
    const device = await this.prisma.device.findUnique({ where: { id } });
    if (!device) {
      throw ApiError.notFound('الجهاز غير موجود.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.device.update({
        where: { id },
        data: { status: DeviceStatus.BLOCKED },
      });

      // إلغاء جميع جلسات التحديث النشطة لهذا الجهاز فوراً (D-03)
      await tx.refreshSession.updateMany({
        where: { deviceId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    await this.audit.log({
      actorType: ActorType.PLATFORM_ADMIN,
      actorId: adminId,
      actionType: 'DEVICE_BLOCKED',
      targetType: 'Device',
      targetId: id,
      newValue: { status: DeviceStatus.BLOCKED },
      result: AuditResult.SUCCESS,
      ipAddress,
    });

    AccountStatusGuard.invalidateDevice(device.deviceFingerprint);

    return { success: true, id, status: DeviceStatus.BLOCKED };
  }

  async unblockDevice(id: string, adminId: string, ipAddress?: string) {
    const device = await this.prisma.device.findUnique({ where: { id } });
    if (!device) {
      throw ApiError.notFound('الجهاز غير موجود.');
    }

    await this.prisma.device.update({
      where: { id },
      data: { status: DeviceStatus.ACTIVE },
    });

    await this.audit.log({
      actorType: ActorType.PLATFORM_ADMIN,
      actorId: adminId,
      actionType: 'DEVICE_UNBLOCKED',
      targetType: 'Device',
      targetId: id,
      newValue: { status: DeviceStatus.ACTIVE },
      result: AuditResult.SUCCESS,
      ipAddress,
    });

    AccountStatusGuard.invalidateDevice(device.deviceFingerprint);

    return { success: true, id, status: DeviceStatus.ACTIVE };
  }

  // ═══════════════════════ الإعلانات والإشعارات ═══════════════════════

  async getBroadcasts(query: BroadcastsQueryDto) {
    const where: Prisma.BroadcastWhereInput = {};
    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    const [items, total] = await Promise.all([
      this.prisma.broadcast.findMany({
        where,
        take: query.limit,
        skip: query.offset,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.broadcast.count({ where }),
    ]);

    return {
      items,
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async createBroadcast(dto: CreateBroadcastDto, adminId: string, ipAddress?: string) {
    const expiresAt =
      dto.durationHours && dto.durationHours > 0
        ? new Date(Date.now() + dto.durationHours * 60 * 60 * 1000)
        : null;

    const discountCode = dto.discountCode ? dto.discountCode.toUpperCase().trim() : null;

    const broadcast = await this.prisma.broadcast.create({
      data: {
        createdBy: adminId,
        type: dto.type,
        title: dto.title,
        body: dto.body,
        imageUrl: dto.imageUrl,
        buttonText: dto.buttonText,
        buttonUrl: dto.buttonUrl,
        durationHours: dto.durationHours ?? 0,
        expiresAt,
        dismissible: dto.dismissible ?? true,
        priority: dto.priority ?? BroadcastPriority.NORMAL,
        targetType: dto.targetType,
        targetDeviceId: dto.targetDeviceId,
        discountCode,
        discountPercentText: dto.discountPercentText,
        isActive: dto.isActive ?? true,
      },
    });

    await this.audit.log({
      actorType: ActorType.PLATFORM_ADMIN,
      actorId: adminId,
      actionType: 'BROADCAST_CREATED',
      targetType: 'Broadcast',
      targetId: broadcast.id,
      newValue: { ...dto },
      result: AuditResult.SUCCESS,
      ipAddress,
    });

    return broadcast;
  }

  async updateBroadcast(
    id: string,
    dto: UpdateBroadcastDto,
    adminId: string,
    ipAddress?: string,
  ) {
    const existing = await this.prisma.broadcast.findUnique({ where: { id } });
    if (!existing) {
      throw ApiError.notFound('الإعلان غير موجود.');
    }

    const discountCode =
      dto.discountCode !== undefined
        ? dto.discountCode
          ? dto.discountCode.toUpperCase().trim()
          : null
        : undefined;

    let expiresAt: Date | null | undefined = undefined;
    if (dto.durationHours !== undefined) {
      expiresAt =
        dto.durationHours > 0 ? new Date(Date.now() + dto.durationHours * 60 * 60 * 1000) : null;
    }

    const updated = await this.prisma.broadcast.update({
      where: { id },
      data: {
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.body !== undefined && { body: dto.body }),
        ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl }),
        ...(dto.buttonText !== undefined && { buttonText: dto.buttonText }),
        ...(dto.buttonUrl !== undefined && { buttonUrl: dto.buttonUrl }),
        ...(dto.durationHours !== undefined && { durationHours: dto.durationHours }),
        ...(expiresAt !== undefined && { expiresAt }),
        ...(dto.dismissible !== undefined && { dismissible: dto.dismissible }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
        ...(dto.targetType !== undefined && { targetType: dto.targetType }),
        ...(dto.targetDeviceId !== undefined && { targetDeviceId: dto.targetDeviceId }),
        ...(discountCode !== undefined && { discountCode }),
        ...(dto.discountPercentText !== undefined && {
          discountPercentText: dto.discountPercentText,
        }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    await this.audit.log({
      actorType: ActorType.PLATFORM_ADMIN,
      actorId: adminId,
      actionType: 'BROADCAST_UPDATED',
      targetType: 'Broadcast',
      targetId: id,
      oldValue: { title: existing.title, isActive: existing.isActive },
      newValue: { ...dto },
      result: AuditResult.SUCCESS,
      ipAddress,
    });

    return updated;
  }

  async deleteBroadcast(id: string, adminId: string, ipAddress?: string) {
    const existing = await this.prisma.broadcast.findUnique({ where: { id } });
    if (!existing) {
      throw ApiError.notFound('الإعلان غير موجود.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.broadcastAck.deleteMany({ where: { broadcastId: id } });
      await tx.broadcast.delete({ where: { id } });
    });

    await this.audit.log({
      actorType: ActorType.PLATFORM_ADMIN,
      actorId: adminId,
      actionType: 'BROADCAST_DELETED',
      targetType: 'Broadcast',
      targetId: id,
      oldValue: { title: existing.title },
      result: AuditResult.SUCCESS,
      ipAddress,
    });

    return { success: true, id };
  }

  // ═══════════════════════ إعدادات النظام ═══════════════════════

  async getSettings() {
    const settings = await this.prisma.systemSetting.findMany();
    const result: Record<string, any> = {};

    for (const s of settings) {
      const val = s.value as any;
      result[s.key] = val && typeof val === 'object' && 'v' in val ? val.v : val;
    }

    // توحيد مفتاحي إصدار التطبيق بين لوحة الإدارة والموبايل (min_app_version / app_min_version)
    const minVersion = result.min_app_version ?? result.app_min_version;
    if (minVersion !== undefined) {
      result.min_app_version = minVersion;
      result.app_min_version = minVersion;
    }

    return result;
  }

  async updateSettings(dto: UpdateSettingsDto, adminId: string, ipAddress?: string) {
    const entries: Array<{ key: string; value: any }> = [];

    if (dto.settings && Array.isArray(dto.settings)) {
      entries.push(...dto.settings);
    } else if (dto.key !== undefined && dto.value !== undefined) {
      entries.push({ key: dto.key, value: dto.value });
    }

    if (entries.length === 0) {
      throw ApiError.badRequest('VALIDATION_ERROR', 'لا توجد إعدادات لتحديثها.');
    }

    for (const entry of entries) {
      if (!ALLOWED_SETTING_KEYS.includes(entry.key)) {
        throw ApiError.badRequest(
          'VALIDATION_ERROR',
          `مفتاح الإعداد '${entry.key}' غير مدعوم في النظام.`,
        );
      }
    }

    // مزامنة تلقائية بين min_app_version و app_min_version لضمان الاتساق
    const minVerEntry = entries.find((e) => e.key === 'min_app_version' || e.key === 'app_min_version');
    if (minVerEntry) {
      const otherKey = minVerEntry.key === 'min_app_version' ? 'app_min_version' : 'min_app_version';
      if (!entries.some((e) => e.key === otherKey)) {
        entries.push({ key: otherKey, value: minVerEntry.value });
      }
    }

    await this.prisma.$transaction(async (tx) => {
      for (const entry of entries) {
        // تخزين القيمة بشكل موحد كـ { "v": value } حسب القرار D-06
        await tx.systemSetting.upsert({
          where: { key: entry.key },
          create: {
            key: entry.key,
            value: { v: entry.value },
          },
          update: {
            value: { v: entry.value },
          },
        });
      }
    });

    await this.audit.log({
      actorType: ActorType.PLATFORM_ADMIN,
      actorId: adminId,
      actionType: 'SYSTEM_SETTINGS_UPDATED',
      targetType: 'SystemSetting',
      newValue: { updatedKeys: entries.map((e) => e.key) },
      result: AuditResult.SUCCESS,
      ipAddress,
    });

    AccountStatusGuard.clearAllCache();

    return this.getSettings();
  }

  // ═══════════════════════ سجل التدقيق ═══════════════════════

  async getAuditLogs(query: AuditLogQueryDto) {
    const where: Prisma.AuditLogWhereInput = {};

    if (query.actorType) where.actorType = query.actorType;
    if (query.actorId) where.actorId = query.actorId;
    if (query.actionType) where.actionType = query.actionType;
    if (query.targetType) where.targetType = query.targetType;
    if (query.targetId) where.targetId = query.targetId;

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        take: query.limit,
        skip: query.offset,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items,
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }
}
