import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { AccountingService } from '../dist/accounting/accounting.service.js';
import { AuditService } from '../dist/audit/audit.service.js';
import { ChartOfAccountsService } from '../dist/accounting/chart-of-accounts.service.js';
import { AuthService } from '../dist/auth/auth.service.js';
import { ItemsService } from '../dist/items/items.service.js';
import { SalesService } from '../dist/sales/sales.service.js';
import { CreditService } from '../dist/credit/credit.service.js';
import { ExpensesService } from '../dist/expenses/expenses.service.js';
import { WorkersService } from '../dist/workers/workers.service.js';
import { RejectedTransactionsService } from '../dist/rejected-transactions/rejected-transactions.service.js';
import { Prisma } from '@prisma/client';

const prisma = new PrismaService();
const accounting = new AccountingService(prisma);
const audit = new AuditService(prisma);
const chartOfAccounts = new ChartOfAccountsService(prisma);
const itemsService = new ItemsService(prisma, accounting);
const salesService = new SalesService(prisma, accounting);
const creditService = new CreditService(prisma, accounting, audit);
const expensesService = new ExpensesService(prisma, accounting, audit);
const workersService = new WorkersService(prisma, audit);
const rejectedTxService = new RejectedTransactionsService(prisma, accounting, audit);

const mockJwt = {
  sign: () => 'mock-jwt-token',
  signAsync: async () => 'mock-jwt-token',
  verify: () => ({}),
  verifyAsync: async () => ({}),
};
const mockConfig = {
  get: (key) => (key === 'JWT_SECRET' ? 'test-secret-key-maquaty-phase5' : undefined),
  getOrThrow: (key) => 'test-secret-key-maquaty-phase5',
};
const authService = new AuthService(prisma, mockJwt, mockConfig, audit, chartOfAccounts);

let ownerId;
let ownerUser;
let workerId;
let workerUser;
let testItemId;
let costOnlyItemId;
let costPlusItemId;
let walletId;
let creditCustomerId;
const cleanupOwnerIds = [];

const STANDARD_ACCOUNTS = [
  { code: '1000', name: 'الصندوق النقدي', accountType: 'ASSET' },
  { code: '1100', name: 'المحافظ الإلكترونية', accountType: 'ASSET' },
  { code: '1101', name: 'محفظة: كاش تجربة', accountType: 'ASSET' },
  { code: '1200', name: 'ذمم العملاء (الآجل)', accountType: 'ASSET' },
  { code: '1300', name: 'المخزون السلعي', accountType: 'ASSET' },
  { code: '2000', name: 'الموردون / الذمم الدائنة', accountType: 'LIABILITY' },
  { code: '3000', name: 'رأس المال', accountType: 'EQUITY' },
  { code: '3900', name: 'الأرباح المحتجزة / أرباح مقفلة', accountType: 'EQUITY' },
  { code: '4000', name: 'إيرادات المبيعات', accountType: 'REVENUE' },
  { code: '4300', name: 'فائض الصندوق', accountType: 'REVENUE' },
  { code: '5000', name: 'تكلفة البضاعة المباعة', accountType: 'EXPENSE' },
  { code: '5200', name: 'مصروفات عامة وإدارية', accountType: 'EXPENSE' },
  { code: '5400', name: 'مصروف البضاعة التالفة', accountType: 'EXPENSE' },
  { code: '5450', name: 'خسارة بيع اضطراري', accountType: 'EXPENSE' },
  { code: '5500', name: 'سلف العمال والعهد', accountType: 'EXPENSE' },
  { code: '5600', name: 'عجز الصندوق', accountType: 'EXPENSE' },
];

async function setupAccounts(id) {
  await prisma.chartOfAccount.createMany({
    data: STANDARD_ACCOUNTS.map((acc) => ({ ...acc, storeOwnerId: id })),
  });
}

