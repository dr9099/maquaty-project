import { Injectable } from '@nestjs/common';
import { Prisma, WorkerStatus } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import { CreateWorkerDto, UpdateWorkerDto } from './dto/workers.dto';

// إدارة العمال — API_SPEC القسم 2 (حصري للمالك) + R-33 (موافقات) + R-11 (المسؤول الوحيد)
@Injectable()
export class WorkersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(storeOwnerId: string) {
    const workers = await this.prisma.worker.findMany({
      where: { storeOwnerId, status: { not: WorkerStatus.DELETED } },
      orderBy: { createdAt: 'asc' },
    });
    return workers.map(serializeWorker);
  }

  async create(storeOwnerId: string, dto: CreateWorkerDto, ip?: string) {
    if (dto.password !== dto.passwordConfirmation) {
      throw ApiError.badRequest('PASSWORD_MISMATCH', 'كلمتا المرور غير متطابقتين.');
    }
    await this.assertPhoneAvailable(dto.phone);

    const created = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // R-33: العامل العادي يتطلب رصيد موافقات — الموقوف يُحتسب والمحذوف يفتح مكاناً؛ المسؤول لا يُحتسب
      if (!dto.isResponsible) {
        const owner = await tx.storeOwner.findUniqueOrThrow({
          where: { id: storeOwnerId },
          select: { maxWorkersAllowed: true },
        });
        const normalCount = await tx.worker.count({
          where: {
            storeOwnerId,
            isResponsible: false,
            status: { in: [WorkerStatus.ACTIVE, WorkerStatus.SUSPENDED] },
          },
        });
        if (normalCount >= owner.maxWorkersAllowed) {
          throw ApiError.forbidden(
            'WORKER_LIMIT_REACHED',
            'لا يوجد رصيد موافقات لإضافة عامل عادي. تواصل مع مالك التطبيق (735717710) لمنح رصيد.',
          );
        }
      }

      // إنشاء مع مسؤول مباشر: نقل الصفة ذرّياً عن وجود مسؤول قائم
      if (dto.isResponsible) {
        await this.transferResponsibility(tx, storeOwnerId, null, dto.confirmReplace ?? false);
      }

      return tx.worker.create({
        data: {
          storeOwnerId,
          fullName: dto.fullName,
          phone: dto.phone,
          passwordHash: await hash(dto.password),
          // الافتراضيات المعتمدة (R-10): التالف والسلفة مفعّلة والباقي معطّل
          permDamagedGoodsEntry: dto.permissions?.damagedGoodsEntry ?? true,
          permShowCostPrice: dto.permissions?.showCostPrice ?? false,
          permShowSellPricesInventory: dto.permissions?.showSellPricesInventory ?? false,
          permReportsAccess: dto.permissions?.reportsAccess ?? false,
          permEnterOwnAdvance: dto.permissions?.enterOwnAdvance ?? true,
          isResponsible: dto.isResponsible ?? false,
        },
      });
    });

    await this.audit.log({
      actorType: 'STORE_OWNER',
      actorId: storeOwnerId,
      actionType: 'WORKER_CREATE',
      targetType: 'worker',
      targetId: created.id,
      newValue: { phone: created.phone, is_responsible: created.isResponsible },
      ipAddress: ip,
      result: 'SUCCESS',
    });
    return serializeWorker(created);
  }

  async getOne(storeOwnerId: string, id: string) {
    const worker = await this.mustGetOwned(storeOwnerId, id);
    return serializeWorker(worker);
  }

  async update(storeOwnerId: string, id: string, dto: UpdateWorkerDto, ip?: string) {
    const worker = await this.mustGetOwned(storeOwnerId, id);
    if (dto.phone && dto.phone !== worker.phone) {
      await this.assertPhoneAvailable(dto.phone);
    }
    const updated = await this.prisma.worker.update({
      where: { id },
      data: {
        ...(dto.fullName !== undefined ? { fullName: dto.fullName } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.permissions !== undefined
          ? {
              permShowCostPrice: dto.permissions.showCostPrice ?? worker.permShowCostPrice,
              permShowSellPricesInventory: dto.permissions.showSellPricesInventory ?? worker.permShowSellPricesInventory,
              permDamagedGoodsEntry: dto.permissions.damagedGoodsEntry ?? worker.permDamagedGoodsEntry,
              permReportsAccess: dto.permissions.reportsAccess ?? worker.permReportsAccess,
              permEnterOwnAdvance: dto.permissions.enterOwnAdvance ?? worker.permEnterOwnAdvance,
            }
          : {}),
      },
    });
    await this.audit.log({
      actorType: 'STORE_OWNER',
      actorId: storeOwnerId,
      actionType: 'WORKER_UPDATE',
      targetType: 'worker',
      targetId: id,
      oldValue: { permissions: permissionsOf(worker) },
      newValue: { permissions: permissionsOf(updated) },
      ipAddress: ip,
      result: 'SUCCESS',
    });
    return serializeWorker(updated);
  }

  async changePassword(storeOwnerId: string, id: string, newPassword: string, confirmation: string, ip?: string) {
    await this.mustGetOwned(storeOwnerId, id);
    if (newPassword !== confirmation) {
      throw ApiError.badRequest('PASSWORD_MISMATCH', 'كلمتا المرور غير متطابقتين.');
    }
    await this.prisma.worker.update({
      where: { id },
      data: { passwordHash: await hash(newPassword) },
    });
    await this.revokeSessions(id);
    await this.audit.log({
      actorType: 'STORE_OWNER',
      actorId: storeOwnerId,
      actionType: 'WORKER_PASSWORD_CHANGE',
      targetType: 'worker',
      targetId: id,
      ipAddress: ip,
      result: 'SUCCESS',
    });
    return { password_changed: true as const };
  }

  async suspend(storeOwnerId: string, id: string, suspended: boolean, ip?: string) {
    const worker = await this.mustGetOwned(storeOwnerId, id);
    if (worker.status === WorkerStatus.DELETED) {
      throw ApiError.conflict('VALIDATION_ERROR', 'لا يمكن إيقاف حساب محذوف.');
    }
    const updated = await this.prisma.worker.update({
      where: { id },
      data: suspended
        ? {
            status: WorkerStatus.SUSPENDED,
            suspendedManuallyBeforeOwnerLock: true, // R-23: يبقى موقوفاً حتى بعد تجديد الاشتراك
          }
        : {
            status: WorkerStatus.ACTIVE,
            suspendedManuallyBeforeOwnerLock: false,
          },
    });
    if (suspended) {
      await this.revokeSessions(id); // إبطال فوري — لا تبقى جلسة سارية رغم الإيقاف (13-auth §1.4)
    }
    await this.audit.log({
      actorType: 'STORE_OWNER',
      actorId: storeOwnerId,
      actionType: suspended ? 'WORKER_SUSPEND' : 'WORKER_UNSUSPEND',
      targetType: 'worker',
      targetId: id,
      ipAddress: ip,
      result: 'SUCCESS',
    });
    return serializeWorker(updated);
  }

  // حذف Soft — يحرر رصيد الموافقة فوراً (R-33) وتبقى سجلاته المحاسبية كاملة (BR-036)
  async remove(storeOwnerId: string, id: string, ip?: string) {
    await this.mustGetOwned(storeOwnerId, id);
    await this.prisma.worker.update({
      where: { id },
      data: { status: WorkerStatus.DELETED, deletedAt: new Date() },
    });
    await this.revokeSessions(id);
    await this.audit.log({
      actorType: 'STORE_OWNER',
      actorId: storeOwnerId,
      actionType: 'WORKER_DELETE',
      targetType: 'worker',
      targetId: id,
      ipAddress: ip,
      result: 'SUCCESS',
    });
    return { deleted: true as const };
  }

  // R-11: ترقية المسؤول — تأكيد صريح ينقل الصفة ذرّياً عند وجود مسؤول قائم
  async promoteResponsible(storeOwnerId: string, id: string, confirmReplace: boolean, ip?: string) {
    const target = await this.mustGetOwned(storeOwnerId, id);
    if (target.status === WorkerStatus.DELETED) {
      throw ApiError.conflict('VALIDATION_ERROR', 'لا يمكن ترقية حساب محذوف.');
    }
    const updated = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await this.transferResponsibility(tx, storeOwnerId, id, confirmReplace);
      return tx.worker.update({ where: { id }, data: { isResponsible: true } });
    });
    await this.audit.log({
      actorType: 'STORE_OWNER',
      actorId: storeOwnerId,
      actionType: 'WORKER_PROMOTE_RESPONSIBLE',
      targetType: 'worker',
      targetId: id,
      newValue: { confirm_replace: confirmReplace },
      ipAddress: ip,
      result: 'SUCCESS',
    });
    return serializeWorker(updated);
  }

  async demoteResponsible(storeOwnerId: string, id: string, ip?: string) {
    await this.mustGetOwned(storeOwnerId, id);
    const updated = await this.prisma.worker.update({
      where: { id },
      data: { isResponsible: false },
    });
    // BR-070: السحب يسري فوراً — AccountStatusGuard يقرأ الصفة من قاعدة البيانات عند كل طلب
    await this.audit.log({
      actorType: 'STORE_OWNER',
      actorId: storeOwnerId,
      actionType: 'WORKER_DEMOTE_RESPONSIBLE',
      targetType: 'worker',
      targetId: id,
      ipAddress: ip,
      result: 'SUCCESS',
    });
    return serializeWorker(updated);
  }

  // ─── العمال المدارين (MANAGED_WORKERS — حصري للعامل المسؤول، اطلاع فقط R-11) ──

  async managedList(storeOwnerId: string) {
    const workers = await this.prisma.worker.findMany({
      where: { storeOwnerId, status: { in: [WorkerStatus.ACTIVE, WorkerStatus.SUSPENDED] } },
      orderBy: { createdAt: 'asc' },
    });
    return workers.map((w) => ({
      id: w.id,
      full_name: w.fullName,
      phone: w.phone,
      status: w.status,
      is_responsible: w.isResponsible,
    }));
  }

  async managedSalesSummary(storeOwnerId: string, workerId: string, date?: string) {
    const worker = await this.prisma.worker.findFirst({
      where: { id: workerId, storeOwnerId, status: { not: WorkerStatus.DELETED } },
    });
    if (!worker) throw ApiError.notFound('العامل غير موجود.');

    const day = date ? new Date(date) : new Date();
    const start = new Date(day); start.setHours(0, 0, 0, 0);
    const end = new Date(day); end.setHours(23, 59, 59, 999);

    const rows = await this.prisma.sale.groupBy({
      by: ['itemId'],
      where: { storeOwnerId, workerId, soldAt: { gte: start, lt: end } },
      _sum: { amount: true, quantity: true },
      _count: { _all: true },
    });
    const items = await this.prisma.item.findMany({
      where: { id: { in: rows.map((r) => r.itemId) } },
      select: { id: true, name: true, unit: true },
    });
    const nameById = new Map(items.map((i) => [i.id, i]));
    const lines = rows.map((r) => ({
      item_id: r.itemId,
      name: nameById.get(r.itemId)?.name ?? '',
      unit: nameById.get(r.itemId)?.unit ?? '',
      total_quantity: r._sum.quantity ?? new Prisma.Decimal(0),
      total_amount: r._sum.amount ?? new Prisma.Decimal(0),
      operations: r._count._all,
    }));
    const total = lines.reduce((s, l) => s.add(l.total_amount), new Prisma.Decimal(0)).toDecimalPlaces(2);
    return { worker_id: workerId, worker_name: worker.fullName, items: lines, total };
  }

  // ─── أدوات داخلية ───────────────────────────────────────────────────────

  private async mustGetOwned(storeOwnerId: string, id: string) {
    const worker = await this.prisma.worker.findFirst({
      where: { id, storeOwnerId }, // فحص الملكية — وإلا 404 (13-auth §2.2)
    });
    if (!worker || worker.status === WorkerStatus.DELETED) throw ApiError.notFound('العامل غير موجود.');
    return worker;
  }

  private async assertPhoneAvailable(phone: string) {
    const owner = await this.prisma.storeOwner.findFirst({ where: { phone, deletedAt: null } });
    const worker = await this.prisma.worker.findUnique({ where: { phone } });
    if (owner || worker) {
      throw ApiError.conflict('PHONE_ALREADY_EXISTS', 'رقم الهاتف مستخدم مسبقاً.');
    }
  }

  // نقل/تفريغ صفة المسؤول ضمن معاملة — بقفل صفوف عمال المتجر لمنع ترقيتين متزامنتين
  private async transferResponsibility(
    tx: Prisma.TransactionClient,
    storeOwnerId: string,
    newResponsibleId: string | null,
    confirmReplace: boolean,
  ): Promise<void> {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM workers WHERE store_owner_id = ${storeOwnerId}::uuid FOR UPDATE`);
    const current = await tx.worker.findFirst({
      where: { storeOwnerId, isResponsible: true, status: { not: WorkerStatus.DELETED } },
    });
    if (current && current.id !== newResponsibleId) {
      if (!confirmReplace) {
        throw ApiError.conflict(
          'RESPONSIBLE_WORKER_EXISTS',
          'يوجد عامل مسؤول حالياً — التأكيد مطلوب لنقل الصفة إليه.',
          { current_responsible: serializeWorker(current) },
        );
      }
      await tx.worker.update({ where: { id: current.id }, data: { isResponsible: false } });
    }
  }

  private async revokeSessions(workerId: string) {
    await this.prisma.refreshSession.updateMany({
      where: { userType: 'WORKER', userId: workerId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

type WorkerRow = {
  id: string; fullName: string; phone: string; status: WorkerStatus;
  isResponsible: boolean; lastLoginAt: Date | null;
  permShowCostPrice: boolean; permShowSellPricesInventory: boolean;
  permDamagedGoodsEntry: boolean; permReportsAccess: boolean; permEnterOwnAdvance: boolean;
};

function permissionsOf(w: WorkerRow) {
  return {
    show_cost_price: w.permShowCostPrice,
    show_sell_prices_inventory: w.permShowSellPricesInventory,
    damaged_goods_entry: w.permDamagedGoodsEntry,
    reports_access: w.permReportsAccess,
    enter_own_advance: w.permEnterOwnAdvance,
  };
}

function serializeWorker(w: WorkerRow) {
  return {
    id: w.id,
    full_name: w.fullName,
    phone: w.phone,
    status: w.status,
    is_responsible: w.isResponsible,
    permissions: permissionsOf(w),
    last_login_at: w.lastLoginAt,
  };
}
