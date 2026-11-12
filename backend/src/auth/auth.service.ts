import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { authenticator } from 'otplib';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { hash, verify as argonVerify } from '@node-rs/argon2';
import { ActorType, StoreOwnerStatus, WorkerStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ChartOfAccountsService } from '../accounting/chart-of-accounts.service';
import { ApiError } from '../common/api-error';
import { AuthenticatedUser } from '../common/types';
import { RegisterStoreOwnerDto } from './dto/register-store-owner.dto';
import { LoginDto } from './dto/login.dto';
import { SetNewPasswordDto } from './dto/set-new-password.dto';

const LOCKED_OWNER_STATUSES: Record<'TRIAL_EXPIRED' | 'EXPIRED' | 'SUSPENDED', string> = {
  TRIAL_EXPIRED: 'انتهت الفترة التجريبية. تواصل مع مالك التطبيق للتجديد.',
  EXPIRED: 'انتهى اشتراكك. تواصل مع مالك التطبيق للتجديد.',
  SUSPENDED: 'تم إيقاف حسابك مؤقتاً بواسطة إدارة التطبيق. تواصل معنا لإعادة التفعيل.',
};
// النصوص القابلة للضبط تُقرأ لاحقاً من system_settings (trial_expired_message وغيرها) — القيم أعلاه هي الافتراضية

