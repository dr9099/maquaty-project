import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { AccountingService } from '../dist/accounting/accounting.service.js';
import { AuditService } from '../dist/audit/audit.service.js';
import { ItemsService } from '../dist/items/items.service.js';
import { SuppliersService } from '../dist/suppliers/suppliers.service.js';
import { PurchasesService } from '../dist/purchases/purchases.service.js';
import { SalesService } from '../dist/sales/sales.service.js';
import { CreditService } from '../dist/credit/credit.service.js';
import { DamagedGoodsService } from '../dist/damaged-goods/damaged-goods.service.js';
import { ExpensesService } from '../dist/expenses/expenses.service.js';
import { ReportsService } from '../dist/reports/reports.service.js';
import { SyncService } from '../dist/sync/sync.service.js';
import { DailyClosingService } from '../dist/daily-closing/daily-closing.service.js';
import { AdminService } from '../dist/admin/admin.service.js';

const prisma = new PrismaService();
const accounting = new AccountingService(prisma);
const audit = new AuditService(prisma);
const itemsService = new ItemsService(prisma, accounting);
const suppliersService = new SuppliersService(prisma, accounting, audit);
const purchasesService = new PurchasesService(prisma, accounting, audit, suppliersService);
const salesService = new SalesService(prisma, accounting);
const creditService = new CreditService(prisma, accounting, audit);
const damagedGoodsService = new DamagedGoodsService(prisma, accounting, audit);
const expensesService = new ExpensesService(prisma, accounting, audit);
const reportsService = new ReportsService(prisma, accounting, audit);
const syncService = new SyncService(
  prisma,
  salesService,
  creditService,
  damagedGoodsService,
  expensesService,
  suppliersService,
  purchasesService,
  reportsService,
  audit,
);
const dailyClosingService = new DailyClosingService(prisma, accounting, audit);
const adminService = new AdminService(prisma, audit);

let ownerId;
let ownerUser;
let ordWorkerId;
let ordWorkerUser;
let respWorkerId;
let respWorkerUser;
let itemId;
let supplierId;
let customerId;
const ownerDeviceFp = `DEV-WAVEC-OWN-${crypto.randomUUID().slice(0, 8)}`;
const ordDeviceFp = `DEV-WAVEC-ORD-${crypto.randomUUID().slice(0, 8)}`;
const respDeviceFp = `DEV-WAVEC-RSP-${crypto.randomUUID().slice(0, 8)}`;

before(async () => {
  await prisma.$connect();

  ownerId = crypto.randomUUID();
  const phone = `73${Math.floor(1000000 + Math.random() * 8999999)}`;
  await prisma.$executeRaw`
    INSERT INTO store_owners (id, full_name, store_name, phone, password_hash, status, default_costing_method, allow_responsible_purchases, updated_at)
    VALUES (${ownerId}::uuid, 'مالك تحقق Wave C', 'متجر تحقق ما قبل الإنتاج', ${phone}, 'test-hash', 'ACTIVE'::"StoreOwnerStatus", 'WEIGHTED_AVERAGE'::"CostingMethod", false, NOW())
  `;

  await prisma.chartOfAccount.createMany({
    data: [
      { storeOwnerId: ownerId, code: '1000', name: 'الصندوق النقدي', accountType: 'ASSET' },
      { storeOwnerId: ownerId, code: '1100', name: 'المحافظ الإلكترونية', accountType: 'ASSET' },
      { storeOwnerId: ownerId, code: '1200', name: 'ذمم العملاء (الآجل)', accountType: 'ASSET' },
      { storeOwnerId: ownerId, code: '1300', name: 'المخزون السلعي', accountType: 'ASSET' },
      { storeOwnerId: ownerId, code: '2000', name: 'الموردون / الذمم الدائنة', accountType: 'LIABILITY' },
      { storeOwnerId: ownerId, code: '3000', name: 'رأس المال', accountType: 'EQUITY' },
      { storeOwnerId: ownerId, code: '3100', name: 'جاري المالك', accountType: 'EQUITY' },
      { storeOwnerId: ownerId, code: '3900', name: 'الأرباح المحتجزة / أرباح مقفلة', accountType: 'EQUITY' },
      { storeOwnerId: ownerId, code: '4000', name: 'إيرادات المبيعات', accountType: 'REVENUE' },
      { storeOwnerId: ownerId, code: '4300', name: 'فائض الصندوق', accountType: 'REVENUE' },
      { storeOwnerId: ownerId, code: '5000', name: 'تكلفة البضاعة المباعة', accountType: 'EXPENSE' },
      { storeOwnerId: ownerId, code: '5400', name: 'مصروف البضاعة التالفة', accountType: 'EXPENSE' },
      { storeOwnerId: ownerId, code: '5450', name: 'خسائر بيع اضطراري ومرفوضات', accountType: 'EXPENSE' },
      { storeOwnerId: ownerId, code: '5500', name: 'سلف العمال والعهد', accountType: 'EXPENSE' },
      { storeOwnerId: ownerId, code: '5600', name: 'عجز الصندوق', accountType: 'EXPENSE' },
    ],
  });

  const ordWorker = await prisma.worker.create({
    data: {
      storeOwnerId: ownerId,
      fullName: 'عامل عادي Wave C',
      phone: `70${Math.floor(1000000 + Math.random() * 8999999)}`,
      passwordHash: 'test-hash',
      status: 'ACTIVE',
      isResponsible: false,
      permDamagedGoodsEntry: false,
    },
  });
  ordWorkerId = ordWorker.id;

  const respWorker = await prisma.worker.create({
    data: {
      storeOwnerId: ownerId,
      fullName: 'عامل مسؤول بدون مشتريات Wave C',
      phone: `71${Math.floor(1000000 + Math.random() * 8999999)}`,
      passwordHash: 'test-hash',
      status: 'ACTIVE',
      isResponsible: true,
      permDamagedGoodsEntry: true,
    },
  });
  respWorkerId = respWorker.id;

  const supplier = await prisma.supplier.create({
    data: {
      storeOwnerId: ownerId,
      name: 'مورد Wave C',
      phone: '775551122',
    },
  });
  supplierId = supplier.id;

  const customer = await prisma.creditCustomer.create({
    data: {
      storeOwnerId: ownerId,
      name: 'عميل Wave C',
      phone: '776661122',
      creditLimit: 50000,
    },
  });
  customerId = customer.id;

  const createdItem = await itemsService.create(ownerId, {
    name: 'قات Wave C للتحقق',
    unit: 'كيلو',
    quantity: 50,
    costPrice: 2000,
    sellPrice: 4000,
  });
  itemId = createdItem.item ? createdItem.item.id : createdItem.id;

  ownerUser = {
    sub: ownerId,
    role: 'STORE_OWNER',
    storeOwnerId: ownerId,
  };
  ordWorkerUser = {
    sub: ordWorkerId,
    role: 'WORKER',
    storeOwnerId: ownerId,
    workerId: ordWorkerId,
    isResponsible: false,
  };
  respWorkerUser = {
    sub: respWorkerId,
    role: 'WORKER',
    storeOwnerId: ownerId,
    workerId: respWorkerId,
    isResponsible: true,
  };
});