before(async () => {
  await prisma.$connect();

  ownerId = crypto.randomUUID();
  cleanupOwnerIds.push(ownerId);
  const phone = `77${Math.floor(1000000 + Math.random() * 8999999)}`;

  await prisma.$executeRaw`
    INSERT INTO store_owners (id, full_name, store_name, phone, password_hash, status, default_costing_method, allow_responsible_purchases, max_workers_allowed, trial_sales_limit, trial_sales_used, updated_at)
    VALUES (${ownerId}::uuid, 'مالك المرحلة الخامسة', 'متجر المبيعات والتسعير', ${phone}, 'test-hash', 'TRIAL'::"StoreOwnerStatus", 'WEIGHTED_AVERAGE'::"CostingMethod", false, 5, 50, 0, NOW())
  `;

  await setupAccounts(ownerId);

  ownerUser = {
    sub: ownerId,
    role: 'STORE_OWNER',
    storeOwnerId: ownerId,
  };

  const wallet = await prisma.wallet.create({
    data: {
      storeOwnerId: ownerId,
      name: 'محفظة جوالي',
      accountCode: '1101',
      isActive: true,
    },
  });
  walletId = wallet.id;

  const customer = await prisma.creditCustomer.create({
    data: {
      storeOwnerId: ownerId,
      name: 'عميل آجل تجريبي',
      phone: `73${Math.floor(1000000 + Math.random() * 8999999)}`,
      creditLimit: 50000,
    },
  });
  creditCustomerId = customer.id;

  const createdItem = await itemsService.create(ownerId, {
    name: 'قات رداعي عادي',
    unit: 'كيلو',
    quantity: 100,
    costPrice: 2000,
    sellPrice: 3000,
  });
  testItemId = createdItem.item ? createdItem.item.id : createdItem.id;

  // صنف بسعر تكلفة فقط (COST_ONLY)
  const itemCostOnly = await itemsService.create(ownerId, {
    name: 'قات خولاني - تكلفة فقط',
    unit: 'كيلو',
    quantity: 50,
    costPrice: 3000,
    sellPrice: 4500,
    emergencyPriceMode: 'COST_ONLY',
  });
  costOnlyItemId = itemCostOnly.item ? itemCostOnly.item.id : itemCostOnly.id;

  // صنف بتكلفة + هامش (COST_PLUS مع أولوية الثابت على النسبة)
  const itemCostPlus = await itemsService.create(ownerId, {
    name: 'قات شامي - تكلفة وهامش',
    unit: 'كيلو',
    quantity: 50,
    costPrice: 2000,
    sellPrice: 4000,
    emergencyPriceMode: 'COST_PLUS',
    emergencyPricePlusFixed: 400,
    emergencyPricePlusPercent: 50, // 50% = 1000 لكن الثابت 400 له الأولوية فيصبح الحد الأدنى 2400
  });
  costPlusItemId = itemCostPlus.item ? itemCostPlus.item.id : itemCostPlus.id;

  // إنشاء عامل مع إخفاء سعر التكلفة
  const workerPhone = `71${Math.floor(1000000 + Math.random() * 8999999)}`;
  const createdWorker = await workersService.create(ownerId, {
    fullName: 'عامل بدون رؤية التكلفة',
    phone: workerPhone,
    password: 'password123',
    passwordConfirmation: 'password123',
    isResponsible: false,
    permShowCostPrice: false,
  });
  workerId = createdWorker.id;
  workerUser = {
    sub: workerId,
    role: 'WORKER',
    workerId,
    storeOwnerId: ownerId,
    isResponsible: false,
  };
});

after(async () => {
  for (const id of cleanupOwnerIds) {
    await prisma.rejectedTransaction.deleteMany({ where: { storeOwnerId: id } });
    await prisma.creditPayment.deleteMany({ where: { storeOwnerId: id } });
    await prisma.sale.deleteMany({ where: { storeOwnerId: id } });
    await prisma.workerAdvance.deleteMany({ where: { storeOwnerId: id } });
    await prisma.employeeAdvance.deleteMany({ where: { storeOwnerId: id } });
    await prisma.employeePayment.deleteMany({ where: { storeOwnerId: id } });
    await prisma.utilityPayment.deleteMany({ where: { storeOwnerId: id } });
    await prisma.rentRecord.deleteMany({ where: { storeOwnerId: id } });
    await prisma.expenseSettlement.deleteMany({ where: { storeOwnerId: id } });
    await prisma.ledgerEntry.deleteMany({ where: { storeOwnerId: id } });
    await prisma.item.deleteMany({ where: { storeOwnerId: id } });
    await prisma.creditCustomer.deleteMany({ where: { storeOwnerId: id } });
    await prisma.wallet.deleteMany({ where: { storeOwnerId: id } });
    await prisma.worker.deleteMany({ where: { storeOwnerId: id } });
    await prisma.chartOfAccount.deleteMany({ where: { storeOwnerId: id } });
    await prisma.storeOwner.deleteMany({ where: { id } });
  }
  await prisma.systemSetting.deleteMany({ where: { key: 'trial_sales_limit' } });
  await prisma.$disconnect();
});

