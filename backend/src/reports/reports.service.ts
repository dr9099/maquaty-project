import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthenticatedUser } from '../common/types';
import { QueryReportsDto, ReportType } from './dto/reports.dto';

// خدمة الأموال والتقارير — API_SPEC القسم 10
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async getFundsSummary(user: AuthenticatedUser, dateStr?: string) {
    const storeOwnerId = user.storeOwnerId!;

    const dateFilter = dateStr
      ? { entryDate: { lte: new Date(dateStr) } }
      : {};

    // 1) رصيد الصندوق (الحساب 1000)
    const cashEntries = await this.prisma.ledgerEntry.findMany({
      where: {
        storeOwnerId,
        account: { code: '1000' },
        ...dateFilter,
      },
      select: { debit: true, credit: true },
    });
    const cashBalance = cashEntries.reduce(
      (sum, e) => sum.plus(e.debit).minus(e.credit),
      new Prisma.Decimal(0),
    );

    // 2) رصيد المحافظ الإلكترونية (الحساب 1100 والحسابات الفرعية)
    const walletEntries = await this.prisma.ledgerEntry.findMany({
      where: {
        storeOwnerId,
        account: { code: { startsWith: '1100' } },
        ...dateFilter,
      },
      select: { debit: true, credit: true },
    });
    const walletBalance = walletEntries.reduce(
      (sum, e) => sum.plus(e.debit).minus(e.credit),
      new Prisma.Decimal(0),
    );

    // 3) رصيد ذمم العملاء (الحساب 1200)
    const creditEntries = await this.prisma.ledgerEntry.findMany({
      where: {
        storeOwnerId,
        account: { code: '1200' },
        ...dateFilter,
      },
      select: { debit: true, credit: true },
    });
    const receivablesBalance = creditEntries.reduce(
      (sum, e) => sum.plus(e.debit).minus(e.credit),
      new Prisma.Decimal(0),
    );

    const totalFunds = cashBalance.plus(walletBalance).plus(receivablesBalance);

    return {
      date: dateStr ?? new Date().toISOString().split('T')[0],
      cash_in_hand: Number(cashBalance.toDecimalPlaces(2)),
      wallets_balance: Number(walletBalance.toDecimalPlaces(2)),
      customer_receivables: Number(receivablesBalance.toDecimalPlaces(2)),
      total_funds: Number(totalFunds.toDecimalPlaces(2)),
    };
  }

  async getReport(user: AuthenticatedUser, dto: QueryReportsDto) {
    const storeOwnerId = user.storeOwnerId!;

    // التحقق من صلاحية العامل
    if (user.role === 'WORKER') {
      const worker = await this.prisma.worker.findUniqueOrThrow({
        where: { id: user.workerId! },
        select: { permReportsAccess: true },
      });
      if (!worker.permReportsAccess) {
        throw ApiError.forbidden('PERMISSION_DENIED', 'ليس لديك صلاحية الوصول إلى التقارير.');
      }
    }

    const start = dto.date_from ? new Date(dto.date_from) : new Date(0);
    const end = dto.date_to ? new Date(dto.date_to) : new Date('2099-12-31');
    end.setHours(23, 59, 59, 999);

    switch (dto.type) {
      case ReportType.SALES: {
        const sales = await this.prisma.sale.findMany({
          where: {
            storeOwnerId,
            soldAt: { gte: start, lte: end },
          },
          include: {
            item: { select: { name: true, unit: true } },
            worker: { select: { fullName: true } },
          },
          orderBy: { soldAt: 'desc' },
        });

        const totalAmount = sales.reduce((sum, s) => sum.plus(s.amount), new Prisma.Decimal(0));
        const totalQuantity = sales.reduce((sum, s) => sum.plus(s.quantity), new Prisma.Decimal(0));

        return {
          type: 'sales',
          count: sales.length,
          total_amount: Number(totalAmount.toDecimalPlaces(2)),
          total_quantity: Number(totalQuantity.toDecimalPlaces(3)),
          records: sales.map((s) => ({
            id: s.id,
            item_name: s.item.name,
            unit: s.item.unit,
            quantity: Number(s.quantity),
            amount: Number(s.amount),
            payment_type: s.paymentType,
            sold_by: s.worker?.fullName ?? 'المالك',
            sold_at: s.soldAt,
          })),
        };
      }

      case ReportType.PURCHASES: {
        const items = await this.prisma.item.findMany({
          where: {
            storeOwnerId,
            createdAt: { gte: start, lte: end },
          },
          orderBy: { createdAt: 'desc' },
        });

        const totalCost = items.reduce(
          (sum, i) => sum.plus(i.quantity.mul(i.costPrice)),
          new Prisma.Decimal(0),
        );
        const totalQuantity = items.reduce((sum, i) => sum.plus(i.quantity), new Prisma.Decimal(0));

        return {
          type: 'purchases',
          count: items.length,
          total_cost: Number(totalCost.toDecimalPlaces(2)),
          total_quantity: Number(totalQuantity.toDecimalPlaces(3)),
          records: items.map((i) => ({
            id: i.id,
            name: i.name,
            unit: i.unit,
            quantity: Number(i.quantity),
            cost_price: Number(i.costPrice),
            total_purchase_cost: Number(i.quantity.mul(i.costPrice).toDecimalPlaces(2)),
            created_at: i.createdAt,
          })),
        };
      }

      case ReportType.EXPENSES: {
        const [rents, utilities, employeePayments] = await Promise.all([
          this.prisma.rentRecord.findMany({
            where: { storeOwnerId, paidAt: { gte: start, lte: end } },
            orderBy: { paidAt: 'desc' },
          }),
          this.prisma.utilityPayment.findMany({
            where: { storeOwnerId, paidAt: { gte: start, lte: end } },
            orderBy: { paidAt: 'desc' },
          }),
          this.prisma.employeePayment.findMany({
            where: { storeOwnerId, paidAt: { gte: start, lte: end } },
            include: { employee: { select: { name: true } } },
            orderBy: { paidAt: 'desc' },
          }),
        ]);

        const rentTotal = rents.reduce((sum, r) => sum.plus(r.amount), new Prisma.Decimal(0));
        const utilityTotal = utilities.reduce((sum, u) => sum.plus(u.amount), new Prisma.Decimal(0));
        const employeeTotal = employeePayments.reduce((sum, e) => sum.plus(e.amount), new Prisma.Decimal(0));
        const totalExpenses = rentTotal.plus(utilityTotal).plus(employeeTotal);

        return {
          type: 'expenses',
          total_expenses: Number(totalExpenses.toDecimalPlaces(2)),
          categories: {
            rent: Number(rentTotal.toDecimalPlaces(2)),
            utilities: Number(utilityTotal.toDecimalPlaces(2)),
            salaries: Number(employeeTotal.toDecimalPlaces(2)),
          },
          records: [
            ...rents.map((r) => ({
              category: 'RENT',
              description: `إيجار مدفوع لـ: ${r.receiverName}`,
              amount: Number(r.amount),
              paid_at: r.paidAt,
            })),
            ...utilities.map((u) => ({
              category: 'UTILITY',
              description: `خدمة: ${u.utilityType}`,
              amount: Number(u.amount),
              paid_at: u.paidAt,
            })),
            ...employeePayments.map((e) => ({
              category: 'SALARY',
              description: `راتب موظف: ${e.employee.name}`,
              amount: Number(e.amount),
              paid_at: e.paidAt,
            })),
          ].sort((a, b) => b.paid_at.getTime() - a.paid_at.getTime()),
        };
      }

      case ReportType.WITHDRAWALS: {
        const [workerAdvances, employeeAdvances] = await Promise.all([
          this.prisma.workerAdvance.findMany({
            where: { storeOwnerId, recordedAt: { gte: start, lte: end } },
            include: { worker: { select: { fullName: true } } },
            orderBy: { recordedAt: 'desc' },
          }),
          this.prisma.employeeAdvance.findMany({
            where: { storeOwnerId, createdAt: { gte: start, lte: end } },
            include: { employee: { select: { name: true } } },
            orderBy: { createdAt: 'desc' },
          }),
        ]);

        const workerAdvTotal = workerAdvances.reduce((sum, w) => sum.plus(w.amount), new Prisma.Decimal(0));
        const employeeAdvTotal = employeeAdvances.reduce((sum, e) => sum.plus(e.amount), new Prisma.Decimal(0));
        const totalWithdrawals = workerAdvTotal.plus(employeeAdvTotal);

        return {
          type: 'withdrawals',
          total_withdrawals: Number(totalWithdrawals.toDecimalPlaces(2)),
          categories: {
            worker_advances: Number(workerAdvTotal.toDecimalPlaces(2)),
            employee_advances: Number(employeeAdvTotal.toDecimalPlaces(2)),
          },
          records: [
            ...workerAdvances.map((w) => ({
              type: 'WORKER_ADVANCE',
              recipient: w.worker.fullName,
              amount: Number(w.amount),
              note: w.note,
              date: w.recordedAt,
            })),
            ...employeeAdvances.map((e) => ({
              type: 'EMPLOYEE_ADVANCE',
              recipient: e.employee.name,
              amount: Number(e.amount),
              note: e.note,
              date: e.createdAt,
            })),
          ].sort((a, b) => b.date.getTime() - a.date.getTime()),
        };
      }
    }
  }
}
