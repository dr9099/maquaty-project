import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../dist/app.module.js';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { RateLimitGuard } from '../dist/common/rate-limit.guard.js';
import { AccountStatusGuard } from '../dist/common/account-status.guard.js';
import { securityHeadersMiddleware } from '../dist/common/security-headers.middleware.js';
import { ReportsService } from '../dist/reports/reports.service.js';
import { CreditService } from '../dist/credit/credit.service.js';
import { AccountingService } from '../dist/accounting/accounting.service.js';
import { AuditService } from '../dist/audit/audit.service.js';
import { SuppliersService } from '../dist/suppliers/suppliers.service.js';
import { PurchasesService } from '../dist/purchases/purchases.service.js';

let app;
let baseUrl;
let prisma;
let rateLimitGuard;
let reportsService;
let creditService;
let suppliersService;
let purchasesService;

const createdOwnerIds = [];
const createdUploadFiles = [];
const uploadDir = path.resolve(process.cwd(), 'uploads');

before(async () => {
  AccountStatusGuard.clearAllCache();
  RateLimitGuard.clearAllBuckets();
  app = await NestFactory.create(AppModule, { logger: ['error'], abortOnError: false });
  app.setGlobalPrefix('v1');
  app.use(securityHeadersMiddleware);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  await app.listen(0, '127.0.0.1');

  const address = app.getHttpServer().address();
  baseUrl = `http://127.0.0.1:${address.port}/v1`;

  prisma = app.get(PrismaService);
  rateLimitGuard = app.get(RateLimitGuard);
  reportsService = app.get(ReportsService);
  creditService = app.get(CreditService);
  const accounting = app.get(AccountingService);
  const audit = app.get(AuditService);
  suppliersService = new SuppliersService(prisma, accounting, audit);
  purchasesService = new PurchasesService(prisma, accounting, audit, suppliersService);
});

after(async () => {
  for (const filename of createdUploadFiles) {
    const p = path.join(uploadDir, filename);
    if (fs.existsSync(p)) {
      try {
        fs.unlinkSync(p);
      } catch {}
    }
  }

  for (const ownerId of createdOwnerIds) {
    try {
      await prisma.refreshSession.deleteMany({ where: { userId: ownerId } });
      await prisma.syncOperation.deleteMany({ where: { storeOwnerId: ownerId } });
      await prisma.device.deleteMany({ where: { storeOwnerId: ownerId } });
      await prisma.ledgerEntry.deleteMany({ where: { storeOwnerId: ownerId } });
      await prisma.creditPayment.deleteMany({ where: { storeOwnerId: ownerId } });
      await prisma.purchaseReturn.deleteMany({ where: { storeOwnerId: ownerId } });
      await prisma.supplierPayment.deleteMany({ where: { storeOwnerId: ownerId } });
      await prisma.purchaseItem.deleteMany({ where: { storeOwnerId: ownerId } });
      await prisma.purchaseInvoice.deleteMany({ where: { storeOwnerId: ownerId } });
      await prisma.sale.deleteMany({ where: { storeOwnerId: ownerId } });
      await prisma.creditCustomer.deleteMany({ where: { storeOwnerId: ownerId } });
      await prisma.item.deleteMany({ where: { storeOwnerId: ownerId } });
      await prisma.supplier.deleteMany({ where: { storeOwnerId: ownerId } });
      await prisma.worker.deleteMany({ where: { storeOwnerId: ownerId } });
      await prisma.chartOfAccount.deleteMany({ where: { storeOwnerId: ownerId } });
      await prisma.auditLog.deleteMany({ where: { actorId: ownerId } });
      await prisma.storeOwner.deleteMany({ where: { id: ownerId } });
    } catch {}
  }

  if (app) {
    await app.close();
  }
});

async function registerTrialOwner() {
  const phone = `73${Math.floor(1000000 + Math.random() * 8999999)}`;
  const deviceFingerprint = `DEV-PH9-${crypto.randomUUID().slice(0, 10)}`;
  const res = await fetch(`${baseUrl}/auth/register-store-owner`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'مالك اختبار الأمان',
      storeName: 'متجر الأمان الشامل',
      phone,
      password: 'StrongPassword123!',
      passwordConfirmation: 'StrongPassword123!',
      deviceFingerprint,
    }),
  });
  const body = await res.json();
  assert.equal(res.status, 201, `Expected 201 registering owner, got ${res.status}: ${JSON.stringify(body)}`);
  createdOwnerIds.push(body.account.id);
  return {
    ownerId: body.account.id,
    phone,
    deviceFingerprint,
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
  };
}

