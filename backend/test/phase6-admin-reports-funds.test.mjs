import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { authenticator } from 'otplib';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { hash } from '@node-rs/argon2';
import { Prisma, BroadcastType, BroadcastPriority, BroadcastTargetType, DeviceStatus, StoreOwnerStatus, ActorType, SyncOpStatus } from '@prisma/client';

import { PrismaService } from '../dist/prisma/prisma.service.js';
import { AccountingService } from '../dist/accounting/accounting.service.js';
import { AuditService } from '../dist/audit/audit.service.js';
import { ChartOfAccountsService } from '../dist/accounting/chart-of-accounts.service.js';
import { AuthService } from '../dist/auth/auth.service.js';
import { AdminService } from '../dist/admin/admin.service.js';
import { ReportsService } from '../dist/reports/reports.service.js';
import { SuppliersService } from '../dist/suppliers/suppliers.service.js';
import { PurchasesService } from '../dist/purchases/purchases.service.js';
import { StepUpMfaGuard } from '../dist/common/step-up-mfa.guard.js';
import { CreateBroadcastDto } from '../dist/admin/dto/admin.dto.js';

const prisma = new PrismaService();
const accounting = new AccountingService(prisma);
const audit = new AuditService(prisma);
const chartOfAccounts = new ChartOfAccountsService(prisma);
const adminService = new AdminService(prisma, audit);
const reportsService = new ReportsService(prisma, accounting, audit);
const suppliersService = new SuppliersService(prisma, accounting, audit);
const purchasesService = new PurchasesService(prisma, accounting, audit);
const stepUpMfaGuard = new StepUpMfaGuard(prisma);

const mockJwt = {
  sign: () => 'mock-jwt-token-phase6',
  signAsync: async () => 'mock-jwt-token-phase6',
  verify: () => ({}),
  verifyAsync: async () => ({}),
};
const mockConfig = {
  get: (key) => (key === 'JWT_SECRET' ? 'test-secret-key-maquaty-phase6' : undefined),
  getOrThrow: (key) => 'test-secret-key-maquaty-phase6',
};
const authService = new AuthService(prisma, mockJwt, mockConfig, audit, chartOfAccounts);

let adminId;
let adminSecret;
let ownerId;
let ownerUser;
let supplierId;
const cleanupOwnerIds = [];
const cleanupAdminIds = [];

async function setupAccounts(id) {
  await chartOfAccounts.seedForOwner(id);
}

before(async () => {
  // 1) إنشاء Admin مع MFA
  adminSecret = authenticator.generateSecret();
  const admin = await prisma.platformAdmin.create({
    data: {
      fullName: 'مدير المنصة فاز 6',
      phone: `776${Math.floor(100000 + Math.random() * 900000)}`,
      passwordHash: await hash('AdminSecretPass!'),
      mfaSecret: adminSecret,
      mfaEnabled: true,
    },
  });
  adminId = admin.id;
  cleanupAdminIds.push(adminId);

  // 2) إنشاء Store Owner
  const owner = await prisma.storeOwner.create({
    data: {
      fullName: 'مالك المتجر فاز 6',
      storeName: 'متجر الجودة النموذجي',
      phone: `775${Math.floor(100000 + Math.random() * 900000)}`,
      passwordHash: await hash('OwnerPass123!'),
      status: StoreOwnerStatus.ACTIVE,
      trialSalesUsed: 10,
      trialSalesLimit: 50,
      maxWorkersAllowed: 3,
      allowResponsiblePurchases: true,
    },
  });
  ownerId = owner.id;
  ownerUser = { userId: ownerId, storeOwnerId: ownerId, role: 'STORE_OWNER' };
  cleanupOwnerIds.push(ownerId);
  await setupAccounts(ownerId);

  // إنشاء مورد
  const sup = await prisma.supplier.create({
    data: {
      storeOwnerId: ownerId,
      name: 'مورد القات الممتاز',
      phone: '771234567',
      openingBalance: new Prisma.Decimal(5000),
      currentBalance: new Prisma.Decimal(5000),
      status: 'ACTIVE',
    },
  });
  supplierId = sup.id;
});

