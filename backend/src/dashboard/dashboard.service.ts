import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../common/types';

// لوحة ملخص الشاشة الرئيسية — API_SPEC القسم 15
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(user: AuthenticatedUser) {
    const storeOwnerId = user.storeOwnerId!;

    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    const tomorrowDate = new Date(todayDate.getTime() + 24 * 60 * 60 * 1000);

    const isStoreWide = user.role === 'STORE_OWNER' || user.isResponsible;
    const workerFilter = isStoreWide ? {} : { workerId: user.workerId! };

    const [salesAgg, cashSalesAgg, cashPaymentsAgg, closing] = await Promise.all([
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
    ]);

    const cashSales = cashSalesAgg._sum.amount ? Number(cashSalesAgg._sum.amount) : 0;
    const cashPayments = cashPaymentsAgg._sum.amount ? Number(cashPaymentsAgg._sum.amount) : 0;
    const cashToday = cashSales + cashPayments;

    const salesTotal = salesAgg._sum.amount ? Number(salesAgg._sum.amount) : 0;
    const salesCount = salesAgg._count.id;

    return {
      today_status: closing?.status ?? 'OPEN',
      cash_today: cashToday,
      sales_today_total: salesTotal,
      sales_today_count: salesCount,
    };
  }
}
