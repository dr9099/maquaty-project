import { Injectable } from '@nestjs/common';
import { CostingMethod, Currency, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import { AccountStatusGuard } from '../common/account-status.guard';
import { AuthenticatedUser } from '../common/types';
import { UpdateStoreSettingsDto } from './dto/settings.dto';

export const CURRENCY_METADATA: Record<Currency, { symbol: string; name_ar: string }> = {
  YER: { symbol: 'ر.ي', name_ar: 'ريال يمني' },
  SAR: { symbol: 'ر.س', name_ar: 'ريال سعودي' },
  USD: { symbol: '$', name_ar: 'دولار أمريكي' },
};

export const COSTING_OPTIONS_AR: Array<{
  code: CostingMethod;
  label_ar: string;
  description_ar: string;
}> = [
  {
    code: 'WEIGHTED_AVERAGE',
    label_ar: 'دمج الكميتين وحساب متوسط السعر تلقائياً',
    description_ar: 'يجمع الكمية المتبقية مع الكمية الجديدة ويحسب متوسط سعر التكلفة بينهما بعدالة.',
  },
  {
    code: 'LAST_PRICE',
    label_ar: 'اعتماد السعر الجديد لكل الكمية الموجودة',
    description_ar: 'يحدّث تكلفة الصنف فوراً لتصبح مساوية لآخر سعر شراء أدخلته الآن.',
  },
  {
    code: 'FIFO',
    label_ar: 'بيع الكمية القديمة بسعرها أولاً ثم الجديدة بسعرها',
    description_ar: 'يخصم المبيعات من الدفعة الأقدم بتكلفتها أولاً، وبعد نفادها ينتقل تلقائياً لتكلفة الدفعة الجديدة.',
  },
];

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getStoreSettings(user: AuthenticatedUser) {
    const storeOwnerId = user.storeOwnerId!;
    const owner = await this.prisma.storeOwner.findUniqueOrThrow({
      where: { id: storeOwnerId },
      select: {
        storeName: true,
        currency: true,
        defaultCostingMethod: true,
        allowResponsiblePurchases: true,
      },
    });

    const meta = CURRENCY_METADATA[owner.currency];
    if (user.role === 'WORKER') {
      const canAccessPurchases = Boolean(user.isResponsible && owner.allowResponsiblePurchases);
      return {
        store_name: owner.storeName,
        currency: owner.currency,
        currency_symbol: meta.symbol,
        currency_name_ar: meta.name_ar,
        allow_responsible_purchases: canAccessPurchases,
        ...(canAccessPurchases
          ? {
              default_costing_method: owner.defaultCostingMethod,
              costing_options: COSTING_OPTIONS_AR,
            }
          : {}),
      };
    }

    const currencyLocked = await this.hasAnyFinancialTransactions(this.prisma, storeOwnerId);

    return {
      store_name: owner.storeName,
      currency: owner.currency,
      currency_symbol: meta.symbol,
      currency_name_ar: meta.name_ar,
      currency_locked: currencyLocked,
      supported_currencies: Object.entries(CURRENCY_METADATA).map(([code, info]) => ({
        code,
        symbol: info.symbol,
        name_ar: info.name_ar,
      })),
      default_costing_method: owner.defaultCostingMethod,
      allow_responsible_purchases: owner.allowResponsiblePurchases,
      costing_options: COSTING_OPTIONS_AR,
    };
  }

  async updateStoreSettings(user: AuthenticatedUser, dto: UpdateStoreSettingsDto, ip?: string) {
    if (user.role !== 'STORE_OWNER') {
      throw ApiError.forbidden('PERMISSION_DENIED', 'تعديل إعدادات المتجر حصري لمالك المتجر.');
    }
    const storeOwnerId = user.storeOwnerId!;

    const updated = await this.prisma.$transaction(async (tx) => {
      const lockedRows = await tx.$queryRaw<
        Array<{
          currency: Currency;
          default_costing_method: CostingMethod;
          allow_responsible_purchases: boolean;
          store_name: string;
        }>
      >(Prisma.sql`SELECT currency, default_costing_method, allow_responsible_purchases, store_name
                   FROM store_owners WHERE id = ${storeOwnerId}::uuid FOR UPDATE`);
      const current = lockedRows[0];
      if (!current) throw ApiError.notFound('حساب المتجر غير موجود.');

      if (dto.currency !== undefined && dto.currency !== current.currency) {
        const locked = await this.hasAnyFinancialTransactions(tx, storeOwnerId);
        if (locked) {
          throw ApiError.conflict(
            'CURRENCY_CHANGE_LOCKED',
            'لا يمكن تغيير عملة المتجر بعد تسجيل عمليات مالية سابقة لضمان سلامة الدفاتر المحاسبية.',
          );
        }
      }

      const next = await tx.storeOwner.update({
        where: { id: storeOwnerId },
        data: {
          ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
          ...(dto.defaultCostingMethod !== undefined
            ? { defaultCostingMethod: dto.defaultCostingMethod }
            : {}),
          ...(dto.allowResponsiblePurchases !== undefined
            ? { allowResponsiblePurchases: dto.allowResponsiblePurchases }
            : {}),
          ...(dto.storeName !== undefined ? { storeName: dto.storeName.trim() } : {}),
        },
        select: {
          storeName: true,
          currency: true,
          defaultCostingMethod: true,
          allowResponsiblePurchases: true,
        },
      });

      return { previous: current, next };
    });

    await this.audit.log({
      actorType: 'STORE_OWNER',
      actorId: storeOwnerId,
      actionType: 'STORE_SETTINGS_UPDATE',
      targetType: 'store_owner',
      targetId: storeOwnerId,
      oldValue: {
        currency: updated.previous.currency,
        default_costing_method: updated.previous.default_costing_method,
        allow_responsible_purchases: updated.previous.allow_responsible_purchases,
        store_name: updated.previous.store_name,
      },
      newValue: {
        currency: updated.next.currency,
        default_costing_method: updated.next.defaultCostingMethod,
        allow_responsible_purchases: updated.next.allowResponsiblePurchases,
        store_name: updated.next.storeName,
      },
      ipAddress: ip,
      result: 'SUCCESS',
    });

    AccountStatusGuard.invalidateOwner(storeOwnerId);

    return this.getStoreSettings(user);
  }

  private async hasAnyFinancialTransactions(
    db: Prisma.TransactionClient | PrismaService,
    storeOwnerId: string,
  ): Promise<boolean> {
    const [
      ledgerCount,
      salesCount,
      purchaseCount,
      supplierPayCount,
      creditPayCount,
      rentCount,
      utilityCount,
      empPayCount,
      workerAdvCount,
    ] = await Promise.all([
      db.ledgerEntry.count({ where: { storeOwnerId } }),
      db.sale.count({ where: { storeOwnerId } }),
      db.purchaseInvoice.count({ where: { storeOwnerId } }),
      db.supplierPayment.count({ where: { storeOwnerId } }),
      db.creditPayment.count({ where: { storeOwnerId } }),
      db.rentRecord.count({ where: { storeOwnerId } }),
      db.utilityPayment.count({ where: { storeOwnerId } }),
      db.employeePayment.count({ where: { storeOwnerId } }),
      db.workerAdvance.count({ where: { storeOwnerId } }),
    ]);

    return (
      ledgerCount > 0 ||
      salesCount > 0 ||
      purchaseCount > 0 ||
      supplierPayCount > 0 ||
      creditPayCount > 0 ||
      rentCount > 0 ||
      utilityCount > 0 ||
      empPayCount > 0 ||
      workerAdvCount > 0
    );
  }
}