test('1. Default trial limit is 50 on new owner registration without custom system setting', async () => {
  await prisma.systemSetting.deleteMany({ where: { key: 'trial_sales_limit' } });
  const limit = await authService.getTrialSalesLimit();
  assert.equal(limit, 50, 'Fallback trial limit must be exactly 50');

  const regPhone = `73${Math.floor(1000000 + Math.random() * 8999999)}`;
  const registered = await authService.registerStoreOwner({
    fullName: 'مالك تجريبي جديد',
    storeName: 'متجر الحصة التجريبية',
    phone: regPhone,
    password: 'password123',
    passwordConfirmation: 'password123',
    deviceFingerprint: `FINGERPRINT-${Date.now()}-01`,
  });
  cleanupOwnerIds.push(registered.account.id);

  const dbOwner = await prisma.storeOwner.findUniqueOrThrow({
    where: { id: registered.account.id },
  });
  assert.equal(dbOwner.trialSalesLimit, 50, 'New store owner must have trialSalesLimit = 50');
  assert.equal(dbOwner.trialSalesUsed, 0, 'New store owner must have trialSalesUsed = 0');
  assert.equal(dbOwner.status, 'TRIAL');
});

test('2. Custom trial_sales_limit from system_settings is respected when present', async () => {
  await prisma.systemSetting.upsert({
    where: { key: 'trial_sales_limit' },
    update: { value: { v: 75 } },
    create: { key: 'trial_sales_limit', value: { v: 75 } },
  });

  const limit = await authService.getTrialSalesLimit();
  assert.equal(limit, 75, 'Custom systemSetting trial limit of 75 must be respected');

  await prisma.systemSetting.deleteMany({ where: { key: 'trial_sales_limit' } });
});

test('3 & 4. Direct sale #50 transitions owner status to TRIAL_EXPIRED and response contains account_status', async () => {
  const trialOwnerId = crypto.randomUUID();
  cleanupOwnerIds.push(trialOwnerId);
  const phone = `77${Math.floor(1000000 + Math.random() * 8999999)}`;

  await prisma.$executeRaw`
    INSERT INTO store_owners (id, full_name, store_name, phone, password_hash, status, default_costing_method, allow_responsible_purchases, max_workers_allowed, trial_sales_limit, trial_sales_used, updated_at)
    VALUES (${trialOwnerId}::uuid, 'مالك تجربة النفاذ', 'متجر البيع رقم 50', ${phone}, 'test-hash', 'TRIAL'::"StoreOwnerStatus", 'WEIGHTED_AVERAGE'::"CostingMethod", false, 5, 50, 49, NOW())
  `;
  await setupAccounts(trialOwnerId);

  const trialItem = await itemsService.create(trialOwnerId, {
    name: 'صنف انتهاء التجربة',
    unit: 'كيلو',
    quantity: 10,
    costPrice: 2000,
    sellPrice: 3000,
  });
  const tId = trialItem.item ? trialItem.item.id : trialItem.id;

  const trialUser = {
    sub: trialOwnerId,
    role: 'STORE_OWNER',
    storeOwnerId: trialOwnerId,
  };

  const saleRes = await salesService.create(trialUser, {
    itemId: tId,
    quantity: 1,
    amount: 3000,
    paymentType: 'CASH',
  });

  assert.equal(saleRes.account_status, 'TRIAL_EXPIRED', 'Sale #50 must return account_status = TRIAL_EXPIRED');

  const updatedOwner = await prisma.storeOwner.findUniqueOrThrow({
    where: { id: trialOwnerId },
  });
  assert.equal(updatedOwner.trialSalesUsed, 50, 'trialSalesUsed must now be 50');
  assert.equal(updatedOwner.status, 'TRIAL_EXPIRED', 'Owner status must be transitioned to TRIAL_EXPIRED');
});

