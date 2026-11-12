import { Injectable } from '@nestjs/common';
import {
  PaymentType,
  Prisma,
  RejectionReasonCode,
  RejectedStatus,
  ResolutionAction,
  StoreOwnerStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import { AccountStatusGuard } from '../common/account-status.guard';
import { assertValidQuantityForUnit, isKiloUnit, isWeightUnit } from '../common/unit-validation';
import { ResolveRejectedTransactionDto } from './dto/rejected-transactions.dto';

// خدمة العمليات المرفوضة — API_SPEC القسم 11 / R-30
@Injectable()
export class RejectedTransactionsService {
  // عتبة تحذير التجربة (BR-041) — تُقرأ ديناميكياً من system_settings مع قيمة احتياطية 30
  private trialWarningThreshold = 30;

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
    private readonly audit: AuditService,
  ) {}

  async list(storeOwnerId: string, status?: RejectedStatus) {
    const records = await this.prisma.rejectedTransaction.findMany({
      where: {
        storeOwnerId,
        ...(status && { status }),
      },
      orderBy: { createdAt: 'desc' },
    });

    const workerIds = records.map((r) => r.workerId).filter(Boolean) as string[];
    const workers = await this.prisma.worker.findMany({
      where: { id: { in: workerIds } },
      select: { id: true, fullName: true },
    });
    const workerMap = new Map(workers.map((w) => [w.id, w.fullName]));

    return records.map((r) => ({
      id: r.id,
      worker_id: r.workerId,
      worker_name: r.workerId ? workerMap.get(r.workerId) ?? null : null,
      attempted_payload: r.attemptedPayload,
      rejection_reason_code: r.rejectionReasonCode,
      rejection_reason_detail: r.rejectionReasonDetail,
      status: r.status,
      resolution_action: r.resolutionAction,
      adjusted_quantity: r.adjustedQuantity ? Number(r.adjustedQuantity) : null,
      resolved_by: r.resolvedBy,
      resolved_at: r.resolvedAt,
      created_at: r.createdAt,
    }));
  }

  async getOne(storeOwnerId: string, id: string) {
    const record = await this.prisma.rejectedTransaction.findFirst({
      where: { id, storeOwnerId },
    });
    if (!record) throw ApiError.notFound('العملية المرفوضة غير موجودة.');
    return record;
  }

  async resolve(
    storeOwnerId: string,
    id: string,
    dto: ResolveRejectedTransactionDto,
    ip?: string,
  ) {
    const record = await this.getOne(storeOwnerId, id);

    if (record.status === RejectedStatus.RESOLVED) {
      throw ApiError.conflict('VALIDATION_ERROR', 'تمت معالجة هذه العملية المرفوضة مسبقاً.');
    }

    // التحقق الصارم من مطابقة خيار المعالجة لسبب الرفض (R-30 / API_SPEC §11)
    if (record.rejectionReasonCode === RejectionReasonCode.CREDIT_LIMIT_EXCEEDED) {
      if (
        dto.resolutionAction !== ResolutionAction.POST_AS_LOSS &&
        dto.resolutionAction !== ResolutionAction.ADD_CREDIT
      ) {
        throw ApiError.badRequest(
          'DISALLOWED_RESOLUTION_ACTION',
          'الإجراء المختار غير مسموح لسبب تجاوز سقف الائتمان (المسموح: POST_AS_LOSS أو ADD_CREDIT).',
        );
      }
    } else if (record.rejectionReasonCode === RejectionReasonCode.INSUFFICIENT_STOCK) {
      if (
        dto.resolutionAction !== ResolutionAction.APPROVE_ADJUSTED_QTY &&
        dto.resolutionAction !== ResolutionAction.APPROVE_NEGATIVE_STOCK &&
        dto.resolutionAction !== ResolutionAction.FINAL_REJECT
      ) {
        throw ApiError.badRequest(
          'DISALLOWED_RESOLUTION_ACTION',
          'الإجراء المختار غير مسموح لسبب نقص المخزون (المسموح: APPROVE_ADJUSTED_QTY أو APPROVE_NEGATIVE_STOCK أو FINAL_REJECT).',
        );
      }
      if (dto.resolutionAction === ResolutionAction.APPROVE_ADJUSTED_QTY) {
        if (!dto.adjustedQuantity || dto.adjustedQuantity <= 0) {
          throw ApiError.badRequest(
            'VALIDATION_ERROR',
            'الكمية المصححة مطلوبة وأكبر من صفر عند اختيار الموافقة بالكمية المصححة.',
          );
        }
      }
    }

    const ownerSettings = await this.prisma.storeOwner.findUniqueOrThrow({
      where: { id: storeOwnerId },
      select: { defaultCostingMethod: true },
    });
    const warningThreshold = await this.getTrialWarningThreshold();

    const result = await this.prisma.$transaction(async (tx) => {
      // قفل صف العملية المرفوضة ذرّياً لمنع التكرار عند الطلبات المتزامنة (Idempotency)
      const lockedRecords = await tx.$queryRaw<
        Array<{
          id: string;
          status: string;
          worker_id: string | null;
          rejection_reason_code: string;
          attempted_payload: any;
        }>
      >(
        Prisma.sql`SELECT id, status::text AS status, worker_id,
                          rejection_reason_code::text AS rejection_reason_code,
                          attempted_payload
                   FROM rejected_transactions
                   WHERE id = ${id}::uuid
                     AND store_owner_id = ${storeOwnerId}::uuid
                   FOR UPDATE`,
      );
      const lockedRecord = lockedRecords[0];
      if (!lockedRecord) {
        throw ApiError.notFound('العملية المرفوضة غير موجودة.');
      }
      if (lockedRecord.status === RejectedStatus.RESOLVED) {
        throw ApiError.conflict('VALIDATION_ERROR', 'تمت معالجة هذه العملية المرفوضة مسبقاً.');
      }

      const payload = (lockedRecord.attempted_payload ?? record.attemptedPayload ?? {}) as Record<string, any>;
      let createdSaleId: string | null = null;
      const entryDate = startOfDay(new Date());

      if (dto.resolutionAction === ResolutionAction.FINAL_REJECT) {
        // رفض نهائي دون أي قيد أو تعديل مخزون
      } else {
        if (!payload.itemId) {
          throw ApiError.badRequest('VALIDATION_ERROR', 'معرّف الصنف مفقود في بيانات العملية.');
        }

        // قفل صف الصنف ذرّياً (BR-073) وفحص عدم الحذف
        const lockedItems = await tx.$queryRaw<
          Array<{
            id: string;
            name: string;
            unit: string;
            quantity: Prisma.Decimal;
            cost_price: Prisma.Decimal;
            sell_price: Prisma.Decimal;
            deleted_at: Date | null;
          }>
        >(
          Prisma.sql`SELECT id, name, unit, quantity, cost_price, sell_price, deleted_at
                     FROM items
                     WHERE id = ${String(payload.itemId)}::uuid
                       AND store_owner_id = ${storeOwnerId}::uuid
                     FOR UPDATE`,
        );
        const item = lockedItems[0];
        if (!item || item.deleted_at) {
          throw ApiError.notFound('الصنف المرتبط بالعملية لم يعد موجوداً.');
        }

        const origQty = this.resolveBaseQuantity(payload.quantity, payload.quantityUnit, item.unit);
        const origAmt = new Prisma.Decimal(payload.amount ?? 0);
        if (origAmt.lte(0)) {
          throw ApiError.badRequest('VALIDATION_ERROR', 'مبلغ العملية يجب أن يكون أكبر من صفر.');
        }

        if (dto.resolutionAction === ResolutionAction.ADD_CREDIT) {
          // اعتماد كدين رغم تجاوز السقف (بموافقة المالك — R-30)
          const customer = await this.mustGetCreditCustomer(tx, storeOwnerId, payload.creditCustomerId);

          if (origQty.gt(item.quantity)) {
            throw ApiError.conflict('INSUFFICIENT_STOCK', 'الكمية المتوفرة غير كافية.', {
              available: item.quantity.toString(),
            });
          }

          const cogs = await this.consumeFifoAndComputeCogs(
            tx,
            storeOwnerId,
            item,
            origQty,
            ownerSettings.defaultCostingMethod,
          );

          await tx.item.update({
            where: { id: item.id },
            data: { quantity: { decrement: origQty } },
          });

          const actualUnitPrice = origAmt.div(origQty);
          const { isEmergency, emergencyReason, overridePrice, priceDiffLoss } =
            this.resolveEmergencyFields(payload, item.sell_price, origQty, actualUnitPrice);

          const sale = await tx.sale.create({
            data: {
              storeOwnerId,
              workerId: lockedRecord.worker_id,
              itemId: item.id,
              quantity: origQty,
              amount: origAmt,
              cogsAmount: cogs,
              paymentType: PaymentType.CREDIT,
              creditCustomerId: customer.id,
              isEmergencySale: isEmergency,
              emergencyReason,
              emergencyOverridePrice: overridePrice,
              priceDifferenceLoss: priceDiffLoss,
              soldAt: new Date(),
            },
          });
          createdSaleId = sale.id;

          await this.accounting.createBalancedEntries(tx, {
            storeOwnerId,
            entryDate,
            referenceType: 'REJECTED_TRANSACTION_RESOLUTION',
            referenceId: record.id,
            lines: this.buildSaleLedgerLines({
              debitAccount: '1200',
              amount: origAmt,
              cogs,
              isEmergency,
              emergencyReason,
              priceDiffLoss,
              normalRevenueAmount: origAmt.plus(priceDiffLoss).toDecimalPlaces(2),
              saleDescription: 'قيد آجل بعد حل العملية المرفوضة',
            }),
          });
        } else if (dto.resolutionAction === ResolutionAction.POST_AS_LOSS) {
          // ترحيل كخسارة
          if (origQty.gt(item.quantity)) {
            throw ApiError.conflict('INSUFFICIENT_STOCK', 'الكمية المتوفرة غير كافية.', {
              available: item.quantity.toString(),
            });
          }

          const cogs = await this.consumeFifoAndComputeCogs(
            tx,
            storeOwnerId,
            item,
            origQty,
            ownerSettings.defaultCostingMethod,
          );

          await tx.item.update({
            where: { id: item.id },
            data: { quantity: { decrement: origQty } },
          });

          if (cogs.gt(0)) {
            await this.accounting.createBalancedEntries(tx, {
              storeOwnerId,
              entryDate,
              referenceType: 'REJECTED_TRANSACTION_RESOLUTION',
              referenceId: record.id,
              lines: [
                { accountCode: '5450', debit: Number(cogs), description: 'ترحيل بضاعة عملية مرفوضة كخسائر' },
                { accountCode: '1300', credit: Number(cogs), description: 'خصم المخزون المنصرف كخسائر' },
              ],
            });
          }
        } else if (dto.resolutionAction === ResolutionAction.APPROVE_ADJUSTED_QTY) {
          // اعتماد بالكمية المصححة
          const adjQty = new Prisma.Decimal(dto.adjustedQuantity!).toDecimalPlaces(3);
          assertValidQuantityForUnit(item.unit, adjQty);

          if (adjQty.gt(item.quantity)) {
            throw ApiError.conflict('INSUFFICIENT_STOCK', 'الكمية المصححة تتجاوز الكمية المتوفرة في المخزون.', {
              available: item.quantity.toString(),
            });
          }

          const unitPrice = origAmt.div(origQty);
          const newAmt = adjQty.mul(unitPrice).toDecimalPlaces(2);
          const paymentType = ((payload.paymentType as string) ?? 'CASH') as PaymentType;

          const { debitAccount, walletId, depositAttachmentUrl, creditCustomerId } =
            await this.validateAndResolveSalePayment(tx, storeOwnerId, paymentType, payload, newAmt);

          const cogs = await this.consumeFifoAndComputeCogs(
            tx,
            storeOwnerId,
            item,
            adjQty,
            ownerSettings.defaultCostingMethod,
          );

          await tx.item.update({
            where: { id: item.id },
            data: { quantity: { decrement: adjQty } },
          });

          const { isEmergency, emergencyReason, overridePrice, priceDiffLoss } =
            this.resolveEmergencyFields(payload, item.sell_price, adjQty, unitPrice);

          const sale = await tx.sale.create({
            data: {
              storeOwnerId,
              workerId: lockedRecord.worker_id,
              itemId: item.id,
              quantity: adjQty,
              amount: newAmt,
              cogsAmount: cogs,
              paymentType,
              walletId,
              depositAttachmentUrl,
              creditCustomerId,
              isEmergencySale: isEmergency,
              emergencyReason,
              emergencyOverridePrice: overridePrice,
              priceDifferenceLoss: priceDiffLoss,
              soldAt: new Date(),
            },
          });
          createdSaleId = sale.id;

          await this.accounting.createBalancedEntries(tx, {
            storeOwnerId,
            entryDate,
            referenceType: 'REJECTED_TRANSACTION_RESOLUTION',
            referenceId: record.id,
            lines: this.buildSaleLedgerLines({
              debitAccount,
              amount: newAmt,
              cogs,
              isEmergency,
              emergencyReason,
              priceDiffLoss,
              normalRevenueAmount: newAmt.plus(priceDiffLoss).toDecimalPlaces(2),
              saleDescription: 'مبيعات بالكمية المصححة',
            }),
          });
        } else if (dto.resolutionAction === ResolutionAction.APPROVE_NEGATIVE_STOCK) {
          // BR-004 & items_quantity_non_negative: قاعدة البيانات تمنع الرصيد السالب قطعياً CHECK (quantity >= 0)
          if (origQty.gt(item.quantity)) {
            throw ApiError.conflict(
              'INSUFFICIENT_STOCK',
              'لا يمكن خصم المخزون إلى السالب بسبب قيد عدم السالبية (BR-004 / items_quantity_non_negative)؛ يرجى تغذية رصيد الصنف أولاً أو الاعتماد بالكمية المصححة.',
              {
                available: item.quantity.toString(),
                requested: origQty.toString(),
              },
            );
          }

          const paymentType = ((payload.paymentType as string) ?? 'CASH') as PaymentType;
          const { debitAccount, walletId, depositAttachmentUrl, creditCustomerId } =
            await this.validateAndResolveSalePayment(tx, storeOwnerId, paymentType, payload, origAmt);

          const cogs = await this.consumeFifoAndComputeCogs(
            tx,
            storeOwnerId,
            item,
            origQty,
            ownerSettings.defaultCostingMethod,
          );

          await tx.item.update({
            where: { id: item.id },
            data: { quantity: { decrement: origQty } },
          });

          const actualUnitPrice = origAmt.div(origQty);
          const { isEmergency, emergencyReason, overridePrice, priceDiffLoss } =
            this.resolveEmergencyFields(payload, item.sell_price, origQty, actualUnitPrice);

          const sale = await tx.sale.create({
            data: {
              storeOwnerId,
              workerId: lockedRecord.worker_id,
              itemId: item.id,
              quantity: origQty,
              amount: origAmt,
              cogsAmount: cogs,
              paymentType,
              walletId,
              depositAttachmentUrl,
              creditCustomerId,
              isEmergencySale: isEmergency,
              emergencyReason,
              emergencyOverridePrice: overridePrice,
              priceDifferenceLoss: priceDiffLoss,
              soldAt: new Date(),
            },
          });
          createdSaleId = sale.id;

          await this.accounting.createBalancedEntries(tx, {
            storeOwnerId,
            entryDate,
            referenceType: 'REJECTED_TRANSACTION_RESOLUTION',
            referenceId: record.id,
            lines: this.buildSaleLedgerLines({
              debitAccount,
              amount: origAmt,
              cogs,
              isEmergency,
              emergencyReason,
              priceDiffLoss,
              normalRevenueAmount: origAmt.plus(priceDiffLoss).toDecimalPlaces(2),
              saleDescription: 'مبيعات معتمدة',
            }),
          });
        }
      }

      // 8) عدّاد التجربة: يُزاد فقط في المسارات التي تنشئ عملية بيع فعلية (createdSaleId !== null)
      //    بقفل صف المالك لمنع سباق العدّاد (BR-039 / BR-040)
      let accountStatus: string | null = null;
      if (createdSaleId !== null) {
        const lockedOwners = await tx.$queryRaw<
          Array<{ trial_sales_used: number; trial_sales_limit: number; status: string }>
        >(
          Prisma.sql`SELECT trial_sales_used, trial_sales_limit, status
                     FROM store_owners
                     WHERE id = ${storeOwnerId}::uuid
                     FOR UPDATE`,
        );
        const owner = lockedOwners[0];
        if (owner) {
          if (
            owner.status === 'TRIAL_EXPIRED' ||
            owner.status === 'EXPIRED' ||
            owner.status === 'SUSPENDED' ||
            ((owner.status === 'TRIAL' || owner.status === 'TRIAL_WARNING') &&
              owner.trial_sales_used >= owner.trial_sales_limit)
          ) {
            const reason =
              owner.status === 'EXPIRED'
                ? 'SUBSCRIPTION_EXPIRED'
                : owner.status === 'SUSPENDED'
                  ? 'ACCOUNT_SUSPENDED'
                  : 'TRIAL_EXPIRED';
            throw ApiError.locked(
              reason,
              'الحساب موقوف أو انتهت الفترة التجريبية ولا يمكن اعتماد عمليات بيع إضافية.',
            );
          }
          accountStatus = owner.status;
          if (owner.trial_sales_used < owner.trial_sales_limit) {
            const nextUsed = owner.trial_sales_used + 1;
            const remaining = owner.trial_sales_limit - nextUsed;
            let nextStatus: StoreOwnerStatus = owner.status as StoreOwnerStatus;
            if (nextUsed >= owner.trial_sales_limit) {
              nextStatus = 'TRIAL_EXPIRED'; // BR-042: قفل كامل فوري
            } else if (
              remaining <= warningThreshold &&
              (owner.status === 'TRIAL' || owner.status === 'TRIAL_WARNING')
            ) {
              nextStatus = 'TRIAL_WARNING'; // BR-041
            }
            await tx.storeOwner.update({
              where: { id: storeOwnerId },
              data: {
                trialSalesUsed: nextUsed,
                ...(nextStatus !== owner.status ? { status: nextStatus } : {}),
              },
              select: { id: true },
            });
            accountStatus = nextStatus;
          }
        }
      }

      const updated = await tx.rejectedTransaction.update({
        where: { id },
        data: {
          status: RejectedStatus.RESOLVED,
          resolutionAction: dto.resolutionAction,
          adjustedQuantity: dto.adjustedQuantity ? new Prisma.Decimal(dto.adjustedQuantity) : null,
          resolvedBy: storeOwnerId,
          resolvedAt: new Date(),
        },
      });

      return { updated, createdSaleId, accountStatus };
    });

    if (result.accountStatus === 'TRIAL_EXPIRED') {
      AccountStatusGuard.invalidateOwner(storeOwnerId);
    }

    await this.audit.log({
      actorType: 'STORE_OWNER',
      actorId: storeOwnerId,
      actionType: 'REJECTED_TRANSACTION_RESOLVE',
      targetType: 'rejected_transaction',
      targetId: id,
      newValue: {
        resolution_action: dto.resolutionAction,
        adjusted_quantity: dto.adjustedQuantity,
        created_sale_id: result.createdSaleId,
      },
      ipAddress: ip,
      result: 'SUCCESS',
    });

    return {
      id: result.updated.id,
      status: result.updated.status,
      resolution_action: result.updated.resolutionAction,
      adjusted_quantity: result.updated.adjustedQuantity ? Number(result.updated.adjustedQuantity) : null,
      resolved_at: result.updated.resolvedAt,
      created_sale_id: result.createdSaleId,
      account_status: result.accountStatus,
    };
  }

  private async consumeFifoAndComputeCogs(
    tx: Prisma.TransactionClient,
    storeOwnerId: string,
    item: { id: string; quantity: Prisma.Decimal; cost_price: Prisma.Decimal },
    quantityConsumed: Prisma.Decimal,
    _defaultCostingMethod?: string,
  ): Promise<Prisma.Decimal> {
    let cogs = item.cost_price.mul(quantityConsumed).toDecimalPlaces(2);
    const fifoLayers = await tx.$queryRaw<
      Array<{
        id: string;
        remaining_fifo_qty: Prisma.Decimal;
        effective_base_unit_cost: Prisma.Decimal;
      }>
    >(Prisma.sql`SELECT pi.id, pi.remaining_fifo_qty, pi.effective_base_unit_cost
                 FROM purchase_items pi
                 JOIN purchase_invoices pinv ON pinv.id = pi.purchase_invoice_id
                 WHERE pi.store_owner_id = ${storeOwnerId}::uuid
                   AND pi.item_id = ${item.id}::uuid
                   AND pi.remaining_fifo_qty > 0
                   AND pinv.status = 'POSTED'
                 ORDER BY pinv.invoice_date ASC, pinv.created_at ASC, pi.created_at ASC, pi.id ASC
                 FOR UPDATE OF pi`);

    if (fifoLayers.length > 0) {
      const totalLayeredQty = fifoLayers.reduce(
        (s, l) => s.plus(new Prisma.Decimal(l.remaining_fifo_qty)),
        new Prisma.Decimal(0),
      );
      const unlayeredOldestQty = Prisma.Decimal.max(
        new Prisma.Decimal(0),
        item.quantity.minus(totalLayeredQty),
      );

      let qtyToConsume = quantityConsumed;
      let fifoCostAcc = new Prisma.Decimal(0);
      let lastConsumedLayerCost = item.cost_price;

      if (unlayeredOldestQty.gt(0)) {
        const fromUnlayered = Prisma.Decimal.min(unlayeredOldestQty, qtyToConsume);
        fifoCostAcc = fifoCostAcc.plus(fromUnlayered.mul(item.cost_price));
        qtyToConsume = qtyToConsume.minus(fromUnlayered);
      }

      let nextFrontLayerCost: Prisma.Decimal | null = null;
      for (const layer of fifoLayers) {
        const layerRemQty = new Prisma.Decimal(layer.remaining_fifo_qty);
        const layerUnitCost = new Prisma.Decimal(layer.effective_base_unit_cost);
        if (qtyToConsume.gt(0)) {
          const consumed = Prisma.Decimal.min(layerRemQty, qtyToConsume);
          fifoCostAcc = fifoCostAcc.plus(consumed.mul(layerUnitCost));
          const remLayer = layerRemQty.minus(consumed);
          lastConsumedLayerCost = layerUnitCost;
          await tx.purchaseItem.update({
            where: { id: layer.id },
            data: { remainingFifoQty: remLayer },
          });
          qtyToConsume = qtyToConsume.minus(consumed);
          if (remLayer.gt(0) && nextFrontLayerCost === null) {
            nextFrontLayerCost = layerUnitCost;
          }
        } else if (nextFrontLayerCost === null) {
          nextFrontLayerCost = layerUnitCost;
        }
      }

      if (qtyToConsume.gt(0)) {
        fifoCostAcc = fifoCostAcc.plus(qtyToConsume.mul(item.cost_price));
      }

      cogs = fifoCostAcc.toDecimalPlaces(2);

      // إذا استُهلكت الدفعة الأقدم بالكامل، حدّث items.cost_price لتكلفة الدفعة النشطة التالية (أو آخر دفعة مستهلكة)
      const remainingUnlayered = unlayeredOldestQty.minus(
        Prisma.Decimal.min(unlayeredOldestQty, quantityConsumed),
      );
      if (remainingUnlayered.lte(0)) {
        const updatedActiveCost = nextFrontLayerCost ?? lastConsumedLayerCost;
        if (!updatedActiveCost.eq(item.cost_price)) {
          await tx.item.update({
            where: { id: item.id },
            data: { costPrice: updatedActiveCost },
          });
        }
      }
    }

    return cogs;
  }

  private async getTrialWarningThreshold(): Promise<number> {
    const setting = await this.prisma.systemSetting?.findUnique({
      where: { key: 'trial_warning_threshold' },
    });
    const raw: unknown = setting?.value;
    const value =
      typeof raw === 'object' && raw !== null && 'v' in raw ? (raw as { v?: unknown }).v : raw;
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? num : this.trialWarningThreshold;
  }

  private resolveBaseQuantity(
    rawQuantity: unknown,
    quantityUnit: unknown,
    itemUnit: string,
  ): Prisma.Decimal {
    const numQty = Number(rawQuantity);
    if (!Number.isFinite(numQty) || numQty <= 0) {
      throw ApiError.badRequest('VALIDATION_ERROR', 'الكمية يجب أن تكون أكبر من صفر.');
    }
    if (quantityUnit === 'GRAM') {
      if (Math.abs(numQty - Math.round(numQty)) > 1e-6) {
        throw ApiError.badRequest(
          'FRACTIONAL_GRAMS_NOT_ALLOWED',
          'الكمية بالجرام يجب أن تكون رقماً صحيحاً بدون كسور.',
        );
      }
      if (!isWeightUnit(itemUnit)) {
        throw ApiError.badRequest(
          'FRACTIONAL_GRAMS_NOT_ALLOWED',
          'لا يمكن استخدام الجرام مع صنف لا يُقاس بالوزن.',
        );
      }
      if (isKiloUnit(itemUnit)) {
        return new Prisma.Decimal(numQty).div(1000).toDecimalPlaces(3);
      }
      return new Prisma.Decimal(numQty).toDecimalPlaces(3);
    }

    const decQty = new Prisma.Decimal(numQty);
    assertValidQuantityForUnit(itemUnit, decQty);
    return decQty.toDecimalPlaces(3);
  }

  private resolveEmergencyFields(
    payload: Record<string, any>,
    sellPrice: Prisma.Decimal,
    quantity: Prisma.Decimal,
    actualUnitPrice: Prisma.Decimal,
  ) {
    const isEmergency = Boolean(payload.isEmergencySale);
    if (!isEmergency) {
      return {
        isEmergency: false,
        emergencyReason: null,
        overridePrice: null,
        priceDiffLoss: new Prisma.Decimal(0),
      };
    }

    const overridePrice = payload.emergencyOverridePrice
      ? new Prisma.Decimal(payload.emergencyOverridePrice).toDecimalPlaces(2)
      : actualUnitPrice.toDecimalPlaces(2);

    const priceDiffLoss = overridePrice.lt(sellPrice)
      ? sellPrice.minus(overridePrice).mul(quantity).toDecimalPlaces(2)
      : new Prisma.Decimal(0);

    return {
      isEmergency: true,
      emergencyReason: payload.emergencyReason ? String(payload.emergencyReason) : null,
      overridePrice,
      priceDiffLoss,
    };
  }

  private buildSaleLedgerLines(params: {
    debitAccount: string;
    amount: Prisma.Decimal;
    cogs: Prisma.Decimal;
    isEmergency: boolean;
    emergencyReason: string | null;
    priceDiffLoss: Prisma.Decimal;
    normalRevenueAmount: Prisma.Decimal;
    saleDescription: string;
  }) {
    const {
      debitAccount,
      amount,
      cogs,
      isEmergency,
      emergencyReason,
      priceDiffLoss,
      normalRevenueAmount,
      saleDescription,
    } = params;

    const lines =
      isEmergency && priceDiffLoss.gt(0)
        ? [
            { accountCode: debitAccount, debit: amount.toNumber(), description: `${saleDescription} (بيع اضطراري)` },
            {
              accountCode: '5450',
              debit: priceDiffLoss.toNumber(),
              description: `خسارة بيع اضطراري${emergencyReason ? `: ${emergencyReason}` : ''}`,
            },
            {
              accountCode: '4000',
              credit: normalRevenueAmount.toNumber(),
              description: 'مبيعات بالسعر العادي',
            },
          ]
        : [
            { accountCode: debitAccount, debit: amount.toNumber(), description: saleDescription },
            { accountCode: '4000', credit: amount.toNumber(), description: 'إيراد المبيعات' },
          ];

    if (cogs.gt(0)) {
      lines.push(
        { accountCode: '5000', debit: cogs.toNumber(), description: 'تكلفة البضاعة المباعة' },
        { accountCode: '1300', credit: cogs.toNumber(), description: 'خصم المخزون' },
      );
    }

    return lines;
  }

  private async mustGetCreditCustomer(
    tx: Prisma.TransactionClient,
    storeOwnerId: string,
    creditCustomerId: unknown,
  ) {
    const idStr = creditCustomerId ? String(creditCustomerId).trim() : '';
    if (!idStr) {
      throw ApiError.badRequest('VALIDATION_ERROR', 'اختيار عميل الآجل إلزامي عند الدفع بالآجل.');
    }
    const lockedCustomers = await tx.$queryRaw<
      Array<{
        id: string;
        name: string;
        credit_limit: Prisma.Decimal | null;
        deleted_at: Date | null;
      }>
    >(
      Prisma.sql`SELECT id, name, credit_limit, deleted_at
                 FROM credit_customers
                 WHERE id = ${idStr}::uuid
                   AND store_owner_id = ${storeOwnerId}::uuid
                 FOR UPDATE`,
    );
    const customer = lockedCustomers[0];
    if (!customer || customer.deleted_at) {
      throw ApiError.notFound('عميل الآجل غير موجود.');
    }
    return {
      id: customer.id,
      name: customer.name,
      creditLimit: customer.credit_limit,
    };
  }

  private async customerTotalDebt(
    tx: Prisma.TransactionClient,
    customerId: string,
  ): Promise<Prisma.Decimal> {
    const [aggSales, aggPayments, aggReturns] = await Promise.all([
      tx.sale.aggregate({
        where: { creditCustomerId: customerId, paymentType: 'CREDIT' },
        _sum: { amount: true },
      }),
      tx.creditPayment.aggregate({
        where: { creditCustomerId: customerId },
        _sum: { amount: true },
      }),
      tx.return.aggregate({
        where: { sale: { creditCustomerId: customerId, paymentType: 'CREDIT' } },
        _sum: { amount: true },
      }),
    ]);
    return (aggSales._sum.amount ?? new Prisma.Decimal(0))
      .minus(aggPayments._sum.amount ?? 0)
      .minus(aggReturns._sum.amount ?? 0);
  }

  private async validateAndResolveSalePayment(
    tx: Prisma.TransactionClient,
    storeOwnerId: string,
    paymentType: PaymentType,
    payload: Record<string, any>,
    saleAmount: Prisma.Decimal,
  ): Promise<{
    debitAccount: string;
    walletId: string | null;
    depositAttachmentUrl: string | null;
    creditCustomerId: string | null;
  }> {
    if (paymentType === PaymentType.ELECTRONIC) {
      const walletIdStr = payload.walletId ? String(payload.walletId).trim() : '';
      const attachmentStr = payload.depositAttachmentUrl
        ? String(payload.depositAttachmentUrl).trim()
        : '';
      if (!walletIdStr || !attachmentStr) {
        throw ApiError.badRequest(
          'MISSING_DEPOSIT_ATTACHMENT',
          'اختيار المحفظة ورفع صورة الإيداع إلزاميان عند الدفع الإلكتروني.',
        );
      }
      const wallet = await tx.wallet.findFirst({
        where: { id: walletIdStr, storeOwnerId, isActive: true },
        select: { id: true, name: true, accountCode: true },
      });
      if (!wallet) {
        throw ApiError.notFound('المحفظة غير موجودة.');
      }
      let debitAccount = wallet.accountCode ?? null;
      if (!debitAccount) {
        const walletAccount = await tx.chartOfAccount.findFirst({
          where: {
            storeOwnerId,
            accountType: 'ASSET',
            name: { startsWith: `محفظة: ${wallet.name}` },
          },
          select: { code: true },
        });
        debitAccount = walletAccount?.code ?? '1100';
      }
      return {
        debitAccount,
        walletId: wallet.id,
        depositAttachmentUrl: attachmentStr,
        creditCustomerId: null,
      };
    }

    if (paymentType === PaymentType.CREDIT) {
      const customer = await this.mustGetCreditCustomer(tx, storeOwnerId, payload.creditCustomerId);
      if (customer.creditLimit !== null) {
        const debts = await this.customerTotalDebt(tx, customer.id);
        if (debts.plus(saleAmount).gt(customer.creditLimit)) {
          throw ApiError.conflict(
            'CREDIT_LIMIT_EXCEEDED',
            'تجاوز المبلغ سقف ائتمان العميل المسموح.',
            { available_credit: customer.creditLimit.minus(debts).toString() },
          );
        }
      }
      return {
        debitAccount: '1200',
        walletId: null,
        depositAttachmentUrl: null,
        creditCustomerId: customer.id,
      };
    }

    return {
      debitAccount: '1000',
      walletId: null,
      depositAttachmentUrl: null,
      creditCustomerId: null,
    };
  }
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
