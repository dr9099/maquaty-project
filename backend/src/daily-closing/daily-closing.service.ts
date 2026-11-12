import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import { AuthenticatedUser } from '../common/types';
import { UpdateActualCashDto } from './dto/daily-closing.dto';

// خدمة المطابقة اليومية والإغلاق — API_SPEC القسم 9 / R-04 / R-21 / R-36 / BR-026..030
// قاعدة صندوق اليوم (Conflict 3): يبدأ صندوق كل يوم جديد من 0 دون ترحيل رصيد اليوم السابق، ويحسب صافي الحركات النقدية لليوم نفسه فقط.
@Injectable()
export class DailyClosingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
    private readonly audit: AuditService,
  ) {}

  async getToday(user: AuthenticatedUser, workerIdParam?: string) {
    const storeOwnerId = user.storeOwnerId!;
    let targetWorkerId: string | null = null;

    if (user.role === 'STORE_OWNER') {
      targetWorkerId = workerIdParam && workerIdParam !== '' ? workerIdParam : null;
    } else {
      // العامل
      if (!user.isResponsible) {
        if (workerIdParam && workerIdParam !== user.workerId) {
          throw ApiError.forbidden('PERMISSION_DENIED', 'لا يمكنك استعراض مطابقة عامل آخر.');
        }
        targetWorkerId = user.workerId!;
      } else {
        // العامل المسؤول
        targetWorkerId = workerIdParam && workerIdParam !== '' ? workerIdParam : user.workerId!;
      }
    }

    const todayDate = startOfDay(new Date());
    const tomorrowDate = new Date(todayDate.getTime() + 24 * 60 * 60 * 1000);

    // 1) حساب الكاش المتوقع لليوم الحالي بدءاً من صفر (0):
    // + مبيعات نقدية - مرتجعات مبيعات نقدية + تحصيلات ديون عملاء نقدية
    // - مشتريات نقدية - سدادات موردين نقدية + استردادات مرتجعات مشتريات نقدية
    // - مصروفات وسلف نقدية + إيداعات المالك النقدية - مسحوبات المالك النقدية + سحوبات المحافظ للصندوق
    const [
      cashSalesAgg,
      cashSaleReturnsAgg,
      cashPaymentsAgg,
      cashPurchasesAgg,
      cashSupplierPaymentsAgg,
      cashPurchaseRefundsAgg,
      workerCashAdvancesAgg,
      empCashAdvancesAgg,
      empCashSalariesAgg,
      cashRentsAgg,
      cashUtilitiesAgg,
      cashAccrualSettlementsAgg,
      ownerCashDepositsAgg,
      ownerCashWithdrawalsAgg,
      walletCashOutsAgg,
    ] = await Promise.all([
      this.prisma.sale.aggregate({
        where: {
          storeOwnerId,
          workerId: targetWorkerId,
          paymentType: 'CASH',
          soldAt: { gte: todayDate, lt: tomorrowDate },
        },
        _sum: { amount: true },
      }),
      this.prisma.return.aggregate({
        where: {
          storeOwnerId,
          returnedAt: { gte: todayDate, lt: tomorrowDate },
          sale: {
            paymentType: 'CASH',
            workerId: targetWorkerId,
          },
        },
        _sum: { amount: true },
      }),
      this.prisma.creditPayment.aggregate({
        where: {
          storeOwnerId,
          workerId: targetWorkerId,
          paymentMethod: 'CASH',
          paidAt: { gte: todayDate, lt: tomorrowDate },
        },
        _sum: { amount: true },
      }),
      this.prisma.purchaseInvoice.aggregate({
        where: {
          storeOwnerId,
          workerId: targetWorkerId,
          status: 'POSTED',
          invoiceDate: todayDate,
          walletId: null,
          paidAmount: { gt: 0 },
        },
        _sum: { paidAmount: true },
      }),
      this.prisma.supplierPayment.aggregate({
        where: {
          storeOwnerId,
          workerId: targetWorkerId,
          paymentMethod: 'CASH',
          paidAt: { gte: todayDate, lt: tomorrowDate },
        },
        _sum: { amount: true },
      }),
      this.prisma.purchaseReturn.aggregate({
        where: {
          storeOwnerId,
          workerId: targetWorkerId,
          refundMethod: 'CASH_REFUND',
          returnedAt: { gte: todayDate, lt: tomorrowDate },
        },
        _sum: { totalAmount: true },
      }),
      targetWorkerId !== null
        ? this.prisma.workerAdvance.aggregate({
            where: {
              storeOwnerId,
              workerId: targetWorkerId,
              paymentMethod: 'CASH',
              recordedAt: { gte: todayDate, lt: tomorrowDate },
            },
            _sum: { amount: true },
          })
        : this.prisma.workerAdvance.aggregate({
            where: {
              storeOwnerId,
              paymentMethod: 'CASH',
              recordedAt: { gte: todayDate, lt: tomorrowDate },
            },
            _sum: { amount: true },
          }),
      targetWorkerId === null
        ? this.prisma.employeeAdvance.aggregate({
            where: {
              storeOwnerId,
              paymentMethod: 'CASH',
              createdAt: { gte: todayDate, lt: tomorrowDate },
            },
            _sum: { amount: true },
          })
        : Promise.resolve({ _sum: { amount: null } }),
      targetWorkerId === null
        ? this.prisma.employeePayment.aggregate({
            where: {
              storeOwnerId,
              paymentMethod: 'CASH',
              paidAmount: { gt: 0 },
              paidAt: { gte: todayDate, lt: tomorrowDate },
            },
            _sum: { paidAmount: true },
          })
        : Promise.resolve({ _sum: { paidAmount: null } }),
      targetWorkerId === null
        ? this.prisma.rentRecord.aggregate({
            where: {
              storeOwnerId,
              paymentMethod: 'CASH',
              paidAmount: { gt: 0 },
              paidAt: { gte: todayDate, lt: tomorrowDate },
            },
            _sum: { paidAmount: true },
          })
        : Promise.resolve({ _sum: { paidAmount: null } }),
      targetWorkerId === null
        ? this.prisma.utilityPayment.aggregate({
            where: {
              storeOwnerId,
              paymentMethod: 'CASH',
              paidAmount: { gt: 0 },
              paidAt: { gte: todayDate, lt: tomorrowDate },
            },
            _sum: { paidAmount: true },
          })
        : Promise.resolve({ _sum: { paidAmount: null } }),
      targetWorkerId === null
        ? this.prisma.expenseSettlement.aggregate({
            where: {
              storeOwnerId,
              paymentMethod: 'CASH',
              paidAt: { gte: todayDate, lt: tomorrowDate },
            },
            _sum: { amount: true },
          })
        : Promise.resolve({ _sum: { amount: null } }),
      targetWorkerId === null
        ? this.prisma.ownerTransaction.aggregate({
            where: {
              storeOwnerId,
              type: 'DEPOSIT',
              paymentMethod: 'CASH',
              transactedAt: { gte: todayDate, lt: tomorrowDate },
            },
            _sum: { amount: true },
          })
        : Promise.resolve({ _sum: { amount: null } }),
      targetWorkerId === null
        ? this.prisma.ownerTransaction.aggregate({
            where: {
              storeOwnerId,
              type: 'WITHDRAWAL',
              paymentMethod: 'CASH',
              transactedAt: { gte: todayDate, lt: tomorrowDate },
            },
            _sum: { amount: true },
          })
        : Promise.resolve({ _sum: { amount: null } }),
      targetWorkerId === null
        ? this.prisma.walletSettlement.aggregate({
            where: {
              storeOwnerId,
              cashOutToDrawer: { gt: 0 },
              settledAt: { gte: todayDate, lt: tomorrowDate },
            },
            _sum: { cashOutToDrawer: true },
          })
        : Promise.resolve({ _sum: { cashOutToDrawer: null } }),
    ]);

    const openingCash = 0; // صندوق اليوم يبدأ دائماً من 0 لكل يوم جديد
    const cashSalesTotal = Number(cashSalesAgg._sum.amount ?? 0);
    const cashSaleReturnsTotal = Number(cashSaleReturnsAgg._sum.amount ?? 0);
    const cashPaymentsTotal = Number(cashPaymentsAgg._sum.amount ?? 0);
    const cashPurchasesTotal = Number(cashPurchasesAgg._sum.paidAmount ?? 0);
    const cashSupplierPaymentsTotal = Number(cashSupplierPaymentsAgg._sum.amount ?? 0);
    const cashPurchaseRefundsTotal = Number(cashPurchaseRefundsAgg._sum.totalAmount ?? 0);

    const workerCashAdvancesTotal = Number(workerCashAdvancesAgg._sum.amount ?? 0);
    const ownerCashExpensesTotal = round2(
      Number(empCashAdvancesAgg._sum.amount ?? 0) +
        Number(empCashSalariesAgg._sum.paidAmount ?? 0) +
        Number(cashRentsAgg._sum.paidAmount ?? 0) +
        Number(cashUtilitiesAgg._sum.paidAmount ?? 0) +
        Number(cashAccrualSettlementsAgg._sum.amount ?? 0) +
        workerCashAdvancesTotal,
    );
    const cashExpensesAndAdvancesTotal =
      targetWorkerId === null ? ownerCashExpensesTotal : workerCashAdvancesTotal;

    const ownerCashDepositsTotal = Number(ownerCashDepositsAgg._sum.amount ?? 0);
    const ownerCashWithdrawalsTotal = Number(ownerCashWithdrawalsAgg._sum.amount ?? 0);
    const walletCashOutsTotal = Number(walletCashOutsAgg._sum.cashOutToDrawer ?? 0);

    const expectedCash = round2(
      openingCash +
        cashSalesTotal -
        cashSaleReturnsTotal +
        cashPaymentsTotal +
        cashPurchaseRefundsTotal +
        ownerCashDepositsTotal +
        walletCashOutsTotal -
        cashPurchasesTotal -
        cashSupplierPaymentsTotal -
        cashExpensesAndAdvancesTotal -
        ownerCashWithdrawalsTotal,
    );

    // 2) البحث عن سجل الإغلاق أو إنشاؤه
    let closing = await this.prisma.dailyClosing.findFirst({
      where: {
        storeOwnerId,
        workerId: targetWorkerId,
        closingDate: todayDate,
      },
    });

    if (!closing) {
      closing = await this.prisma.dailyClosing.create({
        data: {
          storeOwnerId,
          workerId: targetWorkerId,
          closingDate: todayDate,
          actualCash: new Prisma.Decimal(0),
          expectedCash: new Prisma.Decimal(expectedCash),
          difference: new Prisma.Decimal(round2(0 - expectedCash)),
          status: 'OPEN',
        },
      });
    } else if (closing.status === 'OPEN') {
      // تحديث الكاش المتوقع إن تغيرت حركات اليوم قبل الاعتماد
      const diff = round2(Number(closing.actualCash) - expectedCash);
      closing = await this.prisma.dailyClosing.update({
        where: { id: closing.id },
        data: {
          expectedCash: new Prisma.Decimal(expectedCash),
          difference: new Prisma.Decimal(diff),
        },
      });
    }

    // تفاصيل ملخص اليوم للشاشة (SCREEN_SPEC #16)
    const [allSales, allElectronicSales, allCreditSales] = await Promise.all([
      this.prisma.sale.aggregate({
        where: {
          storeOwnerId,
          workerId: targetWorkerId,
          soldAt: { gte: todayDate, lt: tomorrowDate },
        },
        _sum: { amount: true },
        _count: { id: true },
      }),
      this.prisma.sale.aggregate({
        where: {
          storeOwnerId,
          workerId: targetWorkerId,
          paymentType: 'ELECTRONIC',
          soldAt: { gte: todayDate, lt: tomorrowDate },
        },
        _sum: { amount: true },
      }),
      this.prisma.sale.aggregate({
        where: {
          storeOwnerId,
          workerId: targetWorkerId,
          paymentType: 'CREDIT',
          soldAt: { gte: todayDate, lt: tomorrowDate },
        },
        _sum: { amount: true },
      }),
    ]);

    let workersList: Array<{
      id: string;
      name: string;
      full_name: string;
      phone: string;
      is_responsible: boolean;
      status: string;
    }> = [];

    if (user.role === 'STORE_OWNER' || user.isResponsible) {
      const activeWorkers = await this.prisma.worker.findMany({
        where: {
          storeOwnerId,
          status: { not: 'DELETED' },
        },
        orderBy: [{ isResponsible: 'desc' }, { fullName: 'asc' }],
        select: {
          id: true,
          fullName: true,
          phone: true,
          isResponsible: true,
          status: true,
        },
      });
      workersList = activeWorkers.map((w) => ({
        id: w.id,
        name: w.fullName,
        full_name: w.fullName,
        phone: w.phone,
        is_responsible: w.isResponsible,
        status: w.status,
      }));
    }

    return {
      closing_id: closing.id,
      closing_date: closing.closingDate,
      worker_id: closing.workerId,
      status: closing.status,
      opening_cash: openingCash,
      actual_cash: Number(closing.actualCash),
      expected_cash: Number(closing.expectedCash),
      difference: Number(closing.difference),
      workers: workersList,
      summary: {
        opening_cash: openingCash,
        total_sales: allSales._sum.amount ? Number(allSales._sum.amount) : 0,
        sales_count: allSales._count.id,
        cash_sales: cashSalesTotal,
        cash_sale_returns: cashSaleReturnsTotal,
        electronic_sales: allElectronicSales._sum.amount ? Number(allElectronicSales._sum.amount) : 0,
        credit_sales: allCreditSales._sum.amount ? Number(allCreditSales._sum.amount) : 0,
        collected_cash_payments: cashPaymentsTotal,
        cash_purchases: cashPurchasesTotal,
        cash_supplier_payments: cashSupplierPaymentsTotal,
        cash_purchase_refunds: cashPurchaseRefundsTotal,
        cash_expenses: cashExpensesAndAdvancesTotal,
        owner_cash_deposits: ownerCashDepositsTotal,
        owner_cash_withdrawals: ownerCashWithdrawalsTotal,
        wallet_cash_outs: walletCashOutsTotal,
      },
    };
  }

  // تعديل الكاش الفعلي قبل الاعتماد — R-36
  async updateActualCash(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateActualCashDto,
    ip?: string,
  ) {
    const storeOwnerId = user.storeOwnerId!;
    const closing = await this.prisma.dailyClosing.findFirst({
      where: { id, storeOwnerId },
    });
    if (!closing) throw ApiError.notFound('سجل المطابقة غير موجود.');
    if (closing.status === 'CLOSED') {
      throw ApiError.conflict('DAY_ALREADY_CLOSED', 'تم اعتماد إغلاق هذا اليوم مسبقاً ولا يمكن تعديله.');
    }

    // التحقق من الصلاحيات (R-36):
    if (user.role === 'WORKER') {
      const isOwnClosing = closing.workerId === user.workerId;
      if (!isOwnClosing) {
        if (!user.isResponsible) {
          throw ApiError.forbidden('PERMISSION_DENIED', 'لا تملك صلاحية تعديل كاش عامل آخر.');
        }
        // العامل المسؤول ممنوع من تعديل إغلاق صندوق المالك/المتجر العام
        if (closing.workerId === null) {
          throw ApiError.forbidden(
            'PERMISSION_DENIED',
            'تعديل كاش إغلاق المتجر الخاص بالمالك حصري لمالك المتجر فقط.',
          );
        }
        // العامل المسؤول يحتاج صلاحية permEditWorkerClosingCash
        const worker = await this.prisma.worker.findUniqueOrThrow({
          where: { id: user.workerId! },
          select: { permEditWorkerClosingCash: true },
        });
        if (!worker.permEditWorkerClosingCash) {
          throw ApiError.forbidden(
            'PERMISSION_DENIED',
            'ليس لديك صلاحية تعديل كاش العمال الآخرين في المطابقة.',
          );
        }
      }
    }

    const actualCashDecimal = new Prisma.Decimal(dto.actualCash);
    const differenceDecimal = actualCashDecimal.minus(closing.expectedCash);

    const updated = await this.prisma.dailyClosing.update({
      where: { id },
      data: {
        actualCash: actualCashDecimal,
        difference: differenceDecimal,
      },
    });

    void ip;

    return {
      closing_id: updated.id,
      actual_cash: Number(updated.actualCash),
      expected_cash: Number(updated.expectedCash),
      difference: Number(updated.difference),
      status: updated.status,
    };
  }

  async updateWorkerActualCash(
    user: AuthenticatedUser,
    id: string,
    workerId: string,
    dto: UpdateActualCashDto,
    ip?: string,
  ) {
    if (user.role === 'WORKER' && (!workerId || workerId === '')) {
      throw ApiError.forbidden(
        'PERMISSION_DENIED',
        'تعديل كاش إغلاق المتجر الخاص بالمالك حصري لمالك المتجر فقط.',
      );
    }
    const storeOwnerId = user.storeOwnerId!;
    const existing = await this.prisma.dailyClosing.findFirst({
      where: { id, storeOwnerId },
    });
    if (existing && existing.workerId === workerId) {
      return this.updateActualCash(user, id, dto, ip);
    }
    const workerClosing = await this.getToday(user, workerId);
    return this.updateActualCash(user, workerClosing.closing_id, dto, ip);
  }

  // اعتماد الإغلاق النهائي — حصري للمالك دائماً (R-04 / R-21 / R-36)
  async approve(user: AuthenticatedUser, id: string, ip?: string) {
    if (user.role !== 'STORE_OWNER') {
      throw ApiError.forbidden('PERMISSION_DENIED', 'اعتماد الإغلاق النهائي حصري لمالك المتجر فقط.');
    }
    const storeOwnerId = user.storeOwnerId!;

    const closing = await this.prisma.dailyClosing.findFirst({
      where: { id, storeOwnerId },
    });
    if (!closing) throw ApiError.notFound('سجل المطابقة غير موجود.');
    if (closing.status === 'CLOSED') {
      throw ApiError.conflict('DAY_ALREADY_CLOSED', 'هذا الإغلاق معتمد مسبقاً.');
    }

    const todayDate = startOfDay(closing.closingDate);
    const tomorrowDate = new Date(todayDate.getTime() + 24 * 60 * 60 * 1000);

    return this.prisma.$transaction(async (tx) => {
      // قفل ذرّي على مستوى الصف داخل المعاملة لمنع تكرار الاعتماد بالتزامن (Race Conditions)
      const lockResult = await tx.dailyClosing.updateMany({
        where: { id, storeOwnerId, status: 'OPEN' },
        data: {
          status: 'CLOSED',
          approvedBy: storeOwnerId,
          approvedAt: new Date(),
        },
      });
      if (lockResult.count === 0) {
        const currentClosing = await tx.dailyClosing.findFirst({
          where: { id, storeOwnerId },
          select: { id: true },
        });
        if (!currentClosing) throw ApiError.notFound('سجل المطابقة غير موجود.');
        throw ApiError.conflict('DAY_ALREADY_CLOSED', 'هذا الإغلاق معتمد مسبقاً.');
      }

      const approved = await tx.dailyClosing.findUniqueOrThrow({
        where: { id },
      });

      // 2) ربط العمليات غير المربوطة بهذا الإغلاق
      await tx.sale.updateMany({
        where: {
          storeOwnerId,
          workerId: closing.workerId,
          soldAt: { gte: todayDate, lt: tomorrowDate },
          dailyClosingId: null,
        },
        data: { dailyClosingId: approved.id },
      });

      await tx.creditPayment.updateMany({
        where: {
          storeOwnerId,
          workerId: closing.workerId,
          paidAt: { gte: todayDate, lt: tomorrowDate },
          dailyClosingId: null,
        },
        data: { dailyClosingId: approved.id },
      });

      await tx.purchaseInvoice.updateMany({
        where: {
          storeOwnerId,
          workerId: closing.workerId,
          invoiceDate: todayDate,
          status: 'POSTED',
          dailyClosingId: null,
        },
        data: { dailyClosingId: approved.id },
      });

      await tx.supplierPayment.updateMany({
        where: {
          storeOwnerId,
          workerId: closing.workerId,
          paidAt: { gte: todayDate, lt: tomorrowDate },
          dailyClosingId: null,
        },
        data: { dailyClosingId: approved.id },
      });

      // 3) قيود الإقفال المحاسبية المرحلتين (R-21 / 12-business-logic §7)
      const diff = Number(approved.difference);

      // المرحلة 1 — قيد تسوية فرق الصندوق
      if (diff < 0) {
        // عجز
        const shortage = Math.abs(diff);
        await this.accounting.createBalancedEntries(tx, {
          storeOwnerId,
          entryDate: todayDate,
          referenceType: 'CLOSING',
          referenceId: approved.id,
          lines: [
            { accountCode: '5600', debit: shortage, description: 'عجز الصندوق في الإغلاق اليومي' },
            { accountCode: '1000', credit: shortage, description: 'تسوية عجز الصندوق' },
          ],
        });
      } else if (diff > 0) {
        // زيادة
        await this.accounting.createBalancedEntries(tx, {
          storeOwnerId,
          entryDate: todayDate,
          referenceType: 'CLOSING',
          referenceId: approved.id,
          lines: [
            { accountCode: '1000', debit: diff, description: 'إيداع فائض الصندوق في الإغلاق اليومي' },
            { accountCode: '4300', credit: diff, description: 'فائض الصندوق' },
          ],
        });
      }

      // المرحلة 2 — قيد الإقفال الدوري (تصفير حسابات النتيجة المؤقتة إلى الأرباح المحتجزة 3900)
      const closedSales = await tx.sale.findMany({
        where: { dailyClosingId: approved.id },
        select: {
          amount: true,
          quantity: true,
          cogsAmount: true,
          priceDifferenceLoss: true,
          item: { select: { costPrice: true } },
        },
      });

      let totalSalesRevenue = 0;
      let totalCogs = 0;
      let totalEmergencyLoss = 0;

      for (const s of closedSales) {
        totalSalesRevenue += Number(s.amount);
        totalCogs +=
          s.cogsAmount !== null ? Number(s.cogsAmount) : Number(s.quantity) * Number(s.item.costPrice);
        totalEmergencyLoss += Number(s.priceDifferenceLoss);
      }

      totalSalesRevenue = round2(totalSalesRevenue);
      totalCogs = round2(totalCogs);
      totalEmergencyLoss = round2(totalEmergencyLoss);

      // إذا كانت هناك مبيعات، نقوم بتصفيرها دورياً لحساب 3900
      if (totalSalesRevenue > 0 || totalCogs > 0 || totalEmergencyLoss > 0) {
        const closingLines: Array<{ accountCode: string; debit?: number; credit?: number; description: string }> = [];

        if (totalSalesRevenue > 0) {
          closingLines.push({ accountCode: '4000', debit: totalSalesRevenue, description: 'إقفال حساب المبيعات' });
        }
        if (totalCogs > 0) {
          closingLines.push({ accountCode: '5000', credit: totalCogs, description: 'إقفال تكلفة البضاعة المباعة' });
        }
        if (totalEmergencyLoss > 0) {
          closingLines.push({ accountCode: '5450', credit: totalEmergencyLoss, description: 'إقفال خسائر البيع الاضطراري' });
        }

        const debitSum = round2(closingLines.reduce((s, l) => s + (l.debit ?? 0), 0));
        const creditSum = round2(closingLines.reduce((s, l) => s + (l.credit ?? 0), 0));
        const netDifference = round2(debitSum - creditSum);

        if (netDifference > 0) {
          closingLines.push({ accountCode: '3900', credit: netDifference, description: 'صافي أرباح اليوم المقفلة' });
        } else if (netDifference < 0) {
          closingLines.push({ accountCode: '3900', debit: Math.abs(netDifference), description: 'صافي خسائر اليوم المقفلة' });
        }

        await this.accounting.createBalancedEntries(tx, {
          storeOwnerId,
          entryDate: todayDate,
          referenceType: 'CLOSING',
          referenceId: approved.id,
          lines: closingLines,
        });
      }

      await this.audit.log({
        actorType: 'STORE_OWNER',
        actorId: storeOwnerId,
        actionType: 'DAILY_CLOSING_APPROVE',
        targetType: 'daily_closing',
        targetId: approved.id,
        newValue: {
          opening_cash: 0,
          actual_cash: Number(approved.actualCash),
          expected_cash: Number(approved.expectedCash),
          difference: diff,
        },
        ipAddress: ip,
        result: 'SUCCESS',
      });

      return {
        closing_id: approved.id,
        status: approved.status,
        approved_at: approved.approvedAt,
        opening_cash: 0,
        actual_cash: Number(approved.actualCash),
        expected_cash: Number(approved.expectedCash),
        difference: diff,
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
