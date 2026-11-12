import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from './api-error';
import { getRequestUser } from './types';

interface CachedDevice {
  status: string;
  cachedAt: number;
}

interface CachedOwner {
  status: string;
  allowResponsiblePurchases: boolean;
  cachedAt: number;
}

interface CachedWorker {
  status: string;
  isResponsible: boolean;
  storeOwnerId: string;
  cachedAt: number;
}

// فحص حالة الحساب عند كل طلب (12-business-logic §3) — يُسجَّل عالمياً بعد JwtAuthGuard:
// 1) حالة المالك (أو المالك الأب) في (TRIAL_EXPIRED, EXPIRED, SUSPENDED) → 423 ACCOUNT_LOCKED فوراً
// 2) حالة العامل غير ACTIVE → 423 ACCOUNT_LOCKED (reason=WORKER_SUSPENDED)
// ويُحدَّث isResponsible من قاعدة البيانات لحظياً — سحب/منح الصفة يسري فوراً حتى بتوكن قديم (BR-070)
// طبقة In-Memory TTL Cache (30 ثانية) لتفادي استنزاف اتصالات قاعدة البيانات عند كل طلب، مع دعم الإبطال الفوري.
@Injectable()
export class AccountStatusGuard implements CanActivate {
  private static readonly TTL_MS = 30_000;
  private static readonly MAX_CACHE_SIZE = 5_000;
  private static readonly deviceCache = new Map<string, CachedDevice>();
  private static readonly ownerCache = new Map<string, CachedOwner>();
  private static readonly workerCache = new Map<string, CachedWorker>();
  private static readonly messageCache = new Map<string, { text: string; cachedAt: number }>();

