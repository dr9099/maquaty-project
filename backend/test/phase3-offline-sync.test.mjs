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
import { RejectedTransactionsService } from '../dist/rejected-transactions/rejected-transactions.service.js';

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
const rejectedService = new RejectedTransactionsService(prisma, accounting, audit);
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

let ownerId;
let ownerUser;
let workerId;
let workerUser;
let supplierId;
let walletId;
let customerId;
let itemId;
const deviceFingerprint = `DEV-PHASE3-${crypto.randomUUID().slice(0, 12)}`;

async function getAccountNetBalance(storeOwnerId, code) {
  const acc = await prisma.chartOfAccount.findUnique({
    where: { storeOwnerId_code: { storeOwnerId, code } },
  });
  if (!acc) return 0;
  const entries = await prisma.ledgerEntry.findMany({
    where: { storeOwnerId, accountId: acc.id },
  });
  let debit = 0;
  let credit = 0;
  for (const e of entries) {
    debit += Number(e.debit);
    credit += Number(e.credit);
  }
  if (acc.accountType === 'ASSET' || acc.accountType === 'EXPENSE') {
    return Math.round((debit - credit) * 100) / 100;
  }
  return Math.round((credit - debit) * 100) / 100;
}

before(async () => {
  await prisma.$connect();

  ownerId = crypto.randomUUID();
  const phone = `73${Math.floor(1000000 + Math.random() * 8999999)}`;
  await prisma.$executeRaw`
    INSERT INTO store_owners (id, full_name, store_name, phone, password_hash, status, default_costing_method, allow_responsible_purchases, updated_at)
    VALUES (${ownerId}::uuid, 'مالك المرحلة الثالثة', 'متجر مزامنة الأوفلاين', ${phone}, 'test-hash', 'ACTIVE'::"StoreOwnerStatus", 'WEIGHTED_AVERAGE'::"CostingMethod", true, NOW())
  `;

  await prisma.chartOfAccount.createMany({
    data: [
      { storeOwnerId: ownerId, code: '1000', name: 'الصندوق النقدي', accountType: 'ASSET' },
      { storeOwnerId: ownerId, code: '1100', name: 'المحافظ الإلكترونية', accountType: 'ASSET' },
      { storeOwnerId: ownerId, code: '1101', name: 'محفظة: جوالي المرحلة الثالثة', accountType: 'ASSET' },
      { storeOwnerId: ownerId, code: '1200', name: 'ذمم العملاء (الآجل)', accountType: 'ASSET' },
      { storeOwnerId: ownerId, code: '1300', name: 'المخزون السلعي', accountType: 'ASSET' },
      { storeOwnerId: ownerId, code: '2000', name: 'الموردون / الذمم الدائنة', accountType: 'LIABILITY' },
      { storeOwnerId: ownerId, code: '3000', name: 'رأس المال', accountType: 'EQUITY' },
      { storeOwnerId: ownerId, code: '3100', name: 'جاري المالك', accountType: 'EQUITY' },
      { storeOwnerId: ownerId, code: '4000', name: 'إيرادات المبيعات', accountType: 'REVENUE' },
      { storeOwnerId: ownerId, code: '5000', name: 'تكلفة البضاعة المباعة', accountType: 'EXPENSE' },
      { storeOwnerId: ownerId, code: '5400', name: 'مصروف البضاعة التالفة', accountType: 'EXPENSE' },
      { storeOwnerId: ownerId, code: '5450', name: 'خسائر بيع اضطراري ومرفوضات', accountType: 'EXPENSE' },
    ],
  });

  const wallet = await prisma.wallet.create({
    data: {
      storeOwnerId: ownerId,
      name: 'جوالي المرحلة الثالثة',
      accountCode: '1101',
      isActive: true,
    },
  });
  walletId = wallet.id;

  const worker = await prisma.worker.create({
    data: {
      storeOwnerId: ownerId,
      fullName: 'عامل مسؤول المرحلة الثالثة',
      phone: `71${Math.floor(1000000 + Math.random() * 8999999)}`,
      passwordHash: 'test-hash',
      status: 'ACTIVE',
      isResponsible: true,
      permDamagedGoodsEntry: true,
    },
  });
  workerId = worker.id;

  const supplier = await prisma.supplier.create({
    data: {
      storeOwnerId: ownerId,
      name: 'مورد المرحلة الثالثة',
      phone: '773334455',
    },
  });
  supplierId = supplier.id;

  const customer = await prisma.creditCustomer.create({
    data: {
      storeOwnerId: ownerId,
      name: 'عميل آجل المرحلة الثالثة',
      phone: '774445566',
      creditLimit: 50000,
    },
  });
  customerId = customer.id;

  const createdItem = await itemsService.create(ownerId, {
    name: 'قات همداني ممتاز',
    unit: 'كيلو',
    quantity: 20,
    costPrice: 3000,
    sellPrice: 5000,
  });
  itemId = createdItem.item ? createdItem.item.id : createdItem.id;

  ownerUser = {
    sub: ownerId,
    role: 'STORE_OWNER',
    storeOwnerId: ownerId,
  };

  workerUser = {
    sub: workerId,
    role: 'WORKER',
    storeOwnerId: ownerId,
    workerId,
    isResponsible: true,
  };
});

