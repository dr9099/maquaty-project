import { Injectable } from '@nestjs/common';
import { ExpensePaymentMethod, PaymentType, Prisma, UtilityType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import { AuthenticatedUser } from '../common/types';
import {
  CreateEmployeeAdvanceDto,
  CreateEmployeeDto,
  CreateRentRecordDto,
  CreateUnifiedExpenseDto,
  CreateUtilityPaymentDto,
  CreateWorkerAdvanceDto,
  PayEmployeeDto,
  SettleExpenseAccrualDto,
} from './dto/expenses.dto';

// خدمة المصروفات — API_SPEC القسم 8 / R-10 / R-37 / BR-022..025 + الدفع النقدي/الإلكتروني/المستحق (2100) + مصروفات أخرى (5700)
@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
    private readonly audit: AuditService,
  ) {}

  // === 1. أجور الموظفين (Employees) ===

  async listEmployees(storeOwnerId: string) {
    const employees = await this.prisma.employee.findMany({
      where: { storeOwnerId, deletedAt: null },
      include: {
        advances: {
          select: { amount: true, settledAmount: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return employees.map((emp) => {
      const totalAdvances = emp.advances.reduce((sum, a) => sum + Number(a.amount), 0);
      const totalSettled = emp.advances.reduce((sum, a) => sum + Number(a.settledAmount), 0);
      const outstandingAdvances = round2(totalAdvances - totalSettled);
      const monthlyDue = Number(emp.monthlyDue);
      const suggestedNet = Math.max(0, round2(monthlyDue - outstandingAdvances));

      return {
        id: emp.id,
        name: emp.name,
        monthly_due: monthlyDue,
        linked_worker_id: emp.linkedWorkerId,
        outstanding_advances: outstandingAdvances,
        suggested_net: suggestedNet,
        created_at: emp.createdAt,
      };
    });
  }

  async createEmployee(storeOwnerId: string, dto: CreateEmployeeDto, ip?: string) {
    if (dto.linkedWorkerId) {
      const worker = await this.prisma.worker.findFirst({
        where: { id: dto.linkedWorkerId, storeOwnerId, status: { not: 'DELETED' } },
      });
      if (!worker) throw ApiError.notFound('العامل المرتبط غير موجود.');
    }

    const employee = await this.prisma.employee.create({
      data: {
        storeOwnerId,
        name: dto.name.trim(),
        monthlyDue: new Prisma.Decimal(dto.monthlyDue),
        linkedWorkerId: dto.linkedWorkerId ?? null,
      },
    });

    await this.audit.log({
      actorType: 'STORE_OWNER',
      actorId: storeOwnerId,
      actionType: 'EMPLOYEE_CREATE',
      targetType: 'employee',
      targetId: employee.id,
      newValue: { name: employee.name, monthly_due: dto.monthlyDue },
      ipAddress: ip,
      result: 'SUCCESS',
    });

    return {
      id: employee.id,
      name: employee.name,
      monthly_due: Number(employee.monthlyDue),
      linked_worker_id: employee.linkedWorkerId,
      outstanding_advances: 0,
      suggested_net: Number(employee.monthlyDue),
      created_at: employee.createdAt,
    };
  }

  async recordEmployeeAdvance(
    storeOwnerId: string,
    employeeId: string,
    dto: CreateEmployeeAdvanceDto,
    ip?: string,
  ) {
    const employee = await this.mustGetEmployee(storeOwnerId, employeeId);
    const method: ExpensePaymentMethod = dto.paymentMethod ?? 'CASH';
    const { creditAccount } = await this.resolvePaymentAccount(
      storeOwnerId,
      method,
      dto.walletId,
      dto.attachmentUrl,
      null,
      false,
    );
    const amountDecimal = new Prisma.Decimal(dto.amount);

    const advance = await this.prisma.$transaction(async (tx) => {
      const created = await tx.employeeAdvance.create({
        data: {
          storeOwnerId,
          employeeId: employee.id,
          amount: amountDecimal,
          settledAmount: new Prisma.Decimal(0),
          paymentMethod: method,
          walletId: method === 'ELECTRONIC' ? (dto.walletId ?? null) : null,
          attachmentUrl: dto.attachmentUrl?.trim() || null,
          note: dto.note?.trim() ?? null,
        },
      });

      await this.accounting.createBalancedEntries(tx, {
        storeOwnerId,
        entryDate: startOfDay(new Date()),
        referenceType: 'EXPENSE',
        referenceId: created.id,
        lines: [
          { accountCode: '5500', debit: dto.amount, description: `سلفة موظف: ${employee.name}` },
          {
            accountCode: creditAccount,
            credit: dto.amount,
            description: method === 'CASH' ? 'صرف سلفة نقداً' : 'صرف سلفة عبر محفظة إلكترونية',
          },
        ],
      });

      return created;
    });

    return {
      advance_id: advance.id,
      employee_id: employee.id,
      amount: Number(advance.amount),
      payment_method: advance.paymentMethod,
      wallet_id: advance.walletId,
      note: advance.note,
      created_at: advance.createdAt,
    };
  }

  // تسوية الرواتب والسلف — R-37 + دعم نقداً / محفظة / آجل مستحق (2100)
  async payEmployee(storeOwnerId: string, employeeId: string, dto: PayEmployeeDto, ip?: string) {
    const employee = await this.mustGetEmployee(storeOwnerId, employeeId);
    const method: ExpensePaymentMethod = dto.paymentMethod ?? 'CASH';
    const { creditAccount } = await this.resolvePaymentAccount(
      storeOwnerId,
      method,
      dto.walletId,
      dto.attachmentUrl,
      null,
      true,
    );

    return this.prisma.$transaction(async (tx) => {
      const pendingAdvances = await tx.employeeAdvance.findMany({
        where: { employeeId: employee.id, storeOwnerId },
        orderBy: { createdAt: 'asc' },
      });

      let totalUnsettled = 0;
      for (const adv of pendingAdvances) {
        totalUnsettled += Number(adv.amount) - Number(adv.settledAmount);
      }
      totalUnsettled = round2(totalUnsettled);

      const totalDuePaid = round2(dto.amount);
      let requestedDeduct =
        dto.deductAdvances !== undefined
          ? round2(dto.deductAdvances)
          : Math.min(totalDuePaid, totalUnsettled);

      if (requestedDeduct > totalUnsettled) {
        requestedDeduct = totalUnsettled;
      }
      if (requestedDeduct > totalDuePaid) {
        throw ApiError.badRequest('VALIDATION_ERROR', 'مبلغ خصم السلف لا يمكن أن يتجاوز إجمالي المستحق المصروف.');
      }

      const netPayable = round2(totalDuePaid - requestedDeduct);
      const paidNow = method === 'CREDIT' ? 0 : netPayable;
      const remainingAccrued = method === 'CREDIT' ? netPayable : 0;

      // تسوية السلف تدريجياً بنظام FIFO
      let remainingToDeduct = requestedDeduct;
      for (const adv of pendingAdvances) {
        if (remainingToDeduct <= 0) break;
        const unpaid = round2(Number(adv.amount) - Number(adv.settledAmount));
        if (unpaid > 0) {
          const deductFromThis = round2(Math.min(unpaid, remainingToDeduct));
          await tx.employeeAdvance.update({
            where: { id: adv.id },
            data: {
              settledAmount: { increment: new Prisma.Decimal(deductFromThis) },
            },
          });
          remainingToDeduct = round2(remainingToDeduct - deductFromThis);
        }
      }

      const payment = await tx.employeePayment.create({
        data: {
          storeOwnerId,
          employeeId: employee.id,
          amount: new Prisma.Decimal(totalDuePaid),
          advanceDeducted: new Prisma.Decimal(requestedDeduct),
          netPaid: new Prisma.Decimal(netPayable),
          paymentMethod: method,
          walletId: method === 'ELECTRONIC' ? (dto.walletId ?? null) : null,
          attachmentUrl: dto.attachmentUrl?.trim() || null,
          paidAmount: new Prisma.Decimal(paidNow),
          remainingAmount: new Prisma.Decimal(remainingAccrued),
          paidAt: new Date(),
        },
      });

      const lines: Array<{ accountCode: string; debit?: number; credit?: number; description: string }> = [
        { accountCode: '5100', debit: totalDuePaid, description: `أجور ومستحقات: ${employee.name}` },
      ];
      if (netPayable > 0) {
        lines.push({
          accountCode: creditAccount,
          credit: netPayable,
          description:
            method === 'CREDIT'
              ? `أجور مستحقة غير مسددة: ${employee.name}`
              : method === 'ELECTRONIC'
                ? 'صرف مستحقات أجور عبر محفظة'
                : 'صرف مستحقات أجور نقداً',
        });
      }
      if (requestedDeduct > 0) {
        lines.push({ accountCode: '5500', credit: requestedDeduct, description: 'تسوية سلف من مستحقات الأجور' });
      }

      await this.accounting.createBalancedEntries(tx, {
        storeOwnerId,
        entryDate: startOfDay(new Date()),
        referenceType: 'EXPENSE',
        referenceId: payment.id,
        lines,
      });

      return {
        payment_id: payment.id,
        employee_id: employee.id,
        total_due_paid: totalDuePaid,
        advance_deducted: requestedDeduct,
        net_paid: netPayable,
        paid_amount: paidNow,
        remaining_amount: remainingAccrued,
        payment_method: method,
        remaining_advances: round2(totalUnsettled - requestedDeduct),
        paid_at: payment.paidAt,
      };
    });
  }

  async getEmployeeStatement(storeOwnerId: string, employeeId: string) {
    const employee = await this.mustGetEmployee(storeOwnerId, employeeId);

    const [advances, payments] = await Promise.all([
      this.prisma.employeeAdvance.findMany({
        where: { employeeId: employee.id, storeOwnerId },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.employeePayment.findMany({
        where: { employeeId: employee.id, storeOwnerId },
        orderBy: { paidAt: 'desc' },
      }),
    ]);

    const totalAdvances = advances.reduce((s, a) => s + Number(a.amount), 0);
    const totalSettled = advances.reduce((s, a) => s + Number(a.settledAmount), 0);

    return {
      employee: {
        id: employee.id,
        name: employee.name,
        monthly_due: Number(employee.monthlyDue),
        total_advances: round2(totalAdvances),
        settled_advances: round2(totalSettled),
        outstanding_advances: round2(totalAdvances - totalSettled),
      },
      advances: advances.map((a) => ({
        id: a.id,
        amount: Number(a.amount),
        settled_amount: Number(a.settledAmount),
        payment_method: a.paymentMethod,
        note: a.note,
        created_at: a.createdAt,
      })),
      payments: payments.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        advance_deducted: Number(p.advanceDeducted),
        net_paid: Number(p.netPaid),
        paid_amount: Number(p.paidAmount),
        remaining_amount: Number(p.remainingAmount),
        payment_method: p.paymentMethod,
        paid_at: p.paidAt,
      })),
    };
  }

  // === 2. الإيجارات (Rent Records) ===

  async listRentRecords(storeOwnerId: string) {
    const records = await this.prisma.rentRecord.findMany({
      where: { storeOwnerId },
      include: { wallet: { select: { id: true, name: true } } },
      orderBy: { paidAt: 'desc' },
    });
    return records.map((r) => ({
      id: r.id,
      amount: Number(r.amount),
      payment_method: r.paymentMethod,
      wallet_id: r.walletId,
      wallet_name: r.wallet?.name ?? null,
      paid_amount: Number(r.paidAmount),
      remaining_amount: Number(r.remainingAmount),
      payer_name: r.payerName,
      receiver_name: r.receiverName,
      note: r.note,
      paid_at: r.paidAt,
    }));
  }

  async createRentRecord(storeOwnerId: string, dto: CreateRentRecordDto) {
    const method: ExpensePaymentMethod = dto.paymentMethod ?? 'CASH';
    const { creditAccount } = await this.resolvePaymentAccount(
      storeOwnerId,
      method,
      dto.walletId,
      dto.attachmentUrl,
      null,
      true,
    );
    const paidNow = method === 'CREDIT' ? 0 : dto.amount;
    const remainingAccrued = method === 'CREDIT' ? dto.amount : 0;

    return this.prisma.$transaction(async (tx) => {
      const record = await tx.rentRecord.create({
        data: {
          storeOwnerId,
          amount: new Prisma.Decimal(dto.amount),
          paymentMethod: method,
          walletId: method === 'ELECTRONIC' ? (dto.walletId ?? null) : null,
          attachmentUrl: dto.attachmentUrl?.trim() || null,
          paidAmount: new Prisma.Decimal(paidNow),
          remainingAmount: new Prisma.Decimal(remainingAccrued),
          payerName: dto.payerName.trim(),
          receiverName: dto.receiverName.trim(),
          note: dto.note?.trim() || null,
          paidAt: new Date(),
        },
      });

      await this.accounting.createBalancedEntries(tx, {
        storeOwnerId,
        entryDate: startOfDay(new Date()),
        referenceType: 'EXPENSE',
        referenceId: record.id,
        lines: [
          { accountCode: '5200', debit: dto.amount, description: `إيجار متجر لـ: ${record.receiverName}` },
          {
            accountCode: creditAccount,
            credit: dto.amount,
            description:
              method === 'CREDIT'
                ? 'إيجار مستحق بالآجل'
                : method === 'ELECTRONIC'
                  ? 'صرف إيجار عبر محفظة إلكترونية'
                  : 'صرف إيجار نقداً',
          },
        ],
      });

      return {
        id: record.id,
        amount: Number(record.amount),
        payment_method: record.paymentMethod,
        wallet_id: record.walletId,
        paid_amount: Number(record.paidAmount),
        remaining_amount: Number(record.remainingAmount),
        payer_name: record.payerName,
        receiver_name: record.receiverName,
        note: record.note,
        paid_at: record.paidAt,
      };
    });
  }

  // === 3. الخدمات والمصروفات الأخرى للمتجر (Utility & Other Store Expenses) ===

  async listUtilityPayments(storeOwnerId: string) {
    const records = await this.prisma.utilityPayment.findMany({
      where: { storeOwnerId },
      include: { wallet: { select: { id: true, name: true } } },
      orderBy: { paidAt: 'desc' },
    });
    return records.map((u) => ({
      id: u.id,
      utility_type: u.utilityType,
      utility_type_other: u.utilityTypeOther,
      expense_account_code: u.utilityType === 'OTHER' ? '5700' : '5300',
      amount: Number(u.amount),
      payment_method: u.paymentMethod,
      wallet_id: u.walletId,
      wallet_name: u.wallet?.name ?? null,
      paid_amount: Number(u.paidAmount),
      remaining_amount: Number(u.remainingAmount),
      note: u.note,
      paid_at: u.paidAt,
    }));
  }

  async createUtilityPayment(storeOwnerId: string, dto: CreateUtilityPaymentDto) {
    const method: ExpensePaymentMethod = dto.paymentMethod ?? 'CASH';
    const { creditAccount } = await this.resolvePaymentAccount(
      storeOwnerId,
      method,
      dto.walletId,
      dto.attachmentUrl,
      null,
      true,
    );
    const paidNow = method === 'CREDIT' ? 0 : dto.amount;
    const remainingAccrued = method === 'CREDIT' ? dto.amount : 0;

    // Fix 5: فصل مصروفات أخرى (5700) عن الخدمات الأساسية (كهرباء/مياه/إنترنت -> 5300)
    const isOtherExpense = dto.utilityType === UtilityType.OTHER;
    const expenseAccountCode = isOtherExpense ? '5700' : '5300';
    const labelAr = isOtherExpense
      ? `مصروفات أخرى: ${dto.utilityTypeOther?.trim() || dto.note?.trim() || 'نثريات المتجر'}`
      : `خدمات (${utilityLabelAr(dto.utilityType)})`;

    return this.prisma.$transaction(async (tx) => {
      const record = await tx.utilityPayment.create({
        data: {
          storeOwnerId,
          utilityType: dto.utilityType,
          utilityTypeOther: dto.utilityTypeOther?.trim() ?? null,
          amount: new Prisma.Decimal(dto.amount),
          paymentMethod: method,
          walletId: method === 'ELECTRONIC' ? (dto.walletId ?? null) : null,
          attachmentUrl: dto.attachmentUrl?.trim() || null,
          paidAmount: new Prisma.Decimal(paidNow),
          remainingAmount: new Prisma.Decimal(remainingAccrued),
          note: dto.note?.trim() || null,
          paidAt: new Date(),
        },
      });

      await this.accounting.createBalancedEntries(tx, {
        storeOwnerId,
        entryDate: startOfDay(new Date()),
        referenceType: 'EXPENSE',
        referenceId: record.id,
        lines: [
          { accountCode: expenseAccountCode, debit: dto.amount, description: labelAr },
          {
            accountCode: creditAccount,
            credit: dto.amount,
            description:
              method === 'CREDIT'
                ? 'مصروف مستحق بالآجل'
                : method === 'ELECTRONIC'
                  ? 'صرف عبر محفظة إلكترونية'
                  : 'صرف نقداً من الصندوق',
          },
        ],
      });

      return {
        id: record.id,
        utility_type: record.utilityType,
        utility_type_other: record.utilityTypeOther,
        expense_account_code: expenseAccountCode,
        amount: Number(record.amount),
        payment_method: record.paymentMethod,
        wallet_id: record.walletId,
        paid_amount: Number(record.paidAmount),
        remaining_amount: Number(record.remainingAmount),
        note: record.note,
        paid_at: record.paidAt,
      };
    });
  }

  // === 4. سلفة العامل المسؤول لنفسه (R-10 / BR-024) ===

  async recordWorkerAdvance(user: AuthenticatedUser, dto: CreateWorkerAdvanceDto) {
    if (user.role !== 'WORKER' || !user.isResponsible) {
      throw ApiError.forbidden('PERMISSION_DENIED', 'هذه الميزة حصراً للعامل المسؤول.');
    }

    const worker = await this.prisma.worker.findUniqueOrThrow({
      where: { id: user.workerId! },
      select: { permEnterOwnAdvance: true, fullName: true },
    });

    if (!worker.permEnterOwnAdvance) {
      throw ApiError.forbidden('PERMISSION_DENIED', 'ليس لديك صلاحية تسجيل سلفة لنفسك.');
    }

    const storeOwnerId = user.storeOwnerId!;
    const method: ExpensePaymentMethod = dto.paymentMethod ?? 'CASH';
    const { creditAccount } = await this.resolvePaymentAccount(
      storeOwnerId,
      method,
      dto.walletId,
      dto.attachmentUrl,
      user.workerId!,
      false,
    );

    return this.prisma.$transaction(async (tx) => {
      const advance = await tx.workerAdvance.create({
        data: {
          storeOwnerId,
          workerId: user.workerId!,
          amount: new Prisma.Decimal(dto.amount),
          paymentMethod: method,
          walletId: method === 'ELECTRONIC' ? (dto.walletId ?? null) : null,
          attachmentUrl: dto.attachmentUrl?.trim() || null,
          note: dto.note?.trim() ?? null,
          recordedAt: new Date(),
        },
      });

      await this.accounting.createBalancedEntries(tx, {
        storeOwnerId,
        entryDate: startOfDay(new Date()),
        referenceType: 'EXPENSE',
        referenceId: advance.id,
        lines: [
          { accountCode: '5500', debit: dto.amount, description: `سلفة عامل مسؤول: ${worker.fullName}` },
          {
            accountCode: creditAccount,
            credit: dto.amount,
            description: method === 'CASH' ? 'صرف سلفة نقداً' : 'صرف سلفة عبر محفظة',
          },
        ],
      });

      return {
        id: advance.id,
        worker_id: advance.workerId,
        amount: Number(advance.amount),
        payment_method: advance.paymentMethod,
        wallet_id: advance.walletId,
        note: advance.note,
        recorded_at: advance.recordedAt,
      };
    });
  }

  async getMyWorkerAdvances(user: AuthenticatedUser) {
    if (user.role !== 'WORKER' || !user.isResponsible) {
      throw ApiError.forbidden('PERMISSION_DENIED', 'هذه الميزة حصراً للعامل المسؤول.');
    }

    const advances = await this.prisma.workerAdvance.findMany({
      where: { workerId: user.workerId!, storeOwnerId: user.storeOwnerId! },
      orderBy: { recordedAt: 'desc' },
    });

    return advances.map((a) => ({
      id: a.id,
      amount: Number(a.amount),
      payment_method: a.paymentMethod,
      note: a.note,
      recorded_at: a.recordedAt,
    }));
  }

  // === 5. سداد المصروفات المستحقة بالآجل (2100 -> 1000 / 110x) ===

  async settleAccrual(storeOwnerId: string, dto: SettleExpenseAccrualDto, ip?: string) {
    const method: ExpensePaymentMethod = dto.paymentMethod;
    const { creditAccount } = await this.resolvePaymentAccount(
      storeOwnerId,
      method,
      dto.walletId,
      dto.attachmentUrl,
      null,
      false,
    );

    const amountDec = new Prisma.Decimal(dto.amount).toDecimalPlaces(2);

    const result = await this.prisma.$transaction(async (tx) => {
      let currentRemaining = new Prisma.Decimal(0);
      let descriptionTitle = '';

      if (dto.targetType === 'RENT') {
        const rent = await tx.rentRecord.findFirst({
          where: { id: dto.targetId, storeOwnerId },
        });
        if (!rent) throw ApiError.notFound('سجل الإيجار المستحق غير موجود.');
        currentRemaining = rent.remainingAmount;
        if (amountDec.gt(currentRemaining)) {
          throw ApiError.badRequest('VALIDATION_ERROR', 'مبلغ السداد يتجاوز المتبقي على الإيجار المستحق.', {
            remaining_amount: Number(currentRemaining),
          });
        }
        await tx.rentRecord.update({
          where: { id: rent.id },
          data: {
            paidAmount: { increment: amountDec },
            remainingAmount: { decrement: amountDec },
          },
        });
        descriptionTitle = `سداد إيجار مستحق لـ ${rent.receiverName}`;
      } else if (dto.targetType === 'UTILITY') {
        const util = await tx.utilityPayment.findFirst({
          where: { id: dto.targetId, storeOwnerId },
        });
        if (!util) throw ApiError.notFound('سجل المصروف المستحق غير موجود.');
        currentRemaining = util.remainingAmount;
        if (amountDec.gt(currentRemaining)) {
          throw ApiError.badRequest('VALIDATION_ERROR', 'مبلغ السداد يتجاوز المتبقي على المصروف المستحق.', {
            remaining_amount: Number(currentRemaining),
          });
        }
        await tx.utilityPayment.update({
          where: { id: util.id },
          data: {
            paidAmount: { increment: amountDec },
            remainingAmount: { decrement: amountDec },
          },
        });
        descriptionTitle =
          util.utilityType === 'OTHER'
            ? `سداد مصروف مستحق (${util.utilityTypeOther || 'مصروفات أخرى'})`
            : `سداد فاتورة خدمات مستحقة (${utilityLabelAr(util.utilityType)})`;
      } else if (dto.targetType === 'EMPLOYEE_SALARY') {
        const empPay = await tx.employeePayment.findFirst({
          where: { id: dto.targetId, storeOwnerId },
          include: { employee: { select: { name: true } } },
        });
        if (!empPay) throw ApiError.notFound('سجل الراتب المستحق غير موجود.');
        currentRemaining = empPay.remainingAmount;
        if (amountDec.gt(currentRemaining)) {
          throw ApiError.badRequest('VALIDATION_ERROR', 'مبلغ السداد يتجاوز المتبقي من الراتب المستحق.', {
            remaining_amount: Number(currentRemaining),
          });
        }
        await tx.employeePayment.update({
          where: { id: empPay.id },
          data: {
            paidAmount: { increment: amountDec },
            remainingAmount: { decrement: amountDec },
          },
        });
        descriptionTitle = `سداد أجور مستحقة للموظف: ${empPay.employee.name}`;
      } else {
        throw ApiError.badRequest('VALIDATION_ERROR', 'نوع المصروف المستحق غير معروف.');
      }

      const settlement = await tx.expenseSettlement.create({
        data: {
          storeOwnerId,
          targetType: dto.targetType,
          targetId: dto.targetId,
          amount: amountDec,
          paymentMethod: dto.paymentMethod as PaymentType,
          walletId: dto.paymentMethod === 'ELECTRONIC' ? (dto.walletId ?? null) : null,
          attachmentUrl: dto.attachmentUrl?.trim() || null,
          note: dto.note?.trim() || null,
          paidAt: new Date(),
        },
      });

      await this.accounting.createBalancedEntries(tx, {
        storeOwnerId,
        entryDate: startOfDay(new Date()),
        referenceType: 'EXPENSE_SETTLEMENT',
        referenceId: settlement.id,
        lines: [
          { accountCode: '2100', debit: amountDec.toNumber(), description: descriptionTitle },
          {
            accountCode: creditAccount,
            credit: amountDec.toNumber(),
            description:
              dto.paymentMethod === 'CASH'
                ? 'صرف نقدي لسداد مصروف مستحق'
                : 'تحويل محفظة لسداد مصروف مستحق',
          },
        ],
      });

      return {
        settlement_id: settlement.id,
        target_type: settlement.targetType,
        target_id: settlement.targetId,
        amount: Number(settlement.amount),
        payment_method: settlement.paymentMethod,
        remaining_after: Number(currentRemaining.minus(amountDec)),
        paid_at: settlement.paidAt,
      };
    });

    await this.audit.log({
      actorType: 'STORE_OWNER',
      actorId: storeOwnerId,
      actionType: 'EXPENSE_ACCRUAL_SETTLE',
      targetType: 'expense_settlement',
      targetId: result.settlement_id,
      newValue: result,
      ipAddress: ip,
      result: 'SUCCESS',
    });

    return result;
  }

  // === 6. واجهة المصروفات الموحدة لشاشة التطبيق (GET/POST /v1/expenses) ===

  async listUnifiedExpenses(user: AuthenticatedUser) {
    const storeOwnerId = user.storeOwnerId!;
    if (user.role === 'WORKER') {
      if (!user.isResponsible) {
        throw ApiError.forbidden('PERMISSION_DENIED', 'المصروفات غير متاحة للعامل العادي.');
      }
      const myAdvances = await this.getMyWorkerAdvances(user);
      return myAdvances.map((a) => ({
        id: a.id,
        type: 'WORKER_ADVANCE',
        category_label: 'سلفتي الشخصية',
        amount: a.amount,
        payment_method: a.payment_method,
        remaining_amount: 0,
        note: a.note ?? 'سلفة شخصية',
        createdAt: a.recorded_at,
      }));
    }

    const [rents, utilities, empPayments, empAdvances, workerAdvances, employees] = await Promise.all([
      this.prisma.rentRecord.findMany({
        where: { storeOwnerId },
        include: { wallet: { select: { name: true } } },
        orderBy: { paidAt: 'desc' },
        take: 100,
      }),
      this.prisma.utilityPayment.findMany({
        where: { storeOwnerId },
        include: { wallet: { select: { name: true } } },
        orderBy: { paidAt: 'desc' },
        take: 100,
      }),
      this.prisma.employeePayment.findMany({
        where: { storeOwnerId },
        include: { employee: { select: { name: true } }, wallet: { select: { name: true } } },
        orderBy: { paidAt: 'desc' },
        take: 100,
      }),
      this.prisma.employeeAdvance.findMany({
        where: { storeOwnerId },
        include: { employee: { select: { name: true } }, wallet: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.workerAdvance.findMany({
        where: { storeOwnerId },
        include: { worker: { select: { fullName: true } }, wallet: { select: { name: true } } },
        orderBy: { recordedAt: 'desc' },
        take: 100,
      }),
      this.listEmployees(storeOwnerId),
    ]);

    const unified = [
      ...rents.map((r) => ({
        id: r.id,
        target_type: 'RENT',
        type: 'RENT',
        category_label: 'إيجار المتجر',
        account_code: '5200',
        amount: Number(r.amount),
        paid_amount: Number(r.paidAmount),
        remaining_amount: Number(r.remainingAmount),
        payment_method: r.paymentMethod,
        wallet_name: r.wallet?.name ?? null,
        note: `إيجار لـ ${r.receiverName}${r.note ? ` — ${r.note}` : ''}`,
        createdAt: r.paidAt,
      })),
      ...utilities.map((u) => ({
        id: u.id,
        target_type: 'UTILITY',
        type: u.utilityType === 'OTHER' ? 'OTHER' : 'UTILITY',
        utility_type: u.utilityType,
        category_label:
          u.utilityType === 'OTHER'
            ? 'مصروفات أخرى للمتجر'
            : `خدمات (${utilityLabelAr(u.utilityType)})`,
        account_code: u.utilityType === 'OTHER' ? '5700' : '5300',
        amount: Number(u.amount),
        paid_amount: Number(u.paidAmount),
        remaining_amount: Number(u.remainingAmount),
        payment_method: u.paymentMethod,
        wallet_name: u.wallet?.name ?? null,
        note: u.utilityTypeOther || u.note || utilityLabelAr(u.utilityType),
        createdAt: u.paidAt,
      })),
      ...empPayments.map((p) => ({
        id: p.id,
        target_type: 'EMPLOYEE_SALARY',
        type: 'SALARY',
        category_label: 'رواتب وأجور',
        account_code: '5100',
        amount: Number(p.amount),
        paid_amount: Number(p.paidAmount),
        remaining_amount: Number(p.remainingAmount),
        payment_method: p.paymentMethod,
        wallet_name: p.wallet?.name ?? null,
        note: `راتب: ${p.employee.name}${Number(p.advanceDeducted) > 0 ? ` (خصم سلف: ${Number(p.advanceDeducted)})` : ''}`,
        createdAt: p.paidAt,
      })),
      ...empAdvances.map((a) => ({
        id: a.id,
        target_type: null,
        type: 'ADVANCE',
        category_label: 'سلفة موظف',
        account_code: '5500',
        amount: Number(a.amount),
        paid_amount: Number(a.amount),
        remaining_amount: 0,
        payment_method: a.paymentMethod,
        wallet_name: a.wallet?.name ?? null,
        note: `سلفة موظف: ${a.employee.name}${a.note ? ` — ${a.note}` : ''}`,
        createdAt: a.createdAt,
      })),
      ...workerAdvances.map((w) => ({
        id: w.id,
        target_type: null,
        type: 'WORKER_ADVANCE',
        category_label: 'سلفة عامل مسؤول',
        account_code: '5500',
        amount: Number(w.amount),
        paid_amount: Number(w.amount),
        remaining_amount: 0,
        payment_method: w.paymentMethod,
        wallet_name: w.wallet?.name ?? null,
        note: `سلفة مسؤول: ${w.worker.fullName}${w.note ? ` — ${w.note}` : ''}`,
        createdAt: w.recordedAt,
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const unpaidAccruals = unified.filter((x) => x.remaining_amount > 0);
    const totalUnpaidAccruals = round2(
      unpaidAccruals.reduce((sum, x) => sum + x.remaining_amount, 0),
    );

    return {
      records: unified,
      unpaid_accruals: unpaidAccruals,
      total_unpaid_accruals: totalUnpaidAccruals,
      employees,
    };
  }

  async createUnifiedExpense(user: AuthenticatedUser, dto: CreateUnifiedExpenseDto, ip?: string) {
    const normalizedType = dto.type.trim().toUpperCase();

    if (user.role === 'WORKER') {
      return this.recordWorkerAdvance(user, {
        amount: dto.amount,
        paymentMethod: dto.paymentMethod === 'ELECTRONIC' ? 'ELECTRONIC' : 'CASH',
        walletId: dto.walletId,
        attachmentUrl: dto.attachmentUrl,
        note: dto.note,
      });
    }

    const storeOwnerId = user.storeOwnerId!;

    if (normalizedType === 'RENT') {
      return this.createRentRecord(storeOwnerId, {
        amount: dto.amount,
        paymentMethod: dto.paymentMethod ?? 'CASH',
        walletId: dto.walletId,
        attachmentUrl: dto.attachmentUrl,
        payerName: dto.payerName?.trim() || 'مالك المتجر',
        receiverName: dto.receiverName?.trim() || 'مؤجر العقار',
        note: dto.note,
      });
    }

    if (
      normalizedType === 'ELECTRICITY' ||
      normalizedType === 'WATER' ||
      normalizedType === 'INTERNET' ||
      normalizedType === 'UTILITY'
    ) {
      const utilType: UtilityType =
        normalizedType === 'WATER'
          ? 'WATER'
          : normalizedType === 'INTERNET'
            ? 'INTERNET'
            : 'ELECTRICITY';
      return this.createUtilityPayment(storeOwnerId, {
        utilityType: utilType,
        amount: dto.amount,
        paymentMethod: dto.paymentMethod ?? 'CASH',
        walletId: dto.walletId,
        attachmentUrl: dto.attachmentUrl,
        note: dto.note,
      });
    }

    if (normalizedType === 'SALARY' && dto.employeeId) {
      return this.payEmployee(
        storeOwnerId,
        dto.employeeId,
        {
          amount: dto.amount,
          deductAdvances: dto.deductAdvances,
          paymentMethod: dto.paymentMethod ?? 'CASH',
          walletId: dto.walletId,
          attachmentUrl: dto.attachmentUrl,
        },
        ip,
      );
    }

    if (normalizedType === 'ADVANCE' && dto.employeeId) {
      if (dto.paymentMethod === 'CREDIT') {
        throw ApiError.badRequest('VALIDATION_ERROR', 'السلف تُصرف نقداً أو إلكترونياً فقط ولا تسجل بالآجل.');
      }
      return this.recordEmployeeAdvance(
        storeOwnerId,
        dto.employeeId,
        {
          amount: dto.amount,
          paymentMethod: dto.paymentMethod === 'ELECTRONIC' ? 'ELECTRONIC' : 'CASH',
          walletId: dto.walletId,
          attachmentUrl: dto.attachmentUrl,
          note: dto.note,
        },
        ip,
      );
    }

    // الافتراضي: مصروفات أخرى للمتجر -> حساب 5700 مستقل عن الخدمات (Fix 5)
    return this.createUtilityPayment(storeOwnerId, {
      utilityType: UtilityType.OTHER,
      utilityTypeOther: dto.utilityTypeOther?.trim() || dto.note?.trim() || 'مصروفات عامة للمتجر',
      amount: dto.amount,
      paymentMethod: dto.paymentMethod ?? 'CASH',
      walletId: dto.walletId,
      attachmentUrl: dto.attachmentUrl,
      note: dto.note,
    });
  }

  private async resolvePaymentAccount(
    storeOwnerId: string,
    method: ExpensePaymentMethod,
    walletId: string | undefined,
    attachmentUrl: string | undefined,
    actorWorkerId: string | null,
    allowCredit: boolean,
  ): Promise<{ creditAccount: string }> {
    if (method === 'CREDIT') {
      if (!allowCredit) {
        throw ApiError.badRequest('VALIDATION_ERROR', 'هذا النوع من الصرف لا يقبل التسجيل بالآجل.');
      }
      return { creditAccount: '2100' };
    }

    if (method === 'CASH') {
      const today = startOfDay(new Date());
      const closedClosing = await this.prisma.dailyClosing.findFirst({
        where: {
          storeOwnerId,
          workerId: actorWorkerId,
          closingDate: today,
          status: 'CLOSED',
        },
      });
      if (closedClosing) {
        throw ApiError.conflict(
          'DAY_ALREADY_CLOSED',
          'تم اعتماد إغلاق الصندوق لهذا اليوم مسبقاً ولا يمكن تسجيل صرف نقدي جديد.',
        );
      }
      return { creditAccount: '1000' };
    }

    if (method === 'ELECTRONIC') {
      if (!walletId) {
        throw ApiError.badRequest(
          'VALIDATION_ERROR',
          'اختيار المحفظة الإلكترونية إلزامي عند الصرف الإلكتروني.',
        );
      }
      const wallet = await this.prisma.wallet.findFirst({
        where: { id: walletId, storeOwnerId, isActive: true },
      });
      if (!wallet) throw ApiError.notFound('المحفظة الإلكترونية غير موجودة.');
      if (wallet.accountCode) {
        return { creditAccount: wallet.accountCode };
      }
      const walletAccount = await this.prisma.chartOfAccount.findFirst({
        where: { storeOwnerId, accountType: 'ASSET', name: { startsWith: `محفظة: ${wallet.name}` } },
        select: { code: true },
      });
      return { creditAccount: walletAccount?.code ?? '1100' };
    }

    throw ApiError.badRequest('VALIDATION_ERROR', 'طريقة الدفع غير صالحة.');
  }

  private async mustGetEmployee(storeOwnerId: string, id: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id, storeOwnerId, deletedAt: null },
    });
    if (!employee) throw ApiError.notFound('الموظف غير موجود.');
    return employee;
  }
}

function utilityLabelAr(type: UtilityType): string {
  switch (type) {
    case 'ELECTRICITY':
      return 'كهرباء';
    case 'WATER':
      return 'مياه';
    case 'INTERNET':
      return 'إنترنت';
    case 'OTHER':
    default:
      return 'مصروفات أخرى';
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
