import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { hash } from '@node-rs/argon2';
import { Prisma, StoreOwnerStatus } from '@prisma/client';

import { PrismaService } from '../dist/prisma/prisma.service.js';
import { AccountingService } from '../dist/accounting/accounting.service.js';
import { AuditService } from '../dist/audit/audit.service.js';
import { ChartOfAccountsService } from '../dist/accounting/chart-of-accounts.service.js';
import { AuthService } from '../dist/auth/auth.service.js';
import { SalesService } from '../dist/sales/sales.service.js';
import { PurchasesService } from '../dist/purchases/purchases.service.js';
import { SuppliersService } from '../dist/suppliers/suppliers.service.js';
import { CreditService } from '../dist/credit/credit.service.js';
import { SettingsService } from '../dist/settings/settings.service.js';
import { AccountStatusGuard } from '../dist/common/account-status.guard.js';
import { UploadsController } from '../dist/uploads/uploads.controller.js';

const prisma = new PrismaService();
const accounting = new AccountingService(prisma);
const audit = new AuditService(prisma);
const chartOfAccounts = new ChartOfAccountsService(prisma);
const salesService = new SalesService(prisma, accounting, audit);
const suppliersService = new SuppliersService(prisma, accounting, audit);
const purchasesService = new PurchasesService(prisma, accounting, audit, suppliersService);
const creditService = new CreditService(prisma, accounting, audit);
const settingsService = new SettingsService(prisma, audit);
const accountStatusGuard = new AccountStatusGuard(prisma);
const uploadsController = new UploadsController();

const mockJwt = {
  sign: () => 'mock-jwt-token-phase7',
  signAsync: async () => 'mock-jwt-token-phase7',
  verify: () => ({}),
  verifyAsync: async () => ({}),
};
const mockConfig = {
  get: (key) => (key === 'JWT_SECRET' ? 'test-secret-key-maquaty-phase7' : undefined),
  getOrThrow: (key) => 'test-secret-key-maquaty-phase7',
};
const authService = new AuthService(prisma, mockJwt, mockConfig, audit, chartOfAccounts);

let ownerId;
let ownerUser;
let itemId;
let walletId;
let customerId;
let supplierId;
const cleanupOwnerIds = [];

before(async () => {
  AccountStatusGuard.clearAllCache();

  // 1) إعداد مالك متجر نشط للاختبار
  const phone = `777${Math.floor(100000 + Math.random() * 900000)}`;
  const passwordHash = await hash('SecurePass123!');
  const owner = await prisma.storeOwner.create({
    data: {
      fullName: 'مالك اختبار المرحلة السابعة',
      storeName: 'محل مَقوتي التجريبي',
      phone,
      passwordHash,
      status: StoreOwnerStatus.ACTIVE,
      trialSalesLimit: 50,
      trialSalesUsed: 0,
      currency: 'YER',
      defaultCostingMethod: 'WEIGHTED_AVERAGE',
    },
  });
  ownerId = owner.id;
  cleanupOwnerIds.push(ownerId);
  await chartOfAccounts.seedForOwner(ownerId);

  ownerUser = {
    userId: ownerId,
    storeOwnerId: ownerId,
    role: 'STORE_OWNER',
  };

  // 2) إنشاء صنف للاختبار
  const item = await prisma.item.create({
    data: {
      storeOwnerId: ownerId,
      name: 'قات تجريبي مرحلة 7',
      unit: 'حبة',
      sellPrice: new Prisma.Decimal(10000),
      costPrice: new Prisma.Decimal(7000),
      quantity: new Prisma.Decimal(20),
      entryDate: new Date(),
    },
  });
  itemId = item.id;

  // 3) إنشاء محفظة إلكترونية
  const wallet = await prisma.wallet.create({
    data: {
      storeOwnerId: ownerId,
      name: 'محفظة بنك الكريمي',
      accountCode: '1100',
      isActive: true,
    },
  });
  walletId = wallet.id;

  // 4) إنشاء عميل آجل
  const customer = await prisma.creditCustomer.create({
    data: {
      storeOwnerId: ownerId,
      name: 'عميل آجل مرحلة 7',
      phone: '777123456',
    },
  });
  customerId = customer.id;

  // 5) إنشاء مورد
  const supplier = await prisma.supplier.create({
    data: {
      storeOwnerId: ownerId,
      name: 'مورد قات صعدة',
      phone: '777987654',
      currentBalance: new Prisma.Decimal(10000),
      openingBalance: new Prisma.Decimal(0),
    },
  });
  supplierId = supplier.id;

  // 6) ضبط أرقام الدعم في system_settings
  await prisma.systemSetting.upsert({
    where: { key: 'contact_phone' },
    update: { value: { v: '777112233' } },
    create: { key: 'contact_phone', value: { v: '777112233' } },
  });
  await prisma.systemSetting.upsert({
    where: { key: 'contact_whatsapp' },
    update: { value: { v: '777445566' } },
    create: { key: 'contact_whatsapp', value: { v: '777445566' } },
  });
});

