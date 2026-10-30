import { Request } from 'express';

// هوية الطالب المصادَق عليه — تُستخرج حصراً من التوكن (لا من جسم الطلب — 13-auth §2.2)
export type AuthenticatedUser = {
  userId: string;
  role: 'STORE_OWNER' | 'WORKER' | 'PLATFORM_ADMIN';
  storeOwnerId?: string;
  workerId?: string;
  isResponsible?: boolean;
  allowResponsiblePurchases?: boolean;
  scope?: string; // 'set-new-password' | 'mfa' — للتوكنات المحدودة
};

export function getRequestUser(request: Request): AuthenticatedUser {
  return (request as Request & { user?: AuthenticatedUser }).user as AuthenticatedUser;
}