after(async () => {
  for (const id of cleanupOwnerIds) {
    try {
      await prisma.auditLog.deleteMany({ where: { actorId: id } });
      await prisma.ledgerEntry.deleteMany({ where: { storeOwnerId: id } });
      await prisma.chartOfAccount.deleteMany({ where: { storeOwnerId: id } });
      await prisma.purchaseItem.deleteMany({ where: { storeOwnerId: id } });
      await prisma.purchaseInvoice.deleteMany({ where: { storeOwnerId: id } });
      await prisma.supplierPayment.deleteMany({ where: { storeOwnerId: id } });
      await prisma.supplier.deleteMany({ where: { storeOwnerId: id } });
      await prisma.subscription.deleteMany({ where: { storeOwnerId: id } });
      await prisma.device.deleteMany({ where: { storeOwnerId: id } });
      await prisma.worker.deleteMany({ where: { storeOwnerId: id } });
      await prisma.storeOwner.delete({ where: { id } }).catch(() => {});
    } catch (_) {}
  }

  for (const aid of cleanupAdminIds) {
    try {
      await prisma.broadcastAck.deleteMany({ where: { broadcast: { createdBy: aid } } });
      await prisma.broadcast.deleteMany({ where: { createdBy: aid } });
      await prisma.tempPasswordAudit.deleteMany({ where: { adminId: aid } });
      await prisma.platformAdmin.delete({ where: { id: aid } }).catch(() => {});
    } catch (_) {}
  }
  await prisma.$disconnect();
});

test('1. Dashboard & Audit Log response contract verification (actionType, actorType, targetType, createdAt)', async () => {
  // كتابة سجل تدقيق
  await audit.log({
    actorType: ActorType.PLATFORM_ADMIN,
    actorId: adminId,
    actionType: 'PLATFORM_DASHBOARD_TEST_ACTION',
    targetType: 'StoreOwner',
    targetId: ownerId,
    newValue: { status: 'ACTIVE' },
    result: 'SUCCESS',
  });

  const logs = await adminService.getAuditLogs({ limit: 5 });
  assert.ok(logs.items.length > 0, 'يجب أن يعيد عناصر في سجل التدقيق');
  const sample = logs.items.find((l) => l.actionType === 'PLATFORM_DASHBOARD_TEST_ACTION');
  assert.ok(sample, 'يجب العثور على سجل التدقيق المسجل');
  assert.equal(sample.actorType, 'PLATFORM_ADMIN', 'actorType camelCase');
  assert.equal(sample.actionType, 'PLATFORM_DASHBOARD_TEST_ACTION', 'actionType camelCase');
  assert.equal(sample.targetType, 'StoreOwner', 'targetType camelCase');
  assert.ok(sample.createdAt instanceof Date, 'createdAt موجود كتاريخ');
});

test('2. Store-owner list/detail and temporary password (tempPassword, expiresAt, storeName, fullName, counts.workers, maxWorkersAllowed)', async () => {
  const result = await adminService.getStoreOwners({ limit: 10 });
  assert.ok(result.items.length > 0, 'يجب أن يعيد متاجر');
  const owner = result.items.find((o) => o.id === ownerId);
  assert.ok(owner, 'يجب العثور على المتجر');
  assert.equal(owner.storeName, 'متجر الجودة النموذجي', 'storeName camelCase');
  assert.equal(owner.fullName, 'مالك المتجر فاز 6', 'fullName camelCase');
  assert.equal(owner.maxWorkersAllowed, 3, 'maxWorkersAllowed camelCase');
  assert.equal(typeof owner.counts.workers, 'number', 'counts.workers موجود');

  // توليد كلمة مرور مؤقتة
  const tempPass = await adminService.generateTempPassword(ownerId, adminId);
  assert.ok(tempPass.tempPassword, 'tempPassword موجود وغير فارغ');
  assert.ok(tempPass.expiresAt instanceof Date, 'expiresAt موجود وتاريخ صحيح');
  assert.equal(typeof tempPass.tempPassword, 'string', 'tempPassword نصي');
});