after(async () => {
  if (ownerId) {
    await prisma.syncOperation.deleteMany({ where: { storeOwnerId: ownerId } });
    await prisma.device.deleteMany({ where: { storeOwnerId: ownerId } });
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
    await prisma.auditLog.deleteMany({ where: { actorId: { in: [ownerId, workerId] } } });
    await prisma.storeOwner.deleteMany({ where: { id: ownerId } });
  }
  await prisma.$disconnect();
});

test('1-4. Offline SALE (Cash, Electronic, Credit, Emergency) syncs once and is idempotent on retry', async () => {
  const cashOpId = crypto.randomUUID();
  const elecOpId = crypto.randomUUID();
  const creditOpId = crypto.randomUUID();
  const emergOpId = crypto.randomUUID();

  const operations = [
    {
      clientOpId: cashOpId,
      opType: 'SALE',
      payload: {
        id: cashOpId,
        itemId,
        quantity: 2,
        quantityUnit: 'KILO',
        amount: 10000,
        paymentType: 'CASH',
      },
    },
    {
      clientOpId: elecOpId,
      opType: 'SALE',
      payload: {
        id: elecOpId,
        itemId,
        quantity: 1,
        quantityUnit: 'KILO',
        amount: 5000,
        paymentType: 'ELECTRONIC',
        walletId,
        depositAttachmentUrl: 'https://cdn.maquaty.local/receipt-elec-1.jpg',
      },
    },
    {
      clientOpId: creditOpId,
      opType: 'SALE',
      payload: {
        id: creditOpId,
        itemId,
        quantity: 3,
        quantityUnit: 'KILO',
        amount: 15000,
        paymentType: 'CREDIT',
        creditCustomerId: customerId,
      },
    },
    {
      clientOpId: emergOpId,
      opType: 'SALE',
      payload: {
        id: emergOpId,
        itemId,
        quantity: 1,
        quantityUnit: 'KILO',
        amount: 4000,
        paymentType: 'CASH',
        isEmergencySale: true,
        emergencyOverridePrice: 4000,
        emergencyReason: 'نهاية اليوم وتصريف البضاعة',
      },
    },
  ];

  // المزامنة الأولى
  const syncRes1 = await syncService.sync(workerUser, {
    deviceFingerprint,
    lastSyncVersion: 0,
    pendingLocalOperations: operations,
  });

  assert.equal(syncRes1.processed_operations.length, 4);
  for (const p of syncRes1.processed_operations) {
    assert.equal(p.status, 'ACCEPTED');
  }

  // التحقق من المخزون (20 - 2 - 1 - 3 - 1 = 13)
  const itemAfter1 = await prisma.item.findUniqueOrThrow({ where: { id: itemId } });
  assert.equal(Number(itemAfter1.quantity), 13);

  // إعادة إرسال نفس العمليات (Retry / Duplicate Sync) + إعادة استدعاء مباشر بنفس المعرف
  const syncRes2 = await syncService.sync(workerUser, {
    deviceFingerprint,
    lastSyncVersion: syncRes1.new_sync_version,
    pendingLocalOperations: operations,
  });
  assert.equal(syncRes2.processed_operations.length, 4);
  for (const p of syncRes2.processed_operations) {
    assert.equal(p.status, 'ACCEPTED');
  }

  // استدعاء مباشر بنفس معرف البيع للتأكد من عدم تكرار الخصم حتى خارج sync_operations
  await salesService.create(workerUser, {
    id: cashOpId,
    itemId,
    quantity: 2,
    quantityUnit: 'KILO',
    amount: 10000,
    paymentType: 'CASH',
  });

  const itemAfter2 = await prisma.item.findUniqueOrThrow({ where: { id: itemId } });
  assert.equal(Number(itemAfter2.quantity), 13, 'يجب ألا يُخصم المخزون مرتين عند إعادة الإرسال');

  const salesCount = await prisma.sale.count({ where: { storeOwnerId: ownerId } });
  assert.equal(salesCount, 4, 'يجب أن يوجد 4 سجلات بيع فقط دون تكرار');

  assert.equal(await getAccountNetBalance(ownerId, '1200'), 15000, 'مديونية العميل 15,000');
  assert.equal(await getAccountNetBalance(ownerId, '5450'), 1000, 'خسارة البيع الاضطراري 1,000');
});