  private static setBounded<T extends { cachedAt: number }>(
    cache: Map<string, T>,
    key: string,
    value: T,
    now: number,
  ): void {
    if (cache.has(key)) {
      cache.delete(key);
    }
    if (cache.size >= AccountStatusGuard.MAX_CACHE_SIZE) {
      for (const [k, entry] of cache) {
        if (now - entry.cachedAt >= AccountStatusGuard.TTL_MS) {
          cache.delete(k);
        }
      }
      while (cache.size >= AccountStatusGuard.MAX_CACHE_SIZE) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey === undefined) break;
        cache.delete(oldestKey);
      }
    }
    cache.set(key, value);
  }

  static invalidateDevice(fingerprint?: string): void {
    if (!fingerprint || !fingerprint.trim()) {
      AccountStatusGuard.deviceCache.clear();
    } else {
      AccountStatusGuard.deviceCache.delete(fingerprint.trim());
    }
  }

  static invalidateOwner(storeOwnerId: string): void {
    if (storeOwnerId) {
      AccountStatusGuard.ownerCache.delete(storeOwnerId);
    }
  }

  static invalidateWorker(workerId: string): void {
    if (workerId) {
      AccountStatusGuard.workerCache.delete(workerId);
    }
  }

  static clearAllCache(): void {
    AccountStatusGuard.deviceCache.clear();
    AccountStatusGuard.ownerCache.clear();
    AccountStatusGuard.workerCache.clear();
    AccountStatusGuard.messageCache.clear();
  }

  constructor(private readonly prisma: PrismaService) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = getRequestUser(request);
    if (!user || user.role === 'PLATFORM_ADMIN') return true; // مسارات عامة أو سياسات الأدمن الخاصة
    if (user.scope) return true; // توكنات محدودة الغرض (set-new-password) تُفحص في وجهتها

    const rawFingerprint = (request.headers['x-device-fingerprint'] || request.headers['x-device-id']) as string | undefined;
    if (
      !rawFingerprint ||
      !rawFingerprint.trim() ||
      rawFingerprint.trim() === 'APP-DEVICE-DEFAULT' ||
      rawFingerprint.trim().length < 8
    ) {
      throw ApiError.badRequest(
        'INVALID_DEVICE_FINGERPRINT',
        'بصمة الجهاز مطلوبة ويجب ألا تقل عن 8 خانات وألا تكون قيمة عامة افتراضية.',
      );
    }
    const fingerprint = rawFingerprint.trim();

    const now = Date.now();
    let devStatus: string | undefined;
    const cachedDev = AccountStatusGuard.deviceCache.get(fingerprint);
    if (cachedDev && now - cachedDev.cachedAt < AccountStatusGuard.TTL_MS) {
      devStatus = cachedDev.status;
    } else {
      const dev = await this.prisma.device.findUnique({
        where: { deviceFingerprint: fingerprint },
        select: { status: true },
      });
      if (!dev) {
        // لا يتم تخزين الجهاز غير الموجود في الكاش ليتمكن من التسجيل لاحقاً فوراً
        throw ApiError.forbidden('DEVICE_BLOCKED', 'هذا الجهاز غير مسجل أو محظور من استخدام النظام. تواصل مع الإدارة.');
      }
      devStatus = dev.status;
      AccountStatusGuard.setBounded(
        AccountStatusGuard.deviceCache,
        fingerprint,
        { status: dev.status, cachedAt: now },
        now,
      );
    }

    if (devStatus === 'BLOCKED') {
      throw ApiError.forbidden('DEVICE_BLOCKED', 'هذا الجهاز غير مسجل أو محظور من استخدام النظام. تواصل مع الإدارة.');
    }

    if (user.role === 'WORKER' && user.workerId) {
      let worker: { status: string; isResponsible: boolean; storeOwnerId: string } | undefined;
      const cachedWorker = AccountStatusGuard.workerCache.get(user.workerId);
      if (cachedWorker && now - cachedWorker.cachedAt < AccountStatusGuard.TTL_MS) {
        worker = cachedWorker;
      } else {
        const workerDb = await this.prisma.worker.findUnique({
          where: { id: user.workerId },
          select: {
            status: true,
            isResponsible: true,
            storeOwnerId: true,
          },
        });
        if (!workerDb || workerDb.status === 'DELETED') {
          throw ApiError.locked('WORKER_SUSPENDED', 'الحساب غير متاح.');
        }
        worker = {
          status: workerDb.status,
          isResponsible: workerDb.isResponsible,
          storeOwnerId: workerDb.storeOwnerId,
        };
        AccountStatusGuard.setBounded(
          AccountStatusGuard.workerCache,
          user.workerId,
          { ...worker, cachedAt: now },
          now,
        );
      }

      if (worker.status === 'DELETED') {
        throw ApiError.locked('WORKER_SUSPENDED', 'الحساب غير متاح.');
      }

      // فحص كاش المتجر التابع له العامل
      let owner: { status: string; allowResponsiblePurchases: boolean } | undefined;
      const cachedOwner = AccountStatusGuard.ownerCache.get(worker.storeOwnerId);
      if (cachedOwner && now - cachedOwner.cachedAt < AccountStatusGuard.TTL_MS) {
        owner = cachedOwner;
      } else {
        const ownerDb = await this.prisma.storeOwner.findUnique({
          where: { id: worker.storeOwnerId },
          select: { status: true, allowResponsiblePurchases: true },
        });
        if (ownerDb) {
          owner = {
            status: ownerDb.status,
            allowResponsiblePurchases: ownerDb.allowResponsiblePurchases,
          };
          AccountStatusGuard.setBounded(
            AccountStatusGuard.ownerCache,
            worker.storeOwnerId,
            { ...owner, cachedAt: now },
            now,
          );
        }
      }

      if (owner && (owner.status === 'TRIAL_EXPIRED' || owner.status === 'EXPIRED' || owner.status === 'SUSPENDED')) {
        const { phone, whatsapp } = await this.resolveSupportContacts();
        throw ApiError.locked(
          ownerReason(owner.status),
          await this.resolveOwnerMessage(owner.status, phone),
          { contact_phone: phone, contact_whatsapp: whatsapp },
        );
      }
      if (worker.status === 'SUSPENDED') {
        const { phone, whatsapp } = await this.resolveSupportContacts();
        throw ApiError.locked(
          'WORKER_SUSPENDED',
          `الحساب موقوف مؤقتاً. تواصل مع المالك لإعادة تفعيله. للتواصل والدعم: ${phone}`,
          { contact_phone: phone, contact_whatsapp: whatsapp },
        );
      }

      // تحديث لحظي للصفة وصلاحية المشتريات للمسؤول من قاعدة البيانات/الكاش
      request.user = {
        ...user,
        isResponsible: worker.isResponsible,
        storeOwnerId: worker.storeOwnerId,
        allowResponsiblePurchases: worker.isResponsible ? (owner?.allowResponsiblePurchases ?? false) : false,
      };
      return true;
    }

    const storeOwnerId = user.storeOwnerId!;
    let owner: { status: string; allowResponsiblePurchases: boolean } | undefined;
    const cachedOwner = AccountStatusGuard.ownerCache.get(storeOwnerId);
    if (cachedOwner && now - cachedOwner.cachedAt < AccountStatusGuard.TTL_MS) {
      owner = cachedOwner;
    } else {
      const ownerDb = await this.prisma.storeOwner.findUnique({
        where: { id: storeOwnerId },
        select: { status: true, allowResponsiblePurchases: true },
      });
      if (ownerDb) {
        owner = {
          status: ownerDb.status,
          allowResponsiblePurchases: ownerDb.allowResponsiblePurchases,
        };
        AccountStatusGuard.setBounded(
          AccountStatusGuard.ownerCache,
          storeOwnerId,
          { ...owner, cachedAt: now },
          now,
        );
      }
    }

    if (owner && (owner.status === 'TRIAL_EXPIRED' || owner.status === 'EXPIRED' || owner.status === 'SUSPENDED')) {
      const { phone, whatsapp } = await this.resolveSupportContacts();
      throw ApiError.locked(
        ownerReason(owner.status),
        await this.resolveOwnerMessage(owner.status, phone),
        { contact_phone: phone, contact_whatsapp: whatsapp },
      );
    }
    request.user = {
      ...user,
      allowResponsiblePurchases: owner?.allowResponsiblePurchases ?? true,
    };
    return true;
  }

  private async resolveSupportContacts(): Promise<{ phone: string; whatsapp: string }> {
    const defaultPhone = '735717710';
    const sysSetting = (this.prisma as any)?.systemSetting;
    if (!sysSetting || typeof sysSetting.findUnique !== 'function') {
      return { phone: defaultPhone, whatsapp: defaultPhone };
    }
    try {
      const phoneRow = await sysSetting.findUnique({ where: { key: 'contact_phone' } });
      const waRow = await sysSetting.findUnique({ where: { key: 'contact_whatsapp' } });
      const extract = (raw: unknown) => {
        const val = typeof raw === 'object' && raw !== null && 'v' in raw ? (raw as { v?: unknown }).v : raw;
        return typeof val === 'string' && val.trim() !== '' ? val.trim() : null;
      };
      const phone = extract(phoneRow?.value) ?? defaultPhone;
      const whatsapp = extract(waRow?.value) ?? phone;
      return { phone, whatsapp };
    } catch {
      return { phone: defaultPhone, whatsapp: defaultPhone };
    }
  }

  private async resolveOwnerMessage(status: string, phone: string): Promise<string> {
    const fallback = ownerMessage(status);
    const key =
      status === 'TRIAL_EXPIRED'
        ? 'trial_expired_message'
        : status === 'SUSPENDED'
          ? 'suspended_message'
          : 'subscription_expired_message';

    const now = Date.now();
    const cached = AccountStatusGuard.messageCache.get(key);
    let text = fallback;
    if (cached && now - cached.cachedAt < AccountStatusGuard.TTL_MS) {
      text = cached.text;
    } else {
      const sysSetting = (this.prisma as any)?.systemSetting;
      if (sysSetting && typeof sysSetting.findUnique === 'function') {
        try {
          const row = await sysSetting.findUnique({ where: { key } });
          const raw: unknown = row?.value;
          const val = typeof raw === 'object' && raw !== null && 'v' in raw ? (raw as { v?: unknown }).v : raw;
          if (typeof val === 'string' && val.trim() !== '') {
            text = val.trim();
          }
          AccountStatusGuard.setBounded(
            AccountStatusGuard.messageCache,
            key,
            { text, cachedAt: now },
            now,
          );
        } catch {}
      }
    }
    if (!/\d{7,15}/.test(text)) {
      text = `${text} للتواصل والدعم: ${phone}`;
    }
    return text;
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