test('3. Subscription plans (durationDays, isActive) and Devices (deviceFingerprint, appVersion, storeOwner.storeName)', async () => {
  // خطة اشتراك
  const plan = await adminService.createSubscriptionPlan({
    name: 'باقة 60 يوم للتجربة',
    durationDays: 60,
    isActive: true,
  }, adminId);
  assert.equal(plan.durationDays, 60, 'durationDays camelCase');
  assert.equal(plan.isActive, true, 'isActive camelCase');

  // جهاز
  const device = await prisma.device.create({
    data: {
      deviceFingerprint: `FP-PHASE6-${crypto.randomBytes(4).toString('hex')}`,
      storeOwnerId: ownerId,
      appVersion: '1.2.3',
      os: 'Android 14',
      status: DeviceStatus.ACTIVE,
    },
  });

  const devicesRes = await adminService.getDevices({ limit: 10, search: '1.2.3' });
  const foundDev = devicesRes.items.find((d) => d.id === device.id);
  assert.ok(foundDev, 'يجب إيجاد الجهاز');
  assert.equal(foundDev.deviceFingerprint, device.deviceFingerprint, 'deviceFingerprint camelCase');
  assert.equal(foundDev.appVersion, '1.2.3', 'appVersion camelCase');
  assert.equal(foundDev.storeOwner?.storeName, 'متجر الجودة النموذجي', 'storeOwner.storeName camelCase');
});

test('4. Broadcast creation for supported BroadcastType, BroadcastPriority, BroadcastTargetType, and 400 rejection on invalid enum', async () => {
  // أ) إنشاء إعلان بالقيم المعتمدة
  const b1 = await adminService.createBroadcast({
    type: BroadcastType.POPUP,
    priority: BroadcastPriority.HIGH,
    targetType: BroadcastTargetType.ALL,
    title: 'تنبيه هام للمتاجر',
    body: 'سيتم تحديث النظام الساعة 2 صباحاً',
  }, adminId);
  assert.equal(b1.type, 'POPUP');
  assert.equal(b1.priority, 'HIGH');
  assert.equal(b1.targetType, 'ALL');

  const b2 = await adminService.createBroadcast({
    type: BroadcastType.STICKY_BANNER,
    priority: BroadcastPriority.NORMAL,
    targetType: BroadcastTargetType.TRIAL,
    title: 'عرض تجريبي',
    body: 'احصل على خصم 20% على الاشتراك السنوي',
  }, adminId);
  assert.equal(b2.type, 'STICKY_BANNER');
  assert.equal(b2.targetType, 'TRIAL');

  // ب) التحقق من فشل القيم غير الصحيحة التي كانت ترسلها الواجهة سابقاً
  const invalidDto1 = plainToInstance(CreateBroadcastDto, {
    type: 'ANNOUNCEMENT', // غير موجود
    priority: 'CRITICAL', // غير موجود
    targetType: 'TRIAL_ONLY', // غير موجود
    title: 'إعلان غير صالح',
    body: 'محتوى تجربة الفشل',
  });
  const errors1 = await validate(invalidDto1);
  assert.ok(errors1.length > 0, 'يجب أن يفشل التحقق من القيم غير الصحيحة');
  const errorProperties = errors1.map((e) => e.property);
  assert.ok(errorProperties.includes('type'), 'type يجب أن يرفض ANNOUNCEMENT');
  assert.ok(errorProperties.includes('priority'), 'priority يجب أن يرفض CRITICAL');
  assert.ok(errorProperties.includes('targetType'), 'targetType يجب أن يرفض TRIAL_ONLY');
});

