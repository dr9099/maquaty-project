import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ApiError } from './api-error';

// حرس المصادقة (Authentication) — يتحقق من الـ JWT ويضع هوية الطالب على الطلب
// حصراً من التوكن (لا من حمولة الطلب — 13-auth §2.2)
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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