after(async () => {
  for (const id of cleanupOwnerIds) {
    try {
      await prisma.auditLog.deleteMany({ where: { actorId: id } }).catch(() => {});
      await prisma.ledgerEntry.deleteMany({ where: { storeOwnerId: id } }).catch(() => {});
      await prisma.sale.deleteMany({ where: { storeOwnerId: id } }).catch(() => {});
      await prisma.creditPayment.deleteMany({ where: { storeOwnerId: id } }).catch(() => {});
      await prisma.creditCustomer.deleteMany({ where: { storeOwnerId: id } }).catch(() => {});
      await prisma.supplierPayment.deleteMany({ where: { storeOwnerId: id } }).catch(() => {});
      await prisma.purchaseItem.deleteMany({ where: { storeOwnerId: id } }).catch(() => {});
      await prisma.purchaseInvoice.deleteMany({ where: { storeOwnerId: id } }).catch(() => {});
      await prisma.supplier.deleteMany({ where: { storeOwnerId: id } }).catch(() => {});
      await prisma.inventoryLayer.deleteMany({ where: { storeOwnerId: id } }).catch(() => {});
      await prisma.item.deleteMany({ where: { storeOwnerId: id } }).catch(() => {});
      await prisma.wallet.deleteMany({ where: { storeOwnerId: id } }).catch(() => {});
      await prisma.chartOfAccount.deleteMany({ where: { storeOwnerId: id } }).catch(() => {});
      await prisma.device.deleteMany({ where: { storeOwnerId: id } }).catch(() => {});
      await prisma.worker.deleteMany({ where: { storeOwnerId: id } }).catch(() => {});
      await prisma.storeOwner.delete({ where: { id } }).catch(() => {});
    } catch (_) {}
  }
  await prisma.$disconnect();
});

test('1. UploadsController: رفع ملف متعدد الأجزاء واسترجاعه والتحقق من صحة الرابط ونوعه', async () => {
  // إنشاء ملف مؤقت في uploads
  const uploadDir = path.resolve(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const testFilename = `test-${Date.now()}.jpg`;
  const testFilePath = path.join(uploadDir, testFilename);
  // JPEG magic bytes (FF D8 FF E0) + payload (25 bytes total)
  fs.writeFileSync(
    testFilePath,
    Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('FAKE_IMAGE_CONTENT_P7')]),
  );

  const fakeUploadedFile = {
    fieldname: 'file',
    originalname: 'my_receipt.jpg',
    encoding: '7bit',
    mimetype: 'image/jpeg',
    size: 25,
    destination: uploadDir,
    filename: testFilename,
    path: testFilePath,
  };

  // استدعاء uploadFile
  const uploadRes = await uploadsController.uploadFile([fakeUploadedFile]);
  assert.ok(uploadRes.url.startsWith('/v1/uploads/'));
  assert.equal(uploadRes.filename, testFilename);
  assert.equal(uploadRes.size, 25);

  // استرجاع الملف عبر getFile
  let sentPath = null;
  const mockRes = {
    sendFile: (p) => {
      sentPath = p;
    },
  };
  await uploadsController.getFile(testFilename, mockRes);
  assert.equal(sentPath, testFilePath);

  // استرجاع ملف غير موجود يرمي 404
  await assert.rejects(
    async () => uploadsController.getFile('non_existent_file_999.jpg', mockRes),
    (err) => err.statusCode === 404,
  );

  // تنظيف الملف التجريبي
  if (fs.existsSync(testFilePath)) {
    fs.unlinkSync(testFilePath);
  }
});