test('5. Offline CREDIT_PAYMENT syncs once, reduces debt, and does not double-apply on retry', async () => {
  const payOpId = crypto.randomUUID();
  const paymentOp = {
    clientOpId: payOpId,
    opType: 'CREDIT_PAYMENT',
    payload: {
      id: payOpId,
      customerId,
      amount: 6000,
      paymentMethod: 'CASH',
      notes: 'تحصيل أوفلاين من العميل',
    },
  };

  const syncRes1 = await syncService.sync(ownerUser, {
    deviceFingerprint,
    lastSyncVersion: 2,
    pendingLocalOperations: [paymentOp],
  });
  assert.equal(syncRes1.processed_operations[0].status, 'ACCEPTED');
  assert.equal(await getAccountNetBalance(ownerId, '1200'), 9000, 'مديونية العميل تنخفض من 15,000 إلى 9,000');

  // إعادة إرسال نفس العملية عبر المزامنة ومباشرة
  const syncRes2 = await syncService.sync(ownerUser, {
    deviceFingerprint,
    lastSyncVersion: syncRes1.new_sync_version,
    pendingLocalOperations: [paymentOp],
  });
  assert.equal(syncRes2.processed_operations[0].status, 'ACCEPTED');

  await creditService.recordPayment(ownerUser, customerId, {
    id: payOpId,
    customerId,
    amount: 6000,
    paymentMethod: 'CASH',
  });

  assert.equal(await getAccountNetBalance(ownerId, '1200'), 9000, 'لا يُخصم السداد مرتين من ذمة العميل');
});

