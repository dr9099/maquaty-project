import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import { assertValidQuantityForUnit } from '../common/unit-validation';
import { formatQuantityDisplay } from '../common/quantity-formatter';
import { AuthenticatedUser } from '../common/types';
import { RecordDamagedGoodsDto } from './dto/damaged-goods.dto';

// خدمة التالف — API_SPEC القسم 6 / BR-013..017
@Injectable()
export class DamagedGoodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
    private readonly audit: AuditService,
  ) {}

  async record(user: AuthenticatedUser, dto: RecordDamagedGoodsDto, ip?: string) {
    const storeOwnerId = user.storeOwnerId!;

    const isUuid = (val?: string) =>
      typeof val === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(val);
    const candidateDamageId = isUuid(dto.id) ? dto.id : isUuid(dto.clientOpId) ? dto.clientOpId : undefined;

    if (candidateDamageId) {
      const existingDamage = await this.prisma.damagedGood.findFirst({
        where: { id: candidateDamageId, storeOwnerId },
        include: { item: { select: { unit: true } } },
      });
      if (existingDamage) {
        return {
          id: existingDamage.id,
          item_id: existingDamage.itemId,
          quantity: Number(existingDamage.quantity),
          quantity_display: formatQuantityDisplay(existingDamage.quantity, existingDamage.item?.unit),
          is_damaged: existingDamage.isDamaged,
          reason: existingDamage.reason,
          photo_url: existingDamage.photoUrl,
          recorded_at: existingDamage.recordedAt,
        };
      }
    }

    // 1) فحص صلاحية العامل (BR-016)
    if (user.role === 'WORKER') {
      const worker = await this.prisma.worker.findUniqueOrThrow({
        where: { id: user.workerId! },
        select: { permDamagedGoodsEntry: true },
      });
      if (!worker.permDamagedGoodsEntry) {
        throw ApiError.forbidden('PERMISSION_DENIED', 'ليس لديك صلاحية تسجيل التالف.');
      }
    }

    // 2) التحقق من السبب والصورة عند isDamaged=true (BR-014)
    if (dto.isDamaged) {
      if (!dto.reason || dto.reason.trim() === '') {
        throw ApiError.badRequest('VALIDATION_ERROR', 'سبب التلف إلزامي عند تأكيد التلف.');
      }
      if (!dto.photoUrl || dto.photoUrl.trim() === '') {
        throw ApiError.badRequest('VALIDATION_ERROR', 'صورة التلف إلزامية عند تأكيد التلف.');
      }
    }

    const requestedQuantity = new Prisma.Decimal(dto.quantity);
    if (requestedQuantity.lte(0)) {
      throw ApiError.badRequest('VALIDATION_ERROR', 'الكمية التالفة يجب أن تكون أكبر من صفر.');
    }

    // المعاملة الذرّية: قفل صف الصنف + خصم المخزون + قيد المحاسبة (R-17 / BR-073)
    return this.prisma.$transaction(async (tx) => {
      const lockedItems = await tx.$queryRaw<
        Array<{ id: string; unit: string; quantity: Prisma.Decimal; cost_price: Prisma.Decimal; deleted_at: Date | null }>
      >(
        Prisma.sql`SELECT id, unit, quantity, cost_price, deleted_at FROM items
                   WHERE id = ${dto.itemId}::uuid AND store_owner_id = ${storeOwnerId}::uuid FOR UPDATE`,
      );

      const item = lockedItems[0];
      if (!item || item.deleted_at) throw ApiError.notFound('الصنف غير موجود.');

      assertValidQuantityForUnit(item.unit, requestedQuantity);

      if (requestedQuantity.gt(item.quantity)) {
        throw ApiError.conflict('INSUFFICIENT_STOCK', 'الكمية التالفة تتجاوز المخزون المتوفر.', {
          available: item.quantity.toString(),
        });
      }

      // خصم الكمية من المخزون فوراً (BR-013)
      await tx.item.update({
        where: { id: dto.itemId },
        data: { quantity: { decrement: requestedQuantity } },
      });

      const created = await tx.damagedGood.create({
        data: {
          ...(candidateDamageId ? { id: candidateDamageId } : {}),
          storeOwnerId,
          workerId: user.role === 'WORKER' ? user.workerId : null,
          itemId: dto.itemId,
          quantity: requestedQuantity,
          isDamaged: dto.isDamaged,
          reason: dto.isDamaged ? dto.reason!.trim() : null,
          photoUrl: dto.isDamaged ? dto.photoUrl!.trim() : null,
          recordedAt: new Date(),
        },
      });

      // قيد محاسبي إذا كان تالفاً فعلياً: مدين مصروف التالف (5400) ودائن المخزون (1300) بسعر التكلفة
      if (dto.isDamaged) {
        const costAmount = round2(requestedQuantity.mul(item.cost_price).toNumber());
        if (costAmount > 0) {
          await this.accounting.createBalancedEntries(tx, {
            storeOwnerId,
            entryDate: new Date(),
            referenceType: 'DAMAGED_GOODS',
            referenceId: created.id,
            lines: [
              { accountCode: '5400', debit: costAmount, description: `مصروف تالف: ${dto.reason}` },
              { accountCode: '1300', credit: costAmount, description: 'خصم المخزون للتلف' },
            ],
          });
        }
      }

      await this.audit.log({
        actorType: user.role === 'WORKER' ? 'WORKER' : 'STORE_OWNER',
        actorId: user.role === 'WORKER' ? user.workerId! : user.storeOwnerId!,
        actionType: 'DAMAGED_GOODS_RECORD',
        targetType: 'damaged_good',
        targetId: created.id,
        newValue: { item_id: dto.itemId, quantity: dto.quantity, is_damaged: dto.isDamaged },
        ipAddress: ip,
        result: 'SUCCESS',
      });

      return {
        id: created.id,
        item_id: created.itemId,
        quantity: Number(created.quantity),
        quantity_display: formatQuantityDisplay(created.quantity, item.unit),
        is_damaged: created.isDamaged,
        reason: created.reason,
        photo_url: created.photoUrl,
        recorded_at: created.recordedAt,
      };
    });
  }

  // تقرير التالف — حصري للمالك (BR-017)
  async report(storeOwnerId: string, dateStr?: string) {
    const where: Prisma.DamagedGoodWhereInput = { storeOwnerId };
    if (dateStr) {
      const date = new Date(dateStr);
      const nextDay = new Date(date.getTime() + 24 * 60 * 60 * 1000);
      where.recordedAt = { gte: date, lt: nextDay };
    }

    const records = await this.prisma.damagedGood.findMany({
      where,
      include: {
        item: { select: { name: true, unit: true, costPrice: true } },
        worker: { select: { fullName: true } },
      },
      orderBy: { recordedAt: 'desc' },
    });

    let totalCost = 0;
    let totalQty = 0;

    const list = records.map((r) => {
      const qty = Number(r.quantity);
      const cost = round2(qty * Number(r.item.costPrice));
      totalQty += qty;
      totalCost += cost;
      return {
        id: r.id,
        item_name: r.item.name,
        unit: r.item.unit,
        quantity: qty,
        quantity_display: formatQuantityDisplay(r.quantity, r.item.unit),
        cost_amount: cost,
        is_damaged: r.isDamaged,
        reason: r.reason,
        photo_url: r.photoUrl,
        recorded_by: r.worker?.fullName ?? 'المالك',
        recorded_at: r.recordedAt,
      };
    });

    return {
      total_quantity: totalQty,
      total_cost: round2(totalCost),
      records: list,
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
