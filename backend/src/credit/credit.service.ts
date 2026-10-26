import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import { AuthenticatedUser } from '../common/types';
import {
  CreateCreditCustomerDto,
  RecordCreditPaymentDto,
  UpdateCreditCustomerDto,
} from './dto/credit.dto';

// خدمة الآجل — API_SPEC القسم 7 / R-11 / R-12 / BR-018..021
@Injectable()
export class CreditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
    private readonly audit: AuditService,
  ) {}

  async list(storeOwnerId: string, search?: string) {
    const where: Prisma.CreditCustomerWhereInput = {
      storeOwnerId,
      deletedAt: null,
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
        ],
      }),
    };

    const customers = await this.prisma.creditCustomer.findMany({
      where,
      orderBy: { name: 'asc' },
    });

    const results = await Promise.all(
      customers.map(async (c) => {
        const totalDebt = await this.calculateCustomerDebt(c.id);
        return {
          id: c.id,
          name: c.name,
          phone: c.phone,
          credit_limit: c.creditLimit ? Number(c.creditLimit) : null,
          total_debt: totalDebt,
          created_at: c.createdAt,
        };
      }),
    );

    return results;
  }

  async create(user: AuthenticatedUser, dto: CreateCreditCustomerDto, ip?: string) {
    const storeOwnerId = user.storeOwnerId!;
    const customer = await this.prisma.creditCustomer.create({
      data: {
        storeOwnerId,
        name: dto.name.trim(),
        phone: dto.phone?.trim() ?? null,
        creditLimit: dto.creditLimit !== undefined ? new Prisma.Decimal(dto.creditLimit) : null,
        addedByWorkerId: user.role === 'WORKER' ? user.workerId : null,
      },
    });

    await this.audit.log({
      actorType: user.role === 'WORKER' ? 'WORKER' : 'STORE_OWNER',
      actorId: user.role === 'WORKER' ? user.workerId! : user.storeOwnerId!,
      actionType: 'CREDIT_CUSTOMER_CREATE',
      targetType: 'credit_customer',
      targetId: customer.id,
      newValue: { name: customer.name, credit_limit: customer.creditLimit },
      ipAddress: ip,
      result: 'SUCCESS',
    });

    return {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      credit_limit: customer.creditLimit ? Number(customer.creditLimit) : null,
      total_debt: 0,
      created_at: customer.createdAt,
    };
  }

  async update(storeOwnerId: string, id: string, dto: UpdateCreditCustomerDto, ip?: string) {
    const customer = await this.mustGetOwned(storeOwnerId, id);

    const data: Prisma.CreditCustomerUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.phone !== undefined) data.phone = dto.phone ? dto.phone.trim() : null;
    if (dto.creditLimit !== undefined) {
      data.creditLimit = dto.creditLimit !== null ? new Prisma.Decimal(dto.creditLimit) : null;
    }

    const updated = await this.prisma.creditCustomer.update({
      where: { id: customer.id },
      data,
    });

    const totalDebt = await this.calculateCustomerDebt(updated.id);

    return {
      id: updated.id,
      name: updated.name,
      phone: updated.phone,
      credit_limit: updated.creditLimit ? Number(updated.creditLimit) : null,
      total_debt: totalDebt,
      updated_at: updated.updatedAt,
    };
  }

  async getDebts(storeOwnerId: string, id: string) {
    await this.mustGetOwned(storeOwnerId, id);

    const sales = await this.prisma.sale.findMany({
      where: { creditCustomerId: id, storeOwnerId },
      include: {
        item: { select: { name: true, unit: true } },
        worker: { select: { fullName: true } },
      },
      orderBy: { soldAt: 'desc' },
    });

    return sales.map((s) => ({
      sale_id: s.id,
      item_name: s.item.name,
      unit: s.item.unit,
      quantity: Number(s.quantity),
      amount: Number(s.amount),
      is_emergency_sale: s.isEmergencySale,
      emergency_reason: s.emergencyReason,
      sold_by: s.worker?.fullName ?? 'المالك',
      sold_at: s.soldAt,
    }));
  }

  async getPayments(storeOwnerId: string, id: string) {
    await this.mustGetOwned(storeOwnerId, id);

    const payments = await this.prisma.creditPayment.findMany({
      where: { creditCustomerId: id, storeOwnerId },
      include: {
        worker: { select: { fullName: true } },
      },
      orderBy: { paidAt: 'desc' },
    });

    return payments.map((p) => ({
      payment_id: p.id,
      amount: Number(p.amount),
      payment_method: p.paymentMethod,
      wallet_id: p.walletId,
      collected_by: p.worker?.fullName ?? 'المالك',
      paid_at: p.paidAt,
    }));
  }

  async recordPayment(
    user: AuthenticatedUser,
    customerId: string,
    dto: RecordCreditPaymentDto,
    ip?: string,
  ) {
    const storeOwnerId = user.storeOwnerId!;
    await this.mustGetOwned(storeOwnerId, customerId);

    if (dto.amount <= 0) {
      throw ApiError.badRequest('VALIDATION_ERROR', 'مبلغ الدفعة يجب أن يكون أكبر من صفر.');
    }

    let walletAccountCode: string | null = null;
    if (dto.paymentMethod === 'ELECTRONIC') {
      if (!dto.walletId) {
        throw ApiError.badRequest('VALIDATION_ERROR', 'اختيار المحفظة إلزامي للدفع الإلكتروني.');
      }
      const wallet = await this.prisma.wallet.findFirst({
        where: { id: dto.walletId, storeOwnerId, isActive: true },
      });
      if (!wallet) throw ApiError.notFound('المحفظة غير موجودة.');
      const walletAccount = await this.prisma.chartOfAccount.findFirst({
        where: { storeOwnerId, accountType: 'ASSET', name: { startsWith: `محفظة: ${wallet.name}` } },
        select: { code: true },
      });
      walletAccountCode = walletAccount?.code ?? '1100';
    }

    const amountDecimal = new Prisma.Decimal(dto.amount);

    const payment = await this.prisma.$transaction(async (tx) => {
      const createdPayment = await tx.creditPayment.create({
        data: {
          storeOwnerId,
          creditCustomerId: customerId,
          amount: amountDecimal,
          paymentMethod: dto.paymentMethod,
          walletId: dto.walletId ?? null,
          workerId: user.role === 'WORKER' ? user.workerId : null,
          paidAt: new Date(),
        },
      });

      // قيد محاسبي متوازن: مدين الصندوق أو المحفظة، ودائن ذمم العملاء (1200)
      const debitAccount = dto.paymentMethod === 'CASH' ? '1000' : (walletAccountCode ?? '1100');
      await this.accounting.createBalancedEntries(tx, {
        storeOwnerId,
        entryDate: new Date(),
        referenceType: 'CREDIT_PAYMENT',
        referenceId: createdPayment.id,
        lines: [
          { accountCode: debitAccount, debit: dto.amount, description: 'تحصيل دفعة آجل' },
          { accountCode: '1200', credit: dto.amount, description: 'سداد من ذمة العميل' },
        ],
      });

      return createdPayment;
    });

    const newDebt = await this.calculateCustomerDebt(customerId);

    return {
      payment_id: payment.id,
      customer_id: customerId,
      amount: Number(payment.amount),
      payment_method: payment.paymentMethod,
      remaining_debt: newDebt,
      paid_at: payment.paidAt,
    };
  }

  async getStatement(storeOwnerId: string, id: string) {
    const customer = await this.mustGetOwned(storeOwnerId, id);

    const [sales, payments] = await Promise.all([
      this.prisma.sale.findMany({
        where: { creditCustomerId: id, storeOwnerId },
        select: {
          id: true,
          amount: true,
          soldAt: true,
          item: { select: { name: true } },
          quantity: true,
        },
      }),
      this.prisma.creditPayment.findMany({
        where: { creditCustomerId: id, storeOwnerId },
        select: {
          id: true,
          amount: true,
          paymentMethod: true,
          paidAt: true,
        },
      }),
    ]);

    type Tx = {
      id: string;
      date: Date;
      type: 'PURCHASE' | 'PAYMENT';
      description: string;
      debit: number;
      credit: number;
    };

    const combined: Tx[] = [
      ...sales.map((s) => ({
        id: s.id,
        date: s.soldAt,
        type: 'PURCHASE' as const,
        description: `شراء: ${s.item.name} (${Number(s.quantity)})`,
        debit: Number(s.amount),
        credit: 0,
      })),
      ...payments.map((p) => ({
        id: p.id,
        date: p.paidAt,
        type: 'PAYMENT' as const,
        description: `سداد دفعة (${p.paymentMethod === 'CASH' ? 'نقداً' : 'إلكتروني'})`,
        debit: 0,
        credit: Number(p.amount),
      })),
    ];

    combined.sort((a, b) => a.date.getTime() - b.date.getTime());

    let runningBalance = 0;
    const ledger = combined.map((entry) => {
      runningBalance += entry.debit - entry.credit;
      return {
        ...entry,
        running_balance: runningBalance,
      };
    });

    return {
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        credit_limit: customer.creditLimit ? Number(customer.creditLimit) : null,
        total_debt: runningBalance,
      },
      transactions: ledger,
    };
  }

  private async calculateCustomerDebt(customerId: string): Promise<number> {
    const [salesAgg, paymentsAgg] = await Promise.all([
      this.prisma.sale.aggregate({
        where: { creditCustomerId: customerId },
        _sum: { amount: true },
      }),
      this.prisma.creditPayment.aggregate({
        where: { creditCustomerId: customerId },
        _sum: { amount: true },
      }),
    ]);

    const salesTotal = salesAgg._sum.amount ? Number(salesAgg._sum.amount) : 0;
    const paymentsTotal = paymentsAgg._sum.amount ? Number(paymentsAgg._sum.amount) : 0;
    return salesTotal - paymentsTotal;
  }

  private async mustGetOwned(storeOwnerId: string, id: string) {
    const customer = await this.prisma.creditCustomer.findFirst({
      where: { id, storeOwnerId, deletedAt: null },
    });
    if (!customer) throw ApiError.notFound('عميل الآجل غير موجود.');
    return customer;
  }
}
