import { SetMetadata } from '@nestjs/common';

export type RoleRequirement = {
  roles?: Array<'STORE_OWNER' | 'WORKER' | 'PLATFORM_ADMIN'>;
  // الوصول مشروط بصفة العامل المسؤول (الآجل/الصندوق/النسخ الاحتياطي — R-12)
  responsibleOnly?: boolean;
  // الوصول للمشتريات والموردين: حصري للمالك افتراضياً، ويُفتح للعامل المسؤول فقط عند تفعيل allowResponsiblePurchases من إعدادات المتجر
  purchasesAccess?: boolean;
};

export const ROLES_KEY = 'roles_requirement';
export const RequireRoles = (req: RoleRequirement) => SetMetadata(ROLES_KEY, req);
