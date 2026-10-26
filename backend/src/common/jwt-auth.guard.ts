import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ApiError } from './api-error';
import { IS_PUBLIC_KEY } from './public.decorator';

// حرس المصادقة (Authentication) — يُسجَّل عالمياً (APP_GUARD)
// يتحقق من الـ JWT ويضع هوية الطالب على الطلب حصراً من التوكن (لا من الجسم — 13-auth §2.2)
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const header: string | undefined = request.headers['authorization'];
    if (!header?.startsWith('Bearer ')) {
      throw ApiError.unauthorized('INVALID_CREDENTIALS', 'مصادقة ناقصة.');
    }
    try {
      const payload = await this.jwt.verifyAsync(header.slice(7));
      request.user = {
        userId: payload.sub,
        role: payload.role,
        storeOwnerId: payload.storeOwnerId,
        workerId: payload.workerId,
        isResponsible: payload.isResponsible ?? false,
        scope: payload.scope,
      };
      return true;
    } catch {
      throw ApiError.unauthorized('INVALID_CREDENTIALS', 'انتهت صلاحية الجلسة أو غير صالحة.');
    }
  }
}
