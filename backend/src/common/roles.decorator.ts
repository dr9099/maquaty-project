import { SetMetadata } from '@nestjs/common';

export type RoleRequirement = {
  roles?: Array<'STORE_OWNER' | 'WORKER' | 'PLATFORM_ADMIN'>;
  // الوصول مشروط بصفة العامل المسؤول (الآجل/الصندوق/النسخ الاحتياطي — R-12)
  responsibleOnly?: boolean;
};

export const ROLES_KEY = 'roles_requirement';
export const RequireRoles = (req: RoleRequirement) => SetMetadata(ROLES_KEY, req);