after(async () => {
  if (ownerId) {
    await prisma.syncOperation.deleteMany({ where: { storeOwnerId: ownerId } });
    await prisma.device.deleteMany({ where: { storeOwnerId: ownerId } });
    await prisma.dailyClosing.deleteMany({ where: { storeOwnerId: ownerId } });
    await prisma.ledgerEntry.deleteMany({ where: { storeOwnerId: ownerId } });
    await prisma.rejectedTransaction.deleteMany({ where: { storeOwnerId: ownerId } });
    await prisma.damagedGood.deleteMany({ where: { storeOwnerId: ownerId } });
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
    await prisma.wallet.deleteMany({ where: { storeOwnerId: ownerId } });
    await prisma.chartOfAccount.deleteMany({ where: { storeOwnerId: ownerId } });
    await prisma.auditLog.deleteMany({
      where: { actorId: { in: [ownerId, ordWorkerId, respWorkerId].filter(Boolean) } },
    });
    await prisma.storeOwner.deleteMany({ where: { id: ownerId } });
  }
  await prisma.$disconnect();
});

test('Wave C.3 — SyncService rejects privilege escalation for CREDIT_PAYMENT, DAMAGED_GOODS, PURCHASE & PURCHASE_RETURN', async () => {
  const opCreditPay = crypto.randomUUID();
  const opDamaged = crypto.randomUUID();
  const ordSync = await syncService.sync(ordWorkerUser, {
    deviceFingerprint: ordDeviceFp,
    lastSyncVersion: 0,
    pendingLocalOperations: [
      {
        clientOpId: opCreditPay,
        opType: 'CREDIT_PAYMENT',
        payload: {
          customerId,
          amount: 1000,
          paymentMethod: 'CASH',
        },
      },
      {
        clientOpId: opDamaged,
        opType: 'DAMAGED_GOODS',
        payload: {
          itemId,
          quantity: 1,
          reason: 'تلف اختباري',
        },
      },
    ],
  });

  assert.equal(ordSync.processed_operations[0].status, 'REJECTED');
  assert.equal(ordSync.processed_operations[0].error_code, 'PERMISSION_DENIED');
  assert.equal(ordSync.processed_operations[1].status, 'REJECTED');
  assert.equal(ordSync.processed_operations[1].error_code, 'PERMISSION_DENIED');
  assert.equal(ordSync.rejected_operations.length, 2);
  assert.equal(ordSync.rejectedOperations.length, 2);

  const opPurchase = crypto.randomUUID();
  const opPurchaseReturn = crypto.randomUUID();
  const respSync = await syncService.sync(respWorkerUser, {
    deviceFingerprint: respDeviceFp,
    lastSyncVersion: 0,
    pendingLocalOperations: [
      {
        clientOpId: opPurchase,
        opType: 'PURCHASE',
        payload: {
          supplierId,
          items: [{ itemId, quantity: 1, unitCost: 2000 }],
          paymentType: 'CASH',
        },
      },
      {
        clientOpId: opPurchaseReturn,
        opType: 'PURCHASE_RETURN',
        payload: {
          purchaseInvoiceId: crypto.randomUUID(),
          items: [],
        },
      },
    ],
  });

  assert.equal(respSync.processed_operations[0].status, 'REJECTED');
  assert.equal(respSync.processed_operations[0].error_code, 'PERMISSION_DENIED');
  assert.equal(respSync.processed_operations[1].status, 'REJECTED');
  assert.equal(respSync.processed_operations[1].error_code, 'PERMISSION_DENIED');
  assert.equal(respSync.rejected_operations.length, 2);
});