test('5. Sale #51 fails with 423 TRIAL_EXPIRED', async () => {
  const expiredOwnerId = cleanupOwnerIds[cleanupOwnerIds.length - 1];
  const trialItem = await prisma.item.findFirstOrThrow({
    where: { storeOwnerId: expiredOwnerId },
  });

  const expiredUser = {
    sub: expiredOwnerId,
    role: 'STORE_OWNER',
    storeOwnerId: expiredOwnerId,
  };

  await assert.rejects(
    async () => {
      await salesService.create(expiredUser, {
        itemId: trialItem.id,
        quantity: 1,
        amount: 3000,
        paymentType: 'CASH',
      });
    },
    (err) => {
      assert.equal(err.statusCode, 423, 'Must throw 423 for expired trial account');
      assert.equal(err.details?.reason, 'TRIAL_EXPIRED');
      return true;
    },
  );
});

test('6. Rejected transaction resolution increments trial_sales_used and returns account_status', async () => {
  const rejOwnerId = crypto.randomUUID();
  cleanupOwnerIds.push(rejOwnerId);
  const phone = `77${Math.floor(1000000 + Math.random() * 8999999)}`;

  await prisma.$executeRaw`
    INSERT INTO store_owners (id, full_name, store_name, phone, password_hash, status, default_costing_method, allow_responsible_purchases, max_workers_allowed, trial_sales_limit, trial_sales_used, updated_at)
    VALUES (${rejOwnerId}::uuid, 'مالك المرفوضة', 'متجر المرفوضة والتجربة', ${phone}, 'test-hash', 'TRIAL'::"StoreOwnerStatus", 'WEIGHTED_AVERAGE'::"CostingMethod", false, 5, 50, 49, NOW())
  `;
  await setupAccounts(rejOwnerId);

  const rejCustomer = await prisma.creditCustomer.create({
    data: {
      storeOwnerId: rejOwnerId,
      name: 'عميل تجاوز السقف',
      phone: `73${Math.floor(1000000 + Math.random() * 8999999)}`,
      creditLimit: 0,
    },
  });

  const rejItem = await itemsService.create(rejOwnerId, {
    name: 'صنف المرفوضة',
    unit: 'كيلو',
    quantity: 10,
    costPrice: 2000,
    sellPrice: 3000,
  });
  const rId = rejItem.item ? rejItem.item.id : rejItem.id;

  const rejTx = await prisma.rejectedTransaction.create({
    data: {
      storeOwnerId: rejOwnerId,
      rejectionReasonCode: 'CREDIT_LIMIT_EXCEEDED',
      status: 'PENDING',
      attemptedPayload: {
        itemId: rId,
        quantity: 1,
        amount: 3000,
        paymentType: 'CREDIT',
        creditCustomerId: rejCustomer.id,
      },
    },
  });

  const resolveRes = await rejectedTxService.resolve(rejOwnerId, rejTx.id, {
    resolutionAction: 'ADD_CREDIT',
  });

  assert.equal(resolveRes.account_status, 'TRIAL_EXPIRED', 'Resolution must return account_status = TRIAL_EXPIRED');

  const updatedOwner = await prisma.storeOwner.findUniqueOrThrow({
    where: { id: rejOwnerId },
  });
  assert.equal(updatedOwner.trialSalesUsed, 50);
  assert.equal(updatedOwner.status, 'TRIAL_EXPIRED');
});

test('7. Failed sale does NOT increment trial_sales_used or change status', async () => {
  const initialOwner = await prisma.storeOwner.findUniqueOrThrow({
    where: { id: ownerId },
  });
  const initialUsed = initialOwner.trialSalesUsed;

  await assert.rejects(
    async () => {
      await salesService.create(ownerUser, {
        itemId: testItemId,
        quantity: -10, // كمية غير صالحة
        amount: 3000,
        paymentType: 'CASH',
      });
    },
    (err) => {
      assert.equal(err.statusCode, 400);
      return true;
    },
  );

  const dbOwner = await prisma.storeOwner.findUniqueOrThrow({
    where: { id: ownerId },
  });
  assert.equal(dbOwner.trialSalesUsed, initialUsed, 'Failed sale must not increment trial_sales_used');
  assert.equal(dbOwner.status, initialOwner.status, 'Failed sale must not alter status');
});

