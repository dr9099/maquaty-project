import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import { AuthenticatedUser } from '../common/types';
import {
  CreateEmployeeAdvanceDto,
  CreateEmployeeDto,
  CreateRentRecordDto,
  CreateUtilityPaymentDto,
  CreateWorkerAdvanceDto,
  PayEmployeeDto,
} from './dto/expenses.dto';

// خدمة المصروفات — API_SPEC القسم 8 / R-10 / R-37 / BR-022..025
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
      const outstandingAdvances = totalAdvances - totalSettled;
      const monthlyDue = Number(emp.monthlyDue);
      const suggestedNet = Math.max(0, monthlyDue - outstandingAdvances);

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
    const amountDecimal = new Prisma.Decimal(dto.amount);

    const advance = await this.prisma.$transaction(async (tx) => {
      const created = await tx.employeeAdvance.create({
        data: {
          storeOwnerId,
          employeeId: employee.id,
          amount: amountDecimal,
          settledAmount: new Prisma.Decimal(0),
          note: dto.note?.trim() ?? null,
        },
      });

      // قيد محاسبي: مدين سلف الموظفين (5500)، ودائن الصندوق (1000)
      await this.accounting.createBalancedEntries(tx, {
        storeOwnerId,
        entryDate: new Date(),
        referenceType: 'EXPENSE',
        referenceId: created.id,
        lines: [
          { accountCode: '5500', debit: dto.amount, description: `سلفة موظف: ${employee.name}` },
          { accountCode: '1000', credit: dto.amount, description: 'صرف سلفة نقداً' },
        ],
      });

      return created;
    });

    return {
      advance_id: advance.id,
      employee_id: employee.id,
      amount: Number(advance.amount),
      note: advance.note,
      created_at: advance.createdAt,
    };
  }

  // تسوية الرواتب والسلف — R-37: النظام يعرض الصافي المقترح، وللمالك خيار اعتماده أو تخصيص الخصم بنظام FIFO
  async payEmployee(storeOwnerId: string, employeeId: string, dto: PayEmployeeDto, ip?: string) {
    const employee = await this.mustGetEmployee(storeOwnerId, employeeId);

    return this.prisma.$transaction(async (tx) => {
      // جلب السلف غير المسددة بالكامل مرتبة بالأقدم (FIFO)
      const pendingAdvances = await tx.employeeAdvance.findMany({
        where: { employeeId: employee.id, storeOwnerId },
        orderBy: { createdAt: 'asc' },
      });

      let totalUnsettled = 0;
      for (const adv of pendingAdvances) {
        totalUnsettled += Number(adv.amount) - Number(adv.settledAmount);
      }

      // تحديد مبلغ الخصم من السلف
      const totalDuePaid = dto.amount;
      let requestedDeduct =
        dto.deductAdvances !== undefined ? dto.deductAdvances : Math.min(totalDuePaid, totalUnsettled);

      if (requestedDeduct > totalUnsettled) {
        requestedDeduct = totalUnsettled;
      }
      if (requestedDeduct > totalDuePaid) {
        throw ApiError.badRequest('VALIDATION_ERROR', 'مبلغ خصم السلف لا يمكن أن يتجاوز إجمالي المستحق المصروف.');
      }

      const netCashPaid = totalDuePaid - requestedDeduct;

      // تسوية السلف تدريجياً بنظام FIFO
      let remainingToDeduct = requestedDeduct;
      for (const adv of pendingAdvances) {
        if (remainingToDeduct <= 0) break;
        const unpaid = Number(adv.amount) - Number(adv.settledAmount);
        if (unpaid > 0) {
          const deductFromThis = Math.min(unpaid, remainingToDeduct);
          await tx.employeeAdvance.update({
            where: { id: adv.id },
            data: {
              settledAmount: { increment: new Prisma.Decimal(deductFromThis) },
            },
          });
          remainingToDeduct -= deductFromThis;
        }
      }

      const payment = await tx.employeePayment.create({
        data: {
          storeOwnerId,
          employeeId: employee.id,
          amount: new Prisma.Decimal(totalDuePaid),
          advanceDeducted: new Prisma.Decimal(requestedDeduct),
          netPaid: new Prisma.Decimal(netCashPaid),
          paidAt: new Date(),
        },
      });

      // القيد المحاسبي المتوازن:
      // مدين: 5100 (مصروف الأجور) بالمبلغ الإجمالي
      // دائن: 1000 (الصندوق) بصافي النقد المدفوع
      // دائن: 5500 (سلف الموظفين) بمبلغ السلف المستردة/المخصومة
      const lines: Array<{ accountCode: string; debit?: number; credit?: number; description: string }> = [
        { accountCode: '5100', debit: totalDuePaid, description: `أجور ومستحقات: ${employee.name}` },
      ];
      if (netCashPaid > 0) {
        lines.push({ accountCode: '1000', credit: netCashPaid, description: 'صرف مستحقات أجور نقداً' });
      }
      if (requestedDeduct > 0) {
        lines.push({ accountCode: '5500', credit: requestedDeduct, description: 'تسوية سلف من مستحقات الأجور' });
      }

      await this.accounting.createBalancedEntries(tx, {
        storeOwnerId,
        entryDate: new Date(),
        referenceType: 'EXPENSE',
        referenceId: payment.id,
        lines,
      });

      return {
        payment_id: payment.id,
        employee_id: employee.id,
        total_due_paid: totalDuePaid,
        advance_deducted: requestedDeduct,
        net_paid: netCashPaid,
        remaining_advances: totalUnsettled - requestedDeduct,
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
        total_advances: totalAdvances,
        settled_advances: totalSettled,
        outstanding_advances: totalAdvances - totalSettled,
      },
      advances: advances.map((a) => ({
        id: a.id,
        amount: Number(a.amount),
        settled_amount: Number(a.settledAmount),
        note: a.note,
        created_at: a.createdAt,
      })),
      payments: payments.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        advance_deducted: Number(p.advanceDeducted),
        net_paid: Number(p.netPaid),
        paid_at: p.paidAt,
      })),
    };
  }

  // === 2. الإيجارات (Rent Records) ===

  async listRentRecords(storeOwnerId: string) {
    const records = await this.prisma.rentRecord.findMany({
      where: { storeOwnerId },
      orderBy: { paidAt: 'desc' },
    });
    return records.map((r) => ({
      id: r.id,
      amount: Number(r.amount),
      payment_method: r.paymentMethod,
      payer_name: r.payerName,
      receiver_name: r.receiverName,
      paid_at: r.paidAt,
    }));
  }

  async createRentRecord(storeOwnerId: string, dto: CreateRentRecordDto) {
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.rentRecord.create({
        data: {
          storeOwnerId,
          amount: new Prisma.Decimal(dto.amount),
          paymentMethod: dto.paymentMethod,
          payerName: dto.payerName.trim(),
          receiverName: dto.receiverName.trim(),
          paidAt: new Date(),
        },
      });

      // قيد محاسبي: مدين مصروف الإيجار (5200)، ودائن الصندوق (1000)
      await this.accounting.createBalancedEntries(tx, {
        storeOwnerId,
        entryDate: new Date(),
        referenceType: 'EXPENSE',
        referenceId: record.id,
        lines: [
          { accountCode: '5200', debit: dto.amount, description: `إيجار مدفوع لـ: ${record.receiverName}` },
          { accountCode: '1000', credit: dto.amount, description: 'صرف إيجار نقداً' },
        ],
      });

      return {
        id: record.id,
        amount: Number(record.amount),
        payment_method: record.paymentMethod,
        payer_name: record.payerName,
        receiver_name: record.receiverName,
        paid_at: record.paidAt,
      };
    });
  }

  // === 3. الخدمات (Utility Payments) ===

  async listUtilityPayments(storeOwnerId: string) {
    const records = await this.prisma.utilityPayment.findMany({
      where: { storeOwnerId },
      orderBy: { paidAt: 'desc' },
    });
    return records.map((u) => ({
      id: u.id,
      utility_type: u.utilityType,
      utility_type_other: u.utilityTypeOther,
      amount: Number(u.amount),
      paid_at: u.paidAt,
    }));
  }

  async createUtilityPayment(storeOwnerId: string, dto: CreateUtilityPaymentDto) {
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.utilityPayment.create({
        data: {
          storeOwnerId,
          utilityType: dto.utilityType,
          utilityTypeOther: dto.utilityTypeOther?.trim() ?? null,
          amount: new Prisma.Decimal(dto.amount),
          paidAt: new Date(),
        },
      });

      // قيد محاسبي: مدين مصروف الخدمات (5300)، ودائن الصندوق (1000)
      await this.accounting.createBalancedEntries(tx, {
        storeOwnerId,
        entryDate: new Date(),
        referenceType: 'EXPENSE',
        referenceId: record.id,
        lines: [
          { accountCode: '5300', debit: dto.amount, description: `خدمات: ${record.utilityType}` },
          { accountCode: '1000', credit: dto.amount, description: 'صرف فاتورة خدمات نقداً' },
        ],
      });

      return {
        id: record.id,
        utility_type: record.utilityType,
        utility_type_other: record.utilityTypeOther,
        amount: Number(record.amount),
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

    return this.prisma.$transaction(async (tx) => {
      const advance = await tx.workerAdvance.create({
        data: {
          storeOwnerId,
          workerId: user.workerId!,
          amount: new Prisma.Decimal(dto.amount),
          note: dto.note?.trim() ?? null,
          recordedAt: new Date(),
        },
      });

      // قيد محاسبي: مدين سلف الموظفين/العمال (5500)، ودائن الصندوق (1000)
      await this.accounting.createBalancedEntries(tx, {
        storeOwnerId,
        entryDate: new Date(),
        referenceType: 'EXPENSE',
        referenceId: advance.id,
        lines: [
          { accountCode: '5500', debit: dto.amount, description: `سلفة عامل مسؤول: ${worker.fullName}` },
          { accountCode: '1000', credit: dto.amount, description: 'صرف سلفة نقداً' },
        ],
      });

      return {
        id: advance.id,
        worker_id: advance.workerId,
        amount: Number(advance.amount),
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
      note: a.note,
      recorded_at: a.recordedAt,
    }));
  }

  private async mustGetEmployee(storeOwnerId: string, id: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id, storeOwnerId, deletedAt: null },
    });
    if (!employee) throw ApiError.notFound('الموظف غير موجود.');
    return employee;
  }
}