test('1. Security Headers: responses include strict anti-MIME, anti-clickjacking & privacy headers', async () => {
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(res.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()');
});

test('2. Magic-Bytes Upload Hardening: rejects spoofed .jpg containing <script> and serves valid PNG with UUID + nosniff', async () => {
  rateLimitGuard.clearAllBuckets();
  const session = await registerTrialOwner();

  const filesBefore = new Set(fs.existsSync(uploadDir) ? fs.readdirSync(uploadDir) : []);

  // 1) محاولة رفع ملف .jpg مزيف يحتوي على XSS script بدلاً من توقيع JPEG الحقيقي
  const spoofForm = new FormData();
  spoofForm.append(
    'file',
    new Blob(['<script>alert("xss")</script>'], { type: 'image/jpeg' }),
    'evil.jpg',
  );
  const spoofRes = await fetch(`${baseUrl}/uploads`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      'X-Device-Fingerprint': session.deviceFingerprint,
    },
    body: spoofForm,
  });
  const spoofBody = await spoofRes.json();
  assert.equal(spoofRes.status, 400);
  assert.equal(spoofBody.error?.code, 'INVALID_FILE_TYPE');

  // التأكد من حذف الملف المرفوض فوراً من القرص
  const filesAfterSpoof = new Set(fs.existsSync(uploadDir) ? fs.readdirSync(uploadDir) : []);
  assert.equal(filesAfterSpoof.size, filesBefore.size, 'Spoofed upload file must be deleted from disk');

  // 2) رفع ملف PNG حقيقي بتوقيع 89 50 4E 47
  const realPngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
  const validForm = new FormData();
  validForm.append('file', new Blob([realPngBytes], { type: 'image/png' }), 'receipt.png');
  const validRes = await fetch(`${baseUrl}/uploads`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      'X-Device-Fingerprint': session.deviceFingerprint,
    },
    body: validForm,
  });
  const validBody = await validRes.json();
  assert.equal(validRes.status, 201);
  assert.match(
    validBody.filename,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/i,
    'Filename must use UUID v4',
  );
  createdUploadFiles.push(validBody.filename);

  // 3) استرجاع الملف والتأكد من ترويسات الحماية
  const getRes = await fetch(`${baseUrl}/uploads/${validBody.filename}`);
  assert.equal(getRes.status, 200);
  assert.equal(getRes.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(getRes.headers.get('content-security-policy'), "default-src 'none'");

  // 4) رفض تحميل أكثر من ملف واحد في طلب واحد (files: 1 limit)
  const multiForm = new FormData();
  multiForm.append('file1', new Blob([realPngBytes], { type: 'image/png' }), 'a.png');
  multiForm.append('file2', new Blob([realPngBytes], { type: 'image/png' }), 'b.png');
  const multiRes = await fetch(`${baseUrl}/uploads`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      'X-Device-Fingerprint': session.deviceFingerprint,
    },
    body: multiForm,
  });
  assert.equal(multiRes.status >= 400 && multiRes.status < 500, true, 'Multi-file upload must be rejected');
});

test('3. Rate Limiting (DoS Protection): Auth endpoint returns 429 TOO_MANY_REQUESTS after 10 requests/min', async () => {
  rateLimitGuard.clearAllBuckets();

  let last429Body = null;
  let statuses = [];
  for (let i = 0; i < 11; i++) {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-rate-limit': 'enforce',
      },
      body: JSON.stringify({
        phone: '777000000',
        password: 'wrong-password',
        deviceFingerprint: 'DEV-RATELIMIT-TEST-1',
      }),
    });
    statuses.push(res.status);
    if (res.status === 429) {
      last429Body = await res.json();
    }
  }

  for (let i = 0; i < 10; i++) {
    assert.notEqual(statuses[i], 429, `Request #${i + 1} should not be rate limited`);
  }
  assert.equal(statuses[10], 429, '11th request within 1 minute must trigger 429');
  assert.equal(last429Body?.error?.code, 'TOO_MANY_REQUESTS');
  assert.equal(
    last429Body?.error?.message,
    'تم تجاوز الحد المسموح من المحاولات، يرجى الانتظار دقيقة والمحاولة مجدداً.',
  );

  rateLimitGuard.clearAllBuckets();
});

