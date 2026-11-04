import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from './api-error';
import { getRequestUser } from './types';

@Injectable()
export class StepUpMfaGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = getRequestUser(request);

    if (!user || user.role !== 'PLATFORM_ADMIN') {
      throw ApiError.forbidden('PERMISSION_DENIED', 'هذا الإجراء حصري لمالك المنصة.');
    }

    const code = (request.headers['x-mfa-code'] || request.headers['x-mfa-token']) as string | undefined;
    if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
      throw ApiError.badRequest(
        'INVALID_MFA_CODE',
        'رمز التحقق بخطوتين (X-MFA-Code) مطلوب (6 أرقام) لتأكيد هذه العملية الحساسة.',
      );
    }

    const admin = await this.prisma.platformAdmin.findUnique({
      where: { id: user.userId },
    });

    if (!admin || !admin.mfaSecret) {
      throw ApiError.forbidden('PERMISSION_DENIED', 'لم يتم تفعيل التحقق بخطوتين لهذا الحساب الإداري.');
    }

    if (admin.mfaLockedUntil && admin.mfaLockedUntil > new Date()) {
      throw ApiError.locked(
        'MFA_LOCKED',
        'تم قفل حساب الأدمن مؤقتاً لتكرار محاولات MFA الخاطئة. حاول لاحقاً.',
      );
    }

    const ok = authenticator.verify({ token: code.trim(), secret: admin.mfaSecret });
    if (!ok) {
      const nextFailures = admin.failedMfaAttempts + 1;
      const isLockedNow = nextFailures >= 5;

      await this.prisma.platformAdmin.update({
        where: { id: admin.id },
        data: {
          failedMfaAttempts: isLockedNow ? 0 : nextFailures,
          mfaLockedUntil: isLockedNow ? new Date(Date.now() + 15 * 60 * 1000) : null,
        },
      });

      if (isLockedNow) {
        throw ApiError.locked(
          'MFA_LOCKED',
          'تم قفل الحساب الإداري لمدة 15 دقيقة بعد 5 محاولات رمز MFA خاطئة متتالية.',
        );
      }

      throw ApiError.unauthorized('INVALID_MFA_CODE', 'رمز التحقق بخطوتين (X-MFA-Code) غير صحيح.');
    }

    // نجاح الرمز -> تصفير المحاولات الخاطئة
    if (admin.failedMfaAttempts > 0) {
      await this.prisma.platformAdmin.update({
        where: { id: admin.id },
        data: { failedMfaAttempts: 0, mfaLockedUntil: null },
      });
    }

    return true;
  }
}