test('6. Offline DAMAGED_GOODS syncs once, deducts stock, posts 5400/1300, and is idempotent', async () => {
  const dmgOpId = crypto.randomUUID();
  const dmgOp = {
    clientOpId: dmgOpId,
    opType: 'DAMAGED_GOODS',
    payload: {
      id: dmgOpId,
      itemId,
      quantity: 2,
      isDamaged: true,
      reason: 'تلف بسبب الحرارة أثناء انقطاع الإنترنت',
      photoUrl: 'https://cdn.maquaty.local/damaged-1.jpg',
    },
  };

  const syncRes1 = await syncService.sync(workerUser, {
    deviceFingerprint,
    lastSyncVersion: 4,
    pendingLocalOperations: [dmgOp],
  });
  assert.equal(syncRes1.processed_operations[0].status, 'ACCEPTED');

  // المخزون ينخفض من 13 إلى 11
  const itemAfter = await prisma.item.findUniqueOrThrow({ where: { id: itemId } });
  assert.equal(Number(itemAfter.quantity), 11);
  // تكلفة التالف = 2 × 3000 = 6000 في الحساب 5400
  assert.equal(await getAccountNetBalance(ownerId, '5400'), 6000);

  // إعادة المحاولة
  await syncService.sync(workerUser, {
    deviceFingerprint,
    lastSyncVersion: syncRes1.new_sync_version,
    pendingLocalOperations: [dmgOp],
  });
  await damagedGoodsService.record(workerUser, dmgOp.payload);

  const itemAfterRetry = await prisma.item.findUniqueOrThrow({ where: { id: itemId } });
  assert.equal(Number(itemAfterRetry.quantity), 11);
  assert.equal(await getAccountNetBalance(ownerId, '5400'), 6000);
});

test('7-8. Offline PURCHASE (with distinct invoiceId and clientOpId + line IDs) and offline PURCHASE_RETURN sync cleanly', async () => {
  const invoiceId = crypto.randomUUID();
  const purchaseClientOpId = crypto.randomUUID();
  const purchaseLineId = crypto.randomUUID();
  const newItemName = 'قات أرحبي أوفلاين';

  const purchaseOp = {
    clientOpId: purchaseClientOpId,
    opType: 'PURCHASE',
    payload: {
      id: invoiceId,
      clientOpId: purchaseClientOpId,
      supplierId,
      paymentType: 'CREDIT',
      status: 'POSTED',
      costingMethod: 'WEIGHTED_AVERAGE',
      items: [
        {
          id: purchaseLineId,
          itemName: newItemName,
          unit: 'كيلو',
          baseUnit: 'كيلو',
          conversionFactor: 1,
          quantity: 10,
          unitCostPrice: 4000,
          sellPrice: 6000,
        },
      ],
    },
  };

  const syncPurchaseRes = await syncService.sync(ownerUser, {
    deviceFingerprint,
    lastSyncVersion: 6,
    pendingLocalOperations: [purchaseOp],
  });
  assert.equal(syncPurchaseRes.processed_operations[0].status, 'ACCEPTED');

  // التحقق من إنشاء الفاتورة بمعرف invoiceId وبند الشراء بمعرف purchaseLineId المحفوظ محلياً
  const createdInvoice = await purchasesService.getById(ownerId, invoiceId);
  assert.equal(createdInvoice.id, invoiceId);
  assert.equal(createdInvoice.items.length, 1);
  assert.equal(createdInvoice.items[0].id, purchaseLineId);
  assert.equal(createdInvoice.remaining_amount, 40000);

  // الآن إرسال مرتجع مشتريات أوفلاين يستخدم purchaseLineId و invoiceId الذين أنشئا أوفلاين!
  const returnOpId = crypto.randomUUID();
  const returnOp = {
    clientOpId: returnOpId,
    opType: 'PURCHASE_RETURN',
    payload: {
      id: returnOpId,
      clientOpId: returnOpId,
      purchaseInvoiceId: invoiceId,
      purchaseItemId: purchaseLineId,
      quantity: 3,
      quantityUnit: 'KILO',
      refundMethod: 'DEBT_REDUCTION',
      reason: 'مرتجع جزئي مسجل أوفلاين',
    },
  };

  const syncReturnRes = await syncService.sync(ownerUser, {
    deviceFingerprint,
    lastSyncVersion: syncPurchaseRes.new_sync_version,
    pendingLocalOperations: [returnOp],
  });
  assert.equal(syncReturnRes.processed_operations[0].status, 'ACCEPTED');

  const updatedInvoice = await purchasesService.getById(ownerId, invoiceId);
  assert.equal(updatedInvoice.items[0].returned_quantity, 3);
  assert.equal(updatedInvoice.remaining_amount, 28000); // 40,000 - (3 * 4,000)

  // إعادة محاولة نفس المرتجع لا تكرر الخصم
  await purchasesService.createReturn(ownerUser, invoiceId, returnOp.payload);
  const afterRetryInvoice = await purchasesService.getById(ownerId, invoiceId);
  assert.equal(afterRetryInvoice.items[0].returned_quantity, 3);
  assert.equal(afterRetryInvoice.remaining_amount, 28000);
});