test('4. Trial Quota Tamper Resistance & Refresh Token Rotation', async () => {
  rateLimitGuard.clearAllBuckets();

  // 1) تمرير trialSalesLimit في التسجيل مرفوض بسبب forbidNonWhitelisted
  const badReg = await fetch(`${baseUrl}/auth/register-store-owner`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'متلاعب',
      storeName: 'متجر متلاعب',
      phone: `73${Math.floor(1000000 + Math.random() * 8999999)}`,
      password: 'StrongPassword123!',
      passwordConfirmation: 'StrongPassword123!',
      deviceFingerprint: `DEV-TAMPER-${crypto.randomUUID().slice(0, 8)}`,
      trialSalesLimit: 9999,
      trialSalesUsed: 0,
    }),
  });
  assert.equal(badReg.status, 400);

  // 2) تسجيل مالك حقيقي والتحقق من تدوير التوكن ورفض التوكن القديم بـ 401
  const session = await registerTrialOwner();
  const refreshRes1 = await fetch(`${baseUrl}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  });
  const refreshBody1 = await refreshRes1.json();
  assert.equal(refreshRes1.status, 200);
  assert.ok(refreshBody1.access_token);
  assert.ok(refreshBody1.refresh_token);

  // إعادة استخدام التوكن القديم يجب أن تُرفض بـ 401
  const replayRes = await fetch(`${baseUrl}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  });
  assert.equal(replayRes.status, 401);

  const activeAccess = refreshBody1.access_token;

  // إنشاء صنف للمتجر
  const item = await prisma.item.create({
    data: {
      storeOwnerId: session.ownerId,
      name: 'صنف اختبار الحصة',
      unit: 'حبة',
      quantity: 100,
      costPrice: 500,
      sellPrice: 1000,
      entryDate: new Date(),
    },
  });

  // 3) تمرير trialSalesLimit في /v1/sales مرفوض بـ 400
  const tamperSaleRes = await fetch(`${baseUrl}/sales`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${activeAccess}`,
      'X-Device-Fingerprint': session.deviceFingerprint,
    },
    body: JSON.stringify({
      itemId: item.id,
      quantity: 1,
      amount: 1000,
      paymentType: 'CASH',
      trialSalesLimit: 9999,
      trialSalesUsed: 0,
    }),
  });
  assert.equal(tamperSaleRes.status, 400);

  // 4) تمرير trialSalesLimit داخل Sync payload يتم تجاهله تماماً ولا يرفع الحصة عن 50
  const syncRes = await fetch(`${baseUrl}/device/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${activeAccess}`,
      'X-Device-Fingerprint': session.deviceFingerprint,
    },
    body: JSON.stringify({
      deviceFingerprint: session.deviceFingerprint,
      lastSyncVersion: 0,
      pendingLocalOperations: [
        {
          clientOpId: crypto.randomUUID(),
          opType: 'SALE',
          payload: {
            itemId: item.id,
            quantity: 1,
            amount: 1000,
            paymentType: 'CASH',
            trialSalesLimit: 9999,
            trialSalesUsed: 0,
          },
        },
      ],
    }),
  });
  const syncBody = await syncRes.json();
  assert.equal(syncRes.status, 200);
  assert.equal(syncBody.processed_operations?.[0]?.status, 'ACCEPTED');

  const ownerAfterSync = await prisma.storeOwner.findUnique({ where: { id: session.ownerId } });
  assert.equal(ownerAfterSync.trialSalesLimit, 50);
  assert.equal(ownerAfterSync.trialSalesUsed, 1);

  // 5) ضبط العداد عند 49 وإثبات قبول البيعة 50 ثم إغلاق الحساب وقفل البيعة 51 بـ 423
  await prisma.storeOwner.update({
    where: { id: session.ownerId },
    data: { trialSalesUsed: 49, status: 'TRIAL_WARNING' },
  });
  AccountStatusGuard.invalidateOwner(session.ownerId);

  const sale50Res = await fetch(`${baseUrl}/sales`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${activeAccess}`,
      'X-Device-Fingerprint': session.deviceFingerprint,
    },
    body: JSON.stringify({
      clientOpId: crypto.randomUUID(),
      itemId: item.id,
      quantity: 1,
      amount: 1000,
      paymentType: 'CASH',
    }),
  });
  const sale50Body = await sale50Res.json();
  assert.equal(sale50Res.status, 201);
  assert.equal(sale50Body.account_status, 'TRIAL_EXPIRED');

  const sale51Res = await fetch(`${baseUrl}/sales`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${activeAccess}`,
      'X-Device-Fingerprint': session.deviceFingerprint,
    },
    body: JSON.stringify({
      clientOpId: crypto.randomUUID(),
      itemId: item.id,
      quantity: 1,
      amount: 1000,
      paymentType: 'CASH',
    }),
  });
  assert.equal(sale51Res.status, 423);
});

test('5. N+1 Elimination: batched getPurchasesBySupplier & CreditService.list preserve exact totals + Guard Cache bounded', async () => {
  rateLimitGuard.clearAllBuckets();
  const session = await registerTrialOwner();
  const ownerId = session.ownerId;
  const ownerUser = { userId: ownerId, storeOwnerId: ownerId, role: 'STORE_OWNER' };

  const item = await prisma.item.create({
    data: {
      storeOwnerId: ownerId,
      name: 'قات تجمعي',
      unit: 'حبة',
      quantity: 0,
      costPrice: 1000,
      sellPrice: 1500,
      entryDate: new Date(),
    },
  });

  const sup1 = await suppliersService.create(ownerUser, { name: 'مورد أول', phone: '771000111' });
  const sup2 = await suppliersService.create(ownerUser, { name: 'مورد ثانٍ', phone: '771000222' });

  await purchasesService.create(ownerUser, {
    supplierId: sup1.id,
    paymentType: 'CREDIT',
    items: [
      { itemId: item.id, itemName: 'قات تجمعي', unit: 'حبة', quantity: 10, unitCostPrice: 1000, sellPrice: 1500 },
    ],
  });
  const inv2 = await purchasesService.create(ownerUser, {
    supplierId: sup2.id,
    paymentType: 'CREDIT',
    items: [
      { itemId: item.id, itemName: 'قات تجمعي', unit: 'حبة', quantity: 5, unitCostPrice: 1000, sellPrice: 1500 },
    ],
  });

  // إرجاع 1 حبة من المورد الثاني وسداد 2000 للمورد الأول
  const inv2Line = await prisma.purchaseItem.findFirst({ where: { purchaseInvoiceId: inv2.id } });
  await purchasesService.createReturn(ownerUser, inv2.id, {
    purchaseItemId: inv2Line.id,
    quantity: 1,
    refundMethod: 'DEBT_REDUCTION',
    reason: 'مرتجع اختبار تجميعي',
  });
  await suppliersService.recordPayment(ownerUser, sup1.id, {
    amount: 2000,
    paymentMethod: 'CASH',
  });

  const rep = await reportsService.getPurchasesBySupplier(ownerId, {});
  assert.equal(rep.total, 2);
  assert.equal(rep.total_net_purchased, 14000);
  assert.equal(rep.total_current_payables, 12000);

  const r1 = rep.records.find((r) => r.supplier_id === sup1.id);
  const r2 = rep.records.find((r) => r.supplier_id === sup2.id);
  assert.equal(r1.total_purchased, 10000);
  assert.equal(r1.total_returned, 0);
  assert.equal(r1.net_purchased, 10000);
  assert.equal(r1.total_paid, 2000);
  assert.equal(r1.current_balance, 8000);

  assert.equal(r2.total_purchased, 5000);
  assert.equal(r2.total_returned, 1000);
  assert.equal(r2.net_purchased, 4000);
  assert.equal(r2.current_balance, 4000);

  // فحص CreditService.list المجمّع
  const cust1 = await creditService.create(ownerUser, { name: 'عميل أ', creditLimit: 20000 });
  const cust2 = await creditService.create(ownerUser, { name: 'عميل ب', creditLimit: 20000 });
  await prisma.sale.create({
    data: {
      storeOwnerId: ownerId,
      itemId: item.id,
      quantity: 2,
      amount: 3000,
      paymentType: 'CREDIT',
      creditCustomerId: cust1.id,
      soldAt: new Date(),
    },
  });
  await creditService.recordPayment(ownerUser, cust1.id, {
    amount: 500,
    paymentMethod: 'CASH',
  });

  const customers = await creditService.list(ownerId);
  assert.equal(customers.find((c) => c.id === cust1.id)?.total_debt, 2500);
  assert.equal(customers.find((c) => c.id === cust2.id)?.total_debt, 0);

  // فحص حد حجم كاش AccountStatusGuard (5000 عنصر كحد أقصى)
  AccountStatusGuard.clearAllCache();
  const mockPrisma = {
    device: { findUnique: async () => ({ status: 'ACTIVE' }) },
    storeOwner: { findUnique: async () => ({ status: 'ACTIVE', allowResponsiblePurchases: true }) },
  };
  const guard = new AccountStatusGuard(mockPrisma);
  for (let i = 0; i < 5050; i++) {
    await guard.canActivate({
      switchToHttp: () => ({
        getRequest: () => ({
          user: { userId: ownerId, role: 'STORE_OWNER', storeOwnerId: ownerId },
          headers: { 'x-device-fingerprint': `DEV-BOUND-${i}` },
        }),
      }),
    });
  }
  assert.ok(AccountStatusGuard.deviceCache.size <= 5000, 'deviceCache size must be bounded to <= 5000');
  AccountStatusGuard.clearAllCache();
});
