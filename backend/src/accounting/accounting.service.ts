import { Injectable } from '@nestjs/common';
import { AccountType, LedgerReferenceType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';

export type LedgerLine = {
  accountCode: string; // كود من دليل الحسابات المزروع (1000، 4000، 5450...)
  debit?: number;      // بالهللات؟ لا — بالريال كعدد عشري؛ القيود تتوازن على نفس العملة
  credit?: number;
  description?: string;
};

const FALLBACK_STANDARD_ACCOUNTS: Record<string, { name: string; type: AccountType }> = {
  '2000': { name: 'الموردون / الذمم الدائنة', type: 'LIABILITY' },
  '2100': { name: 'مصروفات مستحقة', type: 'LIABILITY' },
  '3100': { name: 'جاري المالك (مسحوبات وإيداعات المالك)', type: 'EQUITY' },
  '5700': { name: 'مصروفات أخرى', type: 'EXPENSE' },
};

const REFERENCE_TYPE_LABELS: Record<string, string> = {
  SALE: 'مبيعات',
  CREDIT_PAYMENT: 'تحصيل دين عميل',
  EXPENSE: 'مصروفات وسلف',
  EXPENSE_SETTLEMENT: 'سداد مصروف مستحق',
  DAMAGED_GOODS: 'إتلاف بضاعة',
  CLOSING: 'إقفال ومطابقة يومية',
  RETURN: 'مرتجع مبيعات',
  EMERGENCY_SALE_LOSS: 'خسارة بيع اضطراري',
  REJECTED_TRANSACTION_RESOLUTION: 'معالجة عملية مرفوضة',
  PURCHASE: 'فاتورة مشتريات',
  PURCHASE_VOID: 'إلغاء فاتورة مشتريات',
  SUPPLIER_OPENING_BALANCE: 'رصيد افتتاحي لمورد',
  PURCHASE_PAYMENT: 'سداد مورد',
  PURCHASE_RETURN: 'مرتجع مشتريات',
  OWNER_DEPOSIT: 'إيداع مالك',
  OWNER_WITHDRAWAL: 'سحب مالك',
  WALLET_SETTLEMENT: 'تسوية محفظة إلكترونية',
};

// المحاسبة التلقائية — القيد المزدوج (R-22 / BR-053..055):
// كل عملية مالية تُنشئ قيداً متوازناً (مدين = دائن) Append-only ضمن نفس معاملة العملية
@Injectable()
export class AccountingService {
  constructor(private readonly prisma: PrismaService) {}

  // تُستدعى دائماً داخل معاملة العملية (tx) — تتحقق من التوازن قبل الكتابة
  async createBalancedEntries(
    tx: Prisma.TransactionClient,
    params: {
      storeOwnerId: string;
      entryDate: Date;
      referenceType: LedgerReferenceType;
      referenceId: string;
      lines: LedgerLine[];
    },
  ): Promise<void> {
    const { storeOwnerId, entryDate, referenceType, referenceId, lines } = params;

    const totalDebit = round2(lines.reduce((s, l) => s + (l.debit ?? 0), 0));
    const totalCredit = round2(lines.reduce((s, l) => s + (l.credit ?? 0), 0));
    // BR-054: مجموع debit = مجموع credit لكل reference_id
    if (lines.length === 0 || totalDebit !== totalCredit || totalDebit <= 0) {
      throw ApiError.internal(`قيد غير متوازن لـ ${referenceType}:${referenceId}`);
    }

    const requestedCodes = Array.from(new Set(lines.map((l) => l.accountCode)));
    let accounts = await tx.chartOfAccount.findMany({
      where: { storeOwnerId, code: { in: requestedCodes } },
      select: { id: true, code: true },
    });
    const byCode = new Map(accounts.map((a) => [a.code, a.id]));

    for (const code of requestedCodes) {
      if (!byCode.has(code) && FALLBACK_STANDARD_ACCOUNTS[code]) {
        const meta = FALLBACK_STANDARD_ACCOUNTS[code];
        const created = await tx.chartOfAccount.upsert({
          where: { storeOwnerId_code: { storeOwnerId, code } },
          update: {},
          create: {
            storeOwnerId,
            code,
            name: meta.name,
            accountType: meta.type,
          },
          select: { id: true, code: true },
        });
        byCode.set(created.code, created.id);
      }
    }

    await tx.ledgerEntry.createMany({
      data: lines.map((l) => {
        const accountId = byCode.get(l.accountCode);
        if (!accountId) {
          throw ApiError.internal(`حساب غير موجود في الدليل: ${l.accountCode}`);
        }
        return {
          storeOwnerId,
          entryDate,
          referenceType,
          referenceId,
          accountId,
          debit: round2(l.debit ?? 0),
          credit: round2(l.credit ?? 0),
          description: l.description,
        };
      }),
    });
  }

  // استعراض دليل الحسابات مع أرصدة ميزان المراجعة للمالك
  async getAccountsWithBalances(storeOwnerId: string, query?: { from?: string; to?: string }) {
    const dateFilter = buildDateFilter(query?.from, query?.to);
    const [accounts, grouped] = await Promise.all([
      this.prisma.chartOfAccount.findMany({
        where: { storeOwnerId },
        orderBy: { code: 'asc' },
      }),
      this.prisma.ledgerEntry.groupBy({
        by: ['accountId'],
        where: {
          storeOwnerId,
          ...(dateFilter ? { entryDate: dateFilter } : {}),
        },
        _sum: { debit: true, credit: true },
        _count: { id: true },
      }),
    ]);

    const sumsByAccount = new Map(
      grouped.map((g) => [
        g.accountId,
        {
          debit: round2(Number(g._sum.debit ?? 0)),
          credit: round2(Number(g._sum.credit ?? 0)),
          entriesCount: g._count.id,
        },
      ]),
    );

    let trialTotalDebit = 0;
    let trialTotalCredit = 0;

    const rows = accounts.map((acc) => {
      const stats = sumsByAccount.get(acc.id) ?? { debit: 0, credit: 0, entriesCount: 0 };
      trialTotalDebit = round2(trialTotalDebit + stats.debit);
      trialTotalCredit = round2(trialTotalCredit + stats.credit);

      const isDebitNature = acc.accountType === 'ASSET' || acc.accountType === 'EXPENSE';
      const netBalance = isDebitNature
        ? round2(stats.debit - stats.credit)
        : round2(stats.credit - stats.debit);

      return {
        id: acc.id,
        code: acc.code,
        name: acc.name,
        account_type: acc.accountType,
        normal_side: isDebitNature ? 'DEBIT' : 'CREDIT',
        total_debit: stats.debit,
        total_credit: stats.credit,
        net_balance: netBalance,
        entries_count: stats.entriesCount,
      };
    });

    return {
      trial_balance: {
        total_debit: trialTotalDebit,
        total_credit: trialTotalCredit,
        difference: round2(trialTotalDebit - trialTotalCredit),
        is_balanced: trialTotalDebit === trialTotalCredit,
      },
      accounts: rows,
    };
  }

  // استعراض قيود دفتر الأستاذ العام مع الفلترة والرصيد التراكمي وتصدير CSV
  async getGeneralLedger(
    storeOwnerId: string,
    query: {
      accountCode?: string;
      referenceType?: string;
      from?: string;
      to?: string;
      limit?: number;
      offset?: number;
      format?: string;
    },
  ) {
    let selectedAccount: {
      id: string;
      code: string;
      name: string;
      accountType: AccountType;
    } | null = null;

    if (query.accountCode && query.accountCode.trim() !== '') {
      selectedAccount = await this.prisma.chartOfAccount.findFirst({
        where: { storeOwnerId, code: query.accountCode.trim() },
        select: { id: true, code: true, name: true, accountType: true },
      });
      if (!selectedAccount) {
        throw ApiError.notFound('الحساب المحدد غير موجود في دليل الحسابات.');
      }
    }

    const dateFilter = buildDateFilter(query.from, query.to);
    const whereClause: Prisma.LedgerEntryWhereInput = {
      storeOwnerId,
      ...(selectedAccount ? { accountId: selectedAccount.id } : {}),
      ...(query.referenceType && query.referenceType.trim() !== ''
        ? { referenceType: query.referenceType.trim() as LedgerReferenceType }
        : {}),
      ...(dateFilter ? { entryDate: dateFilter } : {}),
    };

    let openingBalance = 0;
    const isDebitNature = selectedAccount
      ? selectedAccount.accountType === 'ASSET' || selectedAccount.accountType === 'EXPENSE'
      : true;

    if (selectedAccount && query.from) {
      const fromDate = parseDateOnly(query.from);
      const priorAgg = await this.prisma.ledgerEntry.aggregate({
        where: {
          storeOwnerId,
          accountId: selectedAccount.id,
          entryDate: { lt: fromDate },
        },
        _sum: { debit: true, credit: true },
      });
      const priorDebit = Number(priorAgg._sum.debit ?? 0);
      const priorCredit = Number(priorAgg._sum.credit ?? 0);
      openingBalance = isDebitNature
        ? round2(priorDebit - priorCredit)
        : round2(priorCredit - priorDebit);
    }

    const limit = Math.min(Math.max(Number(query.limit) || 200, 1), 1000);
    const offset = Math.max(Number(query.offset) || 0, 0);

    const [totalCount, periodAgg, entries] = await Promise.all([
      this.prisma.ledgerEntry.count({ where: whereClause }),
      this.prisma.ledgerEntry.aggregate({
        where: whereClause,
        _sum: { debit: true, credit: true },
      }),
      this.prisma.ledgerEntry.findMany({
        where: whereClause,
        include: {
          account: { select: { code: true, name: true, accountType: true } },
        },
        orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        skip: offset,
        take: limit,
      }),
    ]);

    let running = openingBalance;
    const mappedEntries = entries.map((e) => {
      const debit = round2(Number(e.debit));
      const credit = round2(Number(e.credit));
      if (selectedAccount) {
        running = isDebitNature
          ? round2(running + debit - credit)
          : round2(running + credit - debit);
      } else {
        running = round2(running + debit - credit);
      }

      return {
        id: e.id,
        entry_date: e.entryDate,
        created_at: e.createdAt,
        reference_type: e.referenceType,
        reference_type_label: REFERENCE_TYPE_LABELS[e.referenceType] ?? e.referenceType,
        reference_id: e.referenceId,
        account_code: e.account.code,
        account_name: e.account.name,
        account_type: e.account.accountType,
        debit,
        credit,
        running_balance: selectedAccount ? running : null,
        description: e.description ?? '',
      };
    });

    const periodDebit = round2(Number(periodAgg._sum.debit ?? 0));
    const periodCredit = round2(Number(periodAgg._sum.credit ?? 0));
    const closingBalance = selectedAccount
      ? isDebitNature
        ? round2(openingBalance + periodDebit - periodCredit)
        : round2(openingBalance + periodCredit - periodDebit)
      : null;

    let csvContent: string | undefined;
    if (query.format?.toLowerCase() === 'csv') {
      const header = [
        'التاريخ',
        'كود الحساب',
        'اسم الحساب',
        'نوع الحركة',
        'البيان',
        'مدين',
        'دائن',
        'الرصيد التراكمي',
      ].join(',');
      const linesCsv = mappedEntries.map((row) =>
        [
          new Date(row.entry_date).toISOString().slice(0, 10),
          row.account_code,
          escapeCsv(row.account_name),
          escapeCsv(row.reference_type_label),
          escapeCsv(row.description),
          row.debit.toFixed(2),
          row.credit.toFixed(2),
          row.running_balance !== null ? row.running_balance.toFixed(2) : '',
        ].join(','),
      );
      csvContent = '\uFEFF' + [header, ...linesCsv].join('\n');
    }

    return {
      account: selectedAccount
        ? {
            id: selectedAccount.id,
            code: selectedAccount.code,
            name: selectedAccount.name,
            account_type: selectedAccount.accountType,
            opening_balance: openingBalance,
            closing_balance: closingBalance,
          }
        : null,
      summary: {
        total_entries: totalCount,
        period_debit: periodDebit,
        period_credit: periodCredit,
        is_balanced: selectedAccount ? true : periodDebit === periodCredit,
      },
      entries: mappedEntries,
      ...(csvContent ? { csv_content: csvContent } : {}),
    };
  }
}

function parseDateOnly(s: string): Date {
  const d = new Date(s);
  if (isNaN(d.getTime())) {
    throw ApiError.badRequest('VALIDATION_ERROR', 'صيغة التاريخ غير صالحة.');
  }
  d.setHours(0, 0, 0, 0);
  return d;
}

function buildDateFilter(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  const filter: Prisma.DateTimeFilter = {};
  if (from) filter.gte = parseDateOnly(from);
  if (to) {
    const end = parseDateOnly(to);
    end.setHours(23, 59, 59, 999);
    filter.lte = end;
  }
  return filter;
}

function escapeCsv(val: string): string {
  const cleaned = String(val ?? '').replace(/"/g, '""');
  return `"${cleaned}"`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
