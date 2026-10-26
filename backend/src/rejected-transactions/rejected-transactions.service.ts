import { Injectable } from '@nestjs/common';
import { Prisma, RejectionReasonCode, RejectedStatus, ResolutionAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import { ResolveRejectedTransactionDto } from './dto/rejected-transactions.dto';

// خدمة العمليات المرفوضة — API_SPEC القسم 11 / R-30
@Injectable()
export class RejectedTransactionsService {
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

    const payload = record.attemptedPayload as any;

    const result = await this.prisma.$transaction(async (tx) => {
      let createdSaleId: string | null = null;

      if (dto.resolutionAction === ResolutionAction.FINAL_REJECT) {
        // رفض نهائي دون أي قيد أو تعديل مخزون
      } else {
        const item = await tx.item.findFirst({
          where: { id: payload.itemId, storeOwnerId },
        });
        if (!item) throw ApiError.notFound('الصنف المرتبط بالعملية لم يعد موجوداً.');

        if (dto.resolutionAction === ResolutionAction.ADD_CREDIT) {
          // اعتماد كدين رغم تجاوز السقف (بموافقة المالك)
          const qty = new Prisma.Decimal(payload.quantity);
          const amt = new Prisma.Decimal(payload.amount);

          await tx.$executeRaw(
            Prisma.sql`UPDATE items SET quantity = quantity - ${qty}, updated_at = now() WHERE id = ${item.id}::uuid`,
          );

          const sale = await tx.sale.create({
            data: {
              storeOwnerId,
              workerId: record.workerId,
              itemId: item.id,
              quantity: qty,
              amount: amt,
              paymentType: 'CREDIT',
              creditCustomerId: payload.creditCustomerId,
              isEmergencySale: payload.isEmergencySale ?? false,
              emergencyReason: payload.emergencyReason ?? null,
              emergencyOverridePrice: payload.emergencyOverridePrice
                ? new Prisma.Decimal(payload.emergencyOverridePrice)
                : null,
              soldAt: new Date(),
            },
          });
          createdSaleId = sale.id;

          const cogs = qty.mul(item.costPrice).toDecimalPlaces(2);
          await this.accounting.createBalancedEntries(tx, {
            storeOwnerId,
            entryDate: new Date(),
            referenceType: 'REJECTED_TRANSACTION_RESOLUTION',
            referenceId: record.id,
            lines: [
              { accountCode: '1200', debit: Number(amt), description: 'قيد آجل بعد حل العملية المرفوضة' },
              { accountCode: '4000', credit: Number(amt), description: 'مبيعات معتمدة بعد الرفض' },
              { accountCode: '5000', debit: Number(cogs), description: 'تكلفة البضاعة المباعة' },
              { accountCode: '1300', credit: Number(cogs), description: 'خصم المخزون' },
            ],
          });
        } else if (dto.resolutionAction === ResolutionAction.POST_AS_LOSS) {
          // ترحيل كخسارة
          const qty = new Prisma.Decimal(payload.quantity);
          const cogs = qty.mul(item.costPrice).toDecimalPlaces(2);

          await tx.$executeRaw(
            Prisma.sql`UPDATE items SET quantity = quantity - ${qty}, updated_at = now() WHERE id = ${item.id}::uuid`,
          );

          await this.accounting.createBalancedEntries(tx, {
            storeOwnerId,
            entryDate: new Date(),
            referenceType: 'REJECTED_TRANSACTION_RESOLUTION',
            referenceId: record.id,
            lines: [
              { accountCode: '5450', debit: Number(cogs), description: 'ترحيل بضاعة عملية مرفوضة كخسائر' },
              { accountCode: '1300', credit: Number(cogs), description: 'خصم المخزون المنصرف كخسائر' },
            ],
          });
        } else if (dto.resolutionAction === ResolutionAction.APPROVE_ADJUSTED_QTY) {
          // اعتماد بالكمية المصححة
          const adjQty = new Prisma.Decimal(dto.adjustedQuantity!);
          const origQty = new Prisma.Decimal(payload.quantity);
          const origAmt = new Prisma.Decimal(payload.amount);
          const unitPrice = origAmt.div(origQty);
          const newAmt = adjQty.mul(unitPrice).toDecimalPlaces(2);

          await tx.$executeRaw(
            Prisma.sql`UPDATE items SET quantity = quantity - ${adjQty}, updated_at = now() WHERE id = ${item.id}::uuid`,
          );

          const sale = await tx.sale.create({
            data: {
              storeOwnerId,
              workerId: record.workerId,
              itemId: item.id,
              quantity: adjQty,
              amount: newAmt,
              paymentType: payload.paymentType ?? 'CASH',
              walletId: payload.walletId ?? null,
              depositAttachmentUrl: payload.depositAttachmentUrl ?? null,
              creditCustomerId: payload.creditCustomerId ?? null,
              soldAt: new Date(),
            },
          });
          createdSaleId = sale.id;

          const cogs = adjQty.mul(item.costPrice).toDecimalPlaces(2);
          const debitAccount = payload.paymentType === 'CREDIT' ? '1200' : '1000';
          await this.accounting.createBalancedEntries(tx, {
            storeOwnerId,
            entryDate: new Date(),
            referenceType: 'REJECTED_TRANSACTION_RESOLUTION',
            referenceId: record.id,
            lines: [
              { accountCode: debitAccount, debit: Number(newAmt), description: 'مبيعات بالكمية المصححة' },
              { accountCode: '4000', credit: Number(newAmt), description: 'إيراد المبيعات المصححة' },
              { accountCode: '5000', debit: Number(cogs), description: 'تكلفة البضاعة المباعة المصححة' },
              { accountCode: '1300', credit: Number(cogs), description: 'خصم المخزون' },
            ],
          });
        } else if (dto.resolutionAction === ResolutionAction.APPROVE_NEGATIVE_STOCK) {
          // اعتماد مع رصيد سالب
          const qty = new Prisma.Decimal(payload.quantity);
          const amt = new Prisma.Decimal(payload.amount);

          await tx.$executeRaw(
            Prisma.sql`UPDATE items SET quantity = quantity - ${qty}, updated_at = now() WHERE id = ${item.id}::uuid`,
          );

          const sale = await tx.sale.create({
            data: {
              storeOwnerId,
              workerId: record.workerId,
              itemId: item.id,
              quantity: qty,
              amount: amt,
              paymentType: payload.paymentType ?? 'CASH',
              walletId: payload.walletId ?? null,
              depositAttachmentUrl: payload.depositAttachmentUrl ?? null,
              creditCustomerId: payload.creditCustomerId ?? null,
              soldAt: new Date(),
            },
          });
          createdSaleId = sale.id;

          const cogs = qty.mul(item.costPrice).toDecimalPlaces(2);
          const debitAccount = payload.paymentType === 'CREDIT' ? '1200' : '1000';
          await this.accounting.createBalancedEntries(tx, {
            storeOwnerId,
            entryDate: new Date(),
            referenceType: 'REJECTED_TRANSACTION_RESOLUTION',
            referenceId: record.id,
            lines: [
              { accountCode: debitAccount, debit: Number(amt), description: 'مبيعات معتمدة برصيد سالب' },
              { accountCode: '4000', credit: Number(amt), description: 'إيراد المبيعات' },
              { accountCode: '5000', debit: Number(cogs), description: 'تكلفة البضاعة المباعة' },
              { accountCode: '1300', credit: Number(cogs), description: 'خصم المخزون إلى السالب' },
            ],
          });
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

      return { updated, createdSaleId };
    });

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
    };
  }
}
