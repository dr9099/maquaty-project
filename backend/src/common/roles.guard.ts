import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiError } from './api-error';
import { getRequestUser } from './types';
import { ROLES_KEY, RoleRequirement } from './roles.decorator';

// حرس الترخيص (Authorization) — تسلسل التحقق الإلزامي: Authentication → Authorization → ...
// يفرض: الدور المطلوب، صفة العامل المسؤول عند الحاجة (R-11/R-12)، وسكوب التوكنات المحدودة
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requirement = this.reflector.getAllAndOverride<RoleRequirement | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requirement) return true;

    const user = getRequestUser(context.switchToHttp().getRequest());
    if (!user) {
      throw ApiError.unauthorized('INVALID_CREDENTIALS', 'مصادقة ناقصة.');
    }

    // التوكنات المحدودة (set-new-password / mfa) لا تصلح لأي endpoint آخر
    if (user.scope) {
      throw ApiError.forbidden('PERMISSION_DENIED', 'هذا التوكن محدود الغرض ولا يصلح لهذا الإجراء.');
    }

    if (requirement.roles && !requirement.roles.includes(user.role)) {
      throw ApiError.forbidden('PERMISSION_DENIED', 'لا تملك صلاحية الوصول لهذا الإجراء.');
    }

    if (requirement.responsibleOnly) {
      if (user.role === 'WORKER' && !user.isResponsible) {
        // الآجل/الصندوق/النسخ الاحتياطي حصراً للمالك أو العامل المسؤول (R-12) — وليست Toggle
        throw ApiError.forbidden('PERMISSION_DENIED', 'لا تملك صلاحية الوصول لهذا الإجراء.');
      }
    }

    return true;
  }
}
