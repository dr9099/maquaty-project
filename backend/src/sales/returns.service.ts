import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import { assertValidQuantityForUnit, isGramUnit, isKiloUnit, isWeightUnit } from '../common/unit-validation';
import { formatQuantityDisplay } from '../common/quantity-formatter';
import { AuthenticatedUser } from '../common/types';
import { CreateReturnDto } from './dto/create-return.dto';

// خدمة المرتجعات — API_SPEC القسم 4 / R-20 / BR-057
@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
    private readonly audit: AuditService,
  ) {}

  async create(user: AuthenticatedUser, dto: CreateReturnDto, ip?: string) {
    const storeOwnerId = user.storeOwnerId!;

    const sale = await this.prisma.sale.findFirst({
      where: { id: dto.saleId, storeOwnerId },
      include: {
        item: { select: { id: true, unit: true, costPrice: true, sellPrice: true } },
        dailyClosing: { select: { status: true } },
      },
    });

    if (!sale) throw ApiError.notFound('عملية البيع غير موجودة.');

    let returnQtyDecimal: Prisma.Decimal;
    let requestedQty: number;

    if (dto.quantityUnit === 'GRAM') {
      if (Math.abs(dto.quantity - Math.round(dto.quantity)) > 1e-6) {
        throw ApiError.badRequest(
          'FRACTIONAL_GRAMS_NOT_ALLOWED',
          'الكمية المرتجعة بالجرام يجب أن تكون رقماً صحيحاً بدون كسور.',
        );
      }
      if (!isWeightUnit(sale.item.unit)) {
        throw ApiError.badRequest(
          'FRACTIONAL_GRAMS_NOT_ALLOWED',
          'لا يمكن استخدام الجرام مع صنف لا يُقاس بالوزن.',
        );
      }
      if (isKiloUnit(sale.item.unit)) {
        returnQtyDecimal = new Prisma.Decimal(dto.quantity).div(1000).toDecimalPlaces(3);
        requestedQty = returnQtyDecimal.toNumber();
      } else {
        returnQtyDecimal = new Prisma.Decimal(dto.quantity).toDecimalPlaces(3);
        requestedQty = returnQtyDecimal.toNumber();
      }
    } else {
      assertValidQuantityForUnit(sale.item.unit, dto.quantity);
      returnQtyDecimal = new Prisma.Decimal(dto.quantity);
      requestedQty = Number(dto.quantity);
    }

    // 1) فحص ملكية العملية (R-20 / BR-066)
    if (user.role === 'WORKER') {
      if (sale.workerId !== user.workerId) {
        throw ApiError.forbidden('NOT_OWN_SALE', 'لا يمكنك تسجيل مرتجع لعملية لم تقم ببيعها بنفسك.');
      }
    }

    // 2) فحص تاريخ البيع: حصراً في نفس يوم البيع الحالي (R-20)
    const today = startOfDay(new Date());
    const saleDay = startOfDay(sale.soldAt);
    if (today.getTime() !== saleDay.getTime()) {
      throw ApiError.badRequest('RETURN_DAY_PASSED', 'المرتجع مسموح حصراً في نفس يوم البيع (طبيعة القات).');
    }

    // 3) فحص حالة الإغلاق اليومي: لا مرتجع بعد اعتماد الإغلاق (R-20 / BR-057)
    if (sale.dailyClosingId || sale.dailyClosing?.status === 'CLOSED') {
      throw ApiError.conflict('DAY_ALREADY_CLOSED', 'لا يمكن تسجيل مرتجع لعملية تم اعتماد إغلاق يومها.');
    }

    // فحص إضافي: هل تم اعتماد إغلاق هذا الحساب لليوم الحالي؟
    const closedClosing = await this.prisma.dailyClosing.findFirst({
      where: {
        storeOwnerId,
        workerId: sale.workerId,
        closingDate: today,
        status: 'CLOSED',
      },
    });
    if (closedClosing) {
      throw ApiError.conflict('DAY_ALREADY_CLOSED', 'تم اعتماد إغلاق اليوم لهذا الحساب مسبقاً.');
    }

    // 4) فحص الكمية المرتجعة التراكمية
    const existingReturns = await this.prisma.return.aggregate({
      where: { saleId: sale.id },
      _sum: { quantity: true },
    });
    const previouslyReturnedQty = existingReturns._sum.quantity ? Number(existingReturns._sum.quantity) : 0;
    const saleQty = Number(sale.quantity);

    if (round2(previouslyReturnedQty + requestedQty) > saleQty) {
      throw ApiError.badRequest('RETURN_QUANTITY_EXCEEDED', 'الكمية المطلوب إرجاعها تتجاوز الكمية المباعة المتبقية.', {
        max_returnable: round2(saleQty - previouslyReturnedQty),
      });
    }

    const resolvedAmount =
      dto.amount !== undefined
        ? round2(Number(dto.amount))
        : round2((Number(sale.amount) * requestedQty) / saleQty);

    const returnAmountDecimal = new Prisma.Decimal(resolvedAmount);

    return this.prisma.$transaction(async (tx) => {
      // إعادة الكمية للمخزون بقفل تشاؤمي
      await tx.$executeRaw(
        Prisma.sql`UPDATE items SET quantity = quantity + ${returnQtyDecimal}, updated_at = now()
                   WHERE id = ${sale.itemId}::uuid AND store_owner_id = ${storeOwnerId}::uuid`,
      );

      const createdReturn = await tx.return.create({
        data: {
          storeOwnerId,
          saleId: sale.id,
          itemId: sale.itemId,
          workerId: user.role === 'WORKER' ? user.workerId : null,
          quantity: returnQtyDecimal,
          amount: returnAmountDecimal,
          returnedAt: new Date(),
        },
      });

      // تحديد حساب الأصل الدائن (الصندوق أو المحفظة أو ذمم العملاء)
      let creditAccount = '1000';
      if (sale.paymentType === 'ELECTRONIC') {
        if (sale.walletId) {
          const wallet = await tx.wallet.findUnique({ where: { id: sale.walletId } });
          if (wallet?.accountCode) {
            creditAccount = wallet.accountCode;
          } else {
            const walletAccount = await tx.chartOfAccount.findFirst({
              where: { storeOwnerId, accountType: 'ASSET', name: { startsWith: `محفظة: ${wallet?.name}` } },
              select: { code: true },
            });
            creditAccount = walletAccount?.code ?? '1100';
          }
        } else {
          creditAccount = '1100';
        }
      } else if (sale.paymentType === 'CREDIT') {
        creditAccount = '1200';
      }

      // القيد العكسي:
      // مدين: 4000 (المبيعات)
      // دائن: حساب التحصيل الأصلي (1000 / المحفظة / 1200)
      await this.accounting.createBalancedEntries(tx, {
        storeOwnerId,
        entryDate: today,
        referenceType: 'RETURN',
        referenceId: createdReturn.id,
        lines: [
          { accountCode: '4000', debit: resolvedAmount, description: 'مرتجع مبيعات' },
          { accountCode: creditAccount, credit: resolvedAmount, description: 'رد قيمة المرتجع' },
        ],
      });

      // قيد إعادة التكلفة للمخزون:
      // مدين: 1300 (المخزون)
      // دائن: 5000 (تكلفة البضاعة المباعة)
      const unitCogs =
        sale.cogsAmount !== null && sale.quantity.gt(0)
          ? sale.cogsAmount.div(sale.quantity)
          : sale.item.costPrice;
      const cogsAmount = round2(returnQtyDecimal.mul(unitCogs).toNumber());
      if (cogsAmount > 0) {
        await this.accounting.createBalancedEntries(tx, {
          storeOwnerId,
          entryDate: today,
          referenceType: 'RETURN',
          referenceId: createdReturn.id,
          lines: [
            { accountCode: '1300', debit: cogsAmount, description: 'استرداد المخزون من المرتجع' },
            { accountCode: '5000', credit: cogsAmount, description: 'تخفيض تكلفة البضاعة المباعة' },
          ],
        });
      }

      await this.audit.log({
        actorType: user.role === 'WORKER' ? 'WORKER' : 'STORE_OWNER',
        actorId: user.role === 'WORKER' ? user.workerId! : user.storeOwnerId!,
        actionType: 'SALE_RETURN',
        targetType: 'return',
        targetId: createdReturn.id,
        newValue: { sale_id: sale.id, quantity: dto.quantity, amount: resolvedAmount, reason: dto.reason },
        ipAddress: ip,
        result: 'SUCCESS',
      });

      return {
        return_id: createdReturn.id,
        sale_id: sale.id,
        quantity: Number(createdReturn.quantity),
        quantity_display: formatQuantityDisplay(createdReturn.quantity, sale.item.unit),
        amount: Number(createdReturn.amount),
        returned_at: createdReturn.returnedAt,
      };
    });
  }
}

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
