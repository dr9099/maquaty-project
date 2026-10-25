import { Injectable } from '@nestjs/common';
import { ActorType, AuditResult, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type AuditEntry = {
  actorType: ActorType;
  actorId?: string;
  actionType: string; // القائمة الكاملة في 13-authentication-security.md القسم 9
  targetType?: string;
  targetId?: string;
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  ipAddress?: string;
  deviceInfo?: string;
  result: AuditResult;
  failureReason?: string;
};

// سجل التدقيق Append-only (BR-055 سلوكياً على مستوى الخدمة: لا تحديث ولا حذف أبداً)
// إلزامي وغير قابل للتعطيل (04-NFR §8) — فشل التسجيل لا يمنع العملية لكن يُسجَّل في اللوج
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorType: entry.actorType,
          actorId: entry.actorId,
          actionType: entry.actionType,
          targetType: entry.targetType,
          targetId: entry.targetId,
          oldValue: (entry.oldValue ?? undefined) as Prisma.InputJsonValue | undefined,
          newValue: (entry.newValue ?? undefined) as Prisma.InputJsonValue | undefined,
          ipAddress: entry.ipAddress,
          deviceInfo: entry.deviceInfo,
          result: entry.result,
          failureReason: entry.failureReason,
        },
      });
    } catch (error) {
      // لا نُوقف العملية الأصلية بسبب فشل التدقيق — لكن نبلّغ
      console.error('فشل تسجيل سجل التدقيق:', (error as Error).message);
    }
  }
}
