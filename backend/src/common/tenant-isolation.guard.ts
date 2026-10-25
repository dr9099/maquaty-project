import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ApiError } from './api-error';
import { getRequestUser } from './types';

// عزل Tenant الإلزامي (R-03 / 13-auth §2.4):
// كل استعلام بيانات تشغيلية يُقيَّد بـ store_owner_id المستخرج من التوكن حصراً.
// أي endpoint يحمل المعامل :storeOwnerId في المسار يجب أن يطابق هوية التوكن — وإلا 404 (لا 403، إخفاء الوجود).
@Injectable()
export class TenantIsolationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = getRequestUser(request);
    if (!user || user.role === 'PLATFORM_ADMIN') return true; // الأدمن يُفحص عبر سياساته الخاصة

    const requestedOwnerId: string | undefined =
      request.params?.storeOwnerId ?? request.body?.storeOwnerId;

    // منع تمرير store_owner_id من حمولة الطلب (IDOR) — يجب مطابقته للتوكن إن ذُكر
    if (requestedOwnerId && requestedOwnerId !== user.storeOwnerId) {
      throw ApiError.notFound(); // 404 وليس 403 — 13-auth §2.2
    }

    if (!user.storeOwnerId) {
      throw ApiError.forbidden('PERMISSION_DENIED', 'لا تملك صلاحية الوصول لهذا الإجراء.');
    }

    // إعادة الضبط القسري: بيانات العملية تُقيَّد بهوية التوكن دائماً
    request.body.storeOwnerId = user.storeOwnerId;
    return true;
  }
}