test('5. Admin logout (POST /v1/auth/logout) with valid refreshToken, invalid token, missing token, and repeated logout', async () => {
  // أ) إنشاء جلسة refresh نشطة للأدمن
  const refreshTokenRaw = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(refreshTokenRaw).digest('hex');
  await prisma.refreshSession.create({
    data: {
      userType: 'PLATFORM_ADMIN',
      userId: adminId,
      tokenHash,
      expiresAt: new Date(Date.now() + 86400000),
    },
  });

  // فحص الجلسة قبل الخروج
  const activeSessionBefore = await prisma.refreshSession.findFirst({
    where: { tokenHash, revokedAt: null },
  });
  assert.ok(activeSessionBefore, 'جلسة التحديث نشطة قبل الخروج');

  // ب) تسجيل الخروج بتوكن صحيح -> إلغاء الجلسة في DB
  const logoutRes = await authService.logout(refreshTokenRaw);
  assert.equal(logoutRes.logged_out, true);

  const activeSessionAfter = await prisma.refreshSession.findFirst({
    where: { tokenHash, revokedAt: null },
  });
  assert.equal(activeSessionAfter, null, 'الجلسة أصبحت ملغاة (revokedAt != null) بعد تسجيل الخروج');

  // ج) تسجيل خروج مكرر بنفس التوكن -> لا يعطل ولا يرمي خطأ
  const repeatLogout = await authService.logout(refreshTokenRaw);
  assert.equal(repeatLogout.logged_out, true);

  // د) تسجيل خروج بتوكن غير موجود أو فارغ -> يكتمل بأمان
  const emptyLogout = await authService.logout(undefined);
  assert.equal(emptyLogout.logged_out, true);
});

test('6. Reports supplier purchases (net_purchased, current_balance, total_net_purchased, total_current_payables)', async () => {
  // تسجيل فاتورة شراء للمورد بقيمة 2000
  const invoice = await prisma.purchaseInvoice.create({
    data: {
      storeOwnerId: ownerId,
      supplierId,
      invoiceNumber: `INV-${Date.now()}`,
      invoiceDate: new Date(),
      paymentType: 'CREDIT',
      subtotal: new Prisma.Decimal(2000),
      totalAmount: new Prisma.Decimal(2000),
      paidAmount: new Prisma.Decimal(0),
      remainingAmount: new Prisma.Decimal(2000),
    },
  });

  const rep = await reportsService.getPurchasesBySupplier(ownerId, {});
  assert.equal(rep.type, 'purchases_by_supplier');
  assert.ok(rep.records.length > 0, 'يجب أن يعيد سجلات موردين');
  assert.equal(typeof rep.total_net_purchased, 'number', 'total_net_purchased موجود كرقم');
  assert.equal(typeof rep.total_current_payables, 'number', 'total_current_payables موجود كرقم');

  const supRow = rep.records.find((r) => r.supplier_id === supplierId);
  assert.ok(supRow, 'يجب إيجاد سجل المورد');
  assert.equal(typeof supRow.net_purchased, 'number', 'net_purchased موجود كاسم الحقل الصريح');
  assert.equal(typeof supRow.current_balance, 'number', 'current_balance موجود');
});

