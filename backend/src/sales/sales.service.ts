import { Injectable } from '@nestjs/common';
import { PaymentType, Prisma, StoreOwnerStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { ApiError } from '../common/api-error';
import { assertValidQuantityForUnit, isGramUnit, isKiloUnit, isWeightUnit } from '../common/unit-validation';
import { formatQuantityDisplay } from '../common/quantity-formatter';
import { AuthenticatedUser } from '../common/types';
import { CreateSaleDto } from './dto/create-sale.dto';

// البيع — API_SPEC القسم 4: سلسلة التحقق الكاملة داخل معاملة ذرّية واحدة
@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
  ) {}

  async create(user: AuthenticatedUser, dto: CreateSaleDto) {
    const storeOwnerId = user.storeOwnerId!;
    let quantity = new Prisma.Decimal(dto.quantity);
    const amount = new Prisma.Decimal(dto.amount);

    if (dto.quantityUnit === 'GRAM') {
      if (Math.abs(dto.quantity - Math.round(dto.quantity)) > 1e-6) {
        throw ApiError.badRequest(
          'FRACTIONAL_GRAMS_NOT_ALLOWED',
          'الكمية بالجرام يجب أن تكون رقماً صحيحاً بدون كسور.',
        );
      }
    }

    // 0) فحص اعتماد الإغلاق اليومي (BR-057): لا مبيعات بعد الإغلاق
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const closedClosing = await this.prisma.dailyClosing.findFirst({
      where: {
        storeOwnerId,
        workerId: user.role === 'WORKER' ? user.workerId : null,
        closingDate: today,
        status: 'CLOSED',
      },
    });
    if (closedClosing) {
      throw ApiError.conflict('DAY_ALREADY_CLOSED', 'تم اعتماد إغلاق هذا اليوم مسبقاً ولا يمكن تسجيل مبيعات جديدة.');
    }

    // 1) صلاحية الآجل: العامل العادي ممنوع حتى قبل أي فحص آخر (BR-009)
    if (dto.paymentType === PaymentType.CREDIT && user.role === 'WORKER' && !user.isResponsible) {
      throw ApiError.forbidden('PERMISSION_DENIED', 'لا تملك صلاحية البيع بالآجل.');
    }
    if (quantity.lte(0)) {
      throw ApiError.badRequest('VALIDATION_ERROR', 'الكمية يجب أن تكون أكبر من صفر.');
    }

    // 2) الإلكتروني: محفظة + مرفق إيداع إلزاميان معاً (BR-007)
    let walletAccountCode: string | null = null;
    if (dto.paymentType === PaymentType.ELECTRONIC) {
      if (!dto.walletId || !dto.depositAttachmentUrl) {
        throw ApiError.badRequest('MISSING_DEPOSIT_ATTACHMENT', 'اختيار المحفظة ورفع صورة الإيداع إلزاميان عند الدفع الإلكتروني.');
      }
      const wallet = await this.prisma.wallet.findFirst({
        where: { id: dto.walletId, storeOwnerId, isActive: true },
      });
      if (!wallet) throw ApiError.notFound('المحفظة غير موجودة.');
      const walletAccount = wallet.accountCode
        ? { code: wallet.accountCode }
        : await this.prisma.chartOfAccount.findFirst({
            where: { storeOwnerId, accountType: 'ASSET', name: { startsWith: `محفظة: ${wallet.name}` } },
            select: { code: true },
          });
      walletAccountCode = walletAccount?.code ?? '1100'; // احتياط: حساب المحافظ الأب
    }

    // 3) الآجل: عميل موجود ضمن المتجر
    let customer: { id: string; name: string; creditLimit: Prisma.Decimal | null } | null = null;
    if (dto.paymentType === PaymentType.CREDIT) {
      if (!dto.creditCustomerId) {
        throw ApiError.badRequest('VALIDATION_ERROR', 'اختيار عميل الآجل إلزامي عند الدفع بالآجل.');
      }
      customer = await this.prisma.creditCustomer.findFirst({
        where: { id: dto.creditCustomerId, storeOwnerId, deletedAt: null },
        select: { id: true, name: true, creditLimit: true },
      });
      if (!customer) throw ApiError.notFound('عميل الآجل غير موجود.');
    }

    const ownerSettings = await this.prisma.storeOwner.findUniqueOrThrow({
      where: { id: storeOwnerId },
      select: { defaultCostingMethod: true },
    });

    // المعاملة الذرّية: قفل صف الصنف + قفل صف المالك (العداد) + كل الكتابات
    const result = await this.prisma.$transaction(async (tx) => {
      // R-17/BR-073: قفل صف صريح — أول طلب يصل يعالج، والثاني يُرفض فوراً
      const lockedItems = await tx.$queryRaw<
        Array<{
          id: string; name: string; unit: string; quantity: Prisma.Decimal;
          cost_price: Prisma.Decimal; sell_price: Prisma.Decimal; deleted_at: Date | null;
          emergency_price_mode: string;
          emergency_price_plus_fixed: Prisma.Decimal | null;
          emergency_price_plus_percent: Prisma.Decimal | null;
          emergency_price_min: Prisma.Decimal | null;
          emergency_price_max: Prisma.Decimal | null;
        }>
      >(Prisma.sql`SELECT id, name, unit, quantity, cost_price, sell_price, deleted_at,
                          emergency_price_mode::text AS emergency_price_mode,
                          emergency_price_plus_fixed, emergency_price_plus_percent,
                          emergency_price_min, emergency_price_max
                   FROM items WHERE id = ${dto.itemId}::uuid AND store_owner_id = ${storeOwnerId}::uuid FOR UPDATE`);
      const item = lockedItems[0];
      if (!item || item.deleted_at) throw ApiError.notFound('الصنف غير موجود.');

      if (dto.quantityUnit === 'GRAM') {
        if (!isWeightUnit(item.unit)) {
          throw ApiError.badRequest(
            'FRACTIONAL_GRAMS_NOT_ALLOWED',
            'لا يمكن استخدام الجرام مع صنف لا يُقاس بالوزن.',
          );
        }
        if (isKiloUnit(item.unit)) {
          quantity = new Prisma.Decimal(dto.quantity).div(1000).toDecimalPlaces(3);
        } else {
          quantity = new Prisma.Decimal(dto.quantity).toDecimalPlaces(3);
        }
      } else {
        assertValidQuantityForUnit(item.unit, quantity);
      }

      if (quantity.gt(item.quantity)) {
        // رفض فوري دون أي حفظ أو قيد — أول من يحصل على القفل ينفّذ
        throw ApiError.conflict('INSUFFICIENT_STOCK', 'الكمية المتوفرة غير كافية.', {
          available: item.quantity.toString(),
        });
      }

      // 3) البيع الاضطراري: سبب إلزامي + فحص السياسة (R-14/R-15)
      let unitPrice = item.sell_price;
      let isEmergency = false;
      let priceDifferenceLoss = new Prisma.Decimal(0);
      if (dto.isEmergencySale) {
        isEmergency = true;
        if (!dto.emergencyReason || dto.emergencyReason.trim() === '') {
          throw ApiError.badRequest('EMERGENCY_REASON_REQUIRED', 'سبب التعديل إلزامي للبيع الاضطراري.');
        }
        if (!dto.emergencyOverridePrice || dto.emergencyOverridePrice <= 0) {
          throw ApiError.badRequest('VALIDATION_ERROR', 'سعر البيع الاضطراري مطلوب.');
        }
        unitPrice = new Prisma.Decimal(dto.emergencyOverridePrice);
        this.assertEmergencyPricePolicy(item, unitPrice);
      }

      // المبلغ يحسمه الخادم من السعر — لا يُقبل مبلغ لا يطابق الكمية × سعر الوحدة
      const expectedAmount = quantity.mul(unitPrice).toDecimalPlaces(2);
      if (!amount.eq(expectedAmount)) {
        throw ApiError.badRequest('VALIDATION_ERROR', 'المبلغ لا يطابق الكمية × سعر الوحدة.', {
          expected: expectedAmount.toString(),
        });
      }

      // 4) سقف الائتمان Hard Block (R-19): لا حفظ، لا خصم مخزون، لا قيد
      if (dto.paymentType === PaymentType.CREDIT && customer) {
        if (customer.creditLimit !== null) {
          const debts = await this.customerTotalDebt(tx, customer.id);
          if (debts.plus(amount).gt(customer.creditLimit)) {
            throw ApiError.conflict('CREDIT_LIMIT_EXCEEDED', 'تجاوز المبلغ سقف ائتمان العميل المسموح.', {
              available_credit: customer.creditLimit.minus(debts).toString(),
            });
          }
        }
      }

      // الفرق الخساري: الفرق بين السعر العادي والفعلي إن أقل (R-16)
      if (isEmergency && unitPrice.lt(item.sell_price)) {
        priceDifferenceLoss = item.sell_price.minus(unitPrice).mul(quantity).toDecimalPlaces(2);
      }

      // 4.5) احتساب تكلفة البضاعة المباعة (COGS) واستهلاك طبقات FIFO عند تفعيلها
      let cogs = item.cost_price.mul(quantity).toDecimalPlaces(2);
      const fifoLayers = await tx.purchaseItem.findMany({
        where: {
          storeOwnerId,
          itemId: item.id,
          remainingFifoQty: { gt: 0 },
          purchaseInvoice: { status: 'POSTED' },
        },
        orderBy: { createdAt: 'asc' },
      });

      if (fifoLayers.length > 0) {
        const totalLayeredQty = fifoLayers.reduce(
          (s, l) => s.plus(l.remainingFifoQty),
          new Prisma.Decimal(0),
        );
        const unlayeredOldestQty = Prisma.Decimal.max(
          new Prisma.Decimal(0),
          item.quantity.minus(totalLayeredQty),
        );

        let qtyToConsume = quantity;
        let fifoCostAcc = new Prisma.Decimal(0);

        if (unlayeredOldestQty.gt(0)) {
          const fromUnlayered = Prisma.Decimal.min(unlayeredOldestQty, qtyToConsume);
          fifoCostAcc = fifoCostAcc.plus(fromUnlayered.mul(item.cost_price));
          qtyToConsume = qtyToConsume.minus(fromUnlayered);
        }

        let nextFrontLayerCost: Prisma.Decimal | null = null;
        for (const layer of fifoLayers) {
          if (qtyToConsume.gt(0)) {
            const consumed = Prisma.Decimal.min(layer.remainingFifoQty, qtyToConsume);
            fifoCostAcc = fifoCostAcc.plus(consumed.mul(layer.effectiveBaseUnitCost));
            const remLayer = layer.remainingFifoQty.minus(consumed);
            await tx.purchaseItem.update({
              where: { id: layer.id },
              data: { remainingFifoQty: remLayer },
            });
            qtyToConsume = qtyToConsume.minus(consumed);
            if (remLayer.gt(0) && nextFrontLayerCost === null) {
              nextFrontLayerCost = layer.effectiveBaseUnitCost;
            }
          } else if (nextFrontLayerCost === null) {
            nextFrontLayerCost = layer.effectiveBaseUnitCost;
          }
        }

        if (ownerSettings.defaultCostingMethod === 'FIFO') {
          cogs = fifoCostAcc.toDecimalPlaces(2);
          // إذا استُهلكت الدفعة الأقدم بالكامل، حدّث items.cost_price لتكلفة الدفعة النشطة التالية
          const remainingUnlayered = unlayeredOldestQty.minus(
            Prisma.Decimal.min(unlayeredOldestQty, quantity),
          );
          if (remainingUnlayered.lte(0) && nextFrontLayerCost !== null) {
            await tx.item.update({
              where: { id: item.id },
              data: { costPrice: nextFrontLayerCost },
            });
          }
        }
      }

      // 5) خصم الكمية (ضمن نفس القفل والمعاملة)
      await tx.$executeRaw(Prisma.sql`UPDATE items SET quantity = quantity - ${quantity}, updated_at = now()
                                      WHERE id = ${dto.itemId}::uuid`);
      // قاعدة سلامة quantity >= 0 مفروضة بقيد CHECK في قاعدة البيانات — الانتهاك يفشل المعاملة كلها

      // 6) سجل البيع
      const sale = await tx.sale.create({
        data: {
          storeOwnerId,
          workerId: user.role === 'WORKER' ? user.workerId! : null,
          itemId: dto.itemId,
          quantity,
          amount,
          cogsAmount: cogs,
          paymentType: dto.paymentType,
          walletId: dto.walletId ?? null,
          depositAttachmentUrl: dto.depositAttachmentUrl ?? null,
          creditCustomerId: dto.creditCustomerId ?? null,
          isEmergencySale: isEmergency,
          emergencyReason: isEmergency ? dto.emergencyReason : null,
          emergencyOverridePrice: isEmergency ? unitPrice : null,
          priceDifferenceLoss,
          soldAt: new Date(),
        },
      });

      // 7) قيود القيد المزدوج (BR-053): قيد المبيعات + قيد التكلفة + قيد الخسارة المنفصل
      const entryDate = startOfDay(sale.soldAt);
      const debitAccount =
        dto.paymentType === PaymentType.CASH
          ? '1000'
          : dto.paymentType === PaymentType.ELECTRONIC
            ? (walletAccountCode ?? '1100')
            : '1200';
      const revenueLines = isEmergency && priceDifferenceLoss.gt(0)
        ? [ // المبيعات بالسعر العادي؛ النقد الفعلي + الخسارة يوازنانه (R-16 قيد مستقل سلوكياً)
            { accountCode: debitAccount, debit: amount.toNumber(), description: 'تحصيل بيع اضطراري' },
            { accountCode: '5450', debit: priceDifferenceLoss.toNumber(), description: `خسارة بيع اضطراري: ${dto.emergencyReason}` },
            { accountCode: '4000', credit: item.sell_price.mul(quantity).toDecimalPlaces(2).toNumber(), description: 'مبيعات بالسعر العادي' },
          ]
        : [
            { accountCode: debitAccount, debit: amount.toNumber(), description: 'تحصيل بيع' },
            { accountCode: '4000', credit: amount.toNumber(), description: 'مبيعات' },
          ];
      await this.accounting.createBalancedEntries(tx, {
        storeOwnerId,
        entryDate,
        referenceType: 'SALE',
        referenceId: sale.id,
        lines: revenueLines,
      });
      if (cogs.gt(0)) {
        await this.accounting.createBalancedEntries(tx, {
          storeOwnerId,
          entryDate,
          referenceType: 'SALE',
          referenceId: sale.id,
          lines: [
            { accountCode: '5000', debit: cogs.toNumber(), description: 'تكلفة البضاعة المباعة' },
            { accountCode: '1300', credit: cogs.toNumber(), description: 'خصم المخزون' },
          ],
        });
      }

      // 8) عدّاد التجربة: زيادة طالما used < limit (شرط مستقل عن الحالة — BR-040)
      //    بقفل صف المالك لمنع سباق العدّاد بين أجهزة العمال
      const lockedOwners = await tx.$queryRaw<
        Array<{ trial_sales_used: number; trial_sales_limit: number; status: string }>
      >(Prisma.sql`SELECT trial_sales_used, trial_sales_limit, status FROM store_owners
                   WHERE id = ${storeOwnerId}::uuid FOR UPDATE`);
      const owner = lockedOwners[0];
      let accountStatus = owner.status;
      if (owner.trial_sales_used < owner.trial_sales_limit) {
        const nextUsed = owner.trial_sales_used + 1;
        const remaining = owner.trial_sales_limit - nextUsed;
        let nextStatus: StoreOwnerStatus = owner.status as StoreOwnerStatus;
        if (nextUsed >= owner.trial_sales_limit) {
          nextStatus = 'TRIAL_EXPIRED'; // BR-042: قفل كامل فوري
        } else if (remaining <= this.trialWarningThreshold && (owner.status === 'TRIAL' || owner.status === 'TRIAL_WARNING')) {
          nextStatus = 'TRIAL_WARNING'; // BR-041
        }
        await tx.storeOwner.update({
          where: { id: storeOwnerId },
          data: {
            trialSalesUsed: nextUsed,
            ...(nextStatus !== owner.status ? { status: nextStatus } : {}),
          },
        });
        accountStatus = nextStatus;
      }

      return { sale, accountStatus, mergedItemName: item.name, itemUnit: item.unit };
    });

    return {
      sale: serializeSale(result.sale, result.itemUnit),
      account_status: result.accountStatus,
      item_name: result.mergedItemName,
    };
  }

  // المباع (SOLD_ITEMS): للمالك كل العمال مجتمعين؛ للعامل عملياته فقط
  async summaryByItem(user: AuthenticatedUser, date?: string) {
    const entryDate = date ? startOfDay(new Date(date)) : startOfDay(new Date());
    const end = endOfDay(entryDate);
    const rows = await this.prisma.sale.groupBy({
      by: ['itemId'],
      where: {
        storeOwnerId: user.storeOwnerId!,
        soldAt: { gte: entryDate, lt: end },
        ...(user.role === 'WORKER' ? { workerId: user.workerId } : {}),
      },
      _sum: { amount: true, quantity: true },
    });
    const items = await this.prisma.item.findMany({
      where: { id: { in: rows.map((r) => r.itemId) } },
      select: { id: true, name: true, unit: true },
    });
    const nameById = new Map(items.map((i) => [i.id, i]));
    const lines = rows.map((r) => {
      const it = nameById.get(r.itemId);
      const unit = it?.unit ?? '';
      const totalQty = r._sum.quantity?.toDecimalPlaces(3) ?? new Prisma.Decimal(0);
      return {
        item_id: r.itemId,
        name: it?.name ?? '',
        unit,
        total_amount: r._sum.amount?.toDecimalPlaces(2) ?? new Prisma.Decimal(0),
        total_quantity: totalQty,
        quantity_display: formatQuantityDisplay(totalQty, unit),
      };
    });
    const total = lines.reduce((s, l) => s.add(l.total_amount), new Prisma.Decimal(0)).toDecimalPlaces(2);
    return { items: lines, total };
  }

  // سجل العمليات (OPERATIONS_LOG): للمالك سجل موحّد موسوم باسم العامل؛ للعامل عملياته
  async log(user: AuthenticatedUser, date?: string, workerIdFilter?: string) {
    const entryDate = date ? startOfDay(new Date(date)) : startOfDay(new Date());
    const end = endOfDay(entryDate);
    // العامل لا يرى إلا نفسه — حتى لو مرّر worker_id غيره
    const effectiveWorkerId =
      user.role === 'WORKER' ? user.workerId! : (workerIdFilter || undefined);

    const sales = await this.prisma.sale.findMany({
      where: {
        storeOwnerId: user.storeOwnerId!,
        soldAt: { gte: entryDate, lt: end },
        ...(effectiveWorkerId ? { workerId: effectiveWorkerId } : {}),
      },
      include: {
        item: { select: { name: true, unit: true } },
        worker: { select: { fullName: true } },
        wallet: { select: { name: true } },
      },
      orderBy: { soldAt: 'desc' },
    });

    const creditPayments = await this.prisma.creditPayment.findMany({
      where: {
        storeOwnerId: user.storeOwnerId!,
        paidAt: { gte: entryDate, lt: end },
        ...(effectiveWorkerId ? { workerId: effectiveWorkerId } : {}),
      },
      include: {
        creditCustomer: { select: { name: true } },
        worker: { select: { fullName: true } },
      },
      orderBy: { paidAt: 'desc' },
    });

    const operations = [
      ...sales.map((s) => ({
        id: s.id,
        type: 'SALE' as const,
        item_name: s.item.name,
        unit: s.item.unit,
        quantity: s.quantity,
        quantity_display: formatQuantityDisplay(s.quantity, s.item.unit),
        amount: s.amount,
        payment_type: s.paymentType,
        wallet_name: s.wallet?.name ?? null,
        worker_name: s.worker?.fullName ?? 'المالك',
        is_emergency_sale: s.isEmergencySale,
        emergency_reason: s.emergencyReason,
        at: s.soldAt,
      })),
      ...creditPayments.map((p) => ({
        id: p.id,
        type: 'CREDIT_PAYMENT' as const,
        item_name: `دفعة من: ${p.creditCustomer.name}`,
        quantity: null,
        amount: p.amount,
        payment_type: p.paymentMethod,
        wallet_name: null,
        worker_name: p.worker?.fullName ?? 'المالك',
        is_emergency_sale: false,
        emergency_reason: null,
        at: p.paidAt,
      })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime());

    // شريط الإجماليات أسفل الشاشة: نقد/إلكتروني (+ المصروفات تُضاف في مرحلة المصروفات)
    const cash = sumAmounts(operations.filter((o) => o.payment_type === 'CASH').map((o) => o.amount));
    const electronic = sumAmounts(operations.filter((o) => o.payment_type === 'ELECTRONIC').map((o) => o.amount));
    return { operations, totals: { cash, electronic, expenses: new Prisma.Decimal(0) } };
  }

  // ─── أدوات ──────────────────────────────────────────────────────────────

  private assertEmergencyPricePolicy(
    item: {
      cost_price: Prisma.Decimal;
      emergency_price_mode: string;
      emergency_price_plus_fixed: Prisma.Decimal | null;
      emergency_price_plus_percent: Prisma.Decimal | null;
      emergency_price_min: Prisma.Decimal | null;
      emergency_price_max: Prisma.Decimal | null;
    },
    price: Prisma.Decimal,
  ) {
    // الحدان يُفحصان كلٌّ على حدة — ترك الأدنى فارغاً في النمط المفتوح لا يُلغي فحص الأقصى (12-business §5)
    switch (item.emergency_price_mode) {
      case 'COST_ONLY': {
        if (!price.eq(item.cost_price)) {
          throw price.lt(item.cost_price)
            ? ApiError.badRequest('EMERGENCY_PRICE_BELOW_MINIMUM', 'سياسة الصنف: البيع بسعر التكلفة فقط.')
            : ApiError.badRequest('EMERGENCY_PRICE_ABOVE_MAXIMUM', 'سياسة الصنف: البيع بسعر التكلفة فقط.');
        }
        break;
      }
      case 'COST_PLUS': {
        const fixed = item.emergency_price_plus_fixed;
        const percent = item.emergency_price_plus_percent;
        const margin = fixed !== null
          ? fixed
          : item.cost_price.mul(percent ?? 0).div(100).toDecimalPlaces(2);
        const minPrice = item.cost_price.add(margin);
        if (price.lt(minPrice)) {
          throw ApiError.badRequest('EMERGENCY_PRICE_BELOW_MINIMUM', 'السعر أقل من التكلفة + الهامش المحدد.', {
            minimum: minPrice.toString(),
          });
        }
        break;
      }
      case 'RANGE_OR_OPEN': {
        if (item.emergency_price_min !== null && price.lt(item.emergency_price_min)) {
          throw ApiError.badRequest('EMERGENCY_PRICE_BELOW_MINIMUM', 'السعر أقل من الحد الأدنى المسموح.', {
            minimum: item.emergency_price_min.toString(),
          });
        }
        if (item.emergency_price_max !== null && price.gt(item.emergency_price_max)) {
          throw ApiError.badRequest('EMERGENCY_PRICE_ABOVE_MAXIMUM', 'السعر أعلى من الحد الأقصى المحدد.', {
            maximum: item.emergency_price_max.toString(),
          });
        }
        break;
      }
    }
  }

  private async customerTotalDebt(tx: Prisma.TransactionClient, customerId: string): Promise<Prisma.Decimal> {
    const [aggSales, aggPayments, aggReturns] = await Promise.all([
      tx.sale.aggregate({
        where: { creditCustomerId: customerId, paymentType: 'CREDIT' },
        _sum: { amount: true },
      }),
      tx.creditPayment.aggregate({
        where: { creditCustomerId: customerId },
        _sum: { amount: true },
      }),
      tx.return.aggregate({
        where: { sale: { creditCustomerId: customerId, paymentType: 'CREDIT' } },
        _sum: { amount: true },
      }),
    ]);
    return (aggSales._sum.amount ?? new Prisma.Decimal(0))
      .minus(aggPayments._sum.amount ?? 0)
      .minus(aggReturns._sum.amount ?? 0);
  }

  // عتبة تحذير التجربة (BR-041) — تُقرأ من الإعدادات مرة واحدة عند إنشاء الخدمة للطلب
  private trialWarningThreshold = 30;
}

function sumAmounts(values: Prisma.Decimal[]): Prisma.Decimal {
  return values.reduce((s, v) => s.add(v), new Prisma.Decimal(0)).toDecimalPlaces(2);
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function serializeSale(
  s: {
    id: string; quantity: Prisma.Decimal; amount: Prisma.Decimal; paymentType: string;
    isEmergencySale: boolean; emergencyOverridePrice: Prisma.Decimal | null;
    priceDifferenceLoss: Prisma.Decimal; soldAt: Date;
  },
  unit?: string,
) {
  return {
    id: s.id,
    quantity: s.quantity,
    quantity_display: formatQuantityDisplay(s.quantity, unit),
    amount: s.amount,
    payment_type: s.paymentType,
    is_emergency_sale: s.isEmergencySale,
    emergency_override_price: s.emergencyOverridePrice,
    price_difference_loss: s.priceDifferenceLoss,
    sold_at: s.soldAt,
  };
}
