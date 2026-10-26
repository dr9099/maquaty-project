import { Injectable } from '@nestjs/common';
import {
  BroadcastAckType,
  DeviceStatus,
  Prisma,
  RejectionReasonCode,
  SyncOpStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SalesService } from '../sales/sales.service';
import { CreditService } from '../credit/credit.service';
import { DamagedGoodsService } from '../damaged-goods/damaged-goods.service';
import { ExpensesService } from '../expenses/expenses.service';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import { AuthenticatedUser } from '../common/types';
import { AckBroadcastDto, DeviceSyncDto, PullBroadcastsDto } from './dto/sync.dto';

// خدمة المزامنة المركزية — API_SPEC القسم 14 / R-26 / R-30
@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sales: SalesService,
    private readonly credit: CreditService,
    private readonly damagedGoods: DamagedGoodsService,
    private readonly expenses: ExpensesService,
    private readonly audit: AuditService,
  ) {}

  async sync(user: AuthenticatedUser, dto: DeviceSyncDto, ip?: string) {
    const storeOwnerId = user.storeOwnerId!;

    // 1) فحص حالة الجهاز وتحديث بيانات الظهور
    let device = await this.prisma.device.findUnique({
      where: { deviceFingerprint: dto.deviceFingerprint },
    });

    if (device && device.status === DeviceStatus.BLOCKED) {
      throw ApiError.forbidden('DEVICE_BLOCKED', 'هذا الجهاز محظور من الاستخدام.');
    }

    if (!device) {
      device = await this.prisma.device.create({
        data: {
          deviceFingerprint: dto.deviceFingerprint,
          storeOwnerId,
          workerId: user.role === 'WORKER' ? user.workerId : null,
          lastSeenAt: new Date(),
          lastSyncAt: new Date(),
        },
      });
    } else {
      device = await this.prisma.device.update({
        where: { id: device.id },
        data: {
          lastSeenAt: new Date(),
          lastSyncAt: new Date(),
          storeOwnerId,
          workerId: user.role === 'WORKER' ? user.workerId : device.workerId,
        },
      });
    }

    // 2) معالجة العمليات المحلية المرفوعة (Idempotency)
    const processedOps: Array<{
      client_op_id: string;
      status: 'ACCEPTED' | 'REJECTED';
      error_code?: string;
      message?: string;
    }> = [];

    const pendingOps = dto.pendingLocalOperations ?? [];

    for (const op of pendingOps) {
      // فحص عدم التكرار عبر sync_operations
      const existing = await this.prisma.syncOperation.findFirst({
        where: { storeOwnerId, clientOpId: op.clientOpId },
      });

      if (existing) {
        processedOps.push({
          client_op_id: op.clientOpId,
          status: existing.status,
          error_code: existing.errorCode ?? undefined,
        });
        continue;
      }

      // تنفيذ العملية حسب النوع
      try {
        if (op.opType === 'SALE') {
          await this.sales.create(user, op.payload as any);
        } else if (op.opType === 'CREDIT_PAYMENT') {
          await this.credit.recordPayment(user, op.payload.customerId, op.payload as any, ip);
        } else if (op.opType === 'DAMAGED_GOODS') {
          await this.damagedGoods.record(user, op.payload as any, ip);
        } else if (op.opType === 'WORKER_ADVANCE') {
          await this.expenses.recordWorkerAdvance(user, op.payload as any);
        } else {
          throw ApiError.badRequest('VALIDATION_ERROR', `نوع العملية غير معروف: ${op.opType}`);
        }

        // نجحت العملية
        await this.prisma.syncOperation.create({
          data: {
            storeOwnerId,
            deviceId: device.id,
            clientOpId: op.clientOpId,
            opType: op.opType,
            status: SyncOpStatus.ACCEPTED,
          },
        });

        processedOps.push({
          client_op_id: op.clientOpId,
          status: 'ACCEPTED',
        });
      } catch (err: any) {
        const errorCode = err instanceof ApiError ? err.code : 'INTERNAL_ERROR';
        const message = err.message || 'حدث خطأ أثناء معالجة العملية';

        await this.prisma.syncOperation.create({
          data: {
            storeOwnerId,
            deviceId: device.id,
            clientOpId: op.clientOpId,
            opType: op.opType,
            status: SyncOpStatus.REJECTED,
            errorCode,
          },
        });

        processedOps.push({
          client_op_id: op.clientOpId,
          status: 'REJECTED',
          error_code: errorCode,
          message,
        });

        // قاعدة R-30: حفظ عمليات البيع المرفوضة فقط بسبب سقف الائتمان أو نقص المخزون في rejected_transactions
        if (
          op.opType === 'SALE' &&
          (errorCode === 'CREDIT_LIMIT_EXCEEDED' || errorCode === 'INSUFFICIENT_STOCK')
        ) {
          await this.prisma.rejectedTransaction.create({
            data: {
              storeOwnerId,
              workerId: user.role === 'WORKER' ? user.workerId : null,
              attemptedPayload: op.payload,
              rejectionReasonCode: errorCode as RejectionReasonCode,
              rejectionReasonDetail: message,
              status: 'PENDING',
            },
          });
        }
      }
    }

    // 3) احتساب رقم إصدار المزامنة الجديد وتحديث الجهاز
    const nextSyncVersion = Number(device.lastSyncVersion) + 1;
    await this.prisma.device.update({
      where: { id: device.id },
      data: { lastSyncVersion: BigInt(nextSyncVersion) },
    });

    // 4) جلب تحديثات الخادم (Delta / Server Updates)
    const items = await this.prisma.item.findMany({
      where: { storeOwnerId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });

    const isOwner = user.role === 'STORE_OWNER';
    const serverItems = items.map((i) => ({
      id: i.id,
      name: i.name,
      unit: i.unit,
      quantity: Number(i.quantity),
      sell_price: Number(i.sellPrice),
      cost_price: isOwner ? Number(i.costPrice) : undefined, // حماية سعر التكلفة
      emergency_price_mode: i.emergencyPriceMode,
      emergency_price_plus_fixed: i.emergencyPricePlusFixed ? Number(i.emergencyPricePlusFixed) : null,
      emergency_price_min: i.emergencyPriceMin ? Number(i.emergencyPriceMin) : null,
      emergency_price_max: i.emergencyPriceMax ? Number(i.emergencyPriceMax) : null,
      updated_at: i.updatedAt,
    }));

    let workersList: any[] | undefined = undefined;
    if (isOwner || user.isResponsible) {
      const workers = await this.prisma.worker.findMany({
        where: { storeOwnerId, status: { in: ['ACTIVE', 'SUSPENDED'] } },
        orderBy: { createdAt: 'asc' },
      });
      workersList = workers.map((w) => ({
        id: w.id,
        full_name: w.fullName,
        phone: w.phone,
        status: w.status,
        is_responsible: w.isResponsible,
      }));
    }

    const owner = await this.prisma.storeOwner.findUniqueOrThrow({
      where: { id: storeOwnerId },
      select: {
        status: true,
        trialSalesUsed: true,
        trialSalesLimit: true,
        maxWorkersAllowed: true,
      },
    });

    // إعداد أقل نسخة تطبيق مدعومة (إجبار التحديث عن بعد)
    const minAppVersionSetting = await this.prisma.systemSetting.findUnique({
      where: { key: 'min_app_version' },
    });
    const minAppVersion =
      (minAppVersionSetting?.value as string) ||
      process.env.MIN_SUPPORTED_APP_VERSION ||
      '1.0.0';

    return {
      new_sync_version: nextSyncVersion,
      account_status: owner.status,
      min_app_version: minAppVersion,
      processed_operations: processedOps,
      server_updates: {
        items: serverItems,
        workers: workersList,
        subscription: {
          status: owner.status,
          trial_sales_used: owner.trialSalesUsed,
          trial_sales_limit: owner.trialSalesLimit,
          max_workers_allowed: owner.maxWorkersAllowed,
        },
      },
    };
  }

  // ─── الرسائل والإعلانات (Broadcasts Pull & Ack) ──────────────────────────

  async pullBroadcasts(user: AuthenticatedUser, dto: PullBroadcastsDto) {
    const device = await this.prisma.device.findUnique({
      where: { deviceFingerprint: dto.deviceFingerprint },
    });
    if (!device) return [];

    const owner = await this.prisma.storeOwner.findUnique({
      where: { id: user.storeOwnerId! },
      select: { status: true },
    });
    const status = owner?.status ?? 'ACTIVE';

    const now = new Date();
    const ackedBroadcastIds = (
      await this.prisma.broadcastAck.findMany({
        where: { deviceId: device.id, ackType: BroadcastAckType.VIEW },
        select: { broadcastId: true },
      })
    ).map((a) => a.broadcastId);

    const broadcasts = await this.prisma.broadcast.findMany({
      where: {
        isActive: true,
        id: { notIn: ackedBroadcastIds },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { createdAt: 'desc' },
    });

    // فلترة المستهدفين
    const matched = broadcasts.filter((b) => {
      if (b.targetType === 'ALL') return true;
      if (b.targetType === 'SPECIFIC_DEVICE') return b.targetDeviceId === device.id;
      if (b.targetType === 'TRIAL') return status === 'TRIAL' || status === 'TRIAL_WARNING';
      if (b.targetType === 'ACTIVE') return status === 'ACTIVE';
      if (b.targetType === 'EXPIRED')
        return status === 'TRIAL_EXPIRED' || status === 'EXPIRED' || status === 'SUSPENDED';
      return false;
    });

    return matched.map((b) => ({
      id: b.id,
      type: b.type,
      title: b.title,
      body: b.body,
      image_url: b.imageUrl,
      button_text: b.buttonText,
      button_url: b.buttonUrl,
      priority: b.priority,
      dismissible: b.dismissible,
      discount_code: b.discountCode,
      discount_percent_text: b.discountPercentText,
      expires_at: b.expiresAt,
    }));
  }

  async ackBroadcast(user: AuthenticatedUser, broadcastId: string, dto: AckBroadcastDto) {
    const device = await this.prisma.device.findUnique({
      where: { deviceFingerprint: dto.deviceFingerprint },
    });
    if (!device) throw ApiError.notFound('الجهاز غير موجود.');

    const broadcast = await this.prisma.broadcast.findUnique({
      where: { id: broadcastId },
    });
    if (!broadcast) throw ApiError.notFound('الرسالة غير موجودة.');

    await this.prisma.$transaction(async (tx) => {
      await tx.broadcastAck.create({
        data: {
          broadcastId,
          deviceId: device.id,
          storeOwnerId: user.storeOwnerId,
          ackType: dto.ackType,
        },
      });

      if (dto.ackType === BroadcastAckType.VIEW) {
        await tx.broadcast.update({
          where: { id: broadcastId },
          data: { viewsCount: { increment: 1 } },
        });
      } else if (dto.ackType === BroadcastAckType.CLICK) {
        await tx.broadcast.update({
          where: { id: broadcastId },
          data: { clicksCount: { increment: 1 } },
        });
      }
    });

    return { acked: true };
  }
}
