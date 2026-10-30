import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../common/types';
import { CURRENCY_METADATA } from '../settings/settings.service';

// لوحة ملخص الشاشة الرئيسية — API_SPEC القسم 15
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(user: AuthenticatedUser) {
    const storeOwnerId = user.storeOwnerId!;

    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    const tomorrowDate = new Date(todayDate.getTime() + 24 * 60 * 60 * 1000);

    const isOwner = user.role === 'STORE_OWNER';
    const isStoreWide = isOwner || user.isResponsible;
    const workerFilter = isStoreWide ? {} : { workerId: user.workerId! };

    const [owner, salesAgg, cashSalesAgg, cashPaymentsAgg, closing, purchasesTodayAgg, payablesAgg] =
      await Promise.all([
        this.prisma.storeOwner.findUniqueOrThrow({
          where: { id: storeOwnerId },
          select: { currency: true },
        }),
        // إجمالي المبيعات والعدد
        this.prisma.sale.aggregate({
          where: {
            storeOwnerId,
            ...workerFilter,
            soldAt: { gte: todayDate, lt: tomorrowDate },
          },
          _sum: { amount: true },
          _count: { id: true },
        }),
        // مبيعات النقد
        this.prisma.sale.aggregate({
          where: {
            storeOwnerId,
            ...workerFilter,
            paymentType: 'CASH',
            soldAt: { gte: todayDate, lt: tomorrowDate },
          },
          _sum: { amount: true },
        }),
        // دفعات الآجل النقدية
        this.prisma.creditPayment.aggregate({
          where: {
            storeOwnerId,
            ...workerFilter,
            paymentMethod: 'CASH',
            paidAt: { gte: todayDate, lt: tomorrowDate },
          },
          _sum: { amount: true },
        }),
        // حالة الإغلاق لليوم
        this.prisma.dailyClosing.findFirst({
          where: {
            storeOwnerId,
            workerId: isStoreWide ? null : user.workerId!,
            closingDate: todayDate,
          },
          select: { status: true },
        }),
        isOwner
          ? this.prisma.purchaseInvoice.aggregate({
              where: { storeOwnerId, status: 'POSTED', invoiceDate: todayDate },
              _sum: { totalAmount: true },
              _count: { id: true },
            })
          : Promise.resolve({ _sum: { totalAmount: null }, _count: { id: 0 } }),
        isOwner
          ? this.prisma.supplier.aggregate({
              where: { storeOwnerId, deletedAt: null },
              _sum: { currentBalance: true },
            })
          : Promise.resolve({ _sum: { currentBalance: null } }),
      ]);

    const cashSales = cashSalesAgg._sum.amount ? Number(cashSalesAgg._sum.amount) : 0;
    const cashPayments = cashPaymentsAgg._sum.amount ? Number(cashPaymentsAgg._sum.amount) : 0;
    const cashToday = cashSales + cashPayments;

    const salesTotal = salesAgg._sum.amount ? Number(salesAgg._sum.amount) : 0;
    const salesCount = salesAgg._count.id;

    return {
      today_status: closing?.status ?? 'OPEN',
      currency: owner.currency,
      currency_symbol: CURRENCY_METADATA[owner.currency].symbol,
      cash_today: cashToday,
      sales_today_total: salesTotal,
      sales_today_count: salesCount,
      ...(isOwner
        ? {
            purchases_today_total: purchasesTodayAgg._sum.totalAmount
              ? Number(purchasesTodayAgg._sum.totalAmount)
              : 0,
            purchases_today_count: purchasesTodayAgg._count.id,
            supplier_payables_total: payablesAgg._sum.currentBalance
              ? Number(payablesAgg._sum.currentBalance)
              : 0,
          }
        : {}),
    };
  }
}
