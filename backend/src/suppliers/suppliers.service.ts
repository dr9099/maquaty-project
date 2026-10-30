import { Injectable } from '@nestjs/common';
import { PaymentType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import { formatQuantityDisplay } from '../common/quantity-formatter';
import { AuthenticatedUser } from '../common/types';
import { CURRENCY_METADATA } from '../settings/settings.service';
import {
  CreateSupplierDto,
  QueryStatementDto,
  QuerySuppliersDto,
  RecordSupplierPaymentDto,
  UpdateSupplierDto,
} from './dto/suppliers.dto';

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
    private readonly audit: AuditService,
  ) {}

  async list(storeOwnerId: string, query: QuerySuppliersDto) {
    const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
    const offset = Math.max(query.offset ?? 0, 0);
    const search = query.search?.trim();

    const where: Prisma.SupplierWhereInput = {
      storeOwnerId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.only_with_debt === 'true' ? { currentBalance: { gt: 0 } } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search } },
              { contactPerson: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [total, suppliers, payablesAgg, owner] = await Promise.all([
      this.prisma.supplier.count({ where }),
      this.prisma.supplier.findMany({
        where,
        orderBy: [{ currentBalance: 'desc' }, { name: 'asc' }],
        take: limit,
        skip: offset,
      }),
      this.prisma.supplier.aggregate({
        where: { storeOwnerId, deletedAt: null },
        _sum: { currentBalance: true },
      }),
      this.prisma.storeOwner.findUniqueOrThrow({
        where: { id: storeOwnerId },
        select: { currency: true },
      }),
    ]);

    return {
      total,
      limit,
      offset,
      currency: owner.currency,
      currency_symbol: CURRENCY_METADATA[owner.currency].symbol,
      total_payables: Number((payablesAgg._sum.currentBalance ?? new Prisma.Decimal(0)).toDecimalPlaces(2)),
      items: suppliers.map(serializeSupplier),
    };
  }

  async create(user: AuthenticatedUser, dto: CreateSupplierDto, ip?: string) {
    const storeOwnerId = user.storeOwnerId!;
    const trimmedName = dto.name.trim();
    const trimmedPhone = dto.phone?.trim() ? dto.phone.trim() : null;

    // فحص عدم التكرار لاسم المورد أو رقم هاتفه ضمن نفس المتجر
    await this.assertNoDuplicateSupplier(storeOwnerId, trimmedName, trimmedPhone);

    const openingBalance = new Prisma.Decimal(dto.openingBalance ?? 0).toDecimalPlaces(2);

    const supplier = await this.prisma.$transaction(async (tx) => {
      // التأكد من وجود حساب 2000 في دليل الحسابات (حماية دفاعية إضافية)
      await this.ensureSupplierAccountExists(tx, storeOwnerId);

      const created = await tx.supplier.create({
        data: {
          ...(dto.id ? { id: dto.id } : {}),
          storeOwnerId,
          name: trimmedName,
          phone: trimmedPhone,
          address: dto.address?.trim() || null,
          contactPerson: dto.contactPerson?.trim() || null,
          taxNumber: dto.taxNumber?.trim() || null,
          notes: dto.notes?.trim() || null,
          openingBalance,
          openingBalanceSettled: new Prisma.Decimal(0),
          currentBalance: openingBalance,
          creditLimit:
            dto.creditLimit !== undefined ? new Prisma.Decimal(dto.creditLimit).toDecimalPlaces(2) : null,
          paymentTermsDays: dto.paymentTermsDays ?? null,
          status: 'ACTIVE',
        },
      });

      if (openingBalance.gt(0)) {
        await this.accounting.createBalancedEntries(tx, {
          storeOwnerId,
          entryDate: startOfDay(new Date()),
          referenceType: 'SUPPLIER_OPENING_BALANCE',
          referenceId: created.id,
          lines: [
            {
              accountCode: '3000',
              debit: openingBalance.toNumber(),
              description: `إثبات رصيد افتتاحي للمورد: ${created.name}`,
            },
            {
              accountCode: '2000',
              credit: openingBalance.toNumber(),
              description: `رصيد افتتاحي مستحق للمورد: ${created.name}`,
            },
          ],
        });
      }

      return created;
    });

    await this.audit.log({
      actorType: 'STORE_OWNER',
      actorId: storeOwnerId,
      actionType: 'SUPPLIER_CREATE',
      targetType: 'supplier',
      targetId: supplier.id,
      newValue: {
        name: supplier.name,
        phone: supplier.phone,
        opening_balance: Number(supplier.openingBalance),
      },
      ipAddress: ip,
      result: 'SUCCESS',
    });

    return serializeSupplier(supplier);
  }

  async getById(storeOwnerId: string, supplierId: string) {
    const supplier = await this.mustGetOwned(storeOwnerId, supplierId);

    const [invoicesAgg, paymentsAgg, returnsAgg, owner] = await Promise.all([
      this.prisma.purchaseInvoice.aggregate({
        where: { storeOwnerId, supplierId, status: 'POSTED' },
        _count: { id: true },
        _sum: { totalAmount: true, paidAmount: true },
      }),
      this.prisma.supplierPayment.aggregate({
        where: { storeOwnerId, supplierId },
        _count: { id: true },
        _sum: { amount: true },
      }),
      this.prisma.purchaseReturn.aggregate({
        where: { storeOwnerId, supplierId },
        _count: { id: true },
        _sum: { totalAmount: true },
      }),
      this.prisma.storeOwner.findUniqueOrThrow({
        where: { id: storeOwnerId },
        select: { currency: true },
      }),
    ]);

    const totalPurchased = Number((invoicesAgg._sum.totalAmount ?? new Prisma.Decimal(0)).toDecimalPlaces(2));
    const paidOnInvoices = Number((invoicesAgg._sum.paidAmount ?? new Prisma.Decimal(0)).toDecimalPlaces(2));
    const standalonePayments = Number((paymentsAgg._sum.amount ?? new Prisma.Decimal(0)).toDecimalPlaces(2));
    const totalReturned = Number((returnsAgg._sum.totalAmount ?? new Prisma.Decimal(0)).toDecimalPlaces(2));

    return {
      ...serializeSupplier(supplier),
      currency: owner.currency,
      currency_symbol: CURRENCY_METADATA[owner.currency].symbol,
      stats: {
        invoices_count: invoicesAgg._count.id,
        payments_count: paymentsAgg._count.id,
        returns_count: returnsAgg._count.id,
        total_purchased: totalPurchased,
        total_paid: round2(paidOnInvoices + standalonePayments),
        total_returned: totalReturned,
      },
    };
  }

  async update(storeOwnerId: string, supplierId: string, dto: UpdateSupplierDto, ip?: string) {
    const existing = await this.mustGetOwned(storeOwnerId, supplierId);

    const nextName = dto.name !== undefined ? dto.name.trim() : existing.name;
    const nextPhone =
      dto.phone !== undefined ? (dto.phone && dto.phone.trim() !== '' ? dto.phone.trim() : null) : existing.phone;

    await this.assertNoDuplicateSupplier(storeOwnerId, nextName, nextPhone, supplierId);

    const updated = await this.prisma.supplier.update({
      where: { id: supplierId },
      data: {
        ...(dto.name !== undefined ? { name: nextName } : {}),
        ...(dto.phone !== undefined ? { phone: nextPhone } : {}),
        ...(dto.address !== undefined ? { address: dto.address ? dto.address.trim() : null } : {}),
        ...(dto.contactPerson !== undefined
          ? { contactPerson: dto.contactPerson ? dto.contactPerson.trim() : null }
          : {}),
        ...(dto.taxNumber !== undefined ? { taxNumber: dto.taxNumber ? dto.taxNumber.trim() : null } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes ? dto.notes.trim() : null } : {}),
        ...(dto.creditLimit !== undefined
          ? {
              creditLimit:
                dto.creditLimit !== null ? new Prisma.Decimal(dto.creditLimit).toDecimalPlaces(2) : null,
            }
          : {}),
        ...(dto.paymentTermsDays !== undefined ? { paymentTermsDays: dto.paymentTermsDays } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
    });

    await this.audit.log({
      actorType: 'STORE_OWNER',
      actorId: storeOwnerId,
      actionType: 'SUPPLIER_UPDATE',
      targetType: 'supplier',
      targetId: supplierId,
      oldValue: { name: existing.name, phone: existing.phone, status: existing.status },
      newValue: { name: updated.name, phone: updated.phone, status: updated.status },
      ipAddress: ip,
      result: 'SUCCESS',
    });

    return serializeSupplier(updated);
  }

  async remove(storeOwnerId: string, supplierId: string, ip?: string) {
    const supplier = await this.mustGetOwned(storeOwnerId, supplierId);

    if (!supplier.currentBalance.eq(0)) {
      throw ApiError.conflict(
        'SUPPLIER_HAS_BALANCE',
        'لا يمكن حذف مورد لديه رصيد مالي قائم غير مصفّى. قم بتصفية الرصيد أولاً أو إيقاف حساب المورد مؤقتاً.',
        { current_balance: Number(supplier.currentBalance) },
      );
    }

    await this.prisma.supplier.update({
      where: { id: supplierId },
      data: { deletedAt: new Date() },
    });

    await this.audit.log({
      actorType: 'STORE_OWNER',
      actorId: storeOwnerId,
      actionType: 'SUPPLIER_DELETE',
      targetType: 'supplier',
      targetId: supplierId,
      oldValue: { name: supplier.name, status: supplier.status },
      ipAddress: ip,
      result: 'SUCCESS',
    });

    return { deleted: true as const, id: supplierId };
  }

  async recordPayment(
    user: AuthenticatedUser,
    supplierId: string,
    dto: RecordSupplierPaymentDto,
    ip?: string,
  ) {
    const storeOwnerId = user.storeOwnerId!;
    const actorWorkerId = user.role === 'WORKER' ? user.workerId ?? null : null;
    await this.mustGetOwned(storeOwnerId, supplierId);

    if (dto.paymentMethod !== PaymentType.CASH && dto.paymentMethod !== PaymentType.ELECTRONIC) {
      throw ApiError.badRequest('VALIDATION_ERROR', 'طريقة السداد يجب أن تكون CASH أو ELECTRONIC فقط.');
    }

    const today = startOfDay(new Date());
    if (dto.paymentMethod === PaymentType.CASH) {
      const closedClosing = await this.prisma.dailyClosing.findFirst({
        where: {
          storeOwnerId,
          closingDate: today,
          status: 'CLOSED',
          OR: [{ workerId: null }, ...(actorWorkerId ? [{ workerId: actorWorkerId }] : [])],
        },
      });
      if (closedClosing) {
        throw ApiError.conflict(
          'DAY_ALREADY_CLOSED',
          'تم اعتماد إغلاق الصندوق لهذا اليوم مسبقاً ولا يمكن تسجيل سداد نقدي جديد.',
        );
      }
    }

    let walletAccountCode = '1100';
    if (dto.paymentMethod === PaymentType.ELECTRONIC) {
      if (!dto.walletId) {
        throw ApiError.badRequest('VALIDATION_ERROR', 'اختيار المحفظة الإلكترونية إلزامي عند السداد الإلكتروني.');
      }
      const wallet = await this.prisma.wallet.findFirst({
        where: { id: dto.walletId, storeOwnerId, isActive: true },
      });
      if (!wallet) throw ApiError.notFound('المحفظة غير موجودة.');
      const walletAccount = wallet.accountCode
        ? { code: wallet.accountCode }
        : await this.prisma.chartOfAccount.findFirst({
            where: { storeOwnerId, accountType: 'ASSET', name: { startsWith: `محفظة: ${wallet.name}` } },
            select: { code: true },
          });
      walletAccountCode = walletAccount?.code ?? '1100';
    }

    const amountDecimal = new Prisma.Decimal(dto.amount).toDecimalPlaces(2);

    const result = await this.prisma.$transaction(async (tx) => {
      await this.ensureSupplierAccountExists(tx, storeOwnerId);

      // قفل صف المورد لمنع التضارب المتزامن في الرصيد
      const lockedRows = await tx.$queryRaw<
        Array<{
          id: string;
          name: string;
          current_balance: Prisma.Decimal;
          opening_balance: Prisma.Decimal;
          opening_balance_settled: Prisma.Decimal;
          deleted_at: Date | null;
        }>
      >(Prisma.sql`SELECT id, name, current_balance, opening_balance, opening_balance_settled, deleted_at
                   FROM suppliers
                   WHERE id = ${supplierId}::uuid AND store_owner_id = ${storeOwnerId}::uuid
                   FOR UPDATE`);
      const locked = lockedRows[0];
      if (!locked || locked.deleted_at) throw ApiError.notFound('المورد غير موجود.');

      if (amountDecimal.gt(locked.current_balance)) {
        throw ApiError.badRequest(
          'VALIDATION_ERROR',
          'مبلغ السداد يتجاوز الرصيد المستحق للمورد.',
          { current_balance: Number(locked.current_balance) },
        );
      }

      // التخصيص (D-01): إما لفاتورة محددة أو على الحساب العام مع تسوية الأقدم فالأحدث (FIFO)
      if (dto.purchaseInvoiceId) {
        const inv = await tx.purchaseInvoice.findFirst({
          where: {
            id: dto.purchaseInvoiceId,
            storeOwnerId,
            supplierId,
            status: 'POSTED',
          },
        });
        if (!inv) throw ApiError.notFound('فاتورة الشراء غير موجودة أو غير مرحّلة.');
        if (amountDecimal.gt(inv.remainingAmount)) {
          throw ApiError.badRequest(
            'VALIDATION_ERROR',
            'مبلغ السداد يتجاوز المتبقي على الفاتورة المحددة.',
            { invoice_remaining: Number(inv.remainingAmount) },
          );
        }
        await tx.purchaseInvoice.update({
          where: { id: inv.id },
          data: {
            settledAmount: { increment: amountDecimal },
            remainingAmount: { decrement: amountDecimal },
          },
        });
      } else {
        let toAllocate = amountDecimal;
        // 1) تسوية الرصيد الافتتاحي غير المسدد أولاً (إن وجد)
        const openingUnsettled = locked.opening_balance.minus(locked.opening_balance_settled);
        if (openingUnsettled.gt(0) && toAllocate.gt(0)) {
          const allocOpening = Prisma.Decimal.min(openingUnsettled, toAllocate);
          await tx.supplier.update({
            where: { id: supplierId },
            data: { openingBalanceSettled: { increment: allocOpening } },
          });
          toAllocate = toAllocate.minus(allocOpening);
        }

        // 2) تسوية أقدم الفواتير المرحّلة غير المسددة (FIFO)
        if (toAllocate.gt(0)) {
          const openInvoices = await tx.purchaseInvoice.findMany({
            where: {
              storeOwnerId,
              supplierId,
              status: 'POSTED',
              remainingAmount: { gt: 0 },
            },
            orderBy: [{ invoiceDate: 'asc' }, { createdAt: 'asc' }],
          });
          for (const inv of openInvoices) {
            if (toAllocate.lte(0)) break;
            const alloc = Prisma.Decimal.min(inv.remainingAmount, toAllocate);
            await tx.purchaseInvoice.update({
              where: { id: inv.id },
              data: {
                settledAmount: { increment: alloc },
                remainingAmount: { decrement: alloc },
              },
            });
            toAllocate = toAllocate.minus(alloc);
          }
        }
      }

      const nextBalance = locked.current_balance.minus(amountDecimal);
      await tx.supplier.update({
        where: { id: supplierId },
        data: { currentBalance: nextBalance },
      });

      const payment = await tx.supplierPayment.create({
        data: {
          ...(dto.id ? { id: dto.id } : {}),
          storeOwnerId,
          workerId: actorWorkerId,
          supplierId,
          purchaseInvoiceId: dto.purchaseInvoiceId ?? null,
          amount: amountDecimal,
          paymentMethod: dto.paymentMethod,
          walletId: dto.walletId ?? null,
          receiptAttachmentUrl: dto.receiptAttachmentUrl?.trim() || null,
          notes: dto.notes?.trim() || null,
          paidAt: new Date(),
        },
      });

      const creditAccount = dto.paymentMethod === PaymentType.CASH ? '1000' : walletAccountCode;
      await this.accounting.createBalancedEntries(tx, {
        storeOwnerId,
        entryDate: today,
        referenceType: 'PURCHASE_PAYMENT',
        referenceId: payment.id,
        lines: [
          {
            accountCode: '2000',
            debit: amountDecimal.toNumber(),
            description: `سداد دفعة للمورد: ${locked.name}`,
          },
          {
            accountCode: creditAccount,
            credit: amountDecimal.toNumber(),
            description:
              dto.paymentMethod === PaymentType.CASH
                ? `صرف نقدي لسداد المورد: ${locked.name}`
                : `تحويل محفظة لسداد المورد: ${locked.name}`,
          },
        ],
      });

      return { payment, remainingBalance: nextBalance };
    });

    await this.audit.log({
      actorType: user.role === 'WORKER' ? 'WORKER' : 'STORE_OWNER',
      actorId: user.role === 'WORKER' ? user.workerId! : storeOwnerId,
      actionType: 'SUPPLIER_PAYMENT_CREATE',
      targetType: 'supplier_payment',
      targetId: result.payment.id,
      newValue: {
        supplier_id: supplierId,
        amount: Number(result.payment.amount),
        payment_method: result.payment.paymentMethod,
        remaining_balance: Number(result.remainingBalance),
      },
      ipAddress: ip,
      result: 'SUCCESS',
    });

    return {
      payment_id: result.payment.id,
      supplier_id: supplierId,
      purchase_invoice_id: result.payment.purchaseInvoiceId,
      amount: Number(result.payment.amount),
      payment_method: result.payment.paymentMethod,
      wallet_id: result.payment.walletId,
      receipt_attachment_url: result.payment.receiptAttachmentUrl,
      notes: result.payment.notes,
      remaining_balance: Number(result.remainingBalance),
      paid_at: result.payment.paidAt,
    };
  }

  async listPayments(storeOwnerId: string, supplierId: string, limitParam?: number, offsetParam?: number) {
    await this.mustGetOwned(storeOwnerId, supplierId);
    const limit = Math.min(Math.max(limitParam ?? 25, 1), 100);
    const offset = Math.max(offsetParam ?? 0, 0);

    const [total, payments] = await Promise.all([
      this.prisma.supplierPayment.count({ where: { storeOwnerId, supplierId } }),
      this.prisma.supplierPayment.findMany({
        where: { storeOwnerId, supplierId },
        include: {
          wallet: { select: { name: true } },
          purchaseInvoice: { select: { invoiceNumber: true } },
        },
        orderBy: { paidAt: 'desc' },
        take: limit,
        skip: offset,
      }),
    ]);

    return {
      total,
      limit,
      offset,
      items: payments.map((p) => ({
        payment_id: p.id,
        purchase_invoice_id: p.purchaseInvoiceId,
        invoice_number: p.purchaseInvoice?.invoiceNumber ?? null,
        amount: Number(p.amount),
        payment_method: p.paymentMethod,
        wallet_id: p.walletId,
        wallet_name: p.wallet?.name ?? null,
        receipt_attachment_url: p.receiptAttachmentUrl,
        notes: p.notes,
        paid_at: p.paidAt,
      })),
    };
  }

  async getStatement(storeOwnerId: string, supplierId: string, query: QueryStatementDto) {
    const supplier = await this.mustGetOwned(storeOwnerId, supplierId);
    const owner = await this.prisma.storeOwner.findUniqueOrThrow({
      where: { id: storeOwnerId },
      select: { currency: true, storeName: true },
    });

    const [invoices, payments, returns] = await Promise.all([
      this.prisma.purchaseInvoice.findMany({
        where: { storeOwnerId, supplierId, status: 'POSTED' },
        orderBy: [{ invoiceDate: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.supplierPayment.findMany({
        where: { storeOwnerId, supplierId },
        include: { wallet: { select: { name: true } } },
        orderBy: { paidAt: 'asc' },
      }),
      this.prisma.purchaseReturn.findMany({
        where: { storeOwnerId, supplierId },
        include: { item: { select: { name: true, unit: true } }, purchaseInvoice: { select: { invoiceNumber: true } } },
        orderBy: { returnedAt: 'asc' },
      }),
    ]);

    type RawTx = {
      id: string;
      date: Date;
      type: 'OPENING_BALANCE' | 'PURCHASE_INVOICE' | 'INVOICE_INITIAL_PAYMENT' | 'PAYMENT' | 'PURCHASE_RETURN';
      reference: string;
      description: string;
      debit: number;  // ما خفّض ذمة المورد (سداد / مرتجع)
      credit: number; // ما زاد ذمة المورد (رصيد افتتاحي / فاتورة شراء)
    };

    const allEvents: RawTx[] = [];

    if (supplier.openingBalance.gt(0)) {
      allEvents.push({
        id: `${supplier.id}-opening`,
        date: supplier.createdAt,
        type: 'OPENING_BALANCE',
        reference: 'OPENING',
        description: 'رصيد افتتاحي عند تعريف المورد',
        debit: 0,
        credit: Number(supplier.openingBalance),
      });
    }

    for (const inv of invoices) {
      allEvents.push({
        id: inv.id,
        date: inv.postedAt ?? inv.createdAt,
        type: 'PURCHASE_INVOICE',
        reference: inv.invoiceNumber,
        description: `فاتورة شراء رقم ${inv.invoiceNumber}`,
        debit: 0,
        credit: Number(inv.totalAmount),
      });

      if (inv.paidAmount.gt(0)) {
        allEvents.push({
          id: `${inv.id}-paid`,
          date: new Date((inv.postedAt ?? inv.createdAt).getTime() + 1),
          type: 'INVOICE_INITIAL_PAYMENT',
          reference: inv.invoiceNumber,
          description: `دفعة مسددة مع فاتورة الشراء ${inv.invoiceNumber} (${
            inv.paymentType === 'ELECTRONIC' ? 'محفظة' : 'نقد'
          })`,
          debit: Number(inv.paidAmount),
          credit: 0,
        });
      }
    }

    for (const p of payments) {
      allEvents.push({
        id: p.id,
        date: p.paidAt,
        type: 'PAYMENT',
        reference: p.id.slice(0, 8).toUpperCase(),
        description: `سند سداد للمورد (${
          p.paymentMethod === 'CASH' ? 'نقداً' : `محفظة: ${p.wallet?.name ?? ''}`
        })`,
        debit: Number(p.amount),
        credit: 0,
      });
    }

    for (const r of returns) {
      const formattedQty = formatQuantityDisplay(r.baseQuantity, r.item.unit);
      if (r.refundMethod === 'DEBT_REDUCTION') {
        allEvents.push({
          id: r.id,
          date: r.returnedAt,
          type: 'PURCHASE_RETURN',
          reference: r.purchaseInvoice.invoiceNumber,
          description: `مرتجع مشتريات (${r.item.name} — ${formattedQty}) — خصم من الرصيد`,
          debit: Number(r.totalAmount),
          credit: 0,
        });
      } else {
        allEvents.push({
          id: r.id,
          date: r.returnedAt,
          type: 'PURCHASE_RETURN',
          reference: r.purchaseInvoice.invoiceNumber,
          description: `مرتجع مشتريات مسترد نقداً (${r.item.name} — ${formattedQty}) — لا يؤثر على الذمة`,
          debit: 0,
          credit: 0,
        });
      }
    }

    allEvents.sort((a, b) => a.date.getTime() - b.date.getTime());

    const fromDate = query.date_from ? startOfDay(new Date(query.date_from)) : null;
    const toDate = query.date_to ? endOfDay(new Date(query.date_to)) : null;

    let running = 0;
    let openingPeriodBalance = 0;
    const filteredTransactions: Array<RawTx & { running_balance: number }> = [];

    for (const ev of allEvents) {
      if (fromDate && ev.date < fromDate) {
        running = round2(running + ev.credit - ev.debit);
        openingPeriodBalance = running;
        continue;
      }
      if (toDate && ev.date > toDate) {
        continue;
      }
      running = round2(running + ev.credit - ev.debit);
      filteredTransactions.push({
        ...ev,
        running_balance: running,
      });
    }

    const totalDebit = round2(filteredTransactions.reduce((s, t) => s + t.debit, 0));
    const totalCredit = round2(filteredTransactions.reduce((s, t) => s + t.credit, 0));

    let csvContent: string | undefined;
    if (query.format === 'csv' || query.format === 'excel') {
      const header = 'التاريخ,المرجع,نوع الحركة,البيان,مدين (سداد/مرتجع),دائن (مشتريات),الرصيد التراكمي';
      const rows = filteredTransactions.map((t) =>
        [
          t.date.toISOString().split('T')[0],
          `"${t.reference.replace(/"/g, '""')}"`,
          t.type,
          `"${t.description.replace(/"/g, '""')}"`,
          t.debit.toFixed(2),
          t.credit.toFixed(2),
          t.running_balance.toFixed(2),
        ].join(','),
      );
      // UTF-8 BOM لدعم العربية مباشرة في Excel
      csvContent = `\uFEFF${[header, ...rows].join('\n')}`;
    }

    return {
      store_name: owner.storeName,
      currency: owner.currency,
      currency_symbol: CURRENCY_METADATA[owner.currency].symbol,
      supplier: serializeSupplier(supplier),
      period: {
        date_from: query.date_from ?? null,
        date_to: query.date_to ?? null,
        opening_period_balance: openingPeriodBalance,
        total_debit: totalDebit,
        total_credit: totalCredit,
        closing_balance: running,
      },
      transactions: filteredTransactions,
      ...(csvContent ? { csv_content: csvContent } : {}),
    };
  }

  async getAging(storeOwnerId: string, supplierId: string) {
    const supplier = await this.mustGetOwned(storeOwnerId, supplierId);
    const owner = await this.prisma.storeOwner.findUniqueOrThrow({
      where: { id: storeOwnerId },
      select: { currency: true },
    });

    const openInvoices = await this.prisma.purchaseInvoice.findMany({
      where: {
        storeOwnerId,
        supplierId,
        status: 'POSTED',
        remainingAmount: { gt: 0 },
      },
      orderBy: [{ invoiceDate: 'asc' }, { createdAt: 'asc' }],
    });

    const now = startOfDay(new Date());
    const buckets = {
      days_0_30: 0,
      days_31_60: 0,
      days_61_90: 0,
      days_90_plus: 0,
    };

    const items: Array<{
      reference_id: string;
      reference_number: string;
      date: Date;
      due_date: Date | null;
      age_days: number;
      bucket: '0-30' | '31-60' | '61-90' | '90+';
      remaining_amount: number;
    }> = [];

    const openingRemaining = Number(
      supplier.openingBalance.minus(supplier.openingBalanceSettled).toDecimalPlaces(2),
    );
    if (openingRemaining > 0) {
      const ageDays = Math.max(
        0,
        Math.floor((now.getTime() - startOfDay(supplier.createdAt).getTime()) / 86_400_000),
      );
      const bucket = classifyAgeBucket(ageDays);
      addBucket(buckets, bucket, openingRemaining);
      items.push({
        reference_id: supplier.id,
        reference_number: 'OPENING',
        date: supplier.createdAt,
        due_date: null,
        age_days: ageDays,
        bucket,
        remaining_amount: openingRemaining,
      });
    }

    for (const inv of openInvoices) {
      const rem = Number(inv.remainingAmount);
      const baseDate = startOfDay(inv.invoiceDate);
      const ageDays = Math.max(0, Math.floor((now.getTime() - baseDate.getTime()) / 86_400_000));
      const bucket = classifyAgeBucket(ageDays);
      addBucket(buckets, bucket, rem);
      items.push({
        reference_id: inv.id,
        reference_number: inv.invoiceNumber,
        date: inv.invoiceDate,
        due_date: inv.dueDate,
        age_days: ageDays,
        bucket,
        remaining_amount: rem,
      });
    }

    return {
      supplier_id: supplier.id,
      supplier_name: supplier.name,
      currency: owner.currency,
      currency_symbol: CURRENCY_METADATA[owner.currency].symbol,
      total_outstanding: Number(supplier.currentBalance),
      buckets: {
        days_0_30: round2(buckets.days_0_30),
        days_31_60: round2(buckets.days_31_60),
        days_61_90: round2(buckets.days_61_90),
        days_90_plus: round2(buckets.days_90_plus),
      },
      open_items: items,
    };
  }

  private async mustGetOwned(storeOwnerId: string, supplierId: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, storeOwnerId, deletedAt: null },
    });
    // 13-authentication-security.md §2.2: إرجاع 404 بدلاً من 403 لمنع كشف معرّفات المستأجرين الآخرين (IDOR)
    if (!supplier) throw ApiError.notFound('المورد غير موجود.');
    return supplier;
  }

  private async assertNoDuplicateSupplier(
    storeOwnerId: string,
    name: string,
    phone: string | null,
    excludeId?: string,
  ) {
    const dupByName = await this.prisma.supplier.findFirst({
      where: {
        storeOwnerId,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        name: { equals: name, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (dupByName) {
      throw ApiError.conflict('SUPPLIER_DUPLICATE', 'يوجد مورد نشط مسجّل بنفس الاسم في متجرك.');
    }

    if (phone) {
      const dupByPhone = await this.prisma.supplier.findFirst({
        where: {
          storeOwnerId,
          deletedAt: null,
          ...(excludeId ? { id: { not: excludeId } } : {}),
          phone,
        },
        select: { id: true },
      });
      if (dupByPhone) {
        throw ApiError.conflict('SUPPLIER_DUPLICATE', 'يوجد مورد نشط مسجّل بنفس رقم الهاتف في متجرك.');
      }
    }
  }

  async ensureSupplierAccountExists(tx: Prisma.TransactionClient, storeOwnerId: string) {
    const acc = await tx.chartOfAccount.findUnique({
      where: { storeOwnerId_code: { storeOwnerId, code: '2000' } },
      select: { id: true },
    });
    if (!acc) {
      await tx.chartOfAccount.create({
        data: {
          storeOwnerId,
          code: '2000',
          name: 'الموردون / الذمم الدائنة',
          accountType: 'LIABILITY',
        },
      });
    }
  }
}

function serializeSupplier(s: {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  contactPerson: string | null;
  taxNumber: string | null;
  notes: string | null;
  openingBalance: Prisma.Decimal;
  currentBalance: Prisma.Decimal;
  creditLimit: Prisma.Decimal | null;
  paymentTermsDays: number | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: s.id,
    name: s.name,
    phone: s.phone,
    address: s.address,
    contact_person: s.contactPerson,
    tax_number: s.taxNumber,
    notes: s.notes,
    opening_balance: Number(s.openingBalance),
    current_balance: Number(s.currentBalance),
    credit_limit: s.creditLimit !== null ? Number(s.creditLimit) : null,
    payment_terms_days: s.paymentTermsDays,
    status: s.status,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
  };
}

function classifyAgeBucket(days: number): '0-30' | '31-60' | '61-90' | '90+' {
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

function addBucket(
  buckets: { days_0_30: number; days_31_60: number; days_61_90: number; days_90_plus: number },
  bucket: '0-30' | '31-60' | '61-90' | '90+',
  amount: number,
) {
  if (bucket === '0-30') buckets.days_0_30 += amount;
  else if (bucket === '31-60') buckets.days_31_60 += amount;
  else if (bucket === '61-90') buckets.days_61_90 += amount;
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
