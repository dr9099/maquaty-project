import { Injectable } from '@nestjs/common';
import {
  CostingMethod,
  EmergencyPriceMode,
  Prisma,
  PurchaseInvoiceStatus,
  PurchasePaymentType,
  PurchaseRefundMethod,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { AuditService } from '../audit/audit.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import { COSTING_OPTIONS_AR, CURRENCY_METADATA } from '../settings/settings.service';
import { ApiError } from '../common/api-error';
import { AuthenticatedUser } from '../common/types';
import { assertValidQuantityForUnit } from '../common/unit-validation';
import {
  CreatePurchaseDto,
  CreatePurchaseReturnDto,
  PostPurchaseDto,
  PurchaseLineInputDto,
  QueryPurchasesDto,
  UpdateDraftPurchaseDto,
  VoidPurchaseDto,
} from './dto/purchases.dto';

const MAX_INVOICE_LINES = 200;

type ComputedLine = {
  itemId?: string;
  itemName: string;
  unit: string;
  baseUnit: string;
  conversionFactor: Prisma.Decimal;
  quantity: Prisma.Decimal;
  baseQuantity: Prisma.Decimal;
  unitCostPrice: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  totalLineCost: Prisma.Decimal;
  effectiveBaseUnitCost: Prisma.Decimal;
  sellPrice: Prisma.Decimal;
  emergencyPriceMode?: EmergencyPriceMode;
  emergencyPricePlusFixed?: Prisma.Decimal;
  emergencyPricePlusPercent?: Prisma.Decimal;
  emergencyPriceMin?: Prisma.Decimal;
  emergencyPriceMax?: Prisma.Decimal;
};

@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
    private readonly audit: AuditService,
    private readonly suppliersService: SuppliersService,
  ) {}

  // فحص استباقي لاختلاف أسعار الشراء في نفس اليوم قبل الحفظ (لإظهار نافذة الخيارات الثلاثة بالعربية)
  async previewCosting(
    storeOwnerId: string,
    body: {
      invoiceDate?: string;
      taxAmount?: number;
      discountAmount?: number;
      items: PurchaseLineInputDto[];
    },
  ) {
    if (!body.items || body.items.length === 0) {
      throw ApiError.badRequest('VALIDATION_ERROR', 'يجب إرسال بند واحد على الأقل للفحص.');
    }
    if (body.items.length > MAX_INVOICE_LINES) {
      throw ApiError.badRequest(
        'INVOICE_LINES_LIMIT_EXCEEDED',
        `الحد الأقصى لبنود الفاتورة الواحدة هو ${MAX_INVOICE_LINES} بند.`,
      );
    }

    const invoiceDate = body.invoiceDate ? parseDateOnly(body.invoiceDate) : startOfDay(new Date());
    const computed = this.computeInvoiceTotals(
      body.items,
      body.taxAmount ?? 0,
      body.discountAmount ?? 0,
    );

    const conflicts: Array<{
      item_name: string;
      base_unit: string;
      existing_quantity: number;
      old_cost_price: number;
      new_quantity: number;
      new_cost_price: number;
      weighted_average_preview: number;
    }> = [];

    for (const line of computed.lines) {
      const existing = line.itemId
        ? await this.prisma.item.findFirst({
            where: { id: line.itemId, storeOwnerId, deletedAt: null },
          })
        : await this.prisma.item.findFirst({
            where: {
              storeOwnerId,
              deletedAt: null,
              name: line.itemName,
              unit: line.baseUnit,
              entryDate: invoiceDate,
            },
          });

      // قاعدة القات (24-48 ساعة): إذا كان الصنف نافداً (0) أو ليوم جديد، يُعتمد السعر الجديد تلقائياً دون تنبيه
      if (
        existing &&
        sameCalendarDay(existing.entryDate, invoiceDate) &&
        existing.quantity.gt(0) &&
        !existing.costPrice.eq(line.effectiveBaseUnitCost)
      ) {
        const totalQty = existing.quantity.plus(line.baseQuantity);
        const weightedAvg = existing.quantity
          .mul(existing.costPrice)
          .plus(line.baseQuantity.mul(line.effectiveBaseUnitCost))
          .div(totalQty)
          .toDecimalPlaces(2);

        conflicts.push({
          item_name: line.itemName,
          base_unit: line.baseUnit,
          existing_quantity: Number(existing.quantity),
          old_cost_price: Number(existing.costPrice),
          new_quantity: Number(line.baseQuantity),
          new_cost_price: Number(line.effectiveBaseUnitCost),
          weighted_average_preview: Number(weightedAvg),
        });
      }
    }

    const owner = await this.prisma.storeOwner.findUniqueOrThrow({
      where: { id: storeOwnerId },
      select: { defaultCostingMethod: true, currency: true },
    });

    return {
      has_same_day_price_conflict: conflicts.length > 0,
      default_costing_method: owner.defaultCostingMethod,
      currency: owner.currency,
      currency_symbol: CURRENCY_METADATA[owner.currency].symbol,
      costing_options: COSTING_OPTIONS_AR,
      conflicts,
    };
  }

  async list(storeOwnerId: string, query: QueryPurchasesDto) {
    const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
    const offset = Math.max(query.offset ?? 0, 0);
    const search = query.search?.trim();

    const where: Prisma.PurchaseInvoiceWhereInput = {
      storeOwnerId,
      ...(query.supplier_id ? { supplierId: query.supplier_id } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.payment_type ? { paymentType: query.payment_type } : {}),
      ...(query.date_from || query.date_to
        ? {
            invoiceDate: {
              ...(query.date_from ? { gte: parseDateOnly(query.date_from) } : {}),
              ...(query.date_to ? { lte: parseDateOnly(query.date_to) } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { invoiceNumber: { contains: search, mode: 'insensitive' } },
              { supplierInvoiceRef: { contains: search, mode: 'insensitive' } },
              { supplier: { name: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [total, invoices, summaryAgg, owner] = await Promise.all([
      this.prisma.purchaseInvoice.count({ where }),
      this.prisma.purchaseInvoice.findMany({
        where,
        include: {
          supplier: { select: { id: true, name: true, phone: true } },
          wallet: { select: { id: true, name: true } },
          _count: { select: { items: true, returns: true } },
        },
        orderBy: [{ invoiceDate: 'desc' }, { createdAt: 'desc' }],
        take: limit,
        skip: offset,
      }),
      this.prisma.purchaseInvoice.aggregate({
        where: { ...where, status: query.status ?? 'POSTED' },
        _sum: { totalAmount: true, paidAmount: true, remainingAmount: true },
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
      summary: {
        total_amount: Number((summaryAgg._sum.totalAmount ?? new Prisma.Decimal(0)).toDecimalPlaces(2)),
        paid_amount: Number((summaryAgg._sum.paidAmount ?? new Prisma.Decimal(0)).toDecimalPlaces(2)),
        remaining_amount: Number(
          (summaryAgg._sum.remainingAmount ?? new Prisma.Decimal(0)).toDecimalPlaces(2),
        ),
      },
      items: invoices.map((inv) => ({
        id: inv.id,
        invoice_number: inv.invoiceNumber,
        supplier_invoice_ref: inv.supplierInvoiceRef,
        invoice_date: inv.invoiceDate,
        due_date: inv.dueDate,
        supplier: inv.supplier,
        payment_type: inv.paymentType,
        wallet: inv.wallet,
        subtotal: Number(inv.subtotal),
        tax_amount: Number(inv.taxAmount),
        discount_amount: Number(inv.discountAmount),
        total_amount: Number(inv.totalAmount),
        paid_amount: Number(inv.paidAmount),
        settled_amount: Number(inv.settledAmount),
        remaining_amount: Number(inv.remainingAmount),
        currency: inv.currency,
        status: inv.status,
        costing_method_used: inv.costingMethodUsed,
        lines_count: inv._count.items,
        returns_count: inv._count.returns,
        attachment_url: inv.attachmentUrl,
        posted_at: inv.postedAt,
        voided_at: inv.voidedAt,
        created_at: inv.createdAt,
      })),
    };
  }

  async getById(storeOwnerId: string, invoiceId: string) {
    const inv = await this.prisma.purchaseInvoice.findFirst({
      where: { id: invoiceId, storeOwnerId },
      include: {
        supplier: { select: { id: true, name: true, phone: true, currentBalance: true } },
        wallet: { select: { id: true, name: true } },
        items: { orderBy: { createdAt: 'asc' } },
        payments: { orderBy: { paidAt: 'desc' } },
        returns: {
          include: { item: { select: { name: true } } },
          orderBy: { returnedAt: 'desc' },
        },
      },
    });
    if (!inv) throw ApiError.notFound('فاتورة الشراء غير موجودة.');

    return serializeInvoiceDetail(inv);
  }

  async create(user: AuthenticatedUser, dto: CreatePurchaseDto, ip?: string) {
    const storeOwnerId = user.storeOwnerId!;

    if (dto.items.length > MAX_INVOICE_LINES) {
      throw ApiError.badRequest(
        'INVOICE_LINES_LIMIT_EXCEEDED',
        `الحد الأقصى لبنود الفاتورة الواحدة هو ${MAX_INVOICE_LINES} بند لضمان سرعة واستقرار النظام.`,
      );
    }

    const targetStatus = dto.status ?? PurchaseInvoiceStatus.POSTED;
    if (targetStatus === PurchaseInvoiceStatus.VOIDED) {
      throw ApiError.badRequest('VALIDATION_ERROR', 'لا يمكن إنشاء فاتورة بحالة ملغاة ابتداءً.');
    }

    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, storeOwnerId, deletedAt: null },
    });
    if (!supplier) throw ApiError.notFound('المورد غير موجود.');
    if (supplier.status === 'SUSPENDED') {
      throw ApiError.conflict(
        'SUPPLIER_SUSPENDED',
        'حساب هذا المورد موقوف حالياً ولا يمكن إصدار فواتير شراء جديدة باسمه.',
      );
    }

    const owner = await this.prisma.storeOwner.findUniqueOrThrow({
      where: { id: storeOwnerId },
      select: { currency: true, defaultCostingMethod: true },
    });

    const invoiceDate = dto.invoiceDate ? parseDateOnly(dto.invoiceDate) : startOfDay(new Date());
    const dueDate = dto.dueDate
      ? parseDateOnly(dto.dueDate)
      : supplier.paymentTermsDays !== null
        ? new Date(invoiceDate.getTime() + supplier.paymentTermsDays * 86_400_000)
        : null;

    const computed = this.computeInvoiceTotals(
      dto.items,
      dto.taxAmount ?? 0,
      dto.discountAmount ?? 0,
    );

    const { paidAmount, remainingAmount, walletAccountCode } = await this.validateAndResolvePayment(
      storeOwnerId,
      dto.paymentType,
      computed.totalAmount,
      dto.paidAmount,
      dto.walletId,
    );

    const costingMethod = dto.costingMethod ?? owner.defaultCostingMethod;

    const actorWorkerId = user.role === 'WORKER' ? user.workerId ?? null : null;
    const actorType = user.role === 'WORKER' ? 'WORKER' : 'STORE_OWNER';
    const actorId = user.role === 'WORKER' ? user.workerId! : storeOwnerId;

    // 1) مسار المسودة (DRAFT): حفظ دون تأثير على المخزون أو الذمم أو القيود
    if (targetStatus === PurchaseInvoiceStatus.DRAFT) {
      const draft = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM store_owners WHERE id = ${storeOwnerId}::uuid FOR UPDATE`;
        const invoiceNumber =
          dto.invoiceNumber?.trim() ||
          (await this.generateInvoiceNumber(tx, storeOwnerId, invoiceDate));
        return tx.purchaseInvoice.create({
          data: {
            ...(dto.id ? { id: dto.id } : {}),
            storeOwnerId,
            workerId: actorWorkerId,
            supplierId: supplier.id,
            invoiceNumber,
            supplierInvoiceRef: dto.supplierInvoiceRef?.trim() || null,
            invoiceDate,
            dueDate,
            paymentType: dto.paymentType,
            walletId: dto.walletId ?? null,
            subtotal: computed.subtotal,
            taxAmount: computed.headerTax,
            discountAmount: computed.headerDiscount,
            totalAmount: computed.totalAmount,
            paidAmount,
            settledAmount: new Prisma.Decimal(0),
            remainingAmount,
            currency: owner.currency,
            attachmentUrl: dto.attachmentUrl?.trim() || null,
            notes: dto.notes?.trim() || null,
            status: 'DRAFT',
            costingMethodUsed: costingMethod,
            items: {
              create: computed.lines.map((l) => ({
                storeOwnerId,
                itemId: l.itemId ?? null,
                itemName: l.itemName,
                baseUnit: l.baseUnit,
                unit: l.unit,
                conversionFactor: l.conversionFactor,
                quantity: l.quantity,
                baseQuantity: l.baseQuantity,
                unitCostPrice: l.unitCostPrice,
                taxAmount: l.taxAmount,
                discountAmount: l.discountAmount,
                totalLineCost: l.totalLineCost,
                effectiveBaseUnitCost: l.effectiveBaseUnitCost,
                sellPrice: l.sellPrice,
                emergencyPriceMode: l.emergencyPriceMode ?? null,
                emergencyPricePlusFixed: l.emergencyPricePlusFixed ?? null,
                emergencyPricePlusPercent: l.emergencyPricePlusPercent ?? null,
                emergencyPriceMin: l.emergencyPriceMin ?? null,
                emergencyPriceMax: l.emergencyPriceMax ?? null,
                remainingFifoQty: new Prisma.Decimal(0),
              })),
            },
          },
          include: {
            supplier: { select: { id: true, name: true, phone: true, currentBalance: true } },
            wallet: { select: { id: true, name: true } },
            items: { orderBy: { createdAt: 'asc' } },
            payments: true,
            returns: { include: { item: { select: { name: true } } } },
          },
        });
      });

      await this.audit.log({
        actorType,
        actorId,
        actionType: 'PURCHASE_DRAFT_CREATE',
        targetType: 'purchase_invoice',
        targetId: draft.id,
        newValue: { invoice_number: draft.invoiceNumber, total_amount: Number(draft.totalAmount) },
        ipAddress: ip,
        result: 'SUCCESS',
      });

      return serializeInvoiceDetail(draft);
    }

    // 2) مسار الاعتماد المباشر (POSTED): معاملة ذرّية كاملة للمخزون + التكلفة + الذمم + القيد المزدوج
    const defaultEmergencyMode = await this.getDefaultEmergencyMode();
    const postedId = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM store_owners WHERE id = ${storeOwnerId}::uuid FOR UPDATE`;
      const invoiceNumber =
        dto.invoiceNumber?.trim() ||
        (await this.generateInvoiceNumber(tx, storeOwnerId, invoiceDate));
      await this.assertDayNotClosedForCash(
        tx,
        storeOwnerId,
        invoiceDate,
        dto.paymentType,
        paidAmount,
        dto.walletId,
        actorWorkerId,
      );
      await this.suppliersService.ensureSupplierAccountExists(tx, storeOwnerId);

      // قفل المورد والتحقق من سقف الائتمان والحالة
      const lockedSuppliers = await tx.$queryRaw<
        Array<{
          id: string;
          name: string;
          status: string;
          current_balance: Prisma.Decimal;
          credit_limit: Prisma.Decimal | null;
          deleted_at: Date | null;
        }>
      >(Prisma.sql`SELECT id, name, status::text AS status, current_balance, credit_limit, deleted_at
                   FROM suppliers WHERE id = ${supplier.id}::uuid AND store_owner_id = ${storeOwnerId}::uuid FOR UPDATE`);
      const lockedSupplier = lockedSuppliers[0];
      if (!lockedSupplier || lockedSupplier.deleted_at) throw ApiError.notFound('المورد غير موجود.');
      if (lockedSupplier.status === 'SUSPENDED') {
        throw ApiError.conflict('SUPPLIER_SUSPENDED', 'حساب المورد موقوف حالياً.');
      }
      if (
        remainingAmount.gt(0) &&
        lockedSupplier.credit_limit !== null &&
        lockedSupplier.current_balance.plus(remainingAmount).gt(lockedSupplier.credit_limit)
      ) {
        throw ApiError.conflict(
          'SUPPLIER_CREDIT_LIMIT_EXCEEDED',
          'تجاوز المبلغ المتبقي سقف الائتمان المحدد لهذا المورد.',
          {
            available_credit: Number(
              lockedSupplier.credit_limit.minus(lockedSupplier.current_balance).toDecimalPlaces(2),
            ),
          },
        );
      }

      // معالجة الأصناف وحساب التكلفة بقفل الصف (SELECT ... FOR UPDATE)
      const resolvedItemIds = await this.applyInventoryAndCostingForLines(tx, {
        storeOwnerId,
        invoiceDate,
        lines: computed.lines,
        costingMethod,
        explicitCostingProvided: dto.costingMethod !== undefined,
        promptOnSameDayPriceDiff: dto.promptOnSameDayPriceDiff === true,
        defaultEmergencyMode,
      });

      const createdInvoice = await tx.purchaseInvoice.create({
        data: {
          ...(dto.id ? { id: dto.id } : {}),
          storeOwnerId,
          workerId: actorWorkerId,
          supplierId: supplier.id,
          invoiceNumber,
          supplierInvoiceRef: dto.supplierInvoiceRef?.trim() || null,
          invoiceDate,
          dueDate,
          paymentType: dto.paymentType,
          walletId: dto.walletId ?? null,
          subtotal: computed.subtotal,
          taxAmount: computed.headerTax,
          discountAmount: computed.headerDiscount,
          totalAmount: computed.totalAmount,
          paidAmount,
          settledAmount: new Prisma.Decimal(0),
          remainingAmount,
          currency: owner.currency,
          attachmentUrl: dto.attachmentUrl?.trim() || null,
          notes: dto.notes?.trim() || null,
          status: 'POSTED',
          costingMethodUsed: costingMethod,
          postedAt: new Date(),
          items: {
            create: computed.lines.map((l, idx) => ({
              storeOwnerId,
              itemId: resolvedItemIds[idx],
              itemName: l.itemName,
              baseUnit: l.baseUnit,
              unit: l.unit,
              conversionFactor: l.conversionFactor,
              quantity: l.quantity,
              baseQuantity: l.baseQuantity,
              unitCostPrice: l.unitCostPrice,
              taxAmount: l.taxAmount,
              discountAmount: l.discountAmount,
              totalLineCost: l.totalLineCost,
              effectiveBaseUnitCost: l.effectiveBaseUnitCost,
              sellPrice: l.sellPrice,
              emergencyPriceMode: l.emergencyPriceMode ?? null,
              emergencyPricePlusFixed: l.emergencyPricePlusFixed ?? null,
              emergencyPricePlusPercent: l.emergencyPricePlusPercent ?? null,
              emergencyPriceMin: l.emergencyPriceMin ?? null,
              emergencyPriceMax: l.emergencyPriceMax ?? null,
              remainingFifoQty: l.baseQuantity,
            })),
          },
        },
      });

      if (remainingAmount.gt(0)) {
        await tx.supplier.update({
          where: { id: supplier.id },
          data: { currentBalance: { increment: remainingAmount } },
        });
      }

      await this.createPurchaseJournalEntries(tx, {
        storeOwnerId,
        entryDate: invoiceDate,
        invoiceId: createdInvoice.id,
        invoiceNumber: createdInvoice.invoiceNumber,
        supplierName: lockedSupplier.name,
        totalAmount: computed.totalAmount,
        paidAmount,
        remainingAmount,
        paymentType: dto.paymentType,
        walletId: dto.walletId,
        walletAccountCode,
      });

      return createdInvoice.id;
    });

    const fullInvoice = await this.getById(storeOwnerId, postedId);

    await this.audit.log({
      actorType,
      actorId,
      actionType: 'PURCHASE_INVOICE_POST',
      targetType: 'purchase_invoice',
      targetId: postedId,
      newValue: {
        invoice_number: fullInvoice.invoice_number,
        supplier_id: dto.supplierId,
        total_amount: fullInvoice.total_amount,
        paid_amount: fullInvoice.paid_amount,
        remaining_amount: fullInvoice.remaining_amount,
        costing_method: fullInvoice.costing_method_used,
      },
      ipAddress: ip,
      result: 'SUCCESS',
    });

    return fullInvoice;
  }

  async updateDraft(
    storeOwnerId: string,
    invoiceId: string,
    dto: UpdateDraftPurchaseDto,
    ip?: string,
  ) {
    const existing = await this.prisma.purchaseInvoice.findFirst({
      where: { id: invoiceId, storeOwnerId },
      include: { items: true },
    });
    if (!existing) throw ApiError.notFound('فاتورة الشراء غير موجودة.');
    if (existing.status !== 'DRAFT') {
      throw ApiError.conflict(
        'INVOICE_NOT_EDITABLE',
        'لا يمكن تعديل فاتورة شراء بعد ترحيلها أو إلغائها. استخدم مرتجع المشتريات أو إلغاء الفاتورة.',
      );
    }

    if (dto.items && dto.items.length > MAX_INVOICE_LINES) {
      throw ApiError.badRequest(
        'INVOICE_LINES_LIMIT_EXCEEDED',
        `الحد الأقصى لبنود الفاتورة الواحدة هو ${MAX_INVOICE_LINES} بند.`,
      );
    }

    const supplierId = dto.supplierId ?? existing.supplierId;
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, storeOwnerId, deletedAt: null },
    });
    if (!supplier) throw ApiError.notFound('المورد غير موجود.');

    const lineInputs: PurchaseLineInputDto[] = dto.items
      ? dto.items
      : existing.items.map((it) => ({
          itemId: it.itemId ?? undefined,
          itemName: it.itemName,
          unit: it.unit,
          baseUnit: it.baseUnit,
          conversionFactor: Number(it.conversionFactor),
          quantity: Number(it.quantity),
          unitCostPrice: Number(it.unitCostPrice),
          taxAmount: Number(it.taxAmount),
          discountAmount: Number(it.discountAmount),
          sellPrice: Number(it.sellPrice),
          emergencyPriceMode: it.emergencyPriceMode ?? undefined,
          emergencyPricePlusFixed: it.emergencyPricePlusFixed ? Number(it.emergencyPricePlusFixed) : undefined,
          emergencyPricePlusPercent: it.emergencyPricePlusPercent ? Number(it.emergencyPricePlusPercent) : undefined,
          emergencyPriceMin: it.emergencyPriceMin ? Number(it.emergencyPriceMin) : undefined,
          emergencyPriceMax: it.emergencyPriceMax ? Number(it.emergencyPriceMax) : undefined,
        }));

    const headerTax = dto.taxAmount !== undefined ? dto.taxAmount : Number(existing.taxAmount);
    const headerDiscount =
      dto.discountAmount !== undefined ? dto.discountAmount : Number(existing.discountAmount);
    const computed = this.computeInvoiceTotals(lineInputs, headerTax, headerDiscount);

    const paymentType = dto.paymentType ?? existing.paymentType;
    const walletId =
      dto.walletId !== undefined ? (dto.walletId ?? undefined) : (existing.walletId ?? undefined);
    const paidInput = dto.paidAmount !== undefined ? dto.paidAmount : Number(existing.paidAmount);

    const { paidAmount, remainingAmount } = await this.validateAndResolvePayment(
      storeOwnerId,
      paymentType,
      computed.totalAmount,
      paidInput,
      walletId,
    );

    const invoiceDate = dto.invoiceDate ? parseDateOnly(dto.invoiceDate) : existing.invoiceDate;
    const dueDate =
      dto.dueDate !== undefined ? (dto.dueDate ? parseDateOnly(dto.dueDate) : null) : existing.dueDate;

    await this.prisma.$transaction(async (tx) => {
      await tx.purchaseItem.deleteMany({ where: { purchaseInvoiceId: invoiceId } });
      await tx.purchaseInvoice.update({
        where: { id: invoiceId },
        data: {
          supplierId,
          ...(dto.supplierInvoiceRef !== undefined ? { supplierInvoiceRef: dto.supplierInvoiceRef } : {}),
          invoiceDate,
          dueDate,
          paymentType,
          walletId: walletId ?? null,
          subtotal: computed.subtotal,
          taxAmount: computed.headerTax,
          discountAmount: computed.headerDiscount,
          totalAmount: computed.totalAmount,
          paidAmount,
          remainingAmount,
          ...(dto.attachmentUrl !== undefined ? { attachmentUrl: dto.attachmentUrl } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          ...(dto.costingMethod !== undefined ? { costingMethodUsed: dto.costingMethod } : {}),
          items: {
            create: computed.lines.map((l) => ({
              storeOwnerId,
              itemId: l.itemId ?? null,
              itemName: l.itemName,
              baseUnit: l.baseUnit,
              unit: l.unit,
              conversionFactor: l.conversionFactor,
              quantity: l.quantity,
              baseQuantity: l.baseQuantity,
              unitCostPrice: l.unitCostPrice,
              taxAmount: l.taxAmount,
              discountAmount: l.discountAmount,
              totalLineCost: l.totalLineCost,
              effectiveBaseUnitCost: l.effectiveBaseUnitCost,
              sellPrice: l.sellPrice,
              emergencyPriceMode: l.emergencyPriceMode ?? null,
              emergencyPricePlusFixed: l.emergencyPricePlusFixed ?? null,
              emergencyPricePlusPercent: l.emergencyPricePlusPercent ?? null,
              emergencyPriceMin: l.emergencyPriceMin ?? null,
              emergencyPriceMax: l.emergencyPriceMax ?? null,
              remainingFifoQty: new Prisma.Decimal(0),
            })),
          },
        },
      });
    });

    await this.audit.log({
      actorType: 'STORE_OWNER',
      actorId: storeOwnerId,
      actionType: 'PURCHASE_DRAFT_UPDATE',
      targetType: 'purchase_invoice',
      targetId: invoiceId,
      ipAddress: ip,
      result: 'SUCCESS',
    });

    return this.getById(storeOwnerId, invoiceId);
  }

  async postDraft(user: AuthenticatedUser, invoiceId: string, dto: PostPurchaseDto, ip?: string) {
    const storeOwnerId = user.storeOwnerId!;
    const actorWorkerId = user.role === 'WORKER' ? user.workerId ?? null : null;
    const draft = await this.prisma.purchaseInvoice.findFirst({
      where: { id: invoiceId, storeOwnerId },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
    if (!draft) throw ApiError.notFound('فاتورة الشراء غير موجودة.');
    if (draft.status !== 'DRAFT') {
      throw ApiError.conflict('INVOICE_NOT_EDITABLE', 'هذه الفاتورة مرحّلة أو ملغاة بالفعل.');
    }

    const { walletAccountCode } = await this.validateAndResolvePayment(
      storeOwnerId,
      draft.paymentType,
      draft.totalAmount,
      Number(draft.paidAmount),
      draft.walletId ?? undefined,
    );

    const costingMethod = dto.costingMethod ?? draft.costingMethodUsed;
    const defaultEmergencyMode = await this.getDefaultEmergencyMode();

    const lines: ComputedLine[] = draft.items.map((it) => ({
      itemId: it.itemId ?? undefined,
      itemName: it.itemName,
      unit: it.unit,
      baseUnit: it.baseUnit,
      conversionFactor: it.conversionFactor,
      quantity: it.quantity,
      baseQuantity: it.baseQuantity,
      unitCostPrice: it.unitCostPrice,
      taxAmount: it.taxAmount,
      discountAmount: it.discountAmount,
      totalLineCost: it.totalLineCost,
      effectiveBaseUnitCost: it.effectiveBaseUnitCost,
      sellPrice: it.sellPrice,
      emergencyPriceMode: it.emergencyPriceMode ?? undefined,
      emergencyPricePlusFixed: it.emergencyPricePlusFixed ?? undefined,
      emergencyPricePlusPercent: it.emergencyPricePlusPercent ?? undefined,
      emergencyPriceMin: it.emergencyPriceMin ?? undefined,
      emergencyPriceMax: it.emergencyPriceMax ?? undefined,
    }));

    await this.prisma.$transaction(async (tx) => {
      await this.assertDayNotClosedForCash(
        tx,
        storeOwnerId,
        draft.invoiceDate,
        draft.paymentType,
        draft.paidAmount,
        draft.walletId ?? undefined,
        actorWorkerId,
      );
      await this.suppliersService.ensureSupplierAccountExists(tx, storeOwnerId);

      const lockedSuppliers = await tx.$queryRaw<
        Array<{
          id: string;
          name: string;
          status: string;
          current_balance: Prisma.Decimal;
          credit_limit: Prisma.Decimal | null;
          deleted_at: Date | null;
        }>
      >(Prisma.sql`SELECT id, name, status::text AS status, current_balance, credit_limit, deleted_at
                   FROM suppliers WHERE id = ${draft.supplierId}::uuid AND store_owner_id = ${storeOwnerId}::uuid FOR UPDATE`);
      const lockedSupplier = lockedSuppliers[0];
      if (!lockedSupplier || lockedSupplier.deleted_at) throw ApiError.notFound('المورد غير موجود.');
      if (lockedSupplier.status === 'SUSPENDED') {
        throw ApiError.conflict('SUPPLIER_SUSPENDED', 'حساب المورد موقوف حالياً.');
      }
      if (
        draft.remainingAmount.gt(0) &&
        lockedSupplier.credit_limit !== null &&
        lockedSupplier.current_balance.plus(draft.remainingAmount).gt(lockedSupplier.credit_limit)
      ) {
        throw ApiError.conflict(
          'SUPPLIER_CREDIT_LIMIT_EXCEEDED',
          'تجاوز المبلغ المتبقي سقف الائتمان المحدد لهذا المورد.',
        );
      }

      const resolvedItemIds = await this.applyInventoryAndCostingForLines(tx, {
        storeOwnerId,
        invoiceDate: draft.invoiceDate,
        lines,
        costingMethod,
        explicitCostingProvided: dto.costingMethod !== undefined,
        promptOnSameDayPriceDiff: dto.promptOnSameDayPriceDiff === true,
        defaultEmergencyMode,
      });

      for (let i = 0; i < draft.items.length; i++) {
        await tx.purchaseItem.update({
          where: { id: draft.items[i].id },
          data: {
            itemId: resolvedItemIds[i],
            remainingFifoQty: draft.items[i].baseQuantity,
          },
        });
      }

      await tx.purchaseInvoice.update({
        where: { id: invoiceId },
        data: {
          status: 'POSTED',
          ...(actorWorkerId ? { workerId: actorWorkerId } : {}),
          costingMethodUsed: costingMethod,
          postedAt: new Date(),
        },
      });

      if (draft.remainingAmount.gt(0)) {
        await tx.supplier.update({
          where: { id: draft.supplierId },
          data: { currentBalance: { increment: draft.remainingAmount } },
        });
      }

      await this.createPurchaseJournalEntries(tx, {
        storeOwnerId,
        entryDate: draft.invoiceDate,
        invoiceId: draft.id,
        invoiceNumber: draft.invoiceNumber,
        supplierName: lockedSupplier.name,
        totalAmount: draft.totalAmount,
        paidAmount: draft.paidAmount,
        remainingAmount: draft.remainingAmount,
        paymentType: draft.paymentType,
        walletId: draft.walletId ?? undefined,
        walletAccountCode,
      });
    });

    await this.audit.log({
      actorType: user.role === 'WORKER' ? 'WORKER' : 'STORE_OWNER',
      actorId: user.role === 'WORKER' ? user.workerId! : storeOwnerId,
      actionType: 'PURCHASE_INVOICE_POST',
      targetType: 'purchase_invoice',
      targetId: invoiceId,
      ipAddress: ip,
      result: 'SUCCESS',
    });

    return this.getById(storeOwnerId, invoiceId);
  }

  async voidInvoice(storeOwnerId: string, invoiceId: string, dto: VoidPurchaseDto, ip?: string) {
    const invoice = await this.prisma.purchaseInvoice.findFirst({
      where: { id: invoiceId, storeOwnerId },
      include: {
        items: true,
        payments: { select: { id: true } },
        returns: { select: { id: true } },
        supplier: { select: { id: true, name: true } },
      },
    });
    if (!invoice) throw ApiError.notFound('فاتورة الشراء غير موجودة.');

    if (invoice.status === 'VOIDED') {
      throw ApiError.conflict('INVOICE_CANNOT_VOID', 'هذه الفاتورة ملغاة مسبقاً.');
    }
    if (invoice.status === 'DRAFT') {
      await this.prisma.purchaseInvoice.update({
        where: { id: invoiceId },
        data: { status: 'VOIDED', voidedAt: new Date(), voidReason: dto.reason.trim() },
      });
      return this.getById(storeOwnerId, invoiceId);
    }

    if (invoice.payments.length > 0 || invoice.settledAmount.gt(0)) {
      throw ApiError.conflict(
        'INVOICE_CANNOT_VOID',
        'لا يمكن إلغاء فاتورة شراء مرتبطة بسدادات أو تسويات سابقة.',
      );
    }
    if (invoice.returns.length > 0) {
      throw ApiError.conflict(
        'INVOICE_CANNOT_VOID',
        'لا يمكن إلغاء فاتورة شراء سُجّلت عليها مرتجعات سابقة.',
      );
    }

    let walletAccountCode = '1100';
    if (invoice.walletId) {
      const wallet = await this.prisma.wallet.findFirst({
        where: { id: invoice.walletId, storeOwnerId },
      });
      if (wallet) {
        const walletAccount = await this.prisma.chartOfAccount.findFirst({
          where: { storeOwnerId, accountType: 'ASSET', name: { startsWith: `محفظة: ${wallet.name}` } },
          select: { code: true },
        });
        walletAccountCode = walletAccount?.code ?? '1100';
      }
    }

    await this.prisma.$transaction(async (tx) => {
      // منع الإلغاء بعد الإغلاق اليومي
      const closedClosing = await tx.dailyClosing.findFirst({
        where: {
          storeOwnerId,
          workerId: null,
          closingDate: invoice.invoiceDate,
          status: 'CLOSED',
        },
      });
      if (closedClosing) {
        throw ApiError.conflict(
          'DAY_ALREADY_CLOSED',
          'لا يمكن إلغاء فاتورة شراء بعد اعتماد الإغلاق اليومي لتاريخها.',
        );
      }

      // منع الإلغاء إذا تمت مبيعات على أي من أصناف الفاتورة
      const itemIds = invoice.items.map((it) => it.itemId).filter((x): x is string => !!x);
      if (itemIds.length > 0) {
        const salesCount = await tx.sale.count({
          where: {
            storeOwnerId,
            itemId: { in: itemIds },
            ...(invoice.postedAt ? { soldAt: { gte: invoice.postedAt } } : {}),
          },
        });
        if (salesCount > 0) {
          throw ApiError.conflict(
            'PURCHASE_ITEM_HAS_SALES',
            'لا يمكن إلغاء الفاتورة لوجود عمليات بيع تمت بالفعل على أصنافها.',
          );
        }
      }

      // خصم المخزون بقفل الصف لكل صنف
      for (const pItem of invoice.items) {
        if (!pItem.itemId) continue;
        const lockedItems = await tx.$queryRaw<
          Array<{ id: string; quantity: Prisma.Decimal }>
        >(Prisma.sql`SELECT id, quantity FROM items
                     WHERE id = ${pItem.itemId}::uuid AND store_owner_id = ${storeOwnerId}::uuid FOR UPDATE`);
        const lockedItem = lockedItems[0];
        if (!lockedItem || lockedItem.quantity.lt(pItem.baseQuantity)) {
          throw ApiError.conflict(
            'INSUFFICIENT_STOCK',
            'الكمية المتبقية في المخزون أقل من كمية الفاتورة المراد إلغاؤها.',
          );
        }

        await tx.$executeRaw(
          Prisma.sql`UPDATE items SET quantity = quantity - ${pItem.baseQuantity}, updated_at = now()
                     WHERE id = ${pItem.itemId}::uuid`,
        );
        await tx.purchaseItem.update({
          where: { id: pItem.id },
          data: { remainingFifoQty: new Prisma.Decimal(0) },
        });
      }

      // عكس رصيد المورد
      if (invoice.remainingAmount.gt(0)) {
        await tx.supplier.update({
          where: { id: invoice.supplierId },
          data: { currentBalance: { decrement: invoice.remainingAmount } },
        });
      }

      await tx.purchaseInvoice.update({
        where: { id: invoiceId },
        data: {
          status: 'VOIDED',
          voidedAt: new Date(),
          voidReason: dto.reason.trim(),
          remainingAmount: new Prisma.Decimal(0),
        },
      });

      // قيد عكسي كامل متوازن (BR-055: لا تعديل ولا حذف للقيود القديمة بل قيد عكسي)
      if (invoice.totalAmount.gt(0)) {
        const revLines: Array<{ accountCode: string; debit?: number; credit?: number; description: string }> = [];
        if (invoice.paidAmount.gt(0)) {
          const payAcc = invoice.walletId ? walletAccountCode : '1000';
          revLines.push({
            accountCode: payAcc,
            debit: invoice.paidAmount.toNumber(),
            description: `عكس سداد فاتورة ملغاة ${invoice.invoiceNumber}`,
          });
        }
        if (invoice.remainingAmount.gt(0)) {
          revLines.push({
            accountCode: '2000',
            debit: invoice.remainingAmount.toNumber(),
            description: `عكس مديونية فاتورة ملغاة ${invoice.invoiceNumber}`,
          });
        }
        revLines.push({
          accountCode: '1300',
          credit: invoice.totalAmount.toNumber(),
          description: `عكس مخزون فاتورة شراء ملغاة ${invoice.invoiceNumber}`,
        });

        await this.accounting.createBalancedEntries(tx, {
          storeOwnerId,
          entryDate: startOfDay(new Date()),
          referenceType: 'PURCHASE_VOID',
          referenceId: invoice.id,
          lines: revLines,
        });
      }
    });

    await this.audit.log({
      actorType: 'STORE_OWNER',
      actorId: storeOwnerId,
      actionType: 'PURCHASE_INVOICE_VOID',
      targetType: 'purchase_invoice',
      targetId: invoiceId,
      newValue: { reason: dto.reason.trim() },
      ipAddress: ip,
      result: 'SUCCESS',
    });

    return this.getById(storeOwnerId, invoiceId);
  }

  // ─── مرتجع المشتريات (Purchase Returns) ─────────────────────────────────

  async createReturn(
    user: AuthenticatedUser,
    invoiceId: string,
    dto: CreatePurchaseReturnDto,
    ip?: string,
  ) {
    const storeOwnerId = user.storeOwnerId!;

    const invoice = await this.prisma.purchaseInvoice.findFirst({
      where: { id: invoiceId, storeOwnerId },
      include: {
        supplier: { select: { id: true, name: true } },
        items: true,
      },
    });
    if (!invoice) throw ApiError.notFound('فاتورة الشراء غير موجودة.');
    if (invoice.status !== 'POSTED') {
      throw ApiError.conflict(
        'VALIDATION_ERROR',
        'لا يمكن تسجيل مرتجع إلا لفاتورة شراء مرحّلة ومعتمدة.',
      );
    }

    const pItem = invoice.items.find((it) => it.id === dto.purchaseItemId);
    if (!pItem || !pItem.itemId) {
      throw ApiError.notFound('بند الفاتورة المحدد غير موجود.');
    }

    const returnQty = new Prisma.Decimal(dto.quantity).toDecimalPlaces(3);
    const maxReturnable = pItem.quantity.minus(pItem.returnedQuantity);
    if (returnQty.gt(maxReturnable)) {
      throw ApiError.badRequest(
        'RETURN_QTY_EXCEEDS_PURCHASED',
        'الكمية المرتجعة تتجاوز الكمية المشتراة المتبقية في الفاتورة.',
        { max_returnable: Number(maxReturnable) },
      );
    }

    const returnBaseQty = returnQty.mul(pItem.conversionFactor).toDecimalPlaces(3);
    const returnAmount = returnBaseQty.mul(pItem.effectiveBaseUnitCost).toDecimalPlaces(2);
    const today = startOfDay(new Date());

    const createdReturn = await this.prisma.$transaction(async (tx) => {
      await this.suppliersService.ensureSupplierAccountExists(tx, storeOwnerId);

      // 1) حظر المرتجع بعد الإغلاق اليومي (لتاريخ الفاتورة أو تاريخ اليوم)
      const actorWorkerId = user.role === 'WORKER' ? user.workerId ?? null : null;
      const closedClosing = await tx.dailyClosing.findFirst({
        where: {
          storeOwnerId,
          closingDate: { in: [today, invoice.invoiceDate] },
          status: 'CLOSED',
          OR: [{ workerId: null }, ...(actorWorkerId ? [{ workerId: actorWorkerId }] : [])],
        },
      });
      if (closedClosing) {
        throw ApiError.conflict(
          'DAY_ALREADY_CLOSED',
          'تم اعتماد الإغلاق اليومي مسبقاً ولا يمكن تسجيل مرتجع مشتريات لهذا اليوم.',
        );
      }

      // 2) القاعدة الحاكمة الصارمة: حظر مرتجع المشتريات في حال وجود أي عمليات بيع تمت على الصنف
      const salesCount = await tx.sale.count({
        where: {
          storeOwnerId,
          itemId: pItem.itemId!,
          ...(invoice.postedAt ? { soldAt: { gte: invoice.postedAt } } : {}),
        },
      });
      if (salesCount > 0) {
        throw ApiError.conflict(
          'PURCHASE_ITEM_HAS_SALES',
          'لا يمكن تسجيل مرتجع المشتريات لوجود مبيعات تمت بالفعل من هذه الفاتورة.',
          { sales_count: salesCount },
        );
      }

      // 3) قفل الصنف وفحص توفر الكمية في المخزون
      const lockedItems = await tx.$queryRaw<
        Array<{ id: string; quantity: Prisma.Decimal; deleted_at: Date | null }>
      >(Prisma.sql`SELECT id, quantity, deleted_at FROM items
                   WHERE id = ${pItem.itemId}::uuid AND store_owner_id = ${storeOwnerId}::uuid FOR UPDATE`);
      const lockedItem = lockedItems[0];
      if (!lockedItem || lockedItem.deleted_at) throw ApiError.notFound('الصنف غير موجود في المخزون.');
      if (lockedItem.quantity.lt(returnBaseQty)) {
        throw ApiError.conflict(
          'INSUFFICIENT_STOCK',
          'الكمية المتوفرة في المخزون أقل من الكمية المراد إرجاعها للمورد.',
          { available: Number(lockedItem.quantity) },
        );
      }

      // 4) قفل المورد وتحديث الذمة عند اختيار خصم من الدين (DEBT_REDUCTION)
      const lockedSuppliers = await tx.$queryRaw<
        Array<{ id: string; current_balance: Prisma.Decimal }>
      >(Prisma.sql`SELECT id, current_balance FROM suppliers
                   WHERE id = ${invoice.supplierId}::uuid AND store_owner_id = ${storeOwnerId}::uuid FOR UPDATE`);
      const lockedSupplier = lockedSuppliers[0];

      if (dto.refundMethod === PurchaseRefundMethod.DEBT_REDUCTION) {
        if (lockedSupplier.current_balance.lt(returnAmount)) {
          throw ApiError.badRequest(
            'VALIDATION_ERROR',
            'رصيد المورد المستحق أقل من قيمة المرتجع. اختر الاسترداد النقدي (CASH_REFUND).',
            { supplier_balance: Number(lockedSupplier.current_balance) },
          );
        }

        await tx.supplier.update({
          where: { id: invoice.supplierId },
          data: { currentBalance: { decrement: returnAmount } },
        });

        const invReduction = Prisma.Decimal.min(invoice.remainingAmount, returnAmount);
        if (invReduction.gt(0)) {
          await tx.purchaseInvoice.update({
            where: { id: invoice.id },
            data: {
              settledAmount: { increment: invReduction },
              remainingAmount: { decrement: invReduction },
            },
          });
        }
      }

      // 5) خصم المخزون وتحديث البند وطبقات FIFO
      await tx.$executeRaw(
        Prisma.sql`UPDATE items SET quantity = quantity - ${returnBaseQty}, updated_at = now()
                   WHERE id = ${pItem.itemId}::uuid`,
      );

      const nextFifo = Prisma.Decimal.max(
        new Prisma.Decimal(0),
        pItem.remainingFifoQty.minus(returnBaseQty),
      );
      await tx.purchaseItem.update({
        where: { id: pItem.id },
        data: {
          returnedQuantity: { increment: returnQty },
          remainingFifoQty: nextFifo,
        },
      });

      const ret = await tx.purchaseReturn.create({
        data: {
          ...(dto.id ? { id: dto.id } : {}),
          storeOwnerId,
          workerId: actorWorkerId,
          purchaseInvoiceId: invoice.id,
          purchaseItemId: pItem.id,
          supplierId: invoice.supplierId,
          itemId: pItem.itemId!,
          quantity: returnQty,
          baseQuantity: returnBaseQty,
          unitPrice: pItem.effectiveBaseUnitCost,
          totalAmount: returnAmount,
          refundMethod: dto.refundMethod,
          reason: dto.reason.trim(),
          returnedAt: new Date(),
        },
      });

      // 6) قيد محاسبي متوازن لمرتجع المشتريات
      if (returnAmount.gt(0)) {
        const debitAccount = dto.refundMethod === PurchaseRefundMethod.DEBT_REDUCTION ? '2000' : '1000';
        await this.accounting.createBalancedEntries(tx, {
          storeOwnerId,
          entryDate: today,
          referenceType: 'PURCHASE_RETURN',
          referenceId: ret.id,
          lines: [
            {
              accountCode: debitAccount,
              debit: returnAmount.toNumber(),
              description:
                dto.refundMethod === PurchaseRefundMethod.DEBT_REDUCTION
                  ? `تخفيض ذمة المورد (${invoice.supplier.name}) بمرتجع مشتريات`
                  : `استرداد نقدي من المورد (${invoice.supplier.name}) عن مرتجع مشتريات`,
            },
            {
              accountCode: '1300',
              credit: returnAmount.toNumber(),
              description: `خصم المخزون بمرتجع مشتريات من فاتورة ${invoice.invoiceNumber}`,
            },
          ],
        });
      }

      return ret;
    });

    await this.audit.log({
      actorType: 'STORE_OWNER',
      actorId: storeOwnerId,
      actionType: 'PURCHASE_RETURN_CREATE',
      targetType: 'purchase_return',
      targetId: createdReturn.id,
      newValue: {
        invoice_id: invoiceId,
        quantity: Number(createdReturn.quantity),
        total_amount: Number(createdReturn.totalAmount),
        refund_method: createdReturn.refundMethod,
        reason: createdReturn.reason,
      },
      ipAddress: ip,
      result: 'SUCCESS',
    });

    return {
      return_id: createdReturn.id,
      purchase_invoice_id: createdReturn.purchaseInvoiceId,
      purchase_item_id: createdReturn.purchaseItemId,
      supplier_id: createdReturn.supplierId,
      item_id: createdReturn.itemId,
      quantity: Number(createdReturn.quantity),
      base_quantity: Number(createdReturn.baseQuantity),
      unit_price: Number(createdReturn.unitPrice),
      total_amount: Number(createdReturn.totalAmount),
      refund_method: createdReturn.refundMethod,
      reason: createdReturn.reason,
      returned_at: createdReturn.returnedAt,
    };
  }

  async listReturns(storeOwnerId: string, invoiceId: string) {
    const invoice = await this.prisma.purchaseInvoice.findFirst({
      where: { id: invoiceId, storeOwnerId },
      select: { id: true, invoiceNumber: true },
    });
    if (!invoice) throw ApiError.notFound('فاتورة الشراء غير موجودة.');

    const returns = await this.prisma.purchaseReturn.findMany({
      where: { storeOwnerId, purchaseInvoiceId: invoiceId },
      include: { item: { select: { name: true, unit: true } } },
      orderBy: { returnedAt: 'desc' },
    });

    return returns.map((r) => ({
      return_id: r.id,
      item_id: r.itemId,
      item_name: r.item.name,
      unit: r.item.unit,
      quantity: Number(r.quantity),
      base_quantity: Number(r.baseQuantity),
      unit_price: Number(r.unitPrice),
      total_amount: Number(r.totalAmount),
      refund_method: r.refundMethod,
      reason: r.reason,
      returned_at: r.returnedAt,
    }));
  }

  // ─── محرك الاحتساب والمخزون والقيود الداخلية ─────────────────────────────

  private computeInvoiceTotals(
    rawLines: PurchaseLineInputDto[],
    headerTaxNum: number,
    headerDiscountNum: number,
  ): {
    lines: ComputedLine[];
    subtotal: Prisma.Decimal;
    headerTax: Prisma.Decimal;
    headerDiscount: Prisma.Decimal;
    totalAmount: Prisma.Decimal;
  } {
    const preliminary = rawLines.map((l) => {
      const cf = new Prisma.Decimal(l.conversionFactor ?? 1).toDecimalPlaces(3);
      const qty = new Prisma.Decimal(l.quantity).toDecimalPlaces(3);
      const baseQty = qty.mul(cf).toDecimalPlaces(3);
      const unitCost = new Prisma.Decimal(l.unitCostPrice).toDecimalPlaces(2);
      const gross = qty.mul(unitCost).toDecimalPlaces(2);

      const lineTax =
        l.taxAmount !== undefined
          ? new Prisma.Decimal(l.taxAmount).toDecimalPlaces(2)
          : l.taxRatePercent !== undefined
            ? gross.mul(l.taxRatePercent).div(100).toDecimalPlaces(2)
            : new Prisma.Decimal(0);

      const lineDiscount = new Prisma.Decimal(l.discountAmount ?? 0).toDecimalPlaces(2);
      if (lineDiscount.gt(gross.plus(lineTax))) {
        throw ApiError.badRequest(
          'VALIDATION_ERROR',
          `خصم البند (${l.itemName}) يتجاوز إجمالي قيمة البند.`,
        );
      }

      const totalLineCost = gross.plus(lineTax).minus(lineDiscount).toDecimalPlaces(2);
      const baseUnit = (l.baseUnit?.trim() || l.unit.trim());
      assertValidQuantityForUnit(baseUnit, baseQty);

      return {
        raw: l,
        cf,
        qty,
        baseQty,
        unitCost,
        lineTax,
        lineDiscount,
        totalLineCost,
        baseUnit,
      };
    });

    const subtotal = preliminary
      .reduce((s, x) => s.plus(x.totalLineCost), new Prisma.Decimal(0))
      .toDecimalPlaces(2);
    const headerTax = new Prisma.Decimal(headerTaxNum).toDecimalPlaces(2);
    const headerDiscount = new Prisma.Decimal(headerDiscountNum).toDecimalPlaces(2);

    if (headerDiscount.gt(subtotal.plus(headerTax))) {
      throw ApiError.badRequest('VALIDATION_ERROR', 'خصم الفاتورة الإجمالي يتجاوز قيمة الفاتورة.');
    }

    const totalAmount = subtotal.plus(headerTax).minus(headerDiscount).toDecimalPlaces(2);
    if (totalAmount.lte(0)) {
      throw ApiError.badRequest('VALIDATION_ERROR', 'صافي قيمة فاتورة الشراء يجب أن يكون أكبر من صفر.');
    }

    const netHeaderAdjustment = headerTax.minus(headerDiscount);

    const lines: ComputedLine[] = preliminary.map((p) => {
      const share = subtotal.gt(0)
        ? netHeaderAdjustment.mul(p.totalLineCost).div(subtotal)
        : new Prisma.Decimal(0);
      const netLineTotal = p.totalLineCost.plus(share);
      const effectiveBaseUnitCost = Prisma.Decimal.max(
        new Prisma.Decimal(0),
        netLineTotal.div(p.baseQty).toDecimalPlaces(2),
      );

      return {
        itemId: p.raw.itemId,
        itemName: p.raw.itemName.trim(),
        unit: p.raw.unit.trim(),
        baseUnit: p.baseUnit,
        conversionFactor: p.cf,
        quantity: p.qty,
        baseQuantity: p.baseQty,
        unitCostPrice: p.unitCost,
        taxAmount: p.lineTax,
        discountAmount: p.lineDiscount,
        totalLineCost: p.totalLineCost,
        effectiveBaseUnitCost,
        sellPrice: new Prisma.Decimal(p.raw.sellPrice).toDecimalPlaces(2),
        emergencyPriceMode: p.raw.emergencyPriceMode,
        emergencyPricePlusFixed:
          p.raw.emergencyPricePlusFixed !== undefined
            ? new Prisma.Decimal(p.raw.emergencyPricePlusFixed).toDecimalPlaces(2)
            : undefined,
        emergencyPricePlusPercent:
          p.raw.emergencyPricePlusPercent !== undefined
            ? new Prisma.Decimal(p.raw.emergencyPricePlusPercent).toDecimalPlaces(2)
            : undefined,
        emergencyPriceMin:
          p.raw.emergencyPriceMin !== undefined
            ? new Prisma.Decimal(p.raw.emergencyPriceMin).toDecimalPlaces(2)
            : undefined,
        emergencyPriceMax:
          p.raw.emergencyPriceMax !== undefined
            ? new Prisma.Decimal(p.raw.emergencyPriceMax).toDecimalPlaces(2)
            : undefined,
      };
    });

    return { lines, subtotal, headerTax, headerDiscount, totalAmount };
  }

  private async validateAndResolvePayment(
    storeOwnerId: string,
    paymentType: PurchasePaymentType,
    totalAmount: Prisma.Decimal,
    paidInput?: number,
    walletId?: string,
  ): Promise<{
    paidAmount: Prisma.Decimal;
    remainingAmount: Prisma.Decimal;
    walletAccountCode: string;
  }> {
    let walletAccountCode = '1100';
    if (paymentType === 'ELECTRONIC' || (paymentType === 'PARTIAL' && walletId)) {
      if (!walletId) {
        throw ApiError.badRequest(
          'VALIDATION_ERROR',
          'اختيار المحفظة الإلكترونية إلزامي عند الدفع الإلكتروني.',
        );
      }
      const wallet = await this.prisma.wallet.findFirst({
        where: { id: walletId, storeOwnerId, isActive: true },
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

    if (paymentType === 'CASH' || paymentType === 'ELECTRONIC') {
      return {
        paidAmount: totalAmount,
        remainingAmount: new Prisma.Decimal(0),
        walletAccountCode,
      };
    }

    if (paymentType === 'CREDIT') {
      return {
        paidAmount: new Prisma.Decimal(0),
        remainingAmount: totalAmount,
        walletAccountCode,
      };
    }

    // PARTIAL
    if (paidInput === undefined || paidInput <= 0) {
      throw ApiError.badRequest(
        'VALIDATION_ERROR',
        'عند اختيار الدفع الجزئي يجب إدخال مبلغ مدفوع أكبر من صفر.',
      );
    }
    const paidAmount = new Prisma.Decimal(paidInput).toDecimalPlaces(2);
    if (paidAmount.gte(totalAmount)) {
      throw ApiError.badRequest(
        'VALIDATION_ERROR',
        'في الدفع الجزئي يجب أن يكون المبلغ المدفوع أقل من إجمالي الفاتورة.',
      );
    }

    return {
      paidAmount,
      remainingAmount: totalAmount.minus(paidAmount).toDecimalPlaces(2),
      walletAccountCode,
    };
  }

  private async applyInventoryAndCostingForLines(
    tx: Prisma.TransactionClient,
    params: {
      storeOwnerId: string;
      invoiceDate: Date;
      lines: ComputedLine[];
      costingMethod: CostingMethod;
      explicitCostingProvided: boolean;
      promptOnSameDayPriceDiff: boolean;
      defaultEmergencyMode: EmergencyPriceMode;
    },
  ): Promise<string[]> {
    const {
      storeOwnerId,
      invoiceDate,
      lines,
      costingMethod,
      explicitCostingProvided,
      promptOnSameDayPriceDiff,
      defaultEmergencyMode,
    } = params;

    const resolvedIds: string[] = [];
    const conflicts: Array<Record<string, unknown>> = [];

    for (const line of lines) {
      let lockedItem:
        | {
            id: string;
            name: string;
            unit: string;
            quantity: Prisma.Decimal;
            cost_price: Prisma.Decimal;
            sell_price: Prisma.Decimal;
            entry_date: Date;
            deleted_at: Date | null;
          }
        | undefined;

      if (line.itemId) {
        const rows = await tx.$queryRaw<
          Array<{
            id: string;
            name: string;
            unit: string;
            quantity: Prisma.Decimal;
            cost_price: Prisma.Decimal;
            sell_price: Prisma.Decimal;
            entry_date: Date;
            deleted_at: Date | null;
          }>
        >(Prisma.sql`SELECT id, name, unit, quantity, cost_price, sell_price, entry_date, deleted_at
                     FROM items
                     WHERE id = ${line.itemId}::uuid AND store_owner_id = ${storeOwnerId}::uuid
                     FOR UPDATE`);
        lockedItem = rows[0];
        if (!lockedItem || lockedItem.deleted_at) {
          throw ApiError.notFound(`الصنف (${line.itemName}) غير موجود.`);
        }
      } else {
        const rows = await tx.$queryRaw<
          Array<{
            id: string;
            name: string;
            unit: string;
            quantity: Prisma.Decimal;
            cost_price: Prisma.Decimal;
            sell_price: Prisma.Decimal;
            entry_date: Date;
            deleted_at: Date | null;
          }>
        >(Prisma.sql`SELECT id, name, unit, quantity, cost_price, sell_price, entry_date, deleted_at
                     FROM items
                     WHERE store_owner_id = ${storeOwnerId}::uuid
                       AND deleted_at IS NULL
                       AND name = ${line.itemName}
                       AND unit = ${line.baseUnit}
                       AND entry_date = ${invoiceDate}::date
                     ORDER BY created_at ASC
                     LIMIT 1
                     FOR UPDATE`);
        lockedItem = rows[0];
      }

      if (lockedItem) {
        const isSameDay = sameCalendarDay(lockedItem.entry_date, invoiceDate);
        const hasStock = lockedItem.quantity.gt(0);
        const isPriceDifferent = !lockedItem.cost_price.eq(line.effectiveBaseUnitCost);

        // 1) قاعدة صلاحية القات (24-48 ساعة): إذا كان الرصيد المتبقي صفراً أو في يوم مختلف، اعتمد السعر الجديد تلقائياً دون مطالبة
        let nextCostPrice = line.effectiveBaseUnitCost;

        if (isSameDay && hasStock && isPriceDifferent) {
          if (promptOnSameDayPriceDiff && !explicitCostingProvided) {
            const totalQty = lockedItem.quantity.plus(line.baseQuantity);
            const weightedAvg = lockedItem.quantity
              .mul(lockedItem.cost_price)
              .plus(line.baseQuantity.mul(line.effectiveBaseUnitCost))
              .div(totalQty)
              .toDecimalPlaces(2);

            conflicts.push({
              item_id: lockedItem.id,
              item_name: line.itemName,
              base_unit: line.baseUnit,
              existing_quantity: Number(lockedItem.quantity),
              old_cost_price: Number(lockedItem.cost_price),
              new_quantity: Number(line.baseQuantity),
              new_cost_price: Number(line.effectiveBaseUnitCost),
              weighted_average_preview: Number(weightedAvg),
            });
            continue;
          }

          if (costingMethod === 'WEIGHTED_AVERAGE') {
            const totalQty = lockedItem.quantity.plus(line.baseQuantity);
            nextCostPrice = lockedItem.quantity
              .mul(lockedItem.cost_price)
              .plus(line.baseQuantity.mul(line.effectiveBaseUnitCost))
              .div(totalQty)
              .toDecimalPlaces(2);
          } else if (costingMethod === 'LAST_PRICE') {
            nextCostPrice = line.effectiveBaseUnitCost;
          } else if (costingMethod === 'FIFO') {
            // في FIFO تبقى تكلفة الصنف الفعالة مساوية لتكلفة أقدم دفعة غير مستهلكة حالياً، وتُستهلك الدفعات بالترتيب عند البيع
            nextCostPrice = lockedItem.cost_price;
          }
        } else if (!hasStock) {
          // تصفير أي طبقات FIFO قديمة متبقية إن كان الصنف قد نفد تماماً
          await tx.purchaseItem.updateMany({
            where: { storeOwnerId, itemId: lockedItem.id, remainingFifoQty: { gt: 0 } },
            data: { remainingFifoQty: new Prisma.Decimal(0) },
          });
        }

        await tx.item.update({
          where: { id: lockedItem.id },
          data: {
            quantity: { increment: line.baseQuantity },
            costPrice: nextCostPrice,
            sellPrice: line.sellPrice,
            ...(line.emergencyPriceMode !== undefined
              ? { emergencyPriceMode: line.emergencyPriceMode }
              : {}),
            ...(line.emergencyPricePlusFixed !== undefined
              ? { emergencyPricePlusFixed: line.emergencyPricePlusFixed }
              : {}),
            ...(line.emergencyPricePlusPercent !== undefined
              ? { emergencyPricePlusPercent: line.emergencyPricePlusPercent }
              : {}),
            ...(line.emergencyPriceMin !== undefined
              ? { emergencyPriceMin: line.emergencyPriceMin }
              : {}),
            ...(line.emergencyPriceMax !== undefined
              ? { emergencyPriceMax: line.emergencyPriceMax }
              : {}),
          },
        });

        resolvedIds.push(lockedItem.id);
      } else {
        // صنف يومي جديد كلياً — يُعتمد سعر الشراء الفعلي مباشرة
        const createdItem = await tx.item.create({
          data: {
            storeOwnerId,
            name: line.itemName,
            unit: line.baseUnit,
            quantity: line.baseQuantity,
            costPrice: line.effectiveBaseUnitCost,
            sellPrice: line.sellPrice,
            entryDate: invoiceDate,
            emergencyPriceMode: line.emergencyPriceMode ?? defaultEmergencyMode,
            emergencyPricePlusFixed: line.emergencyPricePlusFixed ?? null,
            emergencyPricePlusPercent: line.emergencyPricePlusPercent ?? null,
            emergencyPriceMin: line.emergencyPriceMin ?? null,
            emergencyPriceMax: line.emergencyPriceMax ?? null,
          },
        });
        resolvedIds.push(createdItem.id);
      }
    }

    if (conflicts.length > 0) {
      throw ApiError.conflict(
        'COSTING_METHOD_REQUIRED',
        'تم رصد اختلاف في سعر الشراء لنفس الصنف في نفس اليوم مع وجود كمية متبقية. الرجاء اختيار طريقة احتساب التكلفة.',
        {
          conflicts,
          costing_options: COSTING_OPTIONS_AR,
        },
      );
    }

    return resolvedIds;
  }

  private async createPurchaseJournalEntries(
    tx: Prisma.TransactionClient,
    params: {
      storeOwnerId: string;
      entryDate: Date;
      invoiceId: string;
      invoiceNumber: string;
      supplierName: string;
      totalAmount: Prisma.Decimal;
      paidAmount: Prisma.Decimal;
      remainingAmount: Prisma.Decimal;
      paymentType: PurchasePaymentType;
      walletId?: string;
      walletAccountCode: string;
    },
  ) {
    if (params.totalAmount.lte(0)) return;

    const lines: Array<{ accountCode: string; debit?: number; credit?: number; description: string }> = [
      {
        accountCode: '1300',
        debit: params.totalAmount.toNumber(),
        description: `توريد مشتريات بفاتورة ${params.invoiceNumber} من ${params.supplierName}`,
      },
    ];

    if (params.paidAmount.gt(0)) {
      const creditAcc = params.walletId ? params.walletAccountCode : '1000';
      lines.push({
        accountCode: creditAcc,
        credit: params.paidAmount.toNumber(),
        description: `المسدد على فاتورة شراء ${params.invoiceNumber}`,
      });
    }

    if (params.remainingAmount.gt(0)) {
      lines.push({
        accountCode: '2000',
        credit: params.remainingAmount.toNumber(),
        description: `ذمة دائنة للمورد (${params.supplierName}) عن فاتورة ${params.invoiceNumber}`,
      });
    }

    await this.accounting.createBalancedEntries(tx, {
      storeOwnerId: params.storeOwnerId,
      entryDate: params.entryDate,
      referenceType: 'PURCHASE',
      referenceId: params.invoiceId,
      lines,
    });
  }

  private async assertDayNotClosedForCash(
    tx: Prisma.TransactionClient,
    storeOwnerId: string,
    invoiceDate: Date,
    paymentType: PurchasePaymentType,
    paidAmount: Prisma.Decimal,
    walletId?: string,
    actorWorkerId?: string | null,
  ) {
    // حتى لفواتير الآجل نتحقق من عدم اعتماد إغلاق اليوم لضمان قفل كافة عمليات اليوم المالية بعد الإغلاق
    const closed = await tx.dailyClosing.findFirst({
      where: {
        storeOwnerId,
        closingDate: invoiceDate,
        status: 'CLOSED',
        OR: [{ workerId: null }, ...(actorWorkerId ? [{ workerId: actorWorkerId }] : [])],
      },
    });
    if (closed) {
      throw ApiError.conflict(
        'DAY_ALREADY_CLOSED',
        'تم اعتماد الإغلاق اليومي مسبقاً ولا يمكن تسجيل فواتير شراء جديدة لهذا اليوم.',
      );
    }
  }

  private async generateInvoiceNumber(
    tx: Prisma.TransactionClient,
    storeOwnerId: string,
    invoiceDate: Date,
  ): Promise<string> {
    const count = await tx.purchaseInvoice.count({ where: { storeOwnerId } });
    const ymd = invoiceDate.toISOString().split('T')[0].replace(/-/g, '');
    const seq = String(count + 1).padStart(4, '0');
    const candidate = `PUR-${ymd}-${seq}`;
    const exists = await tx.purchaseInvoice.findUnique({
      where: { storeOwnerId_invoiceNumber: { storeOwnerId, invoiceNumber: candidate } },
      select: { id: true },
    });
    if (!exists) return candidate;
    return `PUR-${ymd}-${seq}-${Math.floor(100 + Math.random() * 900)}`;
  }

  private async getDefaultEmergencyMode(): Promise<EmergencyPriceMode> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: 'default_emergency_price_mode' },
    });
    const raw: unknown = setting?.value;
    const value = typeof raw === 'object' && raw !== null ? (raw as { v?: unknown }).v : raw;
    if (value === 'COST_ONLY' || value === 'COST_PLUS' || value === 'RANGE_OR_OPEN') return value;
    return 'RANGE_OR_OPEN';
  }
}

function serializeInvoiceDetail(inv: {
  id: string;
  invoiceNumber: string;
  supplierInvoiceRef: string | null;
  invoiceDate: Date;
  dueDate: Date | null;
  paymentType: string;
  subtotal: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  settledAmount: Prisma.Decimal;
  remainingAmount: Prisma.Decimal;
  currency: 'YER' | 'SAR' | 'USD';
  attachmentUrl: string | null;
  notes: string | null;
  status: string;
  costingMethodUsed: string;
  postedAt: Date | null;
  voidedAt: Date | null;
  voidReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  supplier: { id: string; name: string; phone: string | null; currentBalance: Prisma.Decimal };
  wallet: { id: string; name: string } | null;
  items: Array<{
    id: string;
    itemId: string | null;
    itemName: string;
    baseUnit: string;
    unit: string;
    conversionFactor: Prisma.Decimal;
    quantity: Prisma.Decimal;
    baseQuantity: Prisma.Decimal;
    unitCostPrice: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    discountAmount: Prisma.Decimal;
    totalLineCost: Prisma.Decimal;
    effectiveBaseUnitCost: Prisma.Decimal;
    sellPrice: Prisma.Decimal;
    remainingFifoQty: Prisma.Decimal;
    returnedQuantity: Prisma.Decimal;
  }>;
  payments: Array<{
    id: string;
    amount: Prisma.Decimal;
    paymentMethod: string;
    paidAt: Date;
    notes: string | null;
  }>;
  returns: Array<{
    id: string;
    purchaseItemId: string;
    itemId: string;
    quantity: Prisma.Decimal;
    baseQuantity: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
    totalAmount: Prisma.Decimal;
    refundMethod: string;
    reason: string;
    returnedAt: Date;
    item: { name: string };
  }>;
}) {
  return {
    id: inv.id,
    invoice_number: inv.invoiceNumber,
    supplier_invoice_ref: inv.supplierInvoiceRef,
    invoice_date: inv.invoiceDate,
    due_date: inv.dueDate,
    supplier: {
      id: inv.supplier.id,
      name: inv.supplier.name,
      phone: inv.supplier.phone,
      current_balance: Number(inv.supplier.currentBalance),
    },
    payment_type: inv.paymentType,
    wallet: inv.wallet,
    subtotal: Number(inv.subtotal),
    tax_amount: Number(inv.taxAmount),
    discount_amount: Number(inv.discountAmount),
    total_amount: Number(inv.totalAmount),
    paid_amount: Number(inv.paidAmount),
    settled_amount: Number(inv.settledAmount),
    remaining_amount: Number(inv.remainingAmount),
    currency: inv.currency,
    currency_symbol: CURRENCY_METADATA[inv.currency].symbol,
    attachment_url: inv.attachmentUrl,
    notes: inv.notes,
    status: inv.status,
    costing_method_used: inv.costingMethodUsed,
    posted_at: inv.postedAt,
    voided_at: inv.voidedAt,
    void_reason: inv.voidReason,
    created_at: inv.createdAt,
    updated_at: inv.updatedAt,
    items: inv.items.map((it) => ({
      id: it.id,
      item_id: it.itemId,
      item_name: it.itemName,
      base_unit: it.baseUnit,
      unit: it.unit,
      conversion_factor: Number(it.conversionFactor),
      quantity: Number(it.quantity),
      base_quantity: Number(it.baseQuantity),
      unit_cost_price: Number(it.unitCostPrice),
      tax_amount: Number(it.taxAmount),
      discount_amount: Number(it.discountAmount),
      total_line_cost: Number(it.totalLineCost),
      effective_base_unit_cost: Number(it.effectiveBaseUnitCost),
      sell_price: Number(it.sellPrice),
      remaining_fifo_qty: Number(it.remainingFifoQty),
      returned_quantity: Number(it.returnedQuantity),
    })),
    payments: inv.payments.map((p) => ({
      id: p.id,
      amount: Number(p.amount),
      payment_method: p.paymentMethod,
      notes: p.notes,
      paid_at: p.paidAt,
    })),
    returns: inv.returns.map((r) => ({
      id: r.id,
      purchase_item_id: r.purchaseItemId,
      item_id: r.itemId,
      item_name: r.item.name,
      quantity: Number(r.quantity),
      base_quantity: Number(r.baseQuantity),
      unit_price: Number(r.unitPrice),
      total_amount: Number(r.totalAmount),
      refund_method: r.refundMethod,
      reason: r.reason,
      returned_at: r.returnedAt,
    })),
  };
}

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function parseDateOnly(s: string): Date {
  const d = new Date(s);
  if (isNaN(d.getTime())) throw ApiError.badRequest('VALIDATION_ERROR', 'صيغة التاريخ غير صالحة.');
  d.setHours(0, 0, 0, 0);
  return d;
}

function sameCalendarDay(a: Date, b: Date): boolean {
  return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
}
