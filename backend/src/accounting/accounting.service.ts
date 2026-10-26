import { Injectable } from '@nestjs/common';
import { LedgerReferenceType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';

export type LedgerLine = {
  accountCode: string; // كود من دليل الحسابات المزروع (1000، 4000، 5450...)
  debit?: number;      // بالهللات؟ لا — بالريال كعدد عشري؛ القيود تتوازن على نفس العملة
  credit?: number;
  description?: string;
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

    const accounts = await tx.chartOfAccount.findMany({
      where: { storeOwnerId, code: { in: lines.map((l) => l.accountCode) } },
      select: { id: true, code: true },
    });
    const byCode = new Map(accounts.map((a) => [a.code, a.id]));

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
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
