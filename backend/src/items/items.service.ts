import { Injectable, Optional } from '@nestjs/common';
import { EmergencyPriceMode, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { ApiError } from '../common/api-error';
import { assertValidQuantityForUnit } from '../common/unit-validation';
import { formatQuantityDisplay } from '../common/quantity-formatter';
import { COSTING_OPTIONS_AR } from '../settings/settings.service';
import { CreateItemDto, UpdateItemDto } from './dto/items.dto';

// الأصناف — API_SPEC القسم 3 + آلية التكلفة لنفس اليوم وقاعدة القات 24-48 ساعة
@Injectable()
export class ItemsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly accounting?: AccountingService,
  ) {}

  async create(storeOwnerId: string, dto: CreateItemDto) {
    const trimmedName = dto.name.trim();
    const trimmedUnit = dto.unit.trim();
    if (dto.quantity < 0) {
      throw ApiError.badRequest('VALIDATION_ERROR', 'الكمية لا تقبل رقماً سالباً.');
    }
    if (dto.costPrice < 0 || dto.sellPrice < 0) {
      throw ApiError.badRequest('VALIDATION_ERROR', 'الأسعار لا تقبل أرقاماً سالبة.');
    }
    assertValidQuantityForUnit(trimmedUnit, dto.quantity);
    this.validateEmergencyPolicy(
      dto.emergencyPriceMode,
      dto.emergencyPricePlusFixed,
      dto.emergencyPricePlusPercent,
      dto.emergencyPriceMin,
      dto.emergencyPriceMax,
    );
    const entryDate = startOfToday();
    const warnings: string[] = [];
    if (dto.sellPrice < dto.costPrice) {
      // قرار معتمد: تحذير فقط دون رفض (النقطة 8 مغلقة)
      warnings.push('سعر البيع أقل من سعر التكلفة — تأكد أن هذا مقصود.');
    }

    const newQty = Number(dto.quantity);
    const newCost = Number(dto.costPrice);
    const addedInventoryCost = new Prisma.Decimal(newQty)
      .mul(new Prisma.Decimal(newCost))
      .toDecimalPlaces(2);

    // فحص وجود نفس الصنف (الاسم + الوحدة) في نفس اليوم
    const existingSameDay = await this.prisma.item.findFirst({
      where: {
        storeOwnerId,
        deletedAt: null,
        name: trimmedName,
        unit: trimmedUnit,
        entryDate,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existingSameDay) {
      const oldQty = Number(existingSameDay.quantity);
      const oldCost = Number(existingSameDay.costPrice);

      // تعريف الصنف بكمية صفرية دون توريد مخزون
      if (newQty <= 0) {
        const item = await this.prisma.item.update({
          where: { id: existingSameDay.id },
          data: {
            ...(oldQty <= 0 ? { costPrice: new Prisma.Decimal(newCost) } : {}),
            sellPrice: new Prisma.Decimal(dto.sellPrice),
            ...(dto.emergencyPriceMode !== undefined ? { emergencyPriceMode: dto.emergencyPriceMode } : {}),
            ...(dto.emergencyPricePlusFixed !== undefined ? { emergencyPricePlusFixed: dto.emergencyPricePlusFixed } : {}),
            ...(dto.emergencyPricePlusPercent !== undefined ? { emergencyPricePlusPercent: dto.emergencyPricePlusPercent } : {}),
            ...(dto.emergencyPriceMin !== undefined ? { emergencyPriceMin: dto.emergencyPriceMin } : {}),
            ...(dto.emergencyPriceMax !== undefined ? { emergencyPriceMax: dto.emergencyPriceMax } : {}),
          },
        });
        return { item, merged: true, warnings };
      }

      // 1) قاعدة القات (24-48 ساعة / نفاد الكمية = 0): اعتماد السعر الجديد تلقائياً دون نافذة منبثقة
      if (oldQty <= 0) {
        const item = await this.prisma.$transaction(async (tx) => {
          await tx.purchaseItem.updateMany({
            where: { storeOwnerId, itemId: existingSameDay.id, remainingFifoQty: { gt: 0 } },
            data: { remainingFifoQty: new Prisma.Decimal(0) },
          });
          const updated = await tx.item.update({
            where: { id: existingSameDay.id },
            data: {
              quantity: new Prisma.Decimal(newQty),
              costPrice: new Prisma.Decimal(newCost),
              sellPrice: new Prisma.Decimal(dto.sellPrice),
              ...(dto.emergencyPriceMode !== undefined ? { emergencyPriceMode: dto.emergencyPriceMode } : {}),
              ...(dto.emergencyPricePlusFixed !== undefined ? { emergencyPricePlusFixed: dto.emergencyPricePlusFixed } : {}),
              ...(dto.emergencyPricePlusPercent !== undefined ? { emergencyPricePlusPercent: dto.emergencyPricePlusPercent } : {}),
              ...(dto.emergencyPriceMin !== undefined ? { emergencyPriceMin: dto.emergencyPriceMin } : {}),
              ...(dto.emergencyPriceMax !== undefined ? { emergencyPriceMax: dto.emergencyPriceMax } : {}),
            },
          });
          await this.recordDirectStockJournalEntry(tx, {
            storeOwnerId,
            entryDate,
            itemId: updated.id,
            itemName: trimmedName,
            addedCost: addedInventoryCost,
          });
          return updated;
        });
        return { item, merged: true, warnings };
      }

      // 2) نفس سعر التكلفة في نفس اليوم -> دمج تلقائي (BR-003)
      if (Math.abs(oldCost - newCost) < 0.005) {
        const item = await this.prisma.$transaction(async (tx) => {
          const updated = await tx.item.update({
            where: { id: existingSameDay.id },
            data: {
              quantity: { increment: new Prisma.Decimal(newQty) },
              sellPrice: new Prisma.Decimal(dto.sellPrice),
            },
          });
          await this.recordDirectStockJournalEntry(tx, {
            storeOwnerId,
            entryDate,
            itemId: updated.id,
            itemName: trimmedName,
            addedCost: addedInventoryCost,
          });
          return updated;
        });
        return { item, merged: true, warnings };
      }

      // 3) سعر تكلفة مختلف لنفس الصنف في نفس اليوم مع وجود كمية متبقية (> 0)
      const weightedAvg =
        Math.round((((oldQty * oldCost + newQty * newCost) / (oldQty + newQty)) + Number.EPSILON) * 100) / 100;

      if (!dto.costingMethod) {
        throw ApiError.conflict(
          'COSTING_METHOD_REQUIRED',
          `هذا الصنف (${trimmedName}) موجود اليوم بكمية متبقية (${oldQty} ${trimmedUnit}) بسعر شراء (${oldCost}) مختلف عن السعر الجديد (${newCost}). اختر طريقة احتساب التكلفة المناسبة:`,
          {
            conflicts: [
              {
                item_id: existingSameDay.id,
                item_name: trimmedName,
                unit: trimmedUnit,
                existing_quantity: oldQty,
                existing_cost_price: oldCost,
                incoming_quantity: newQty,
                incoming_cost_price: newCost,
                weighted_average_cost: weightedAvg,
              },
            ],
            costing_options: COSTING_OPTIONS_AR,
          },
        );
      }

      let nextCostPrice = oldCost;
      if (dto.costingMethod === 'WEIGHTED_AVERAGE') {
        nextCostPrice = weightedAvg;
      } else if (dto.costingMethod === 'LAST_PRICE') {
        nextCostPrice = newCost;
      } else if (dto.costingMethod === 'FIFO') {
        // بيع الكمية القديمة بسعرها أولاً ثم الجديدة بسعرها
        nextCostPrice = oldCost;
      }

      const item = await this.prisma.$transaction(async (tx) => {
        if (dto.costingMethod === 'WEIGHTED_AVERAGE' || dto.costingMethod === 'LAST_PRICE') {
          await tx.purchaseItem.updateMany({
            where: {
              storeOwnerId,
              itemId: existingSameDay.id,
              remainingFifoQty: { gt: 0 },
            },
            data: { effectiveBaseUnitCost: new Prisma.Decimal(nextCostPrice) },
          });
        }
        const updated = await tx.item.update({
          where: { id: existingSameDay.id },
          data: {
            quantity: { increment: new Prisma.Decimal(newQty) },
            costPrice: new Prisma.Decimal(nextCostPrice),
            sellPrice: new Prisma.Decimal(dto.sellPrice),
            ...(dto.emergencyPriceMode !== undefined ? { emergencyPriceMode: dto.emergencyPriceMode } : {}),
            ...(dto.emergencyPricePlusFixed !== undefined ? { emergencyPricePlusFixed: dto.emergencyPricePlusFixed } : {}),
            ...(dto.emergencyPricePlusPercent !== undefined ? { emergencyPricePlusPercent: dto.emergencyPricePlusPercent } : {}),
            ...(dto.emergencyPriceMin !== undefined ? { emergencyPriceMin: dto.emergencyPriceMin } : {}),
            ...(dto.emergencyPriceMax !== undefined ? { emergencyPriceMax: dto.emergencyPriceMax } : {}),
          },
        });
        await this.recordDirectStockJournalEntry(tx, {
          storeOwnerId,
          entryDate,
          itemId: updated.id,
          itemName: trimmedName,
          addedCost: addedInventoryCost,
        });
        return updated;
      });
      return { item, merged: true, costing_method_used: dto.costingMethod, warnings };
    }

    const defaultMode = dto.emergencyPriceMode ?? (await this.defaultEmergencyMode());
    const item = await this.prisma.$transaction(async (tx) => {
      const created = await tx.item.create({
        data: {
          storeOwnerId,
          name: trimmedName,
          unit: trimmedUnit,
          quantity: dto.quantity,
          costPrice: dto.costPrice,
          sellPrice: dto.sellPrice,
          entryDate,
          emergencyPriceMode: defaultMode,
          emergencyPricePlusFixed: dto.emergencyPricePlusFixed,
          emergencyPricePlusPercent: dto.emergencyPricePlusPercent,
          emergencyPriceMin: dto.emergencyPriceMin,
          emergencyPriceMax: dto.emergencyPriceMax,
        },
      });
      if (newQty > 0) {
        await this.recordDirectStockJournalEntry(tx, {
          storeOwnerId,
          entryDate,
          itemId: created.id,
          itemName: trimmedName,
          addedCost: addedInventoryCost,
        });
      }
      return created;
    });
    return { item, merged: false, warnings };
  }

  private async recordDirectStockJournalEntry(
    tx: Prisma.TransactionClient,
    params: {
      storeOwnerId: string;
      entryDate: Date;
      itemId: string;
      itemName: string;
      addedCost: Prisma.Decimal;
    },
  ) {
    if (!this.accounting || params.addedCost.lte(0)) return;
    const amountNum = params.addedCost.toNumber();
    await this.accounting.createBalancedEntries(tx, {
      storeOwnerId: params.storeOwnerId,
      entryDate: params.entryDate,
      referenceType: 'PURCHASE',
      referenceId: params.itemId,
      lines: [
        {
          accountCode: '1300',
          debit: amountNum,
          description: `توريد مخزون مباشر للصنف (${params.itemName})`,
        },
        {
          accountCode: '3000',
          credit: amountNum,
          description: `تمويل مخزون مباشر للصنف (${params.itemName})`,
        },
      ],
    });
  }

  // جدول أصناف اليوم (ITEMS_MANAGE) — للمالك حصراً
  async listForOwner(storeOwnerId: string, date?: string) {
    const entryDate = date ? parseDate(date) : startOfToday();
    const items = await this.prisma.item.findMany({
      where: { storeOwnerId, deletedAt: null, entryDate },
      orderBy: { createdAt: 'asc' },
    });
    return items.map(toOwnerView);
  }

  // المخزون (INVENTORY) — للمالك: كامل؛ للعامل: حسب الصلاحيات الممنوحة (showSellPrices / showCostPrice)
  async inventory(
    storeOwnerId: string,
    opts: { isWorker: boolean; showSellPrices: boolean; showCostPrice?: boolean },
    search?: string,
    limitParam?: number,
    offsetParam?: number,
  ) {
    const trimmedSearch = search?.trim();
    const take = Math.min(Math.max(limitParam ?? (trimmedSearch ? 20 : 100), 1), 200);
    const skip = Math.max(offsetParam ?? 0, 0);

    const items = await this.prisma.item.findMany({
      where: {
        storeOwnerId,
        deletedAt: null,
        entryDate: startOfToday(),
        ...(trimmedSearch ? { name: { contains: trimmedSearch, mode: 'insensitive' } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take,
      skip,
    });

    return items.map((it) => {
      let emergMin: number | null = null;
      let emergMax: number | null = null;
      if (it.emergencyPriceMode === 'COST_ONLY') {
        emergMin = Number(it.costPrice);
        emergMax = Number(it.costPrice);
      } else if (it.emergencyPriceMode === 'COST_PLUS') {
        const fixed = it.emergencyPricePlusFixed;
        const percent = it.emergencyPricePlusPercent;
        const margin = fixed !== null
          ? fixed
          : it.costPrice.mul(percent ?? 0).div(100).toDecimalPlaces(2);
        emergMin = Number(it.costPrice.add(margin));
        emergMax = null;
      } else if (it.emergencyPriceMode === 'RANGE_OR_OPEN') {
        emergMin = it.emergencyPriceMin !== null ? Number(it.emergencyPriceMin) : null;
        emergMax = it.emergencyPriceMax !== null ? Number(it.emergencyPriceMax) : null;
      }

      const base: Record<string, unknown> = {
        item_id: it.id,
        name: it.name,
        unit: it.unit,
        remaining_qty: it.quantity,
        quantity_display: formatQuantityDisplay(it.quantity, it.unit),
        sell_price: it.sellPrice,
        emergency_price_mode: it.emergencyPriceMode,
        emergency_price_plus_fixed: it.emergencyPricePlusFixed,
        emergency_price_plus_percent: it.emergencyPricePlusPercent,
        emergency_price_min: it.emergencyPriceMin,
        emergency_price_max: it.emergencyPriceMax,
        emergency_min_price: emergMin,
        emergency_max_price: emergMax,
      };
      if (!opts.isWorker || opts.showSellPrices) {
        base.remaining_value = mul(it.quantity, it.sellPrice);
      }
      if (!opts.isWorker || opts.showCostPrice) {
        base.cost_price = it.costPrice;
      }
      return base;
    });
  }

  async update(storeOwnerId: string, itemId: string, dto: UpdateItemDto) {
    const item = await this.prisma.item.findFirst({
      where: { id: itemId, storeOwnerId, deletedAt: null },
    });
    if (!item) throw ApiError.notFound('الصنف غير موجود.');

    this.validateEmergencyPolicy(
      dto.emergencyPriceMode ?? item.emergencyPriceMode,
      dto.emergencyPricePlusFixed,
      dto.emergencyPricePlusPercent,
      dto.emergencyPriceMin,
      dto.emergencyPriceMax,
    );

    return this.prisma.item.update({
      where: { id: itemId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.unit !== undefined ? { unit: dto.unit } : {}),
        ...(dto.quantity !== undefined ? { quantity: dto.quantity } : {}),
        ...(dto.costPrice !== undefined ? { costPrice: dto.costPrice } : {}),
        ...(dto.sellPrice !== undefined ? { sellPrice: dto.sellPrice } : {}),
        ...(dto.emergencyPriceMode !== undefined ? { emergencyPriceMode: dto.emergencyPriceMode } : {}),
        ...(dto.emergencyPricePlusFixed !== undefined ? { emergencyPricePlusFixed: dto.emergencyPricePlusFixed } : {}),
        ...(dto.emergencyPricePlusPercent !== undefined ? { emergencyPricePlusPercent: dto.emergencyPricePlusPercent } : {}),
        ...(dto.emergencyPriceMin !== undefined ? { emergencyPriceMin: dto.emergencyPriceMin } : {}),
        ...(dto.emergencyPriceMax !== undefined ? { emergencyPriceMax: dto.emergencyPriceMax } : {}),
      },
    });
  }

  // BR-005: التأكيد قبل الحذف مسؤولية الواجهة (WORKER_DELETE نمط) — الخادم Soft Delete
  async remove(storeOwnerId: string, itemId: string) {
    const item = await this.prisma.item.findFirst({
      where: { id: itemId, storeOwnerId, deletedAt: null },
    });
    if (!item) throw ApiError.notFound('الصنف غير موجود.');
    await this.prisma.item.update({
      where: { id: itemId },
      data: { deletedAt: new Date() },
    });
    return { deleted: true as const };
  }

  private validateEmergencyPolicy(
    mode: EmergencyPriceMode | undefined,
    plusFixed?: number,
    plusPercent?: number,
    min?: number,
    max?: number,
  ) {
    if (mode === 'COST_PLUS' && (plusFixed === undefined || plusFixed === null) && (plusPercent === undefined || plusPercent === null)) {
      throw ApiError.badRequest('VALIDATION_ERROR', 'نمط تكلفة+هامش يتطلب مبلغاً ثابتاً أو نسبة مئوية.');
    }
    if (min !== undefined && max !== undefined && min > max) {
      throw ApiError.badRequest('VALIDATION_ERROR', 'الحد الأدنى لا يمكن أن يزيد عن الحد الأقصى.');
    }
  }

  private async defaultEmergencyMode(): Promise<EmergencyPriceMode> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: 'default_emergency_price_mode' },
    });
    const raw: unknown = setting?.value;
    const value = typeof raw === 'object' && raw !== null ? (raw as { v?: unknown }).v : raw;
    if (value === 'COST_ONLY' || value === 'COST_PLUS' || value === 'RANGE_OR_OPEN') return value;
    return 'RANGE_OR_OPEN';
  }
}