test('8. salesService.log returns both operations and totals: { cash, electronic, expenses }', async () => {
  // 1. بيع نقدي بـ 3000 (سعر الصنف 3000)
  await salesService.create(ownerUser, {
    itemId: testItemId,
    quantity: 1,
    amount: 3000,
    paymentType: 'CASH',
  });

  // 2. بيع إلكتروني بـ 3000
  await salesService.create(ownerUser, {
    itemId: testItemId,
    quantity: 1,
    amount: 3000,
    paymentType: 'ELECTRONIC',
    walletId,
    depositAttachmentUrl: 'https://example.com/receipt.jpg',
  });

  // 3. سلفة/مصروف عامل بـ 500
  await prisma.workerAdvance.create({
    data: {
      storeOwnerId: ownerId,
      workerId,
      amount: new Prisma.Decimal(500),
      paymentMethod: 'CASH',
      recordedAt: new Date(),
    },
  });

  const logData = await salesService.log(ownerUser);
  assert.ok(Array.isArray(logData.operations), 'operations must be an array');
  assert.ok(logData.totals, 'totals must be returned');
  assert.equal(Number(logData.totals.cash), 3000, 'Cash total must be 3000');
  assert.equal(Number(logData.totals.electronic), 3000, 'Electronic total must be 3000');
  assert.equal(Number(logData.totals.expenses), 500, 'Expenses total must be 500');
});

test('9. CREDIT_PAYMENT in operations has type CREDIT_PAYMENT and quantity null', async () => {
  // تسجيل بيع آجل أولاً بـ 3000 ليكون على العميل مديونية
  await salesService.create(ownerUser, {
    itemId: testItemId,
    quantity: 1,
    amount: 3000,
    paymentType: 'CREDIT',
    creditCustomerId,
  });

  // سداد دين عميل بـ 800
  await creditService.recordPayment(ownerUser, creditCustomerId, {
    amount: 800,
    paymentMethod: 'CASH',
  });

  const logData = await salesService.log(ownerUser);
  const creditPaymentOp = logData.operations.find((op) => op.type === 'CREDIT_PAYMENT');
  assert.ok(creditPaymentOp, 'Must find CREDIT_PAYMENT in operations');
  assert.equal(creditPaymentOp.quantity, null, 'CREDIT_PAYMENT quantity must be strictly null');
  assert.equal(Number(creditPaymentOp.amount), 800, 'CREDIT_PAYMENT amount must match');
});

test('10. COST_ONLY emergency price enforces exact equality (rejects < cost and > cost)', async () => {
  // التكلفة 3000 والبيع 4500
  // محاولة سعر أقل من التكلفة (2999) -> يرفض
  await assert.rejects(
    async () => {
      await salesService.create(ownerUser, {
        itemId: costOnlyItemId,
        quantity: 1,
        amount: 2999,
        paymentType: 'CASH',
        isEmergencySale: true,
        emergencyReason: 'سعر منخفض',
        emergencyOverridePrice: 2999,
      });
    },
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(err.code, 'EMERGENCY_PRICE_BELOW_MINIMUM');
      return true;
    },
  );

  // محاولة سعر أعلى من التكلفة (3001) -> يرفض
  await assert.rejects(
    async () => {
      await salesService.create(ownerUser, {
        itemId: costOnlyItemId,
        quantity: 1,
        amount: 3001,
        paymentType: 'CASH',
        isEmergencySale: true,
        emergencyReason: 'سعر مرتفع عن التكلفة',
        emergencyOverridePrice: 3001,
      });
    },
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(err.code, 'EMERGENCY_PRICE_ABOVE_MAXIMUM');
      return true;
    },
  );

  // محاولة سعر مساوٍ للتكلفة تماماً (3000) -> ينجح
  const successSale = await salesService.create(ownerUser, {
    itemId: costOnlyItemId,
    quantity: 1,
    amount: 3000,
    paymentType: 'CASH',
    isEmergencySale: true,
    emergencyReason: 'بيع بالتكلفة فقط',
    emergencyOverridePrice: 3000,
  });
  assert.ok(successSale.sale.id);
});