type Role = 'STORE_OWNER' | 'WORKER' | 'PLATFORM_ADMIN';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly chartOfAccounts: ChartOfAccountsService,
  ) { }

  // ─── تسجيل مالك متجر جديد (USER_FLOWS 1) ────────────────────────────────

  async registerStoreOwner(dto: RegisterStoreOwnerDto, ip?: string) {
    this.validateDeviceFingerprint(dto.deviceFingerprint);

    if (dto.password !== dto.passwordConfirmation) {
      throw ApiError.badRequest('VALIDATION_ERROR', 'كلمتا المرور غير متطابقتين.');
    }

    const phoneTaken = await this.prisma.storeOwner.findFirst({
      where: { phone: dto.phone, deletedAt: null },
    });
    if (phoneTaken || (await this.prisma.worker.findUnique({ where: { phone: dto.phone } }))) {
      throw ApiError.conflict('PHONE_ALREADY_EXISTS', 'رقم الهاتف مستخدم مسبقاً.');
    }

    // R-25: القرار بمنح/رفض التجربة من جهة الخادم دائماً عبر بصمة الجهاز
    const device = await this.prisma.device.findUnique({
      where: { deviceFingerprint: dto.deviceFingerprint },
    });
    if (device?.trialConsumed) {
      await this.audit.log({
        actorType: 'SYSTEM',
        actionType: 'TRIAL_REJECTED_DEVICE',
        targetType: 'device',
        targetId: device.id,
        result: 'FAILURE',
        failureReason: 'DEVICE_TRIAL_ALREADY_CONSUMED',
        ipAddress: ip,
        deviceInfo: dto.deviceFingerprint,
      });
      const contactPhone = await this.getContactPhone();
      throw ApiError.forbidden(
        'DEVICE_TRIAL_ALREADY_CONSUMED',
        `هذا الجهاز لا يستحق تجربة جديدة، تواصل مع ${contactPhone}.`,
      );
    }

    const trialLimit = await this.getTrialSalesLimit();
    const passwordHash = await hash(dto.password);

    const owner = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.storeOwner.create({
        data: {
          fullName: dto.fullName,
          storeName: dto.storeName,
          phone: dto.phone,
          passwordHash,
          status: StoreOwnerStatus.TRIAL,
          trialSalesUsed: 0,
          trialSalesLimit: trialLimit, // snapshot لا يتأثر لاحقاً بتعديل الإعداد العام
          maxWorkersAllowed: 0, // رصيد العمال العاديين يُمنح من Admin Portal (R-33)
        },
      });
      if (device) {
        await tx.device.update({
          where: { id: device.id },
          data: { storeOwnerId: created.id, trialConsumed: true },
        });
      } else {
        await tx.device.create({
          data: {
            deviceFingerprint: dto.deviceFingerprint,
            storeOwnerId: created.id,
            trialConsumed: true,
          },
        });
      }
      return created;
    });

    await this.chartOfAccounts.seedForOwner(owner.id); // زراعة دليل الحسابات (12-business §4)
    await this.audit.log({
      actorType: 'STORE_OWNER',
      actorId: owner.id,
      actionType: 'OWNER_REGISTER',
      targetType: 'store_owner',
      targetId: owner.id,
      newValue: { phone: owner.phone, status: owner.status },
      ipAddress: ip,
      deviceInfo: dto.deviceFingerprint,
      result: 'SUCCESS',
    });

    const tokens = await this.issueTokens(
      { userId: owner.id, role: 'STORE_OWNER', storeOwnerId: owner.id },
      dto.deviceFingerprint,
    );
    return {
      role: 'STORE_OWNER' as const,
      account_status: owner.status,
      account: {
        id: owner.id,
        full_name: owner.fullName,
        store_name: owner.storeName,
        phone: owner.phone,
        status: owner.status,
        trial_sales_used: owner.trialSalesUsed,
        trial_sales_limit: owner.trialSalesLimit,
        allow_responsible_purchases: owner.allowResponsiblePurchases,
      },
      user: {
        id: owner.id,
        storeOwnerId: owner.id,
        name: owner.fullName,
        storeName: owner.storeName,
        phone: owner.phone,
        role: 'STORE_OWNER',
        accountStatus: owner.status,
        isResponsibleWorker: false,
        allowResponsiblePurchases: owner.allowResponsiblePurchases,
        trialSalesUsed: owner.trialSalesUsed,
        trialSalesLimit: owner.trialSalesLimit,
      },
      ...tokens,
    };
  }

  // ─── تسجيل الدخول (USER_FLOWS 2 — الفحص موحّد: المالك أولاً ثم العامل) ──

  async login(dto: LoginDto, ip?: string) {
    this.validateDeviceFingerprint(dto.deviceFingerprint);

    // 0) فحص حظر الجهاز مباشرة من قاعدة البيانات
    const existingDevice = await this.prisma.device.findUnique({
      where: { deviceFingerprint: dto.deviceFingerprint },
    });
    if (existingDevice && existingDevice.status === 'BLOCKED') {
      await this.audit.log({
        actorType: 'SYSTEM',
        actionType: 'LOGIN_BLOCKED_DEVICE',
        result: 'FAILURE',
        failureReason: 'DEVICE_BLOCKED',
        ipAddress: ip,
        deviceInfo: dto.deviceFingerprint,
      });
      throw ApiError.forbidden('DEVICE_BLOCKED', 'هذا الجهاز محظور من استخدام النظام. تواصل مع الإدارة.');
    }

    const owner = await this.prisma.storeOwner.findFirst({
      where: { phone: dto.phone, deletedAt: null },
    });
    const worker = owner
      ? null
      : await this.prisma.worker.findUnique({
        where: { phone: dto.phone },
        include: { storeOwner: true },
      });

    if (!owner && !worker) {
      throw this.invalidCredentials(ip, dto.deviceFingerprint);
    }

    // 1) بيانات الدخول: كلمة المرور العادية أولاً؛ لصاحب المتجر فقط نتحقق من الكلمة الاحتياطية عند فشل العادية
    let tempPasswordUsed = false;
    const ok =
      owner
        ? await argonVerify(owner.passwordHash, dto.password).catch(() => false)
        : await argonVerify(worker!.passwordHash, dto.password).catch(() => false);

    if (!ok) {
      if (owner && owner.tempPasswordHash && this.isTempPasswordValid(owner)) {
        tempPasswordUsed = await argonVerify(owner.tempPasswordHash, dto.password).catch(() => false);
      }
      if (!tempPasswordUsed) {
        throw this.invalidCredentials(ip, dto.deviceFingerprint);
      }
    }

    // 2) حالة المالك (أو المالك الأب) أولاً — 423 ACCOUNT_LOCKED الموحّد مع reason
    const parent = owner ?? worker!.storeOwner;
    const parentStatus = parent.status;
    if (
      parentStatus === StoreOwnerStatus.TRIAL_EXPIRED ||
      parentStatus === StoreOwnerStatus.EXPIRED ||
      parentStatus === StoreOwnerStatus.SUSPENDED
    ) {
      const reason =
        parentStatus === StoreOwnerStatus.TRIAL_EXPIRED
          ? 'TRIAL_EXPIRED'
          : parentStatus === StoreOwnerStatus.EXPIRED
            ? 'SUBSCRIPTION_EXPIRED'
            : 'SUSPENDED';
      await this.audit.log({
        actorType: worker ? 'WORKER' : 'STORE_OWNER',
        actorId: worker?.id ?? owner!.id,
        actionType: 'LOGIN_BLOCKED_LOCKED_ACCOUNT',
        targetType: worker ? 'worker' : 'store_owner',
        targetId: worker?.id ?? owner!.id,
        result: 'FAILURE',
        failureReason: reason,
        ipAddress: ip,
        deviceInfo: dto.deviceFingerprint,
      });
      const { phone, whatsapp } = await this.getSupportContacts();
      const lockedMsg = await this.getLockedOwnerMessage(
        parentStatus as 'TRIAL_EXPIRED' | 'EXPIRED' | 'SUSPENDED',
        phone,
      );
      throw ApiError.locked(reason, lockedMsg, {
        contact_phone: phone,
        contact_whatsapp: whatsapp,
      });
    }

    // 3) حالة العامل: موقوف؟ — 423 ACCOUNT_LOCKED (reason=WORKER_SUSPENDED)
    if (worker && worker.status !== WorkerStatus.ACTIVE) {
      await this.audit.log({
        actorType: 'WORKER',
        actorId: worker.id,
        actionType: 'LOGIN_BLOCKED_SUSPENDED_WORKER',
        targetType: 'worker',
        targetId: worker.id,
        result: 'FAILURE',
        failureReason: 'WORKER_SUSPENDED',
        ipAddress: ip,
        deviceInfo: dto.deviceFingerprint,
      });
      const { phone, whatsapp } = await this.getSupportContacts();
      throw ApiError.locked(
        'WORKER_SUSPENDED',
        `الحساب موقوف مؤقتاً. تواصل مع المالك لإعادة تفعيله. للتواصل والدعم: ${phone}`,
        {
          contact_phone: phone,
          contact_whatsapp: whatsapp,
        },
      );
    }

    // 4) دخول بكلمة مرور احتياطية → توجيه إلزامي لشاشة SET_NEW_PASSWORD (R-32)
    if (tempPasswordUsed) {
      // ختم أحدث سجل TempPasswordAudit للمالك كـ مستخدم (usedAt)
      const latestAudit = await this.prisma.tempPasswordAudit.findFirst({
        where: { storeOwnerId: owner!.id, usedAt: null },
        orderBy: { generatedAt: 'desc' },
      });
      if (latestAudit) {
        await this.prisma.tempPasswordAudit.update({
          where: { id: latestAudit.id },
          data: { usedAt: new Date() },
        });
      }

      // تسجيل وتحديث ظهور الجهاز
      await this.prisma.device.upsert({
        where: { deviceFingerprint: dto.deviceFingerprint },
        create: {
          deviceFingerprint: dto.deviceFingerprint,
          storeOwnerId: owner!.id,
          lastSeenAt: new Date(),
        },
        update: { lastSeenAt: new Date() },
      });

      const tempToken = await this.jwt.signAsync(
        { sub: owner!.id, role: 'STORE_OWNER', storeOwnerId: owner!.id, scope: 'set-new-password' },
        { expiresIn: '10m' },
      );
      await this.audit.log({
        actorType: 'STORE_OWNER',
        actorId: owner!.id,
        actionType: 'TEMP_PASSWORD_USED',
        targetType: 'store_owner',
        targetId: owner!.id,
        result: 'SUCCESS',
        ipAddress: ip,
        deviceInfo: dto.deviceFingerprint,
      });
      return { must_change_password: true as const, temp_access_token: tempToken };
    }

    // نجاح كامل
    await this.prisma.device.upsert({
      where: { deviceFingerprint: dto.deviceFingerprint },
      create: {
        deviceFingerprint: dto.deviceFingerprint,
        storeOwnerId: worker ? worker.storeOwnerId : owner!.id,
        workerId: worker?.id,
      },
      update: { lastSeenAt: new Date(), workerId: worker?.id ?? undefined },
    });
    if (worker) {
      await this.prisma.worker.update({
        where: { id: worker.id },
        data: { lastLoginAt: new Date() },
      });
    }

    const user: AuthenticatedUser = worker
      ? {
        userId: worker.id,
        role: 'WORKER',
        storeOwnerId: worker.storeOwnerId,
        workerId: worker.id,
        isResponsible: worker.isResponsible,
      }
      : { userId: owner!.id, role: 'STORE_OWNER', storeOwnerId: owner!.id };

    const tokens = await this.issueTokens(user, dto.deviceFingerprint);
    await this.audit.log({
      actorType: worker ? 'WORKER' : 'STORE_OWNER',
      actorId: user.userId,
      actionType: 'LOGIN_SUCCESS',
      targetType: worker ? 'worker' : 'store_owner',
      targetId: user.userId,
      result: 'SUCCESS',
      ipAddress: ip,
      deviceInfo: dto.deviceFingerprint,
    });

    return {
      role: user.role,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      account_status: worker ? worker.status : owner!.status,
      user: worker
        ? {
          id: worker.id,
          storeOwnerId: worker.storeOwnerId,
          name: worker.fullName,
          storeName: worker.storeOwner.storeName,
          phone: worker.phone,
          role: 'WORKER',
          accountStatus: worker.storeOwner.status,
          isResponsibleWorker: worker.isResponsible,
          allowResponsiblePurchases: worker.isResponsible
            ? worker.storeOwner.allowResponsiblePurchases
            : false,
          trialSalesUsed: worker.storeOwner.trialSalesUsed,
          trialSalesLimit: worker.storeOwner.trialSalesLimit,
          permissions: {
            showCostPrice: worker.permShowCostPrice,
            showSellPricesInventory: worker.permShowSellPricesInventory,
            damagedGoodsEntry: worker.permDamagedGoodsEntry,
            reportsAccess: worker.permReportsAccess,
            enterOwnAdvance: worker.permEnterOwnAdvance,
            editWorkerClosingCash: worker.permEditWorkerClosingCash,
          },
        }
        : {
          id: owner!.id,
          storeOwnerId: owner!.id,
          name: owner!.fullName,
          storeName: owner!.storeName,
          phone: owner!.phone,
          role: 'STORE_OWNER',
          accountStatus: owner!.status,
          isResponsibleWorker: false,
          allowResponsiblePurchases: owner!.allowResponsiblePurchases,
          trialSalesUsed: owner!.trialSalesUsed,
          trialSalesLimit: owner!.trialSalesLimit,
        },
    };
  }

  // ─── إكمال تدفق كلمة المرور المؤقتة (R-32) ──────────────────────────────

  async setNewPassword(
    dto: SetNewPasswordDto,
    user: AuthenticatedUser,
    ip?: string,
    deviceFingerprint?: string,
  ) {
    if (user.scope !== 'set-new-password' || user.role !== 'STORE_OWNER') {
      throw ApiError.forbidden('PERMISSION_DENIED', 'هذا التوكن محدود الغرض ولا يصلح لهذا الإجراء.');
    }
    if (dto.newPassword !== dto.newPasswordConfirmation) {
      throw ApiError.badRequest('PASSWORD_MISMATCH', 'كلمتا المرور غير متطابقتين.');
    }

    const passwordHash = await hash(dto.newPassword);
    const now = new Date();

    const owner = await this.prisma.$transaction(async (tx) => {
      // 1) تحديث كلمة مرور المالك وتصفير المؤقتة
      const updatedOwner = await tx.storeOwner.update({
        where: { id: user.userId },
        data: {
          passwordHash,
          tempPasswordHash: null,
          tempPasswordGeneratedAt: null,
          mustChangePassword: false,
        },
      });

      // 2) ختم كافة سجلات كلمات المرور المؤقتة المفتوحة كـ مستخدمة
      await tx.tempPasswordAudit.updateMany({
        where: { storeOwnerId: user.userId, usedAt: null },
        data: { usedAt: now },
      });

      // 3) إلغاء كافة جلسات التحديث القديمة للمالك لضمان الأمان
      await tx.refreshSession.updateMany({
        where: { userId: user.userId, userType: 'STORE_OWNER', revokedAt: null },
        data: { revokedAt: now },
      });

      return updatedOwner;
    });

    await this.audit.log({
      actorType: 'STORE_OWNER',
      actorId: owner.id,
      actionType: 'PASSWORD_SET',
      targetType: 'store_owner',
      targetId: owner.id,
      result: 'SUCCESS',
      ipAddress: ip,
    });

    // استخراج بصمة الجهاز الممررة أو أحدث جهاز نشط للمالك لربطه بجلسة التحديث الجديدة
    let effectiveFingerprint = deviceFingerprint;
    if (!effectiveFingerprint) {
      const latestDevice = await this.prisma.device.findFirst({
        where: { storeOwnerId: owner.id },
        orderBy: { lastSeenAt: 'desc' },
        select: { deviceFingerprint: true },
      });
      effectiveFingerprint = latestDevice?.deviceFingerprint;
    }

    const tokens = await this.issueTokens(
      { userId: owner.id, role: 'STORE_OWNER', storeOwnerId: owner.id },
      effectiveFingerprint,
    );
    return {
      ...tokens,
      role: 'STORE_OWNER' as const,
      account_status: owner.status,
      user: {
        id: owner.id,
        storeOwnerId: owner.id,
        name: owner.fullName,
        storeName: owner.storeName,
        phone: owner.phone,
        role: 'STORE_OWNER',
        accountStatus: owner.status,
        isResponsibleWorker: false,
        allowResponsiblePurchases: owner.allowResponsiblePurchases,
        trialSalesUsed: owner.trialSalesUsed,
        trialSalesLimit: owner.trialSalesLimit,
      },
    };
  }

  // ─── تدوير refresh_token (13-auth §1.4 Rotation) ────────────────────────

  async refresh(refreshToken: string, ip?: string) {
    const tokenHash = this.sha256(refreshToken);
    const session = await this.prisma.refreshSession.findUnique({
      where: { tokenHash },
      include: { device: true },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw ApiError.unauthorized('INVALID_REFRESH_TOKEN', 'انتهت صلاحية الجلسة أو غير صالحة.');
    }
    if (session.device && session.device.status === 'BLOCKED') {
      throw ApiError.forbidden('DEVICE_BLOCKED', 'هذا الجهاز محظور من استخدام النظام. تواصل مع الإدارة.');
    }

    // إبطال القديم وإنشاء جديد (دوران — منع إعادة استخدام توكن مسروق)
    const newRefreshToken = randomBytes(48).toString('hex');
    await this.prisma.$transaction([
      this.prisma.refreshSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      }),
      this.prisma.refreshSession.create({
        data: {
          userType: session.userType,
          userId: session.userId,
          deviceId: session.deviceId,
          tokenHash: this.sha256(newRefreshToken),
          expiresAt: this.refreshExpiry(session.userType),
        },
      }),
    ]);

    const user = await this.loadUserForTokens(session.userType, session.userId);
    const accessToken = await this.jwt.signAsync(this.tokenPayload(user), {
      expiresIn: session.userType === 'PLATFORM_ADMIN'
        ? this.config.getOrThrow('ADMIN_JWT_ACCESS_TOKEN_TTL')
        : this.config.getOrThrow('JWT_ACCESS_TOKEN_TTL'),
    });
    return { access_token: accessToken, refresh_token: newRefreshToken };
  }

  // ─── إبطال الجلسة (logout) ──────────────────────────────────────────────

  async logout(refreshToken: string | undefined, ip?: string) {
    if (refreshToken) {
      const tokenHash = this.sha256(refreshToken);
      await this.prisma.refreshSession.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return { logged_out: true as const };
  }

  // ─── دخول App Owner (مسار منفصل + MFA إلزامي — 13-auth §1.1/§8) ─────────

  async adminLogin(dto: { phone: string; password: string }, ip?: string) {
    const admin = await this.prisma.platformAdmin.findUnique({ where: { phone: dto.phone } });
    const ok = admin ? await argonVerify(admin.passwordHash, dto.password).catch(() => false) : false;
    if (!admin || !ok) {
      await this.audit.log({
        actorType: 'PLATFORM_ADMIN',
        actorId: admin?.id,
        actionType: 'ADMIN_LOGIN_FAILED',
        result: 'FAILURE',
        failureReason: 'INVALID_CREDENTIALS',
        ipAddress: ip,
      });
      throw ApiError.unauthorized('INVALID_CREDENTIALS', 'بيانات دخول غير صحيحة.');
    }

    // التسجيل عند أول دخول: يُولَّد سرّ TOTP ويُعرض otpauth_url مرة واحدة ثم يُحفظ
    let enrollment: { secret: string; otpauth_url: string } | undefined;
    if (!admin.mfaSecret) {
      const secret = authenticator.generateSecret();
      await this.prisma.platformAdmin.update({
        where: { id: admin.id },
        data: { mfaSecret: secret },
      });
      enrollment = {
        secret,
        otpauth_url: authenticator.keyuri(admin.phone, 'Maquaty Admin Portal', secret),
      };
      await this.audit.log({
        actorType: 'PLATFORM_ADMIN',
        actorId: admin.id,
        actionType: 'MFA_ENROLL',
        result: 'SUCCESS',
        ipAddress: ip,
      });
    }

    const challengeToken = await this.jwt.signAsync(
      { sub: admin.id, role: 'PLATFORM_ADMIN', scope: 'mfa' },
      { expiresIn: '5m' },
    );
    return { mfa_required: true as const, mfa_challenge_token: challengeToken, ...(enrollment ? { mfa_enrollment: enrollment } : {}) };
  }

  async adminMfaVerify(dto: { mfaChallengeToken: string; code: string }, ip?: string) {
    let payload: { sub: string; scope?: string };
    try {
      payload = await this.jwt.verifyAsync(dto.mfaChallengeToken);
    } catch {
      throw new ApiError(419, 'MFA_CHALLENGE_EXPIRED', 'انتهت صلاحية تحدي MFA، أعد الدخول.');
    }
    if (payload.scope !== 'mfa') {
      throw ApiError.forbidden('PERMISSION_DENIED', 'هذا التوكن محدود الغرض ولا يصلح لهذا الإجراء.');
    }

    const admin = await this.prisma.platformAdmin.findUnique({ where: { id: payload.sub } });
    if (!admin?.mfaSecret) {
      throw ApiError.badRequest('VALIDATION_ERROR', 'لم يُسجَّل مُصدِّق MFA بعد.');
    }

    if (admin.mfaLockedUntil && admin.mfaLockedUntil > new Date()) {
      throw ApiError.locked(
        'MFA_LOCKED',
        'تم قفل الحساب مؤقتاً بسبب تكرار محاولات MFA الخاطئة. حاول لاحقاً.',
      );
    }

    const ok = authenticator.verify({ token: dto.code, secret: admin.mfaSecret });
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

      await this.audit.log({
        actorType: 'PLATFORM_ADMIN',
        actorId: admin.id,
        actionType: 'MFA_VERIFY_FAILED',
        result: 'FAILURE',
        failureReason: isLockedNow ? 'MFA_LOCKED_MAX_ATTEMPTS' : 'INVALID_MFA_CODE',
        ipAddress: ip,
      });

      if (isLockedNow) {
        throw ApiError.locked(
          'MFA_LOCKED',
          'تم قفل الحساب مؤقتاً لمدة 15 دقيقة بسبب تكرار المحاولات الخاطئة (5 محاولات).',
        );
      }
      throw ApiError.unauthorized('INVALID_MFA_CODE', 'كود MFA غير صحيح.');
    }

    await this.prisma.platformAdmin.update({
      where: { id: admin.id },
      data: {
        failedMfaAttempts: 0,
        mfaLockedUntil: null,
        ...(!admin.mfaEnabled ? { mfaEnabled: true } : {}),
      },
    });

    const user: AuthenticatedUser = { userId: admin.id, role: 'PLATFORM_ADMIN' };
    const refreshToken = randomBytes(48).toString('hex');
    await this.prisma.refreshSession.create({
      data: {
        userType: 'PLATFORM_ADMIN',
        userId: admin.id,
        tokenHash: this.sha256(refreshToken),
        expiresAt: this.refreshExpiry('PLATFORM_ADMIN'),
      },
    });
    const accessToken = await this.jwt.signAsync(this.tokenPayload(user), {
      expiresIn: this.config.getOrThrow('ADMIN_JWT_ACCESS_TOKEN_TTL'),
    });
    await this.audit.log({
      actorType: 'PLATFORM_ADMIN',
      actorId: admin.id,
      actionType: 'MFA_VERIFY_SUCCESS',
      result: 'SUCCESS',
      ipAddress: ip,
    });
    return {
      role: 'PLATFORM_ADMIN' as const,
      access_token: accessToken,
      refresh_token: refreshToken,
    };
  }

  // ─── أدوات داخلية ───────────────────────────────────────────────────────

  private invalidCredentials(ip?: string, deviceInfo?: string): ApiError {
    void this.audit.log({
      actorType: 'SYSTEM',
      actionType: 'LOGIN_FAILED',
      result: 'FAILURE',
      failureReason: 'INVALID_CREDENTIALS',
      ipAddress: ip,
      deviceInfo,
    });
    // موحّدة لكل أسباب الفشل — لا تكشف هل الرقم موجود (13-auth §6)
    return ApiError.unauthorized('INVALID_CREDENTIALS', 'بيانات الدخول غير صحيحة.');
  }

  private isTempPasswordValid(owner: { tempPasswordGeneratedAt: Date | null }): boolean {
    if (!owner.tempPasswordGeneratedAt) return false;
    const hours = Number(this.config.get('TEMP_PASSWORD_VALIDITY_HOURS') ?? 24); // R-32: 24 ساعة افتراضياً
    const expiresAt = new Date(owner.tempPasswordGeneratedAt.getTime() + hours * 3_600_000);
    return expiresAt > new Date();
  }

  private async getTrialSalesLimit(): Promise<number> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: 'trial_sales_limit' },
    });
    const raw: unknown = setting?.value;
    const value = typeof raw === 'object' && raw !== null ? (raw as { v?: unknown }).v : raw;
    return typeof value === 'number' ? value : 50;
  }

  private async getSystemTextSetting(key: string, fallback: string): Promise<string> {
    try {
      const setting = await this.prisma.systemSetting?.findUnique({ where: { key } });
      const raw: unknown = setting?.value;
      const value = typeof raw === 'object' && raw !== null && 'v' in raw ? (raw as { v?: unknown }).v : raw;
      return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
    } catch {
      return fallback;
    }
  }

  private async getContactPhone(): Promise<string> {
    return this.getSystemTextSetting('contact_phone', '735717710');
  }

  private async getSupportContacts(): Promise<{ phone: string; whatsapp: string }> {
    const phone = await this.getSystemTextSetting('contact_phone', '735717710');
    const whatsapp = await this.getSystemTextSetting('contact_whatsapp', phone);
    return { phone, whatsapp };
  }

  private async getLockedOwnerMessage(
    status: 'TRIAL_EXPIRED' | 'EXPIRED' | 'SUSPENDED',
    phone?: string,
  ): Promise<string> {
    const keyMap: Record<'TRIAL_EXPIRED' | 'EXPIRED' | 'SUSPENDED', string> = {
      TRIAL_EXPIRED: 'trial_expired_message',
      EXPIRED: 'subscription_expired_message',
      SUSPENDED: 'suspended_message',
    };
    let msg = await this.getSystemTextSetting(keyMap[status], LOCKED_OWNER_STATUSES[status]);
    if (phone && !/\d{7,15}/.test(msg)) {
      msg = `${msg} للتواصل والدعم: ${phone}`;
    }
    return msg;
  }

  private tokenPayload(user: AuthenticatedUser) {
    return {
      sub: user.userId,
      role: user.role,
      ...(user.storeOwnerId ? { storeOwnerId: user.storeOwnerId } : {}),
      ...(user.workerId ? { workerId: user.workerId } : {}),
      ...(user.isResponsible !== undefined ? { isResponsible: user.isResponsible } : {}),
      ...(user.scope ? { scope: user.scope } : {}),
    };
  }

  private async loadUserForTokens(userType: string, userId: string): Promise<AuthenticatedUser> {
    if (userType === 'PLATFORM_ADMIN') {
      return { userId, role: 'PLATFORM_ADMIN' };
    }
    if (userType === 'WORKER') {
      const w = await this.prisma.worker.findUniqueOrThrow({ where: { id: userId } });
      return {
        userId: w.id,
        role: 'WORKER',
        storeOwnerId: w.storeOwnerId,
        workerId: w.id,
        isResponsible: w.isResponsible,
      };
    }
    const o = await this.prisma.storeOwner.findUniqueOrThrow({ where: { id: userId } });
    return { userId: o.id, role: 'STORE_OWNER', storeOwnerId: o.id };
  }

  private refreshExpiry(userType: string): Date {
    const ttl =
      userType === 'PLATFORM_ADMIN'
        ? this.config.getOrThrow('ADMIN_JWT_REFRESH_TOKEN_TTL')
        : this.config.getOrThrow('JWT_REFRESH_TOKEN_TTL');
    return new Date(Date.now() + this.parseTtlMs(ttl));
  }

  private parseTtlMs(ttl: string): number {
    const match = /^(\d+)([smhd])$/.exec(ttl);
    if (!match) return 30 * 24 * 3_600_000;
    const n = Number(match[1]);
    const unit: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
    return n * unit[match[2]];
  }

  private async issueTokens(user: AuthenticatedUser, deviceFingerprint: string | undefined) {
    const accessToken = await this.jwt.signAsync(this.tokenPayload(user), {
      expiresIn: this.config.getOrThrow('JWT_ACCESS_TOKEN_TTL'),
    });
    const refreshToken = randomBytes(48).toString('hex');
    let deviceId: string | undefined;
    if (deviceFingerprint) {
      const device = await this.prisma.device.findUnique({
        where: { deviceFingerprint },
        select: { id: true },
      });
      deviceId = device?.id;
    }
    await this.prisma.refreshSession.create({
      data: {
        userType: user.role === 'WORKER' ? 'WORKER' : 'STORE_OWNER',
        userId: user.userId,
        deviceId,
        tokenHash: this.sha256(refreshToken),
        expiresAt: this.refreshExpiry(user.role === 'WORKER' ? 'WORKER' : 'STORE_OWNER'),
      },
    });
    return { access_token: accessToken, refresh_token: refreshToken };
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  // مولّد كلمة المرور الاحتياطية المؤقتة (يُستخدم لاحقاً في Admin Portal — R-32)
  generateTempPassword(): string {
    return randomBytes(6).toString('base64url').slice(0, 10) + randomInt(10, 99).toString();
  }

  private validateDeviceFingerprint(fingerprint: string | undefined): void {
    if (
      !fingerprint ||
      fingerprint.trim() === 'APP-DEVICE-DEFAULT' ||
      fingerprint.trim().length < 8
    ) {
      throw ApiError.badRequest(
        'INVALID_DEVICE_FINGERPRINT',
        'بصمة الجهاز غير صالحة أو غير مسموح بها. يجب ألا تقل عن 8 خانات وألا تكون قيمة عامة افتراضية.',
      );
    }
  }
}
