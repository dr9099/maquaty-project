import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import { SettleWalletDto } from './dto/wallets.dto';

// المحافظ الإلكترونية (كريمي، جيب، ون كاش...) — إنشاء حساب فرعي 11xx لكل محفظة + تتبع الرصيد الدفتري والتسوية (Fix 7)
@Injectable()
export class WalletsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
    private readonly audit: AuditService,
  ) {}

  async create(storeOwnerId: string, dto: { name: string }, ip?: string) {
    const cleanName = dto.name.trim();
    const duplicate = await this.prisma.wallet.findFirst({
      where: { storeOwnerId, name: cleanName, isActive: true },
    });
    if (duplicate) {
      throw ApiError.conflict('VALIDATION_ERROR', 'توجد محفظة بهذا الاسم بالفعل.');
    }

    const wallet = await this.prisma.$transaction(async (tx) => {
      // حساب فرعي تحت 1100 المحافظ الإلكترونية (1101، 1102، ...)
      const existingAccounts = await tx.chartOfAccount.findMany({
        where: { storeOwnerId, code: { startsWith: '11' } },
        select: { code: true },
      });
      let maxNum = 1100;
      for (const acc of existingAccounts) {
        const parsed = parseInt(acc.code, 10);
        if (!Number.isNaN(parsed) && parsed >= 1100 && parsed < 1200 && parsed > maxNum) {
          maxNum = parsed;
        }
      }
      const nextCode = String(maxNum + 1);

      const created = await tx.wallet.create({
        data: {
          storeOwnerId,
          name: cleanName,
          accountCode: nextCode,
        },
      });

      await tx.chartOfAccount.create({
        data: {
          storeOwnerId,
          code: nextCode,
          name: `محفظة: ${cleanName}`,
          accountType: 'ASSET',
        },
      });

      return created;
    });

    await this.audit.log({
      actorType: 'STORE_OWNER',
      actorId: storeOwnerId,
      actionType: 'WALLET_CREATE',
      targetType: 'wallet',
      targetId: wallet.id,
      newValue: { name: wallet.name, account_code: wallet.accountCode },
      ipAddress: ip,
      result: 'SUCCESS',
    });

    return {
      id: wallet.id,
      name: wallet.name,
      account_code: wallet.accountCode,
      is_active: wallet.isActive,
      book_balance: 0,
      unsettled_count: 0,
      unsettled_inflow: 0,
      unsettled_outflow: 0,
      unsettled_net_amount: 0,
      last_settled_at: null,
    };
  }

  async list(storeOwnerId: string, includeOwnerBalances = false) {
    const wallets = await this.prisma.wallet.findMany({
      where: { storeOwnerId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    if (!includeOwnerBalances) {
      return wallets.map((w) => ({
        id: w.id,
        name: w.name,
        is_active: w.isActive,
      }));
    }

    return Promise.all(
      wallets.map(async (w) => {
        const accountCode = await this.resolveWalletAccountCode(this.prisma, storeOwnerId, w);
        const [bookBalance, unsettledStats, lastSettlement] = await Promise.all([
          this.computeBookBalance(this.prisma, storeOwnerId, accountCode),
          this.computeUnsettledStats(storeOwnerId, w.id),
          this.prisma.walletSettlement.findFirst({
            where: { storeOwnerId, walletId: w.id },
            orderBy: { settledAt: 'desc' },
            select: {
              id: true,
              settledAt: true,
              actualProviderBalance: true,
              bookBalanceAfter: true,
              difference: true,
              status: true,
            },
          }),
        ]);

        return {
          id: w.id,
          name: w.name,
          account_code: accountCode,
          is_active: w.isActive,
          book_balance: bookBalance,
          unsettled_count: unsettledStats.count,
          unsettled_inflow: unsettledStats.inflow,
          unsettled_outflow: unsettledStats.outflow,
          unsettled_net_amount: round2(unsettledStats.inflow - unsettledStats.outflow),
          last_settled_at: lastSettlement?.settledAt ?? null,
          last_actual_provider_balance: lastSettlement
            ? Number(lastSettlement.actualProviderBalance)
            : null,
          last_settlement_status: lastSettlement?.status ?? null,
        };
      }),
    );
  }

  async getTransactions(storeOwnerId: string, walletId: string) {
    const wallet = await this.prisma.wallet.findFirst({
      where: { id: walletId, storeOwnerId },
    });
    if (!wallet) throw ApiError.notFound('المحفظة غير موجودة.');

    const accountCode = await this.resolveWalletAccountCode(this.prisma, storeOwnerId, wallet);
    const [
      bookBalance,
      sales,
      creditPayments,
      purchases,
      supplierPayments,
      rents,
      utilities,
      employeePayments,
      employeeAdvances,
      workerAdvances,
      expenseSettlements,
      ownerTransactions,
      settlements,
    ] = await Promise.all([
      this.computeBookBalance(this.prisma, storeOwnerId, accountCode),
      this.prisma.sale.findMany({
        where: { storeOwnerId, walletId, paymentType: 'ELECTRONIC' },
        include: { item: { select: { name: true } } },
        orderBy: { soldAt: 'desc' },
        take: 100,
      }),
      this.prisma.creditPayment.findMany({
        where: { storeOwnerId, walletId, paymentMethod: 'ELECTRONIC' },
        include: { creditCustomer: { select: { name: true } } },
        orderBy: { paidAt: 'desc' },
        take: 100,
      }),
      this.prisma.purchaseInvoice.findMany({
        where: { storeOwnerId, walletId, status: 'POSTED', paidAmount: { gt: 0 } },
        include: { supplier: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.supplierPayment.findMany({
        where: { storeOwnerId, walletId, paymentMethod: 'ELECTRONIC' },
        include: { supplier: { select: { name: true } } },
        orderBy: { paidAt: 'desc' },
        take: 100,
      }),
      this.prisma.rentRecord.findMany({
        where: { storeOwnerId, walletId, paymentMethod: 'ELECTRONIC', paidAmount: { gt: 0 } },
        orderBy: { paidAt: 'desc' },
        take: 50,
      }),
      this.prisma.utilityPayment.findMany({
        where: { storeOwnerId, walletId, paymentMethod: 'ELECTRONIC', paidAmount: { gt: 0 } },
        orderBy: { paidAt: 'desc' },
        take: 50,
      }),
      this.prisma.employeePayment.findMany({
        where: { storeOwnerId, walletId, paymentMethod: 'ELECTRONIC', paidAmount: { gt: 0 } },
        include: { employee: { select: { name: true } } },
        orderBy: { paidAt: 'desc' },
        take: 50,
      }),
      this.prisma.employeeAdvance.findMany({
        where: { storeOwnerId, walletId, paymentMethod: 'ELECTRONIC' },
        include: { employee: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.workerAdvance.findMany({
        where: { storeOwnerId, walletId, paymentMethod: 'ELECTRONIC' },
        include: { worker: { select: { fullName: true } } },
        orderBy: { recordedAt: 'desc' },
        take: 50,
      }),
      this.prisma.expenseSettlement.findMany({
        where: { storeOwnerId, walletId, paymentMethod: 'ELECTRONIC' },
        orderBy: { paidAt: 'desc' },
        take: 50,
      }),
      this.prisma.ownerTransaction.findMany({
        where: { storeOwnerId, walletId, paymentMethod: 'ELECTRONIC' },
        orderBy: { transactedAt: 'desc' },
        take: 50,
      }),
      this.prisma.walletSettlement.findMany({
        where: { storeOwnerId, walletId },
        orderBy: { settledAt: 'desc' },
        take: 25,
      }),
    ]);

    const operations = [
      ...sales.map((s) => ({
        id: s.id,
        type: 'SALE',
        type_label: 'مبيعات إلكترونية',
        direction: 'IN' as const,
        amount: Number(s.amount),
        description: `بيع ${s.item.name}`,
        attachment_url: s.depositAttachmentUrl,
        settled: s.walletSettled,
        date: s.soldAt,
      })),
      ...creditPayments.map((p) => ({
        id: p.id,
        type: 'CREDIT_PAYMENT',
        type_label: 'تحصيل دين عميل',
        direction: 'IN' as const,
        amount: Number(p.amount),
        description: `سداد من العميل: ${p.creditCustomer.name}`,
        attachment_url: p.attachmentUrl,
        settled: p.walletSettled,
        date: p.paidAt,
      })),
      ...purchases.map((inv) => ({
        id: inv.id,
        type: 'PURCHASE',
        type_label: 'فاتورة مشتريات',
        direction: 'OUT' as const,
        amount: Number(inv.paidAmount),
        description: `شراء ${inv.invoiceNumber} — ${inv.supplier.name}`,
        attachment_url: inv.attachmentUrl,
        settled: inv.walletSettled,
        date: inv.postedAt ?? inv.createdAt,
      })),
      ...supplierPayments.map((sp) => ({
        id: sp.id,
        type: 'SUPPLIER_PAYMENT',
        type_label: 'سداد مورد',
        direction: 'OUT' as const,
        amount: Number(sp.amount),
        description: `سداد للمورد: ${sp.supplier.name}`,
        attachment_url: sp.receiptAttachmentUrl,
        settled: sp.walletSettled,
        date: sp.paidAt,
      })),
      ...rents.map((r) => ({
        id: r.id,
        type: 'EXPENSE_RENT',
        type_label: 'مصروف إيجار',
        direction: 'OUT' as const,
        amount: Number(r.paidAmount),
        description: `إيجار لـ: ${r.receiverName}`,
        attachment_url: r.attachmentUrl,
        settled: r.walletSettled,
        date: r.paidAt,
      })),
      ...utilities.map((u) => ({
        id: u.id,
        type: 'EXPENSE_UTILITY',
        type_label: u.utilityType === 'OTHER' ? 'مصروفات أخرى' : 'مصروف خدمات',
        direction: 'OUT' as const,
        amount: Number(u.paidAmount),
        description: u.note ?? `خدمة: ${u.utilityType}`,
        attachment_url: u.attachmentUrl,
        settled: u.walletSettled,
        date: u.paidAt,
      })),
      ...employeePayments.map((ep) => ({
        id: ep.id,
        type: 'EXPENSE_SALARY',
        type_label: 'صرف راتب',
        direction: 'OUT' as const,
        amount: Number(ep.paidAmount),
        description: `راتب: ${ep.employee.name}`,
        attachment_url: ep.attachmentUrl,
        settled: ep.walletSettled,
        date: ep.paidAt,
      })),
      ...employeeAdvances.map((ea) => ({
        id: ea.id,
        type: 'EMPLOYEE_ADVANCE',
        type_label: 'سلفة موظف',
        direction: 'OUT' as const,
        amount: Number(ea.amount),
        description: `سلفة موظف: ${ea.employee.name}`,
        attachment_url: ea.attachmentUrl,
        settled: ea.walletSettled,
        date: ea.createdAt,
      })),
      ...workerAdvances.map((wa) => ({
        id: wa.id,
        type: 'WORKER_ADVANCE',
        type_label: 'سلفة عامل',
        direction: 'OUT' as const,
        amount: Number(wa.amount),
        description: `سلفة عامل: ${wa.worker.fullName}`,
        attachment_url: wa.attachmentUrl,
        settled: wa.walletSettled,
        date: wa.recordedAt,
      })),
      ...expenseSettlements.map((es) => ({
        id: es.id,
        type: 'EXPENSE_SETTLEMENT',
        type_label: 'سداد مصروف مستحق',
        direction: 'OUT' as const,
        amount: Number(es.amount),
        description: es.note ?? 'سداد مصروف مستحق',
        attachment_url: es.attachmentUrl,
        settled: es.walletSettled,
        date: es.paidAt,
      })),
      ...ownerTransactions.map((ot) => ({
        id: ot.id,
        type: ot.type === 'DEPOSIT' ? 'OWNER_DEPOSIT' : 'OWNER_WITHDRAWAL',
        type_label: ot.type === 'DEPOSIT' ? 'إيداع مالك للمحفظة' : 'سحب مالك من المحفظة',
        direction: ot.type === 'DEPOSIT' ? ('IN' as const) : ('OUT' as const),
        amount: Number(ot.amount),
        description: ot.note ?? (ot.type === 'DEPOSIT' ? 'إيداع رأس مال / تمويل' : 'مسحوبات مالك'),
        attachment_url: ot.attachmentUrl,
        settled: ot.walletSettled,
        date: ot.transactedAt,
      })),
    ].sort((a, b) => b.date.getTime() - a.date.getTime());

    const unsettledStats = await this.computeUnsettledStats(storeOwnerId, walletId);

    return {
      wallet: {
        id: wallet.id,
        name: wallet.name,
        account_code: accountCode,
        is_active: wallet.isActive,
        book_balance: bookBalance,
        unsettled_count: unsettledStats.count,
        unsettled_inflow: unsettledStats.inflow,
        unsettled_outflow: unsettledStats.outflow,
        unsettled_net_amount: round2(unsettledStats.inflow - unsettledStats.outflow),
      },
      operations,
      settlements: settlements.map((st) => ({
        id: st.id,
        book_balance_before: Number(st.bookBalanceBefore),
        actual_provider_balance: Number(st.actualProviderBalance),
        difference: Number(st.difference),
        cash_out_to_drawer: Number(st.cashOutToDrawer),
        book_balance_after: Number(st.bookBalanceAfter),
        settled_operations_count: st.settledOperationsCount,
        status: st.status,
        notes: st.notes,
        settled_at: st.settledAt,
      })),
    };
  }

  async settle(storeOwnerId: string, walletId: string, dto: SettleWalletDto, ip?: string) {
    const wallet = await this.prisma.wallet.findFirst({
      where: { id: walletId, storeOwnerId, isActive: true },
    });
    if (!wallet) throw ApiError.notFound('المحفظة غير موجودة أو غير نشطة.');

    const actualProviderBalance = round2(dto.actualProviderBalance);
    const cashOutToDrawer = round2(dto.cashOutToDrawer ?? 0);

    if (cashOutToDrawer > actualProviderBalance) {
      throw ApiError.badRequest(
        'VALIDATION_ERROR',
        'لا يمكن سحب مبلغ نقدي للصندوق أكبر من الرصيد الفعلي المتوفر في المحفظة.',
      );
    }

    const today = startOfDay(new Date());
    if (cashOutToDrawer > 0) {
      const closedClosing = await this.prisma.dailyClosing.findFirst({
        where: {
          storeOwnerId,
          workerId: null,
          closingDate: today,
          status: 'CLOSED',
        },
      });
      if (closedClosing) {
        throw ApiError.conflict(
          'DAY_ALREADY_CLOSED',
          'تم اعتماد إغلاق الصندوق لهذا اليوم مسبقاً ولا يمكن سحب نقدية إلى الصندوق الآن.',
        );
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const accountCode = await this.resolveWalletAccountCode(tx, storeOwnerId, wallet);
      const bookBalanceBefore = await this.computeBookBalance(tx, storeOwnerId, accountCode);
      const difference = round2(actualProviderBalance - bookBalanceBefore);
      const bookBalanceAfter = round2(actualProviderBalance - cashOutToDrawer);
      const status = difference === 0 ? 'MATCHED' : 'DISCREPANCY_RESOLVED';

      const settlement = await tx.walletSettlement.create({
        data: {
          storeOwnerId,
          walletId: wallet.id,
          bookBalanceBefore: new Prisma.Decimal(bookBalanceBefore),
          actualProviderBalance: new Prisma.Decimal(actualProviderBalance),
          difference: new Prisma.Decimal(difference),
          cashOutToDrawer: new Prisma.Decimal(cashOutToDrawer),
          bookBalanceAfter: new Prisma.Decimal(bookBalanceAfter),
          settledOperationsCount: 0,
          status,
          notes: dto.notes?.trim() || null,
          settledAt: new Date(),
        },
      });

      // 1) تسوية الفارق بين الرصيد الفعلي لدى المزود والرصيد الدفتري
      if (difference < 0) {
        const shortage = Math.abs(difference);
        await this.accounting.createBalancedEntries(tx, {
          storeOwnerId,
          entryDate: today,
          referenceType: 'WALLET_SETTLEMENT',
          referenceId: settlement.id,
          lines: [
            {
              accountCode: '5600',
              debit: shortage,
              description: `تسوية عجز/عمولات محفظة (${wallet.name})`,
            },
            {
              accountCode,
              credit: shortage,
              description: `تخفيض رصيد محفظة (${wallet.name}) لمطابقة المزود`,
            },
          ],
        });
      } else if (difference > 0) {
        await this.accounting.createBalancedEntries(tx, {
          storeOwnerId,
          entryDate: today,
          referenceType: 'WALLET_SETTLEMENT',
          referenceId: settlement.id,
          lines: [
            {
              accountCode,
              debit: difference,
              description: `تسوية فائض محفظة (${wallet.name}) لمطابقة المزود`,
            },
            {
              accountCode: '4300',
              credit: difference,
              description: `فائض تسوية محفظة (${wallet.name})`,
            },
          ],
        });
      }

      // 2) تحويل نقدي اختياري من المحفظة إلى صندوق المحل (1000)
      if (cashOutToDrawer > 0) {
        await this.accounting.createBalancedEntries(tx, {
          storeOwnerId,
          entryDate: today,
          referenceType: 'WALLET_SETTLEMENT',
          referenceId: settlement.id,
          lines: [
            {
              accountCode: '1000',
              debit: cashOutToDrawer,
              description: `سحب نقدي من محفظة (${wallet.name}) إلى صندوق المحل`,
            },
            {
              accountCode,
              credit: cashOutToDrawer,
              description: `تحويل رصيد محفظة (${wallet.name}) إلى نقدية بالصندوق`,
            },
          ],
        });
      }

      // 3) تعليم كافة العمليات الإلكترونية غير المسواة على هذه المحفظة كمسواة
      const markData = { walletSettled: true, walletSettlementId: settlement.id };
      const counts = await Promise.all([
        tx.sale.updateMany({
          where: { storeOwnerId, walletId: wallet.id, paymentType: 'ELECTRONIC', walletSettled: false },
          data: markData,
        }),
        tx.creditPayment.updateMany({
          where: { storeOwnerId, walletId: wallet.id, paymentMethod: 'ELECTRONIC', walletSettled: false },
          data: markData,
        }),
        tx.purchaseInvoice.updateMany({
          where: { storeOwnerId, walletId: wallet.id, status: 'POSTED', walletSettled: false },
          data: markData,
        }),
        tx.supplierPayment.updateMany({
          where: { storeOwnerId, walletId: wallet.id, paymentMethod: 'ELECTRONIC', walletSettled: false },
          data: markData,
        }),
        tx.rentRecord.updateMany({
          where: { storeOwnerId, walletId: wallet.id, paymentMethod: 'ELECTRONIC', walletSettled: false },
          data: markData,
        }),
        tx.utilityPayment.updateMany({
          where: { storeOwnerId, walletId: wallet.id, paymentMethod: 'ELECTRONIC', walletSettled: false },
          data: markData,
        }),
        tx.employeePayment.updateMany({
          where: { storeOwnerId, walletId: wallet.id, paymentMethod: 'ELECTRONIC', walletSettled: false },
          data: markData,
        }),
        tx.employeeAdvance.updateMany({
          where: { storeOwnerId, walletId: wallet.id, paymentMethod: 'ELECTRONIC', walletSettled: false },
          data: markData,
        }),
        tx.workerAdvance.updateMany({
          where: { storeOwnerId, walletId: wallet.id, paymentMethod: 'ELECTRONIC', walletSettled: false },
          data: markData,
        }),
        tx.expenseSettlement.updateMany({
          where: { storeOwnerId, walletId: wallet.id, paymentMethod: 'ELECTRONIC', walletSettled: false },
          data: markData,
        }),
        tx.ownerTransaction.updateMany({
          where: { storeOwnerId, walletId: wallet.id, paymentMethod: 'ELECTRONIC', walletSettled: false },
          data: markData,
        }),
      ]);

      const settledCount = counts.reduce((sum, c) => sum + c.count, 0);
      const updatedSettlement = await tx.walletSettlement.update({
        where: { id: settlement.id },
        data: { settledOperationsCount: settledCount },
      });

      return { updatedSettlement, accountCode };
    });

    await this.audit.log({
      actorType: 'STORE_OWNER',
      actorId: storeOwnerId,
      actionType: 'WALLET_SETTLEMENT',
      targetType: 'wallet_settlement',
      targetId: result.updatedSettlement.id,
      newValue: {
        wallet_id: wallet.id,
        wallet_name: wallet.name,
        book_balance_before: Number(result.updatedSettlement.bookBalanceBefore),
        actual_provider_balance: Number(result.updatedSettlement.actualProviderBalance),
        difference: Number(result.updatedSettlement.difference),
        cash_out_to_drawer: Number(result.updatedSettlement.cashOutToDrawer),
        book_balance_after: Number(result.updatedSettlement.bookBalanceAfter),
        settled_operations_count: result.updatedSettlement.settledOperationsCount,
      },
      ipAddress: ip,
      result: 'SUCCESS',
    });

    return {
      settlement_id: result.updatedSettlement.id,
      wallet_id: wallet.id,
      wallet_name: wallet.name,
      account_code: result.accountCode,
      book_balance_before: Number(result.updatedSettlement.bookBalanceBefore),
      actual_provider_balance: Number(result.updatedSettlement.actualProviderBalance),
      difference: Number(result.updatedSettlement.difference),
      cash_out_to_drawer: Number(result.updatedSettlement.cashOutToDrawer),
      book_balance_after: Number(result.updatedSettlement.bookBalanceAfter),
      settled_operations_count: result.updatedSettlement.settledOperationsCount,
      status: result.updatedSettlement.status,
      notes: result.updatedSettlement.notes,
      settled_at: result.updatedSettlement.settledAt,
    };
  }

  private async resolveWalletAccountCode(
    tx: Prisma.TransactionClient | PrismaService,
    storeOwnerId: string,
    wallet: { id: string; name: string; accountCode: string | null },
  ): Promise<string> {
    if (wallet.accountCode) return wallet.accountCode;
    const found = await tx.chartOfAccount.findFirst({
      where: {
        storeOwnerId,
        accountType: 'ASSET',
        name: { startsWith: `محفظة: ${wallet.name}` },
      },
      select: { code: true },
    });
    if (found?.code) {
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { accountCode: found.code },
      });
      return found.code;
    }
    return '1100';
  }

  private async computeBookBalance(
    tx: Prisma.TransactionClient | PrismaService,
    storeOwnerId: string,
    accountCode: string,
  ): Promise<number> {
    const agg = await tx.ledgerEntry.aggregate({
      where: { storeOwnerId, account: { code: accountCode } },
      _sum: { debit: true, credit: true },
    });
    const debit = agg._sum.debit ?? new Prisma.Decimal(0);
    const credit = agg._sum.credit ?? new Prisma.Decimal(0);
    return Number(debit.minus(credit).toDecimalPlaces(2));
  }

  private async computeUnsettledStats(storeOwnerId: string, walletId: string) {
    const [
      salesAgg,
      creditPayAgg,
      purchasesAgg,
      supplierPayAgg,
      rentAgg,
      utilAgg,
      empPayAgg,
      empAdvAgg,
      workAdvAgg,
      expSettleAgg,
      ownerDepAgg,
      ownerWithAgg,
    ] = await Promise.all([
      this.prisma.sale.aggregate({
        where: { storeOwnerId, walletId, paymentType: 'ELECTRONIC', walletSettled: false },
        _count: { id: true },
        _sum: { amount: true },
      }),
      this.prisma.creditPayment.aggregate({
        where: { storeOwnerId, walletId, paymentMethod: 'ELECTRONIC', walletSettled: false },
        _count: { id: true },
        _sum: { amount: true },
      }),
      this.prisma.purchaseInvoice.aggregate({
        where: { storeOwnerId, walletId, status: 'POSTED', paidAmount: { gt: 0 }, walletSettled: false },
        _count: { id: true },
        _sum: { paidAmount: true },
      }),
      this.prisma.supplierPayment.aggregate({
        where: { storeOwnerId, walletId, paymentMethod: 'ELECTRONIC', walletSettled: false },
        _count: { id: true },
        _sum: { amount: true },
      }),
      this.prisma.rentRecord.aggregate({
        where: { storeOwnerId, walletId, paymentMethod: 'ELECTRONIC', paidAmount: { gt: 0 }, walletSettled: false },
        _count: { id: true },
        _sum: { paidAmount: true },
      }),
      this.prisma.utilityPayment.aggregate({
        where: { storeOwnerId, walletId, paymentMethod: 'ELECTRONIC', paidAmount: { gt: 0 }, walletSettled: false },
        _count: { id: true },
        _sum: { paidAmount: true },
      }),
      this.prisma.employeePayment.aggregate({
        where: { storeOwnerId, walletId, paymentMethod: 'ELECTRONIC', paidAmount: { gt: 0 }, walletSettled: false },
        _count: { id: true },
        _sum: { paidAmount: true },
      }),
      this.prisma.employeeAdvance.aggregate({
        where: { storeOwnerId, walletId, paymentMethod: 'ELECTRONIC', walletSettled: false },
        _count: { id: true },
        _sum: { amount: true },
      }),
      this.prisma.workerAdvance.aggregate({
        where: { storeOwnerId, walletId, paymentMethod: 'ELECTRONIC', walletSettled: false },
        _count: { id: true },
        _sum: { amount: true },
      }),
      this.prisma.expenseSettlement.aggregate({
        where: { storeOwnerId, walletId, paymentMethod: 'ELECTRONIC', walletSettled: false },
        _count: { id: true },
        _sum: { amount: true },
      }),
      this.prisma.ownerTransaction.aggregate({
        where: { storeOwnerId, walletId, paymentMethod: 'ELECTRONIC', type: 'DEPOSIT', walletSettled: false },
        _count: { id: true },
        _sum: { amount: true },
      }),
      this.prisma.ownerTransaction.aggregate({
        where: { storeOwnerId, walletId, paymentMethod: 'ELECTRONIC', type: 'WITHDRAWAL', walletSettled: false },
        _count: { id: true },
        _sum: { amount: true },
      }),
    ]);

    const inflow = round2(
      Number(salesAgg._sum.amount ?? 0) +
        Number(creditPayAgg._sum.amount ?? 0) +
        Number(ownerDepAgg._sum.amount ?? 0),
    );
    const outflow = round2(
      Number(purchasesAgg._sum.paidAmount ?? 0) +
        Number(supplierPayAgg._sum.amount ?? 0) +
        Number(rentAgg._sum.paidAmount ?? 0) +
        Number(utilAgg._sum.paidAmount ?? 0) +
        Number(empPayAgg._sum.paidAmount ?? 0) +
        Number(empAdvAgg._sum.amount ?? 0) +
        Number(workAdvAgg._sum.amount ?? 0) +
        Number(expSettleAgg._sum.amount ?? 0) +
        Number(ownerWithAgg._sum.amount ?? 0),
    );
    const count =
      salesAgg._count.id +
      creditPayAgg._count.id +
      purchasesAgg._count.id +
      supplierPayAgg._count.id +
      rentAgg._count.id +
      utilAgg._count.id +
      empPayAgg._count.id +
      empAdvAgg._count.id +
      workAdvAgg._count.id +
      expSettleAgg._count.id +
      ownerDepAgg._count.id +
      ownerWithAgg._count.id;

    return { count, inflow, outflow };
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