test('Wave C.4a — SalesService & SyncService honor valid offline soldAt and reject future soldAt > 5 min', async () => {
  const yesterdayNoon = new Date(Date.now() - 24 * 60 * 60 * 1000);
  yesterdayNoon.setHours(12, 0, 0, 0);
  const offlineSaleId = crypto.randomUUID();

  const syncRes = await syncService.sync(ownerUser, {
    deviceFingerprint: ownerDeviceFp,
    lastSyncVersion: 0,
    pendingLocalOperations: [
      {
        clientOpId: offlineSaleId,
        opType: 'SALE',
        payload: {
          id: offlineSaleId,
          itemId,
          quantity: 1,
          quantityUnit: 'KILO',
          amount: 4000,
          paymentType: 'CASH',
          soldAt: yesterdayNoon.toISOString(),
        },
      },
    ],
  });

  assert.equal(syncRes.processed_operations[0].status, 'ACCEPTED');
  const savedSale = await prisma.sale.findUnique({ where: { id: offlineSaleId } });
  assert.ok(savedSale, 'Offline sale must exist in DB');
  assert.equal(
    savedSale.soldAt.getTime(),
    yesterdayNoon.getTime(),
    'Stored sale.soldAt must preserve client offline timestamp',
  );

  const futureSkewed = new Date(Date.now() + 20 * 60 * 1000);
  await assert.rejects(
    () =>
      salesService.create(ownerUser, {
        itemId,
        quantity: 1,
        quantityUnit: 'KILO',
        amount: 4000,
        paymentType: 'CASH',
        soldAt: futureSkewed.toISOString(),
      }),
    (err) => err?.code === 'VALIDATION_ERROR',
  );
});

test('Wave C.4b — Concurrent DailyClosingService.approve must only succeed once without duplicate closing ledger entries', async () => {
  await salesService.create(ownerUser, {
    itemId,
    quantity: 2,
    quantityUnit: 'KILO',
    amount: 8000,
    paymentType: 'CASH',
  });

  const todayClosing = await dailyClosingService.getToday(ownerUser);
  await dailyClosingService.updateActualCash(ownerUser, todayClosing.closing_id, {
    actualCash: 8000,
  });

  const results = await Promise.allSettled([
    dailyClosingService.approve(ownerUser, todayClosing.closing_id),
    dailyClosingService.approve(ownerUser, todayClosing.closing_id),
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');

  assert.equal(fulfilled.length, 1, `Expected 1 approval to succeed, got ${fulfilled.length}`);
  assert.equal(fulfilled[0].value.status, 'CLOSED');
  assert.equal(rejected.length, 1, `Expected 1 concurrent approval to fail, got ${rejected.length}`);
  assert.equal(rejected[0].reason?.code, 'DAY_ALREADY_CLOSED');

  const closingEntries = await prisma.ledgerEntry.findMany({
    where: {
      storeOwnerId: ownerId,
      referenceType: 'CLOSING',
      referenceId: todayClosing.closing_id,
    },
    include: { account: { select: { code: true } } },
  });
  const acct4000Entries = closingEntries.filter((e) => e.account.code === '4000');
  assert.equal(
    acct4000Entries.length,
    1,
    `Account 4000 closing entry must only be posted once on concurrent approve, got ${acct4000Entries.length}`,
  );
});

test('Wave C.4c — Closed day blocks offline soldAt sale with DAY_ALREADY_CLOSED', async () => {
  await assert.rejects(
    () =>
      salesService.create(ownerUser, {
        itemId,
        quantity: 1,
        quantityUnit: 'KILO',
        amount: 4000,
        paymentType: 'CASH',
        soldAt: new Date().toISOString(),
      }),
    (err) => err?.code === 'DAY_ALREADY_CLOSED',
  );
});

test('Wave C.8 — AdminService.seedInitialAdminAndSettings is idempotent and ensures default settings', async () => {
  await adminService.seedInitialAdminAndSettings();
  await adminService.seedInitialAdminAndSettings();

  const keys = await prisma.systemSetting.findMany({
    where: {
      key: { in: ['trial_sales_limit', 'trial_warning_threshold', 'contact_phone'] },
    },
  });
  assert.equal(keys.length, 3, 'Default system_settings keys must exist without duplication');
});

