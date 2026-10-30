import { Injectable } from '@nestjs/common';
import { EmergencyPriceMode, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { assertValidQuantityForUnit } from '../common/unit-validation';
import { COSTING_OPTIONS_AR } from '../settings/settings.service';
import { CreateItemDto, UpdateItemDto } from './dto/items.dto';

// الأصناف — API_SPEC القسم 3 + آلية التكلفة لنفس اليوم وقاعدة القات 24-48 ساعة
@Injectable()
export class ItemsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(storeOwnerId: string, dto: CreateItemDto) {
    const trimmedName = dto.name.trim();
    const trimmedUnit = dto.unit.trim();
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
      const newQty = Number(dto.quantity);
      const newCost = Number(dto.costPrice);

      // 1) قاعدة القات (24-48 ساعة / نفاد الكمية = 0): اعتماد السعر الجديد تلقائياً دون نافذة منبثقة
      if (oldQty <= 0) {
        const item = await this.prisma.item.update({
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
        return { item, merged: true, warnings };
      }

      // 2) نفس سعر التكلفة في نفس اليوم -> دمج تلقائي (BR-003)
      if (Math.abs(oldCost - newCost) < 0.005) {
        const item = await this.prisma.item.update({
          where: { id: existingSameDay.id },
          data: {
            quantity: { increment: new Prisma.Decimal(newQty) },
            sellPrice: new Prisma.Decimal(dto.sellPrice),
          },
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

      const item = await this.prisma.item.update({
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
      return { item, merged: true, costing_method_used: dto.costingMethod, warnings };
    }

    const item = await this.prisma.item.create({
      data: {
        storeOwnerId,
        name: trimmedName,
        unit: trimmedUnit,
        quantity: dto.quantity,
        costPrice: dto.costPrice,
        sellPrice: dto.sellPrice,
        entryDate,
        emergencyPriceMode: dto.emergencyPriceMode ?? (await this.defaultEmergencyMode()),
        emergencyPricePlusFixed: dto.emergencyPricePlusFixed,
        emergencyPricePlusPercent: dto.emergencyPricePlusPercent,
        emergencyPriceMin: dto.emergencyPriceMin,
        emergencyPriceMax: dto.emergencyPriceMax,
      },
    });
    return { item, merged: false, warnings };
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

  // المخزون (INVENTORY) — للمالك: كامل؛ للعامل: بلا قيمة متبقية إلا بصلاحية؛ لا cost_price للعامل أبداً
  async inventory(
    storeOwnerId: string,
    opts: { isWorker: boolean; showSellPrices: boolean },
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
      const base: Record<string, unknown> = {
        item_id: it.id,
        name: it.name,
        unit: it.unit,
        remaining_qty: it.quantity,
        sell_price: it.sellPrice,
      };
      if (!opts.isWorker || opts.showSellPrices) {
        base.remaining_value = mul(it.quantity, it.sellPrice);
      }
      // حماية خادمية أساسية: cost_price لا يُعاد لأي Worker إطلاقاً
      if (!opts.isWorker) {
        base.cost_price = it.costPrice;
        base.emergency_price_mode = it.emergencyPriceMode;
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