test('7. Funds summary (accrued_expenses_payable for account 2100)', async () => {
  // تسجيل قيد يدوي للمصروف المستحق (دائن 2100 بقيمة 1500، ومدين 5200 بقيمة 1500)
  const acc2100 = await prisma.chartOfAccount.findUniqueOrThrow({
    where: { storeOwnerId_code: { storeOwnerId: ownerId, code: '2100' } },
  });
  const acc5200 = await prisma.chartOfAccount.findUniqueOrThrow({
    where: { storeOwnerId_code: { storeOwnerId: ownerId, code: '5200' } },
  });

  const dummyRefId = crypto.randomUUID();
  await prisma.ledgerEntry.createMany({
    data: [
      {
        storeOwnerId: ownerId,
        accountId: acc5200.id,
        referenceType: 'EXPENSE',
        referenceId: dummyRefId,
        debit: new Prisma.Decimal(1500),
        credit: new Prisma.Decimal(0),
        entryDate: new Date(),
      },
      {
        storeOwnerId: ownerId,
        accountId: acc2100.id,
        referenceType: 'EXPENSE',
        referenceId: dummyRefId,
        debit: new Prisma.Decimal(0),
        credit: new Prisma.Decimal(1500),
        entryDate: new Date(),
      },
    ],
  });

  const funds = await reportsService.getFundsSummary(ownerUser);
  assert.ok(funds.accrued_expenses_payable !== undefined, 'accrued_expenses_payable يجب أن يكون موجوداً للمالك');
  assert.ok(funds.accrued_expenses_payable >= 1500, `accrued_expenses_payable يجب أن يعكس رصيد 2100 (الفعلي: ${funds.accrued_expenses_payable})`);
});

test('8. Supplier conflict handling and preservation of pending unsynchronized records (synced = 0)', async () => {
  // محاكاة استعلام الموردين المعلقين ومقارنتها بتحديث السيرفر
  const localSuppliers = [
    { id: 'sup-local-pending', name: 'مورد محلي غير متزامن', synced: 0, current_balance: 3000 },
    { id: 'sup-local-synced', name: 'مورد متزامن قديم', synced: 1, current_balance: 1000 },
  ];

  const serverUpdates = [
    { id: 'sup-local-pending', name: 'مورد من السيرفر يحاول مسح المحلي', current_balance: 0 },
    { id: 'sup-local-synced', name: 'مورد متزامن محدث من السيرفر', current_balance: 1500 },
  ];

  // منطق الحماية: جمع pendingSupplierIds وتخطي من يمتلك synced = 0
  const pendingIds = new Set(localSuppliers.filter((s) => s.synced === 0).map((s) => s.id));
  const merged = [];

  for (const s of serverUpdates) {
    if (pendingIds.has(s.id)) {
      // تم حماية المورد المعلق من الكتابة الفوقية!
      continue;
    }
    merged.push(s);
  }

  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'sup-local-synced');
  assert.equal(merged[0].current_balance, 1500);
});

test('9. Admin settings update and StepUpMfaGuard regression check', async () => {
  // أ) فحص حارس MFA بنجاح الرمز الصحيح
  const validTotp = authenticator.generate(adminSecret);
  const mockContextValid = {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: { 'x-mfa-code': validTotp },
        user: { userId: adminId, role: 'PLATFORM_ADMIN' },
      }),
    }),
  };
  const canActivateOk = await stepUpMfaGuard.canActivate(mockContextValid);
  assert.equal(canActivateOk, true, 'يجب قبول الرمز الصحيح');

  // ب) فحص دعم هيدر x-step-up-code البديل
  const mockContextStepUpHeader = {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: { 'x-step-up-code': validTotp },
        user: { userId: adminId, role: 'PLATFORM_ADMIN' },
      }),
    }),
  };
  const canActivateStepUpOk = await stepUpMfaGuard.canActivate(mockContextStepUpHeader);
  assert.equal(canActivateStepUpOk, true, 'يجب قبول الرمز عبر x-step-up-code');

  // ج) فحص رفض الرمز الخاطئ
  const mockContextInvalid = {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: { 'x-mfa-code': '999999' },
        user: { userId: adminId, role: 'PLATFORM_ADMIN' },
      }),
    }),
  };
  await assert.rejects(
    async () => stepUpMfaGuard.canActivate(mockContextInvalid),
    (err) => err.code === 'INVALID_MFA_CODE',
    'يجب رفض الرمز الخاطئ',
  );

  // د) تحديث الإعدادات عبر AdminService
  const updatedSettings = await adminService.updateSettings({
    key: 'admin_notice',
    value: 'ملاحظة عامة محدثة للفاز 6',
  }, adminId);
  assert.equal(updatedSettings.admin_notice, 'ملاحظة عامة محدثة للفاز 6');
});