function toOwnerView(it: {
  id: string; name: string; unit: string; quantity: Prisma.Decimal;
  costPrice: Prisma.Decimal; sellPrice: Prisma.Decimal; emergencyPriceMode: string;
  emergencyPricePlusFixed: Prisma.Decimal | null; emergencyPricePlusPercent: Prisma.Decimal | null;
  emergencyPriceMin: Prisma.Decimal | null; emergencyPriceMax: Prisma.Decimal | null;
  entryDate: Date;
}) {
  return {
    id: it.id,
    name: it.name,
    unit: it.unit,
    quantity: it.quantity,
    quantity_display: formatQuantityDisplay(it.quantity, it.unit),
    cost_price: it.costPrice,
    sell_price: it.sellPrice,
    remaining_value: mul(it.quantity, it.sellPrice),
    emergency_price_mode: it.emergencyPriceMode,
    emergency_price_plus_fixed: it.emergencyPricePlusFixed,
    emergency_price_plus_percent: it.emergencyPricePlusPercent,
    emergency_price_min: it.emergencyPriceMin,
    emergency_price_max: it.emergencyPriceMax,
    entry_date: it.entryDate,
  };
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseDate(s: string): Date {
  const d = new Date(s);
  if (isNaN(d.getTime())) throw ApiError.badRequest('VALIDATION_ERROR', 'تاريخ غير صالح.');
  d.setHours(0, 0, 0, 0);
  return d;
}

function mul(q: Prisma.Decimal, price: Prisma.Decimal): Prisma.Decimal {
  return q.mul(price).toDecimalPlaces(2);
}