test('9-10. Rejected offline SALE (INSUFFICIENT_STOCK or CREDIT_LIMIT_EXCEEDED) creates RejectedTransaction and can be resolved', async () => {
  const rejectedStockOpId = crypto.randomUUID();
  const rejectedCreditOpId = crypto.randomUUID();

  const syncRes = await syncService.sync(workerUser, {
    deviceFingerprint,
    lastSyncVersion: 10,
    pendingLocalOperations: [
      {
        clientOpId: rejectedStockOpId,
        opType: 'SALE',
        payload: {
          id: rejectedStockOpId,
          itemId,
          quantity: 500, // أكبر من المتوفر (11)
          quantityUnit: 'KILO',
          amount: 2500000,
          paymentType: 'CASH',
        },
      },
      {
        clientOpId: rejectedCreditOpId,
        opType: 'SALE',
        payload: {
          id: rejectedCreditOpId,
          itemId,
          quantity: 10,
          quantityUnit: 'KILO',
          amount: 50000, // يتجاوز المتبقي من سقف الائتمان (50,000 - 9,000 = 41,000)
          paymentType: 'CREDIT',
          creditCustomerId: customerId,
        },
      },
    ],
  });

  assert.equal(syncRes.processed_operations[0].status, 'REJECTED');
  assert.equal(syncRes.processed_operations[0].error_code, 'INSUFFICIENT_STOCK');
  assert.equal(syncRes.processed_operations[1].status, 'REJECTED');
  assert.equal(syncRes.processed_operations[1].error_code, 'CREDIT_LIMIT_EXCEEDED');

  const rejectedList = await rejectedService.list(ownerId);
  assert.equal(rejectedList.length, 2);

  // معالجة المرفوضة بسبب سقف الائتمان عبر APPROVE_AS_VALID بعد رفع السقف
  await creditService.update(ownerId, customerId, { creditLimit: 100000 });
  const creditRej = rejectedList.find((r) => r.rejection_reason_code === 'CREDIT_LIMIT_EXCEEDED');
  const resolved = await rejectedService.resolve(ownerId, creditRej.id, {
    resolutionAction: 'ADD_CREDIT',
  });
  assert.equal(resolved.status, 'RESOLVED');
});

test('11. Server sync response includes server_updates (items, workers, suppliers, purchases) and min_app_version', async () => {
  const syncRes = await syncService.sync(ownerUser, {
    deviceFingerprint,
    lastSyncVersion: 15,
    pendingLocalOperations: [],
  });

  assert.ok(typeof syncRes.min_app_version === 'string' && syncRes.min_app_version.length > 0);
  assert.ok(Array.isArray(syncRes.server_updates.items));
  assert.ok(Array.isArray(syncRes.server_updates.workers));
  assert.ok(Array.isArray(syncRes.server_updates.suppliers));
  assert.ok(Array.isArray(syncRes.server_updates.purchases));
  assert.equal(syncRes.server_updates.workers.length, 1);
  assert.equal(syncRes.server_updates.workers[0].id, workerId);
});

