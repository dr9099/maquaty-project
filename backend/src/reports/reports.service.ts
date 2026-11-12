import { Injectable } from '@nestjs/common';
import { OwnerTransactionType, PaymentType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import { formatQuantityDisplay } from '../common/quantity-formatter';
import { AuthenticatedUser } from '../common/types';
import { CURRENCY_METADATA } from '../settings/settings.service';
import {
  CreateOwnerTransactionDto,
  QueryRangeDto,
  QueryReportsDto,
  ReportType,
} from './dto/reports.dto';

// خدمة الأموال والتقارير وإيداعات/مسحوبات المالك — API_SPEC القسم 10 + تقارير المشتريات والموردين وقائمة الدخل الكاملة
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
    private readonly audit: AuditService,
  ) {}

  async getFundsSummary(user: AuthenticatedUser, dateStr?: string) {
    const storeOwnerId = user.storeOwnerId!;
    const owner = await this.prisma.storeOwner.findUniqueOrThrow({
      where: { id: storeOwnerId },
      select: { currency: true, allowResponsiblePurchases: true },
    });

    const dateFilter = dateStr ? { entryDate: { lte: new Date(dateStr) } } : {};

    // 1) رصيد الصندوق (الحساب 1000)
    const cashEntries = await this.prisma.ledgerEntry.findMany({
      where: { storeOwnerId, account: { code: '1000' }, ...dateFilter },
      select: { debit: true, credit: true },
    });
    const cashBalance = cashEntries.reduce(
      (sum, e) => sum.plus(e.debit).minus(e.credit),
      new Prisma.Decimal(0),
    );

    // 2) رصيد المحافظ الإلكترونية (الحساب 1100 وكافة الحسابات الفرعية 11xx)
    const walletEntries = await this.prisma.ledgerEntry.findMany({
      where: { storeOwnerId, account: { code: { startsWith: '11' } }, ...dateFilter },
      select: { debit: true, credit: true },
    });
    const walletBalance = walletEntries.reduce(
      (sum, e) => sum.plus(e.debit).minus(e.credit),
      new Prisma.Decimal(0),
    );

    // 3) رصيد ذمم العملاء (الحساب 1200 — يشمل المبيعات الآجلة مطروحاً منها المرتجعات والسدادات)
    const creditEntries = await this.prisma.ledgerEntry.findMany({
      where: { storeOwnerId, account: { code: '1200' }, ...dateFilter },
      select: { debit: true, credit: true },
    });
    const receivablesBalance = creditEntries.reduce(
      (sum, e) => sum.plus(e.debit).minus(e.credit),
      new Prisma.Decimal(0),
    );

    const totalFunds = cashBalance.plus(walletBalance).plus(receivablesBalance);

    // 4) التزامات الموردين (الحساب 2000): للمالك، أو للعامل المسؤول فقط عند تفعيل allowResponsiblePurchases
    const canSeePurchases =
      user.role === 'STORE_OWNER' ||
      (user.role === 'WORKER' && Boolean(user.isResponsible) && owner.allowResponsiblePurchases);

    let supplierPayablesObj: Record<string, unknown> = {};
    if (canSeePurchases) {
      const payableEntries = await this.prisma.ledgerEntry.findMany({
        where: { storeOwnerId, account: { code: '2000' }, ...dateFilter },
        select: { debit: true, credit: true },
      });
      const payablesBalance = payableEntries.reduce(
        (sum, e) => sum.plus(e.credit).minus(e.debit),
        new Prisma.Decimal(0),
      );
      supplierPayablesObj = {
        supplier_payables: Number(payablesBalance.toDecimalPlaces(2)),
        net_funds_after_payables: Number(totalFunds.minus(payablesBalance).toDecimalPlaces(2)),
      };
    }

    // 5) المصروفات المستحقة غير المسددة (2100) وجاري المالك (3100) — للمالك حصراً
    let ownerExtrasObj: Record<string, unknown> = {};
    if (user.role === 'STORE_OWNER') {
      const [accruedEntries, ownerEquityEntries, ownerDepAgg, ownerWithAgg] = await Promise.all([
        this.prisma.ledgerEntry.findMany({
          where: { storeOwnerId, account: { code: '2100' }, ...dateFilter },
          select: { debit: true, credit: true },
        }),
        this.prisma.ledgerEntry.findMany({
          where: { storeOwnerId, account: { code: '3100' }, ...dateFilter },
          select: { debit: true, credit: true },
        }),
        this.prisma.ownerTransaction.aggregate({
          where: { storeOwnerId, type: 'DEPOSIT' },
          _sum: { amount: true },
        }),
        this.prisma.ownerTransaction.aggregate({
          where: { storeOwnerId, type: 'WITHDRAWAL' },
          _sum: { amount: true },
        }),
      ]);

      const accruedPayables = accruedEntries.reduce(
        (sum, e) => sum.plus(e.credit).minus(e.debit),
        new Prisma.Decimal(0),
      );
      const ownerEquityNet = ownerEquityEntries.reduce(
        (sum, e) => sum.plus(e.credit).minus(e.debit),
        new Prisma.Decimal(0),
      );

      ownerExtrasObj = {
        accrued_expenses_payable: Number(accruedPayables.toDecimalPlaces(2)),
        owner_equity_net: Number(ownerEquityNet.toDecimalPlaces(2)),
        owner_deposits_total: Number((ownerDepAgg._sum.amount ?? new Prisma.Decimal(0)).toDecimalPlaces(2)),
        owner_withdrawals_total: Number(
          (ownerWithAgg._sum.amount ?? new Prisma.Decimal(0)).toDecimalPlaces(2),
        ),
      };
    }

    return {
      date: dateStr ?? new Date().toISOString().split('T')[0],
      currency: owner.currency,
      currency_symbol: CURRENCY_METADATA[owner.currency].symbol,
      cash_in_hand: Number(cashBalance.toDecimalPlaces(2)),
      wallets_balance: Number(walletBalance.toDecimalPlaces(2)),
      customer_receivables: Number(receivablesBalance.toDecimalPlaces(2)),
      total_funds: Number(totalFunds.toDecimalPlaces(2)),
      ...supplierPayablesObj,
      ...ownerExtrasObj,
    };
  }

  // ─── إيداعات ومسحوبات المالك (جاري المالك 3100 — Fix 6 & Note 4) ───────────

  async createOwnerTransaction(
    storeOwnerId: string,
    dto: CreateOwnerTransactionDto,
    ip?: string,
  ) {
    const paymentMethod = dto.paymentMethod ?? 'CASH';
    const amountDecimal = new Prisma.Decimal(dto.amount).toDecimalPlaces(2);
    const today = startOfDay(new Date());

    if (paymentMethod === 'CASH') {
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
          'تم اعتماد إغلاق الصندوق لهذا اليوم مسبقاً ولا يمكن تسجيل إيداع أو سحب نقدي جديد.',
        );
      }
    }

    let walletAccountCode = '1100';
    let walletName: string | null = null;
    if (paymentMethod === 'ELECTRONIC') {
      if (!dto.walletId) {
        throw ApiError.badRequest(
          'VALIDATION_ERROR',
          'اختيار المحفظة الإلكترونية إلزامي عند الإيداع أو السحب الإلكتروني.',
        );
      }
      const wallet = await this.prisma.wallet.findFirst({
        where: { id: dto.walletId, storeOwnerId, isActive: true },
      });
      if (!wallet) throw ApiError.notFound('المحفظة الإلكترونية غير موجودة.');
      walletName = wallet.name;
      if (wallet.accountCode) {
        walletAccountCode = wallet.accountCode;
      } else {
        const wAcc = await this.prisma.chartOfAccount.findFirst({
          where: { storeOwnerId, accountType: 'ASSET', name: { startsWith: `محفظة: ${wallet.name}` } },
          select: { code: true },
        });
        walletAccountCode = wAcc?.code ?? '1100';
      }
    }

    const created = await this.prisma.$transaction(async (tx) => {
      // ضمان وجود حساب 3100 جاري المالك في دليل الحسابات
      const eqAcc = await tx.chartOfAccount.findUnique({
        where: { storeOwnerId_code: { storeOwnerId, code: '3100' } },
      });
      if (!eqAcc) {
        await tx.chartOfAccount.create({
          data: {
            storeOwnerId,
            code: '3100',
            name: 'جاري المالك (مسحوبات وإيداعات المالك)',
            accountType: 'EQUITY',
          },
        });
      }

      const txRow = await tx.ownerTransaction.create({
        data: {
          storeOwnerId,
          type: dto.type,
          amount: amountDecimal,
          paymentMethod: paymentMethod === 'ELECTRONIC' ? PaymentType.ELECTRONIC : PaymentType.CASH,
          walletId: paymentMethod === 'ELECTRONIC' ? dto.walletId! : null,
          attachmentUrl: dto.attachmentUrl?.trim() || null,
          note: dto.note?.trim() || null,
          transactedAt: new Date(),
        },
        include: { wallet: { select: { id: true, name: true } } },
      });

      const liquidAccount = paymentMethod === 'ELECTRONIC' ? walletAccountCode : '1000';
      const amtNum = amountDecimal.toNumber();
      const noteSuffix = dto.note?.trim() ? ` — ${dto.note.trim()}` : '';

      if (dto.type === OwnerTransactionType.DEPOSIT) {
        await this.accounting.createBalancedEntries(tx, {
          storeOwnerId,
          entryDate: today,
          referenceType: 'OWNER_DEPOSIT',
          referenceId: txRow.id,
          lines: [
            {
              accountCode: liquidAccount,
              debit: amtNum,
              description: `إيداع مالك في ${paymentMethod === 'ELECTRONIC' ? `محفظة (${walletName})` : 'الصندوق'}${noteSuffix}`,
            },
            {
              accountCode: '3100',
              credit: amtNum,
              description: `جاري المالك — إيداع تمويل للمحل${noteSuffix}`,
            },
          ],
        });
      } else {
        await this.accounting.createBalancedEntries(tx, {
          storeOwnerId,
          entryDate: today,
          referenceType: 'OWNER_WITHDRAWAL',
          referenceId: txRow.id,
          lines: [
            {
              accountCode: '3100',
              debit: amtNum,
              description: `جاري المالك — مسحوبات شخصية للمالك${noteSuffix}`,
            },
            {
              accountCode: liquidAccount,
              credit: amtNum,
              description: `سحب مالك من ${paymentMethod === 'ELECTRONIC' ? `محفظة (${walletName})` : 'الصندوق'}${noteSuffix}`,
            },
          ],
        });
      }

      return txRow;
    });

    await this.audit.log({
      actorType: 'STORE_OWNER',
      actorId: storeOwnerId,
      actionType: dto.type === 'DEPOSIT' ? 'OWNER_DEPOSIT' : 'OWNER_WITHDRAWAL',
      targetType: 'owner_transaction',
      targetId: created.id,
      newValue: {
        type: created.type,
        amount: Number(created.amount),
        payment_method: created.paymentMethod,
        wallet_id: created.walletId,
        note: created.note,
      },
      ipAddress: ip,
      result: 'SUCCESS',
    });

    return {
      id: created.id,
      type: created.type,
      amount: Number(created.amount),
      payment_method: created.paymentMethod,
      wallet_id: created.walletId,
      wallet_name: created.wallet?.name ?? null,
      attachment_url: created.attachmentUrl,
      note: created.note,
      recorded_at: created.transactedAt,
    };
  }

  async listOwnerTransactions(storeOwnerId: string, dto: QueryRangeDto) {
    const start = dto.date_from ? startOfDay(new Date(dto.date_from)) : new Date(0);
    const end = dto.date_to ? endOfDay(new Date(dto.date_to)) : new Date('2099-12-31T23:59:59.999Z');
    const limit = Math.min(Math.max(dto.limit ?? 50, 1), 100);
    const offset = Math.max(dto.offset ?? 0, 0);

    const where: Prisma.OwnerTransactionWhereInput = {
      storeOwnerId,
      transactedAt: { gte: start, lte: end },
    };

    const [total, depAgg, withAgg, rows, owner] = await Promise.all([
      this.prisma.ownerTransaction.count({ where }),
      this.prisma.ownerTransaction.aggregate({
        where: { ...where, type: 'DEPOSIT' },
        _sum: { amount: true },
      }),
      this.prisma.ownerTransaction.aggregate({
        where: { ...where, type: 'WITHDRAWAL' },
        _sum: { amount: true },
      }),
      this.prisma.ownerTransaction.findMany({
        where,
        include: { wallet: { select: { id: true, name: true } } },
        orderBy: { transactedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.storeOwner.findUniqueOrThrow({
        where: { id: storeOwnerId },
        select: { currency: true },
      }),
    ]);

    const depositsTotal = Number((depAgg._sum.amount ?? new Prisma.Decimal(0)).toDecimalPlaces(2));
    const withdrawalsTotal = Number((withAgg._sum.amount ?? new Prisma.Decimal(0)).toDecimalPlaces(2));

    return {
      total,
      limit,
      offset,
      currency: owner.currency,
      currency_symbol: CURRENCY_METADATA[owner.currency].symbol,
      deposits_total: depositsTotal,
      withdrawals_total: withdrawalsTotal,
      net_owner_equity: round2(depositsTotal - withdrawalsTotal),
      records: rows.map((r) => ({
        id: r.id,
        type: r.type,
        amount: Number(r.amount),
        payment_method: r.paymentMethod,
        wallet_id: r.walletId,
        wallet_name: r.wallet?.name ?? null,
        attachment_url: r.attachmentUrl,
        note: r.note,
        recorded_at: r.transactedAt,
      })),
    };
  }

  async getReport(user: AuthenticatedUser, dto: QueryReportsDto) {
    const storeOwnerId = user.storeOwnerId!;

    const owner = await this.prisma.storeOwner.findUniqueOrThrow({
      where: { id: storeOwnerId },
      select: { currency: true, allowResponsiblePurchases: true },
    });

    // قائمة الدخل والربحية الصافية حصرية للمالك دائماً
    if (user.role === 'WORKER' && dto.type === ReportType.PROFIT_MARGIN) {
      throw ApiError.forbidden(
        'PERMISSION_DENIED',
        'تقرير قائمة الدخل وصافي الأرباح حصري لمالك المتجر فقط.',
      );
    }

    // تقارير المشتريات والموردين: للمالك، أو للعامل المسؤول فقط عند تفعيل allowResponsiblePurchases
    const purchaseReportTypes: ReportType[] = [
      ReportType.PURCHASES,
      ReportType.PURCHASES_BY_SUPPLIER,
      ReportType.PURCHASES_BY_ITEM,
      ReportType.SUPPLIER_PAYABLES,
    ];
    if (user.role === 'WORKER' && purchaseReportTypes.includes(dto.type)) {
      const worker = await this.prisma.worker.findUnique({
        where: { id: user.workerId! },
        select: { isResponsible: true },
      });
      if (!worker?.isResponsible || !owner.allowResponsiblePurchases) {
        throw ApiError.forbidden(
          'PERMISSION_DENIED',
          'تقارير المشتريات والذمم الدائنة حصرية لمالك المتجر ما لم يفعّل صلاحيتها للعامل المسؤول.',
        );
      }
    } else if (user.role === 'WORKER') {
      // التحقق من صلاحية العامل للتقارير المسموحة الأخرى
      const worker = await this.prisma.worker.findUniqueOrThrow({
        where: { id: user.workerId! },
        select: { permReportsAccess: true },
      });
      if (!worker.permReportsAccess) {
        throw ApiError.forbidden('PERMISSION_DENIED', 'ليس لديك صلاحية الوصول إلى التقارير.');
      }
    }

    const currencyMeta = {
      currency: owner.currency,
      currency_symbol: CURRENCY_METADATA[owner.currency].symbol,
    };

    const start = dto.date_from ? startOfDay(new Date(dto.date_from)) : new Date(0);
    const end = dto.date_to ? endOfDay(new Date(dto.date_to)) : new Date('2099-12-31T23:59:59.999Z');
    const limit = Math.min(Math.max(dto.limit ?? 50, 1), 100);
    const offset = Math.max(dto.offset ?? 0, 0);

    switch (dto.type) {
      case ReportType.SALES: {
        const where: Prisma.SaleWhereInput = {
          storeOwnerId,
          soldAt: { gte: start, lte: end },
        };
        const [totalCount, agg, sales] = await Promise.all([
          this.prisma.sale.count({ where }),
          this.prisma.sale.aggregate({ where, _sum: { amount: true, quantity: true } }),
          this.prisma.sale.findMany({
            where,
            include: {
              item: { select: { name: true, unit: true } },
              worker: { select: { fullName: true } },
            },
            orderBy: { soldAt: 'desc' },
            take: limit,
            skip: offset,
          }),
        ]);

        return {
          type: 'sales',
          ...currencyMeta,
          count: totalCount,
          limit,
          offset,
          total_amount: Number((agg._sum.amount ?? new Prisma.Decimal(0)).toDecimalPlaces(2)),
          total_quantity: Number((agg._sum.quantity ?? new Prisma.Decimal(0)).toDecimalPlaces(3)),
          records: sales.map((s) => ({
            id: s.id,
            item_name: s.item.name,
            unit: s.item.unit,
            quantity: Number(s.quantity),
            quantity_display: formatQuantityDisplay(s.quantity, s.item.unit),
            amount: Number(s.amount),
            payment_type: s.paymentType,
            sold_by: s.worker?.fullName ?? 'المالك',
            sold_at: s.soldAt,
          })),
        };
      }

      case ReportType.PURCHASES: {
        // يُقرأ من الفواتير المرحّلة الفعلية (POSTED) مع الحفاظ الكامل على مفاتيح التوافق العكسي
        const invWhere: Prisma.PurchaseInvoiceWhereInput = {
          storeOwnerId,
          status: 'POSTED',
          invoiceDate: { gte: start, lte: end },
        };

        const [invoicesAgg, returnsAgg, linesCount, lines] = await Promise.all([
          this.prisma.purchaseInvoice.aggregate({
            where: invWhere,
            _count: { id: true },
            _sum: { totalAmount: true, paidAmount: true, remainingAmount: true },
          }),
          this.prisma.purchaseReturn.aggregate({
            where: {
              storeOwnerId,
              returnedAt: { gte: start, lte: end },
            },
            _sum: { totalAmount: true, baseQuantity: true },
          }),
          this.prisma.purchaseItem.count({
            where: { storeOwnerId, purchaseInvoice: invWhere },
          }),
          this.prisma.purchaseItem.findMany({
            where: { storeOwnerId, purchaseInvoice: invWhere },
            include: {
              purchaseInvoice: {
                select: {
                  id: true,
                  invoiceNumber: true,
                  invoiceDate: true,
                  paymentType: true,
                  postedAt: true,
                  supplier: { select: { id: true, name: true } },
                },
              },
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
            skip: offset,
          }),
        ]);

        const allQtyAgg = await this.prisma.purchaseItem.aggregate({
          where: { storeOwnerId, purchaseInvoice: invWhere },
          _sum: { baseQuantity: true },
        });

        const grossCost = invoicesAgg._sum.totalAmount ?? new Prisma.Decimal(0);
        const returnsCost = returnsAgg._sum.totalAmount ?? new Prisma.Decimal(0);
        const netCost = grossCost.minus(returnsCost);

        const grossQty = allQtyAgg._sum.baseQuantity ?? new Prisma.Decimal(0);
        const returnsQty = returnsAgg._sum.baseQuantity ?? new Prisma.Decimal(0);
        const netQty = grossQty.minus(returnsQty);

        return {
          type: 'purchases',
          ...currencyMeta,
          count: linesCount,
          invoices_count: invoicesAgg._count.id,
          limit,
          offset,
          gross_cost: Number(grossCost.toDecimalPlaces(2)),
          total_returns: Number(returnsCost.toDecimalPlaces(2)),
          total_cost: Number(netCost.toDecimalPlaces(2)),
          total_quantity: Number(netQty.toDecimalPlaces(3)),
          total_paid: Number((invoicesAgg._sum.paidAmount ?? new Prisma.Decimal(0)).toDecimalPlaces(2)),
          total_remaining: Number(
            (invoicesAgg._sum.remainingAmount ?? new Prisma.Decimal(0)).toDecimalPlaces(2),
          ),
          records: lines.map((l) => {
            const netBaseQty = l.baseQuantity.minus(l.returnedQuantity.mul(l.conversionFactor));
            const netLineCost = netBaseQty.mul(l.effectiveBaseUnitCost).toDecimalPlaces(2);
            return {
              id: l.id,
              invoice_id: l.purchaseInvoice.id,
              invoice_number: l.purchaseInvoice.invoiceNumber,
              supplier_id: l.purchaseInvoice.supplier.id,
              supplier_name: l.purchaseInvoice.supplier.name,
              payment_type: l.purchaseInvoice.paymentType,
              name: l.itemName,
              unit: l.baseUnit,
              purchase_unit: l.unit,
              conversion_factor: Number(l.conversionFactor),
              quantity: Number(netBaseQty.toDecimalPlaces(3)),
              quantity_display: formatQuantityDisplay(netBaseQty, l.baseUnit),
              cost_price: Number(l.effectiveBaseUnitCost),
              total_purchase_cost: Number(netLineCost),
              invoice_date: l.purchaseInvoice.invoiceDate,
              created_at: l.purchaseInvoice.postedAt ?? l.createdAt,
            };
          }),
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
        const pureUtilities = utilities.filter((u) => u.utilityType !== 'OTHER');
        const otherExpenses = utilities.filter((u) => u.utilityType === 'OTHER');

        const utilityTotal = pureUtilities.reduce((sum, u) => sum.plus(u.amount), new Prisma.Decimal(0));
        const otherExpensesTotal = otherExpenses.reduce(
          (sum, u) => sum.plus(u.amount),
          new Prisma.Decimal(0),
        );
        const employeeTotal = employeePayments.reduce(
          (sum, e) => sum.plus(e.amount),
          new Prisma.Decimal(0),
        );
        const totalExpenses = rentTotal
          .plus(utilityTotal)
          .plus(otherExpensesTotal)
          .plus(employeeTotal);

        const combined = [
          ...rents.map((r) => ({
            id: r.id,
            category: 'RENT',
            account_code: '5200',
            description: `إيجار المتجر — المستلم: ${r.receiverName}`,
            amount: Number(r.amount),
            payment_method: r.paymentMethod,
            paid_amount: Number(r.paidAmount),
            remaining_amount: Number(r.remainingAmount),
            paid_at: r.paidAt,
          })),
          ...pureUtilities.map((u) => ({
            id: u.id,
            category: 'UTILITY',
            account_code: '5300',
            description: u.note ?? `خدمة: ${u.utilityType}`,
            amount: Number(u.amount),
            payment_method: u.paymentMethod,
            paid_amount: Number(u.paidAmount),
            remaining_amount: Number(u.remainingAmount),
            paid_at: u.paidAt,
          })),
          ...otherExpenses.map((u) => ({
            id: u.id,
            category: 'OTHER_EXPENSE',
            account_code: '5700',
            description: u.note ?? 'مصروفات أخرى للمتجر',
            amount: Number(u.amount),
            payment_method: u.paymentMethod,
            paid_amount: Number(u.paidAmount),
            remaining_amount: Number(u.remainingAmount),
            paid_at: u.paidAt,
          })),
          ...employeePayments.map((e) => ({
            id: e.id,
            category: 'SALARY',
            account_code: '5100',
            description: `راتب موظف: ${e.employee.name}`,
            amount: Number(e.amount),
            payment_method: e.paymentMethod,
            paid_amount: Number(e.paidAmount),
            remaining_amount: Number(e.remainingAmount),
            paid_at: e.paidAt,
          })),
        ].sort((a, b) => b.paid_at.getTime() - a.paid_at.getTime());

        return {
          type: 'expenses',
          ...currencyMeta,
          total_expenses: Number(totalExpenses.toDecimalPlaces(2)),
          categories: {
            rent: Number(rentTotal.toDecimalPlaces(2)),
            utilities: Number(utilityTotal.toDecimalPlaces(2)),
            other_expenses: Number(otherExpensesTotal.toDecimalPlaces(2)),
            salaries: Number(employeeTotal.toDecimalPlaces(2)),
          },
          records: combined.slice(offset, offset + limit),
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
        const employeeAdvTotal = employeeAdvances.reduce(
          (sum, e) => sum.plus(e.amount),
          new Prisma.Decimal(0),
        );
        const totalWithdrawals = workerAdvTotal.plus(employeeAdvTotal);

        const combined = [
          ...workerAdvances.map((w) => ({
            type: 'WORKER_ADVANCE',
            recipient: w.worker.fullName,
            amount: Number(w.amount),
            payment_method: w.paymentMethod,
            note: w.note,
            date: w.recordedAt,
          })),
          ...employeeAdvances.map((e) => ({
            type: 'EMPLOYEE_ADVANCE',
            recipient: e.employee.name,
            amount: Number(e.amount),
            payment_method: e.paymentMethod,
            note: e.note,
            date: e.createdAt,
          })),
        ].sort((a, b) => b.date.getTime() - a.date.getTime());

        return {
          type: 'withdrawals',
          ...currencyMeta,
          total_withdrawals: Number(totalWithdrawals.toDecimalPlaces(2)),
          categories: {
            worker_advances: Number(workerAdvTotal.toDecimalPlaces(2)),
            employee_advances: Number(employeeAdvTotal.toDecimalPlaces(2)),
          },
          records: combined.slice(offset, offset + limit),
        };
      }

      case ReportType.PURCHASES_BY_SUPPLIER:
        return this.getPurchasesBySupplier(storeOwnerId, dto);

      case ReportType.PURCHASES_BY_ITEM:
        return this.getPurchasesByItem(storeOwnerId, dto);

      case ReportType.SUPPLIER_PAYABLES:
        return this.getSupplierPayables(storeOwnerId, dto);

      case ReportType.PROFIT_MARGIN:
        return this.getProfitMargin(storeOwnerId, dto);
    }
  }

  async getPurchasesBySupplier(storeOwnerId: string, dto: QueryRangeDto) {
    const start = dto.date_from ? startOfDay(new Date(dto.date_from)) : new Date(0);
    const end = dto.date_to ? endOfDay(new Date(dto.date_to)) : new Date('2099-12-31T23:59:59.999Z');
    const limit = Math.min(Math.max(dto.limit ?? 50, 1), 100);
    const offset = Math.max(dto.offset ?? 0, 0);

    const [owner, suppliers, invoiceGroups, paymentGroups, returnGroups] = await Promise.all([
      this.prisma.storeOwner.findUniqueOrThrow({
        where: { id: storeOwnerId },
        select: { currency: true },
      }),
      this.prisma.supplier.findMany({
        where: { storeOwnerId, deletedAt: null },
        orderBy: { name: 'asc' },
      }),
      this.prisma.purchaseInvoice.groupBy({
        by: ['supplierId'],
        where: {
          storeOwnerId,
          status: 'POSTED',
          invoiceDate: { gte: start, lte: end },
        },
        _count: { id: true },
        _sum: { totalAmount: true, paidAmount: true },
      }),
      this.prisma.supplierPayment.groupBy({
        by: ['supplierId'],
        where: {
          storeOwnerId,
          paidAt: { gte: start, lte: end },
        },
        _sum: { amount: true },
      }),
      this.prisma.purchaseReturn.groupBy({
        by: ['supplierId'],
        where: {
          storeOwnerId,
          returnedAt: { gte: start, lte: end },
        },
        _sum: { totalAmount: true },
      }),
    ]);

    const invoiceMap = new Map(invoiceGroups.map((g) => [g.supplierId, g]));
    const paymentMap = new Map(paymentGroups.map((g) => [g.supplierId, g]));
    const returnMap = new Map(returnGroups.map((g) => [g.supplierId, g]));

    const rows = suppliers.map((s) => {
      const invAgg = invoiceMap.get(s.id);
      const payAgg = paymentMap.get(s.id);
      const retAgg = returnMap.get(s.id);

      const purchased = Number((invAgg?._sum.totalAmount ?? new Prisma.Decimal(0)).toDecimalPlaces(2));
      const paidOnInv = Number((invAgg?._sum.paidAmount ?? new Prisma.Decimal(0)).toDecimalPlaces(2));
      const payments = Number((payAgg?._sum.amount ?? new Prisma.Decimal(0)).toDecimalPlaces(2));
      const returned = Number((retAgg?._sum.totalAmount ?? new Prisma.Decimal(0)).toDecimalPlaces(2));

      return {
        supplier_id: s.id,
        supplier_name: s.name,
        phone: s.phone,
        status: s.status,
        invoices_count: invAgg?._count.id ?? 0,
        total_purchased: purchased,
        total_returned: returned,
        net_purchased: round2(purchased - returned),
        total_paid: round2(paidOnInv + payments),
        current_balance: Number(s.currentBalance),
      };
    });

    rows.sort((a, b) => b.net_purchased - a.net_purchased);
    const totalPurchased = round2(rows.reduce((s, r) => s + r.net_purchased, 0));
    const totalPayables = round2(rows.reduce((s, r) => s + r.current_balance, 0));

    return {
      type: 'purchases_by_supplier',
      currency: owner.currency,
      currency_symbol: CURRENCY_METADATA[owner.currency].symbol,
      total: rows.length,
      limit,
      offset,
      total_net_purchased: totalPurchased,
      total_current_payables: totalPayables,
      records: rows.slice(offset, offset + limit),
    };
  }

  async getPurchasesByItem(storeOwnerId: string, dto: QueryRangeDto) {
    const start = dto.date_from ? startOfDay(new Date(dto.date_from)) : new Date(0);
    const end = dto.date_to ? endOfDay(new Date(dto.date_to)) : new Date('2099-12-31T23:59:59.999Z');
    const limit = Math.min(Math.max(dto.limit ?? 50, 1), 100);
    const offset = Math.max(dto.offset ?? 0, 0);

    const owner = await this.prisma.storeOwner.findUniqueOrThrow({
      where: { id: storeOwnerId },
      select: { currency: true },
    });

    const pItems = await this.prisma.purchaseItem.findMany({
      where: {
        storeOwnerId,
        purchaseInvoice: {
          status: 'POSTED',
          invoiceDate: { gte: start, lte: end },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const grouped = new Map<
      string,
      {
        item_name: string;
        base_unit: string;
        total_qty: number;
        total_cost: number;
        min_unit_cost: number;
        max_unit_cost: number;
        batches_count: number;
      }
    >();

    for (const p of pItems) {
      const key = `${p.itemName}__${p.baseUnit}`;
      const netQty = Number(p.baseQuantity.minus(p.returnedQuantity.mul(p.conversionFactor)));
      const unitCost = Number(p.effectiveBaseUnitCost);
      const netCost = round2(netQty * unitCost);

      const cur = grouped.get(key);
      if (!cur) {
        grouped.set(key, {
          item_name: p.itemName,
          base_unit: p.baseUnit,
          total_qty: netQty,
          total_cost: netCost,
          min_unit_cost: unitCost,
          max_unit_cost: unitCost,
          batches_count: 1,
        });
      } else {
        cur.total_qty = round3(cur.total_qty + netQty);
        cur.total_cost = round2(cur.total_cost + netCost);
        cur.min_unit_cost = Math.min(cur.min_unit_cost, unitCost);
        cur.max_unit_cost = Math.max(cur.max_unit_cost, unitCost);
        cur.batches_count += 1;
      }
    }

    const list = Array.from(grouped.values())
      .map((g) => ({
        ...g,
        average_unit_cost: g.total_qty > 0 ? round2(g.total_cost / g.total_qty) : 0,
      }))
      .sort((a, b) => b.total_cost - a.total_cost);

    return {
      type: 'purchases_by_item',
      currency: owner.currency,
      currency_symbol: CURRENCY_METADATA[owner.currency].symbol,
      total: list.length,
      limit,
      offset,
      records: list.slice(offset, offset + limit),
    };
  }

  async getSupplierPayables(storeOwnerId: string, dto: QueryRangeDto) {
    const limit = Math.min(Math.max(dto.limit ?? 50, 1), 100);
    const offset = Math.max(dto.offset ?? 0, 0);

    const owner = await this.prisma.storeOwner.findUniqueOrThrow({
      where: { id: storeOwnerId },
      select: { currency: true },
    });

    const suppliers = await this.prisma.supplier.findMany({
      where: { storeOwnerId, deletedAt: null, currentBalance: { gt: 0 } },
      orderBy: { currentBalance: 'desc' },
    });

    const openInvoices = await this.prisma.purchaseInvoice.findMany({
      where: {
        storeOwnerId,
        status: 'POSTED',
        remainingAmount: { gt: 0 },
      },
      select: {
        supplierId: true,
        invoiceDate: true,
        remainingAmount: true,
      },
    });

    const now = startOfDay(new Date());
    const globalBuckets = { days_0_30: 0, days_31_60: 0, days_61_90: 0, days_90_plus: 0 };
    const invoicesBySupplier = new Map<string, typeof openInvoices>();
    for (const inv of openInvoices) {
      const list = invoicesBySupplier.get(inv.supplierId);
      if (list) list.push(inv);
      else invoicesBySupplier.set(inv.supplierId, [inv]);
    }

    const records = suppliers.map((s) => {
      const buckets = { days_0_30: 0, days_31_60: 0, days_61_90: 0, days_90_plus: 0 };
      const openingRem = Number(s.openingBalance.minus(s.openingBalanceSettled).toDecimalPlaces(2));
      if (openingRem > 0) {
        const age = Math.max(0, Math.floor((now.getTime() - startOfDay(s.createdAt).getTime()) / 86_400_000));
        putInBucket(buckets, age, openingRem);
      }

      for (const inv of invoicesBySupplier.get(s.id) ?? []) {
        const rem = Number(inv.remainingAmount);
        const age = Math.max(0, Math.floor((now.getTime() - startOfDay(inv.invoiceDate).getTime()) / 86_400_000));
        putInBucket(buckets, age, rem);
      }

      globalBuckets.days_0_30 += buckets.days_0_30;
      globalBuckets.days_31_60 += buckets.days_31_60;
      globalBuckets.days_61_90 += buckets.days_61_90;
      globalBuckets.days_90_plus += buckets.days_90_plus;

      return {
        supplier_id: s.id,
        supplier_name: s.name,
        phone: s.phone,
        current_balance: Number(s.currentBalance),
        aging: {
          days_0_30: round2(buckets.days_0_30),
          days_31_60: round2(buckets.days_31_60),
          days_61_90: round2(buckets.days_61_90),
          days_90_plus: round2(buckets.days_90_plus),
        },
      };
    });

    const totalPayables = round2(records.reduce((s, r) => s + r.current_balance, 0));

    return {
      type: 'supplier_payables',
      currency: owner.currency,
      currency_symbol: CURRENCY_METADATA[owner.currency].symbol,
      total: records.length,
      limit,
      offset,
      total_payables: totalPayables,
      aging_summary: {
        days_0_30: round2(globalBuckets.days_0_30),
        days_31_60: round2(globalBuckets.days_31_60),
        days_61_90: round2(globalBuckets.days_61_90),
        days_90_plus: round2(globalBuckets.days_90_plus),
      },
      records: records.slice(offset, offset + limit),
    };
  }

  // قائمة الدخل التفصيلية وهامش الربح (Fix 8 + Fix 5)
  async getProfitMargin(storeOwnerId: string, dto: QueryRangeDto) {
    const start = dto.date_from ? startOfDay(new Date(dto.date_from)) : new Date(0);
    const end = dto.date_to ? endOfDay(new Date(dto.date_to)) : new Date('2099-12-31T23:59:59.999Z');

    const owner = await this.prisma.storeOwner.findUniqueOrThrow({
      where: { id: storeOwnerId },
      select: { currency: true, defaultCostingMethod: true },
    });

    const [
      sales,
      saleReturns,
      damaged,
      rents,
      pureUtilities,
      otherExpenses,
      salaries,
      shortageEntries,
      surplusEntries,
    ] = await Promise.all([
      this.prisma.sale.findMany({
        where: { storeOwnerId, soldAt: { gte: start, lte: end } },
        include: { item: { select: { id: true, name: true, unit: true, costPrice: true } } },
      }),
      this.prisma.return.findMany({
        where: { storeOwnerId, returnedAt: { gte: start, lte: end } },
        include: {
          sale: {
            select: {
              itemId: true,
              quantity: true,
              cogsAmount: true,
              item: { select: { costPrice: true } },
            },
          },
        },
      }),
      this.prisma.damagedGood.findMany({
        where: { storeOwnerId, isDamaged: true, recordedAt: { gte: start, lte: end } },
        include: { item: { select: { costPrice: true } } },
      }),
      this.prisma.rentRecord.aggregate({
        where: { storeOwnerId, paidAt: { gte: start, lte: end } },
        _sum: { amount: true },
      }),
      this.prisma.utilityPayment.aggregate({
        where: { storeOwnerId, utilityType: { not: 'OTHER' }, paidAt: { gte: start, lte: end } },
        _sum: { amount: true },
      }),
      this.prisma.utilityPayment.aggregate({
        where: { storeOwnerId, utilityType: 'OTHER', paidAt: { gte: start, lte: end } },
        _sum: { amount: true },
      }),
      this.prisma.employeePayment.aggregate({
        where: { storeOwnerId, paidAt: { gte: start, lte: end } },
        _sum: { amount: true },
      }),
      this.prisma.ledgerEntry.aggregate({
        where: {
          storeOwnerId,
          account: { code: '5600' },
          entryDate: { gte: start, lte: end },
          referenceType: { in: ['CLOSING', 'WALLET_SETTLEMENT'] },
        },
        _sum: { debit: true, credit: true },
      }),
      this.prisma.ledgerEntry.aggregate({
        where: {
          storeOwnerId,
          account: { code: '4300' },
          entryDate: { gte: start, lte: end },
          referenceType: { in: ['CLOSING', 'WALLET_SETTLEMENT'] },
        },
        _sum: { debit: true, credit: true },
      }),
    ]);

    let grossSales = 0;
    let grossCogs = 0;
    let emergencyLoss = 0;

    const itemStats = new Map<
      string,
      { item_id: string; item_name: string; unit: string; qty_sold: number; revenue: number; cogs: number }
    >();

    for (const s of sales) {
      const rev = Number(s.amount);
      const cogs =
        s.cogsAmount !== null ? Number(s.cogsAmount) : round2(Number(s.quantity) * Number(s.item.costPrice));
      grossSales += rev;
      grossCogs += cogs;
      emergencyLoss += Number(s.priceDifferenceLoss);

      const st = itemStats.get(s.itemId);
      if (!st) {
        itemStats.set(s.itemId, {
          item_id: s.itemId,
          item_name: s.item.name,
          unit: s.item.unit,
          qty_sold: Number(s.quantity),
          revenue: rev,
          cogs,
        });
      } else {
        st.qty_sold = round3(st.qty_sold + Number(s.quantity));
        st.revenue = round2(st.revenue + rev);
        st.cogs = round2(st.cogs + cogs);
      }
    }

    let returnsRevenue = 0;
    let returnsCogs = 0;
    for (const r of saleReturns) {
      const rev = Number(r.amount);
      const unitCogs =
        r.sale.cogsAmount !== null && r.sale.quantity.gt(0)
          ? Number(r.sale.cogsAmount.div(r.sale.quantity))
          : Number(r.sale.item.costPrice);
      const cogs = round2(Number(r.quantity) * unitCogs);
      returnsRevenue += rev;
      returnsCogs += cogs;

      const st = itemStats.get(r.sale.itemId);
      if (st) {
        st.qty_sold = round3(st.qty_sold - Number(r.quantity));
        st.revenue = round2(st.revenue - rev);
        st.cogs = round2(st.cogs - cogs);
      }
    }

    const damagedLoss = round2(
      damaged.reduce((sum, d) => sum + Number(d.quantity) * Number(d.item.costPrice), 0),
    );
    const rentExpense = round2(Number(rents._sum.amount ?? 0));
    const utilitiesExpense = round2(Number(pureUtilities._sum.amount ?? 0));
    const otherStoreExpenses = round2(Number(otherExpenses._sum.amount ?? 0));
    const salariesExpense = round2(Number(salaries._sum.amount ?? 0));
    const shortageExpense = Math.max(
      0,
      round2(Number(shortageEntries._sum.debit ?? 0) - Number(shortageEntries._sum.credit ?? 0)),
    );
    const surplusIncome = Math.max(
      0,
      round2(Number(surplusEntries._sum.credit ?? 0) - Number(surplusEntries._sum.debit ?? 0)),
    );

    const operatingExpenses = round2(
      rentExpense + utilitiesExpense + otherStoreExpenses + salariesExpense + shortageExpense,
    );

    const netSales = round2(grossSales - returnsRevenue);
    const actualCogs = round2(grossCogs - returnsCogs);
    const grossProfit = round2(netSales - actualCogs);
    const netProfit = round2(grossProfit + surplusIncome - damagedLoss - operatingExpenses);
    const grossMarginPercent = netSales > 0 ? round2((grossProfit / netSales) * 100) : 0;
    const netMarginPercent = netSales > 0 ? round2((netProfit / netSales) * 100) : 0;

    return {
      type: 'profit_margin',
      date_from: dto.date_from ?? null,
      date_to: dto.date_to ?? null,
      currency: owner.currency,
      currency_symbol: CURRENCY_METADATA[owner.currency].symbol,
      costing_method: owner.defaultCostingMethod,
      gross_sales: round2(grossSales),
      sales_returns: round2(returnsRevenue),
      net_sales: netSales,
      actual_cogs: actualCogs,
      gross_profit: grossProfit,
      gross_margin_percent: grossMarginPercent,
      damaged_loss: damagedLoss,
      emergency_price_loss_info: round2(emergencyLoss),
      other_income_surplus: surplusIncome,
      operating_expenses: operatingExpenses,
      expenses_breakdown: {
        salaries: salariesExpense,
        rent: rentExpense,
        utilities: utilitiesExpense,
        other_expenses: otherStoreExpenses,
        cash_and_wallet_shortage: shortageExpense,
      },
      net_profit: netProfit,
      net_margin_percent: netMarginPercent,
      items_breakdown: Array.from(itemStats.values()).map((it) => ({
        ...it,
        gross_profit: round2(it.revenue - it.cogs),
        margin_percent: it.revenue > 0 ? round2(((it.revenue - it.cogs) / it.revenue) * 100) : 0,
      })),
    };
  }
}

function putInBucket(
  buckets: { days_0_30: number; days_31_60: number; days_61_90: number; days_90_plus: number },
  ageDays: number,
  amount: number,
) {
  if (ageDays <= 30) buckets.days_0_30 += amount;
  else if (ageDays <= 60) buckets.days_31_60 += amount;
  else if (ageDays <= 90) buckets.days_61_90 += amount;
  else buckets.days_90_plus += amount;
}

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function endOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(23, 59, 59, 999);
  return c;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
