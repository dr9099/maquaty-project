import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from './api-error';
import { getRequestUser } from './types';

// فحص حالة الحساب عند كل طلب (12-business-logic §3) — يُسجَّل عالمياً بعد JwtAuthGuard:
// 1) حالة المالك (أو المالك الأب) في (TRIAL_EXPIRED, EXPIRED, SUSPENDED) → 423 ACCOUNT_LOCKED فوراً
// 2) حالة العامل غير ACTIVE → 423 ACCOUNT_LOCKED (reason=WORKER_SUSPENDED)
// ويُحدَّث isResponsible من قاعدة البيانات لحظياً — سحب/منح الصفة يسري فوراً حتى بتوكن قديم (BR-070)
@Injectable()
export class AccountStatusGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = getRequestUser(request);
    if (!user || user.role === 'PLATFORM_ADMIN') return true; // مسارات عامة أو سياسات الأدمن الخاصة
    if (user.scope) return true; // توكنات محدودة الغرض (set-new-password) تُفحص في وجهتها

    if (user.role === 'WORKER' && user.workerId) {
      const worker = await this.prisma.worker.findUnique({
        where: { id: user.workerId },
        select: { status: true, isResponsible: true, storeOwnerId: true, storeOwner: { select: { status: true } } },
      });
      if (!worker || worker.status === 'DELETED') {
        throw ApiError.locked('WORKER_SUSPENDED', 'الحساب غير متاح.');
      }
      if (worker.storeOwner.status === 'TRIAL_EXPIRED' || worker.storeOwner.status === 'EXPIRED' || worker.storeOwner.status === 'SUSPENDED') {
        throw ApiError.locked(ownerReason(worker.storeOwner.status), ownerMessage(worker.storeOwner.status));
      }
      if (worker.status === 'SUSPENDED') {
        throw ApiError.locked('WORKER_SUSPENDED', 'الحساب موقوف مؤقتاً. تواصل مع المالك لإعادة تفعيله.');
      }
      // تحديث لحظي للصفة من قاعدة البيانات
      request.user = { ...user, isResponsible: worker.isResponsible, storeOwnerId: worker.storeOwnerId };
      return true;
    }

    const owner = await this.prisma.storeOwner.findUnique({
      where: { id: user.storeOwnerId! },
      select: { status: true },
    });
    if (owner && (owner.status === 'TRIAL_EXPIRED' || owner.status === 'EXPIRED' || owner.status === 'SUSPENDED')) {
      throw ApiError.locked(ownerReason(owner.status), ownerMessage(owner.status));
    }
    return true;
  }
}

function ownerReason(status: string): string {
  if (status === 'TRIAL_EXPIRED') return 'TRIAL_EXPIRED';
  if (status === 'SUSPENDED') return 'SUSPENDED';
  return 'SUBSCRIPTION_EXPIRED';
}
function ownerMessage(status: string): string {
  if (status === 'TRIAL_EXPIRED') return 'انتهت الفترة التجريبية. تواصل مع مالك التطبيق للتجديد.';
  if (status === 'SUSPENDED') return 'تم إيقاف حسابك مؤقتاً بواسطة إدارة التطبيق. تواصل معنا لإعادة التفعيل.';
  return 'انتهى اشتراكك. تواصل مع مالك التطبيق للتجديد.';
}