test('2. UploadsController: رفض رفع بدون ملفات برمز MISSING_FILE', async () => {
  await assert.rejects(
    async () => uploadsController.uploadFile([]),
    (err) => err.statusCode === 400 && err.code === 'MISSING_FILE',
  );
  await assert.rejects(
    async () => uploadsController.uploadFile(null),
    (err) => err.statusCode === 400 && err.code === 'MISSING_FILE',
  );
});

test('3. حفظ واسترجاع روابط المرفقات /v1/uploads/... عبر العمليات (بيع، تحصيل آجل، شراء، سداد مورد)', async () => {
  // 1) بيع إلكتروني مع رابط مرفق
  const receiptUrl = `/v1/uploads/receipt-${Date.now()}.jpg`;
  const saleRes = await salesService.create(ownerUser, {
    clientOpId: crypto.randomUUID(),
    itemId,
    quantity: 1,
    amount: 10000,
    paymentType: 'ELECTRONIC',
    walletId,
    depositAttachmentUrl: receiptUrl,
  });
  const saleId = saleRes.sale?.id || saleRes.id;
  assert.ok(saleId);
  const dbSale = await prisma.sale.findUnique({ where: { id: saleId } });
  assert.equal(dbSale.depositAttachmentUrl, receiptUrl);

  // 2) إنشاء مبيعات آجلة للعميل ثم تحصيل آجل إلكتروني مع رابط مرفق
  await salesService.create(ownerUser, {
    clientOpId: crypto.randomUUID(),
    itemId,
    quantity: 1,
    amount: 10000,
    paymentType: 'CREDIT',
    creditCustomerId: customerId,
  });

  const creditReceiptUrl = `/v1/uploads/credit-rec-${Date.now()}.png`;
  const creditPayment = await creditService.recordPayment(ownerUser, customerId, {
    clientOpId: crypto.randomUUID(),
    amount: 1000,
    paymentMethod: 'ELECTRONIC',
    walletId,
    attachmentUrl: creditReceiptUrl,
  });
  assert.ok(creditPayment);
  const creditPaymentId = creditPayment.payment_id || creditPayment.id;
  const dbCreditPayment = await prisma.creditPayment.findUnique({ where: { id: creditPaymentId } });
  assert.equal(dbCreditPayment.attachmentUrl, creditReceiptUrl);

  // 3) فاتورة شراء مع رابط مرفق
  const purchaseInvoiceUrl = `/v1/uploads/pur-inv-${Date.now()}.jpg`;
  const purchase = await purchasesService.create(ownerUser, {
    clientOpId: crypto.randomUUID(),
    supplierId,
    paymentType: 'CASH',
    attachmentUrl: purchaseInvoiceUrl,
    items: [
      {
        itemId,
        itemName: 'قات تجريبي مرحلة 7',
        unit: 'حبة',
        quantity: 2,
        unitCostPrice: 7000,
        sellPrice: 10000,
      },
    ],
  });
  assert.ok(purchase);
  const dbPurchase = await prisma.purchaseInvoice.findUnique({ where: { id: purchase.id } });
  assert.equal(dbPurchase.attachmentUrl, purchaseInvoiceUrl);

  // 4) سداد مورد مع رابط إيصال الحوالة
  const supplierReceiptUrl = `/v1/uploads/sup-rec-${Date.now()}.webp`;
  const supPayment = await suppliersService.recordPayment(ownerUser, supplierId, {
    clientOpId: crypto.randomUUID(),
    amount: 2000,
    paymentMethod: 'ELECTRONIC',
    walletId,
    receiptAttachmentUrl: supplierReceiptUrl,
  });
  assert.ok(supPayment);
  const supPaymentId = supPayment.payment_id || supPayment.id;
  const dbSupPayment = await prisma.supplierPayment.findUnique({ where: { id: supPaymentId } });
  assert.equal(dbSupPayment.receiptAttachmentUrl, supplierReceiptUrl);
});

