import { Injectable } from '@nestjs/common';
import {
  BroadcastAckType,
  DeviceStatus,
  RejectionReasonCode,
  SyncOpStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SalesService } from '../sales/sales.service';
import { CreditService } from '../credit/credit.service';
import { DamagedGoodsService } from '../damaged-goods/damaged-goods.service';
import { ExpensesService } from '../expenses/expenses.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import { PurchasesService } from '../purchases/purchases.service';
import { ReportsService } from '../reports/reports.service';
import { CURRENCY_METADATA } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import { AuthenticatedUser } from '../common/types';
import { AckBroadcastDto, DeviceSyncDto, PullBroadcastsDto } from './dto/sync.dto';

// خدمة المزامنة المركزية — API_SPEC القسم 14 / R-26 / R-30 / D-04
@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sales: SalesService,
    private readonly credit: CreditService,
    private readonly damagedGoods: DamagedGoodsService,
    private readonly expenses: ExpensesService,
    private readonly suppliers: SuppliersService,
    private readonly purchases: PurchasesService,
    private readonly reports: ReportsService,
    private readonly audit: AuditService,
  ) { }

  async sync(user: AuthenticatedUser, dto: DeviceSyncDto, ip?: string) {
    const storeOwnerId = user.storeOwnerId!;

    // جلب إعدادات المالك الحية للتحقق من صلاحية المشتريات للعامل المسؤول
    const owner = await this.prisma.storeOwner.findUniqueOrThrow({
      where: { id: storeOwnerId },
      select: {
        status: true,
        trialSalesUsed: true,
        trialSalesLimit: true,
        maxWorkersAllowed: true,
        currency: true,
        defaultCostingMethod: true,
        allowResponsiblePurchases: true,
      },
    });

    let isResponsibleWorker = Boolean(user.isResponsible);
    let permShowCostPrice = false;
    let permDamagedGoodsEntry = false;
    if (user.role === 'WORKER' && user.workerId) {
      const liveWorker = await this.prisma.worker.findUnique({
        where: { id: user.workerId },
        select: {
          isResponsible: true,
          permShowCostPrice: true,
          permDamagedGoodsEntry: true,
        },
      });
      isResponsibleWorker = Boolean(liveWorker?.isResponsible);
      permShowCostPrice = Boolean(liveWorker?.permShowCostPrice);
      permDamagedGoodsEntry = Boolean(liveWorker?.permDamagedGoodsEntry);
    }

    const isOwner = user.role === 'STORE_OWNER';
    const canManagePurchases =
      isOwner || (user.role === 'WORKER' && isResponsibleWorker && owner.allowResponsiblePurchases);
    const canSeeCostPrice = canManagePurchases || permShowCostPrice;

    // 1) التحقق من سلامة البصمة وفحص حالة الجهاز وتحديث بيانات الظهور
    if (
      !dto.deviceFingerprint ||
      dto.deviceFingerprint.trim() === 'APP-DEVICE-DEFAULT' ||
      dto.deviceFingerprint.trim().length < 8
    ) {
      throw ApiError.badRequest(
        'INVALID_DEVICE_FINGERPRINT',
        'بصمة الجهاز غير صالحة أو غير مسموح بها. يجب ألا تقل عن 8 خانات وألا تكون قيمة عامة افتراضية.',
      );
    }

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
        const payloadWithClientOp: Record<string, any> = {
          ...(op.payload ?? {}),
          clientOpId: op.clientOpId,
        };
        // حماية حصة التجربة وعزل المستأجر: لا يُسمح للعميل بتمرير حقول تحكم خادميّة داخل payload المزامنة
        delete payloadWithClientOp.trialSalesLimit;
        delete payloadWithClientOp.trialSalesUsed;
        delete payloadWithClientOp.trial_sales_limit;
        delete payloadWithClientOp.trial_sales_used;
        delete payloadWithClientOp.storeOwnerId;
        delete payloadWithClientOp.store_owner_id;
        delete payloadWithClientOp.status;
        if (op.opType === 'SALE') {
          await this.sales.create(user, payloadWithClientOp as any);
        } else if (op.opType === 'CREDIT_PAYMENT') {
          if (user.role === 'WORKER' && !isResponsibleWorker) {
            throw ApiError.forbidden('PERMISSION_DENIED', 'ليس لديك صلاحية تسجيل دفعات الآجل (مخصصة للمسؤول أو المالك).');
          }
          const customerId =
            payloadWithClientOp.customerId ?? payloadWithClientOp.creditCustomerId;
          await this.credit.recordPayment(user, customerId, payloadWithClientOp as any, ip);
        } else if (op.opType === 'DAMAGED_GOODS') {
          if (user.role === 'WORKER' && !permDamagedGoodsEntry) {
            throw ApiError.forbidden('PERMISSION_DENIED', 'ليس لديك صلاحية تسجيل التالف.');
          }
          await this.damagedGoods.record(user, payloadWithClientOp as any, ip);
        } else if (op.opType === 'WORKER_ADVANCE') {
          await this.expenses.recordWorkerAdvance(user, op.payload as any);
        } else if (op.opType === 'SUPPLIER_CREATE') {
          if (!canManagePurchases) {
            throw ApiError.forbidden('PERMISSION_DENIED', 'ليس لديك صلاحية إدارة الموردين.');
          }
          await this.suppliers.create(user, payloadWithClientOp as any, ip);
        } else if (op.opType === 'PURCHASE') {
          if (user.role === 'WORKER' && !(isResponsibleWorker && owner.allowResponsiblePurchases)) {
            throw ApiError.forbidden('PERMISSION_DENIED', 'ليس لديك صلاحية تسجيل فواتير الشراء.');
          }
          if (!canManagePurchases) {
            throw ApiError.forbidden('PERMISSION_DENIED', 'ليس لديك صلاحية تسجيل فواتير الشراء.');
          }
          await this.purchases.create(user, payloadWithClientOp as any, ip);
        } else if (op.opType === 'SUPPLIER_PAYMENT') {
          if (!canManagePurchases) {
            throw ApiError.forbidden('PERMISSION_DENIED', 'ليس لديك صلاحية سداد الموردين.');
          }
          await this.suppliers.recordPayment(
            user,
            payloadWithClientOp.supplierId,
            payloadWithClientOp as any,
            ip,
          );
        } else if (op.opType === 'PURCHASE_RETURN') {
          if (user.role === 'WORKER' && !(isResponsibleWorker && owner.allowResponsiblePurchases)) {
            throw ApiError.forbidden('PERMISSION_DENIED', 'ليس لديك صلاحية تسجيل مرتجعات المشتريات.');
          }
          if (!canManagePurchases) {
            throw ApiError.forbidden('PERMISSION_DENIED', 'ليس لديك صلاحية تسجيل مرتجعات المشتريات.');
          }
          await this.purchases.createReturn(
            user,
            payloadWithClientOp.purchaseInvoiceId,
            payloadWithClientOp as any,
            ip,
          );
        } else if (op.opType === 'OWNER_TRANSACTION') {
          if (!isOwner) {
            throw ApiError.forbidden('PERMISSION_DENIED', 'إيداعات ومسحوبات المالك حصرية لمالك المتجر.');
          }
          await this.reports.createOwnerTransaction(storeOwnerId, op.payload as any, ip);
        } else if (op.opType === 'EXPENSE') {
          if (!isOwner) {
            throw ApiError.forbidden('PERMISSION_DENIED', 'تسجيل مصروفات المتجر حصري لمالك المتجر.');
          }
          await this.expenses.createUnifiedExpense(user, op.payload as any, ip);
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

    // 4) جلب تحديثات الخادم (Delta / Server Updates مع حدود أداء التخزين المحلي D-04)
    const totalItemsCount = await this.prisma.item.count({
      where: { storeOwnerId, deletedAt: null },
    });
    const cacheLimit = totalItemsCount > 50_000 ? 5_000 : 20_000;

    const items = await this.prisma.item.findMany({
      where: { storeOwnerId, deletedAt: null },
      orderBy: [{ entryDate: 'desc' }, { updatedAt: 'desc' }],
      take: cacheLimit,
    });

    const serverItems = items.map((i) => ({
      id: i.id,
      name: i.name,
      unit: i.unit,
      quantity: Number(i.quantity),
      sell_price: Number(i.sellPrice),
      cost_price: canSeeCostPrice ? Number(i.costPrice) : undefined, // حماية سعر التكلفة لغير المخوّل
      emergency_price_mode: i.emergencyPriceMode,
      emergency_price_plus_fixed: i.emergencyPricePlusFixed ? Number(i.emergencyPricePlusFixed) : null,
      emergency_price_plus_percent: i.emergencyPricePlusPercent ? Number(i.emergencyPricePlusPercent) : null,
      emergency_price_min: i.emergencyPriceMin ? Number(i.emergencyPriceMin) : null,
      emergency_price_max: i.emergencyPriceMax ? Number(i.emergencyPriceMax) : null,
      updated_at: i.updatedAt,
    }));

    let workersList: any[] | undefined = undefined;
    if (isOwner || isResponsibleWorker) {
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

    let suppliersList: any[] | undefined = undefined;
    let recentPurchasesList: any[] | undefined = undefined;
    if (canManagePurchases) {
      const [suppliers, recentPurchases] = await Promise.all([
        this.prisma.supplier.findMany({
          where: { storeOwnerId, deletedAt: null },
          orderBy: { updatedAt: 'desc' },
          take: 200,
        }),
        this.prisma.purchaseInvoice.findMany({
          where: { storeOwnerId },
          orderBy: { updatedAt: 'desc' },
          take: 100,
          select: {
            id: true,
            invoiceNumber: true,
            supplierId: true,
            invoiceDate: true,
            paymentType: true,
            totalAmount: true,
            paidAmount: true,
            remainingAmount: true,
            status: true,
            costingMethodUsed: true,
            updatedAt: true,
          },
        }),
      ]);
      suppliersList = suppliers.map((s) => ({
        id: s.id,
        name: s.name,
        phone: s.phone,
        current_balance: Number(s.currentBalance),
        status: s.status,
        updated_at: s.updatedAt,
      }));
      recentPurchasesList = recentPurchases.map((p) => ({
        id: p.id,
        invoice_number: p.invoiceNumber,
        supplier_id: p.supplierId,
        invoice_date: p.invoiceDate,
        payment_type: p.paymentType,
        total_amount: Number(p.totalAmount),
        paid_amount: Number(p.paidAmount),
        remaining_amount: Number(p.remainingAmount),
        status: p.status,
        costing_method_used: p.costingMethodUsed,
        updated_at: p.updatedAt,
      }));
    }

    // Re-read status/trial counters after any SALE ops executed above
    const [refreshedOwner, serverCreditCustomers] = await Promise.all([
      this.prisma.storeOwner.findUniqueOrThrow({
        where: { id: storeOwnerId },
        select: {
          status: true,
          trialSalesUsed: true,
          trialSalesLimit: true,
          maxWorkersAllowed: true,
        },
      }),
      this.credit.list(storeOwnerId),
    ]);

    // إعداد أقل نسخة تطبيق مدعومة (إجبار التحديث عن بعد — مع فك غلاف { v } حسب D-06)
    const minAppVersionSetting = await this.prisma.systemSetting.findFirst({
      where: { key: { in: ['min_app_version', 'app_min_version'] } },
    });
    const rawMinVer: unknown = minAppVersionSetting?.value;
    const unwrappedMinVer =
      typeof rawMinVer === 'object' && rawMinVer !== null && 'v' in rawMinVer
        ? (rawMinVer as { v?: unknown }).v
        : rawMinVer;
    const minAppVersion =
      (typeof unwrappedMinVer === 'string' && unwrappedMinVer.trim() !== ''
        ? unwrappedMinVer.trim()
        : undefined) ||
      process.env.MIN_SUPPORTED_APP_VERSION ||
      '1.0.0';

    void this.audit;

    const rejectedOpsList = processedOps.filter((o) => o.status === 'REJECTED');

    return {
      new_sync_version: nextSyncVersion,
      account_status: refreshedOwner.status,
      min_app_version: minAppVersion,
      processed_operations: processedOps,
      rejected_operations: rejectedOpsList,
      rejectedOperations: rejectedOpsList,
      server_updates: {
        items: serverItems,
        workers: workersList,
        credit_customers: serverCreditCustomers,
        ...(canManagePurchases ? { suppliers: suppliersList, purchases: recentPurchasesList } : {}),
        store_settings: {
          currency: owner.currency,
          currency_symbol: CURRENCY_METADATA[owner.currency].symbol,
          allow_responsible_purchases: owner.allowResponsiblePurchases,
          ...(canManagePurchases ? { default_costing_method: owner.defaultCostingMethod } : {}),
        },
        subscription: {
          status: refreshedOwner.status,
          trial_sales_used: refreshedOwner.trialSalesUsed,
          trial_sales_limit: refreshedOwner.trialSalesLimit,
          max_workers_allowed: refreshedOwner.maxWorkersAllowed,
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
