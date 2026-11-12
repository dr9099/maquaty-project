import { CanActivate, ExecutionContext, Injectable, OnModuleDestroy } from '@nestjs/common';
import { ApiError } from './api-error';
import { getRequestUser } from './types';

type RateLimitTier = 'AUTH' | 'UPLOAD_SYNC' | 'GENERAL';

interface TierConfig {
  tier: RateLimitTier;
  limit: number;
  windowMs: number;
}

const RATE_LIMIT_MESSAGE = 'تم تجاوز الحد المسموح من المحاولات، يرجى الانتظار دقيقة والمحاولة مجدداً.';
const WINDOW_MS = 60_000;
const MAX_BUCKETS = 20_000;

/**
 * محدد معدل الطلبات متعدد الطبقات (Sliding Window In-Memory Rate Limiter):
 * - Auth & MFA: 10 طلبات / دقيقة لكل IP
 * - Uploads & Sync: 30 طلب / دقيقة لكل مستخدم أو IP
 * - General API: 120 طلب / دقيقة لكل مستخدم أو IP
 */
@Injectable()
export class RateLimitGuard implements CanActivate, OnModuleDestroy {
  private static readonly buckets = new Map<string, number[]>();
  private readonly cleanupTimer: NodeJS.Timeout;

  static clearAllBuckets(): void {
    RateLimitGuard.buckets.clear();
  }

  constructor() {
    this.cleanupTimer = setInterval(() => {
      RateLimitGuard.purgeExpired(Date.now());
    }, WINDOW_MS);
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupTimer);
    RateLimitGuard.buckets.clear();
  }

  clearAllBuckets(): void {
    RateLimitGuard.clearAllBuckets();
  }

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const request = http.getRequest();
    const response = http.getResponse();

    if (!request) return true;

    // في بيئة الاختبارات الآلية: تخطي المحدد ما لم يطلب الاختبار تفعيله صراحةً
    const isTestEnv = process.env.NODE_ENV === 'test';
    const forceEnforceInTest =
      process.env.RATE_LIMIT_TEST_MODE === 'enforce' ||
      request.headers?.['x-test-rate-limit'] === 'enforce';
    if (isTestEnv && !forceEnforceInTest) {
      return true;
    }

    const rawUrl = String(request.originalUrl || request.url || '');
    const rawPath = rawUrl.split('?')[0].toLowerCase();
    const path = rawPath.startsWith('/v1/')
      ? rawPath.slice(3)
      : rawPath === '/v1'
        ? '/'
        : rawPath;

    const config = this.resolveTier(path);
    const clientIp = this.extractClientIp(request);
    const user = getRequestUser(request);

    const subjectKey =
      config.tier === 'AUTH'
        ? `ip:${clientIp}`
        : user?.userId
          ? `user:${user.userId}`
          : `ip:${clientIp}`;
    const bucketKey = `${config.tier}:${subjectKey}`;

    const now = Date.now();
    const cutoff = now - config.windowMs;

    const existing = RateLimitGuard.buckets.get(bucketKey) ?? [];
    const active = existing.filter((ts) => ts > cutoff);

    if (active.length >= config.limit) {
      const oldestActive = active[0] ?? now;
      const retryAfterSec = Math.max(1, Math.ceil((oldestActive + config.windowMs - now) / 1000));
      response?.setHeader?.('X-RateLimit-Limit', String(config.limit));
      response?.setHeader?.('X-RateLimit-Remaining', '0');
      response?.setHeader?.('Retry-After', String(retryAfterSec));
      RateLimitGuard.buckets.set(bucketKey, active);
      throw ApiError.tooManyRequests(RATE_LIMIT_MESSAGE, {
        retry_after_seconds: retryAfterSec,
      });
    }

    active.push(now);
    if (RateLimitGuard.buckets.has(bucketKey)) {
      RateLimitGuard.buckets.delete(bucketKey);
    } else if (RateLimitGuard.buckets.size >= MAX_BUCKETS) {
      RateLimitGuard.purgeExpired(now);
      while (RateLimitGuard.buckets.size >= MAX_BUCKETS) {
        const oldestKey = RateLimitGuard.buckets.keys().next().value;
        if (oldestKey === undefined) break;
        RateLimitGuard.buckets.delete(oldestKey);
      }
    }
    RateLimitGuard.buckets.set(bucketKey, active);

    const remaining = Math.max(0, config.limit - active.length);
    response?.setHeader?.('X-RateLimit-Limit', String(config.limit));
    response?.setHeader?.('X-RateLimit-Remaining', String(remaining));

    return true;
  }

  private resolveTier(path: string): TierConfig {
    if (
      path === '/auth/login' ||
      path === '/auth/admin/login' ||
      path === '/auth/register' ||
      path === '/auth/register-store-owner' ||
      path === '/auth/mfa' ||
      path.startsWith('/auth/mfa/') ||
      path === '/auth/admin/mfa' ||
      path.startsWith('/auth/admin/mfa/')
    ) {
      return { tier: 'AUTH', limit: 10, windowMs: WINDOW_MS };
    }

    if (
      path === '/uploads' ||
      path.startsWith('/uploads/') ||
      path === '/device/sync'
    ) {
      return { tier: 'UPLOAD_SYNC', limit: 30, windowMs: WINDOW_MS };
    }

    return { tier: 'GENERAL', limit: 120, windowMs: WINDOW_MS };
  }

  private extractClientIp(request: any): string {
    if (typeof request.ip === 'string' && request.ip.trim()) {
      return request.ip.trim();
    }
    const remote = request.socket?.remoteAddress || request.connection?.remoteAddress;
    if (typeof remote === 'string' && remote.trim()) {
      return remote.trim();
    }
    return 'unknown';
  }

  private static purgeExpired(now: number): void {
    const cutoff = now - WINDOW_MS;
    for (const [key, timestamps] of RateLimitGuard.buckets) {
      const fresh = timestamps.filter((ts) => ts > cutoff);
      if (fresh.length === 0) {
        RateLimitGuard.buckets.delete(key);
      } else if (fresh.length !== timestamps.length) {
        RateLimitGuard.buckets.set(key, fresh);
      }
    }
  }
}