test('4. استجابة 423 ACCOUNT_LOCKED من AccountStatusGuard و AuthService تتضمن contact_phone و contact_whatsapp ورقم الدعم في الرسالة', async () => {
  // إنشاء مالك متجر مقفل (TRIAL_EXPIRED)
  const lockedPhone = `777${Math.floor(100000 + Math.random() * 900000)}`;
  const passwordHash = await hash('SecurePass123!');
  const lockedOwner = await prisma.storeOwner.create({
    data: {
      fullName: 'مالك منتهي الصلاحية',
      storeName: 'محل منتهي',
      phone: lockedPhone,
      passwordHash,
      status: StoreOwnerStatus.TRIAL_EXPIRED,
      trialSalesLimit: 50,
      trialSalesUsed: 50,
    },
  });
  cleanupOwnerIds.push(lockedOwner.id);

  // 1) فحص AuthService.login
  await assert.rejects(
    async () =>
      authService.login(
        {
          phone: lockedPhone,
          password: 'SecurePass123!',
          deviceFingerprint: 'TEST-DEV-FINGERPRINT-1234',
        },
        '127.0.0.1',
      ),
    (err) => {
      assert.equal(err.statusCode, 423);
      assert.equal(err.code, 'ACCOUNT_LOCKED');
      assert.equal(err.details?.contact_phone, '777112233');
      assert.equal(err.details?.contact_whatsapp, '777445566');
      assert.ok(err.message.includes('777112233'));
      return true;
    },
  );

  // 2) فحص AccountStatusGuard.canActivate
  // تسجيل جهاز أولاً حتى لا يتم رفضه بـ DEVICE_BLOCKED
  const testDevFp = 'DEV-FP-' + crypto.randomUUID();
  await prisma.device.create({
    data: {
      storeOwnerId: lockedOwner.id,
      deviceFingerprint: testDevFp,
      status: 'ACTIVE',
    },
  });

  const mockContext = {
    switchToHttp: () => ({
      getRequest: () => ({
        user: {
          userId: lockedOwner.id,
          storeOwnerId: lockedOwner.id,
          role: 'STORE_OWNER',
        },
        headers: {
          'x-device-fingerprint': testDevFp,
        },
      }),
    }),
  };

  AccountStatusGuard.clearAllCache();
  await assert.rejects(
    async () => accountStatusGuard.canActivate(mockContext),
    (err) => {
      assert.equal(err.statusCode, 423);
      assert.equal(err.code, 'ACCOUNT_LOCKED');
      assert.equal(err.details?.contact_phone, '777112233');
      assert.equal(err.details?.contact_whatsapp, '777445566');
      assert.ok(err.message.includes('777112233'));
      return true;
    },
  );
});

test('5. ثبات العملة (YER, SAR, USD) واسترجاعها بدقة دون تحويل أو انكسار', async () => {
  // إنشاء مالك متجر جديد دون أي عمليات مالية سابقة
  const freshPhone = `777${Math.floor(100000 + Math.random() * 900000)}`;
  const passwordHash = await hash('SecurePass123!');
  const freshOwner = await prisma.storeOwner.create({
    data: {
      fullName: 'مالك متجر العملات',
      storeName: 'محل العملات',
      phone: freshPhone,
      passwordHash,
      status: StoreOwnerStatus.ACTIVE,
      currency: 'YER',
      defaultCostingMethod: 'WEIGHTED_AVERAGE',
    },
  });
  cleanupOwnerIds.push(freshOwner.id);
  const freshUser = { userId: freshOwner.id, storeOwnerId: freshOwner.id, role: 'STORE_OWNER' };

  // 1) تغيير العملة إلى SAR
  const updatedToSar = await settingsService.updateStoreSettings(freshUser, {
    currency: 'SAR',
    defaultCostingMethod: 'FIFO',
  });
  assert.equal(updatedToSar.currency, 'SAR');
  assert.equal(updatedToSar.currency_symbol, 'ر.س');

  // استرجاع الإعدادات والتأكد من بقائها SAR
  const fetchedSar = await settingsService.getStoreSettings(freshUser);
  assert.equal(fetchedSar.currency, 'SAR');
  assert.equal(fetchedSar.currency_symbol, 'ر.س');

  // 2) تغيير العملة إلى USD
  const updatedToUsd = await settingsService.updateStoreSettings(freshUser, {
    currency: 'USD',
  });
  assert.equal(updatedToUsd.currency, 'USD');
  assert.equal(updatedToUsd.currency_symbol, '$');

  const fetchedUsd = await settingsService.getStoreSettings(freshUser);
  assert.equal(fetchedUsd.currency, 'USD');
  assert.equal(fetchedUsd.currency_symbol, '$');
});