test('11. COST_PLUS uses fixed !== null ? fixed : percent priority', async () => {
  // التكلفة 2000، الثابت 400، النسبة 50%. الأولوية للثابت: الحد الأدنى = 2400
  await assert.rejects(
    async () => {
      await salesService.create(ownerUser, {
        itemId: costPlusItemId,
        quantity: 1,
        amount: 2399,
        paymentType: 'CASH',
        isEmergencySale: true,
        emergencyReason: 'أقل من التكلفة + الهامش الثابت',
        emergencyOverridePrice: 2399,
      });
    },
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(err.code, 'EMERGENCY_PRICE_BELOW_MINIMUM');
      return true;
    },
  );

  const successPlus = await salesService.create(ownerUser, {
    itemId: costPlusItemId,
    quantity: 1,
    amount: 2400,
    paymentType: 'CASH',
    isEmergencySale: true,
    emergencyReason: 'بيع بالتكلفة + الهامش المحدد',
    emergencyOverridePrice: 2400,
  });
  assert.ok(successPlus.sale.id);
});

test('12. GET /v1/inventory with permShowCostPrice = false omits cost_price but includes emergency_min_price', async () => {
  const inv = await itemsService.inventory(ownerId, {
    isWorker: true,
    showSellPrices: true,
    showCostPrice: false,
  });
  const foundPlus = inv.find((i) => i.item_id === costPlusItemId);
  assert.ok(foundPlus, 'Item must be in inventory');
  assert.equal(foundPlus.cost_price, undefined, 'cost_price must be omitted when permShowCostPrice = false');
  assert.equal(foundPlus.emergency_min_price, 2400, 'emergency_min_price must be computed and returned as 2400');

  const foundCostOnly = inv.find((i) => i.item_id === costOnlyItemId);
  assert.ok(foundCostOnly);
  assert.equal(foundCostOnly.cost_price, undefined, 'cost_price must be omitted for COST_ONLY too');
  assert.equal(foundCostOnly.emergency_min_price, 3000, 'emergency_min_price must be 3000');
});

test('13. Emergency sale with hidden cost and valid emergency_min_price succeeds and posts difference loss to 5450', async () => {
  // بيع اضطراري بواسطة العامل بالسعر الأدنى 2400 (سعر البيع الأصلي 4000، الخسارة = 1600)
  const workerSale = await salesService.create(workerUser, {
    itemId: costPlusItemId,
    quantity: 1,
    amount: 2400,
    paymentType: 'CASH',
    isEmergencySale: true,
    emergencyReason: 'زبون دائم مستعجل',
    emergencyOverridePrice: 2400,
  });

  assert.ok(workerSale.sale.id);

  // فحص قيود المحاسبة لبيع الطوارئ
  const entries = await prisma.ledgerEntry.findMany({
    where: {
      storeOwnerId: ownerId,
      referenceType: 'SALE',
      referenceId: workerSale.sale.id,
    },
    include: { account: true },
  });

  const lossEntry = entries.find((e) => e.account.code === '5450');
  assert.ok(lossEntry, 'Must find ledger entry containing account 5450');
  assert.equal(Number(lossEntry.debit), 1600, 'Loss posted to 5450 must be exactly 1600');

  const cashEntry = entries.find((e) => e.account.code === '1000');
  assert.ok(cashEntry, 'Must find cash entry 1000');
  assert.equal(Number(cashEntry.debit), 2400, 'Cash debit must be 2400');

  const revEntry = entries.find((e) => e.account.code === '4000');
  assert.ok(revEntry, 'Must find revenue entry 4000');
  assert.equal(Number(revEntry.credit), 4000, 'Revenue credit must be original sell price 4000');

  // التحقق من توازن القيد
  const totalDebits = entries.reduce((s, l) => s + Number(l.debit), 0);
  const totalCredits = entries.reduce((s, l) => s + Number(l.credit), 0);
  assert.equal(totalDebits, totalCredits, 'Debit and Credit must be perfectly balanced');
});
