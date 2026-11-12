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
import { RejectedTransactionsService } from '../dist/rejected-transactions/rejected-transactions.service.js';

const prisma = new PrismaService();
const accounting = new AccountingService(prisma);
const audit = new AuditService(prisma);
const itemsService = new ItemsService(prisma, accounting);
const suppliersService = new SuppliersService(prisma, accounting, audit);
const purchasesService = new PurchasesService(prisma, accounting, audit, suppliersService);
const salesService = new SalesService(prisma, accounting);
const rejectedService = new RejectedTransactionsService(prisma, accounting, audit);

let ownerId;
let ownerUser;
let supplierId;
let walletId;

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
  const phone = `78${Math.floor(1000000 + Math.random() * 8999999)}`;
  await prisma.$executeRaw`
    INSERT INTO store_owners (id, full_name, store_name, phone, password_hash, status, default_costing_method, updated_at)
    VALUES (${ownerId}::uuid, 'مالك اختبار المرحلة الثانية', 'متجر اختبار المشتريات والمخزون', ${phone}, 'test-hash', 'ACTIVE'::"StoreOwnerStatus", 'WEIGHTED_AVERAGE'::"CostingMethod", NOW())
  `;

  await prisma.chartOfAccount.createMany({
    data: [
      { storeOwnerId: ownerId, code: '1000', name: 'الصندوق النقدي', accountType: 'ASSET' },
      { storeOwnerId: ownerId, code: '1100', name: 'المحافظ الإلكترونية', accountType: 'ASSET' },
      { storeOwnerId: ownerId, code: '1101', name: 'محفظة: جوالي المرحلة الثانية', accountType: 'ASSET' },
      { storeOwnerId: ownerId, code: '1200', name: 'ذمم العملاء (الآجل)', accountType: 'ASSET' },
      { storeOwnerId: ownerId, code: '1300', name: 'المخزون السلعي', accountType: 'ASSET' },
      { storeOwnerId: ownerId, code: '2000', name: 'الموردون / الذمم الدائنة', accountType: 'LIABILITY' },
      { storeOwnerId: ownerId, code: '3000', name: 'رأس المال', accountType: 'EQUITY' },
      { storeOwnerId: ownerId, code: '3100', name: 'جاري المالك', accountType: 'EQUITY' },
      { storeOwnerId: ownerId, code: '4000', name: 'إيرادات المبيعات', accountType: 'REVENUE' },
      { storeOwnerId: ownerId, code: '5000', name: 'تكلفة البضاعة المباعة', accountType: 'EXPENSE' },
      { storeOwnerId: ownerId, code: '5450', name: 'خسائر بيع اضطراري ومرفوضات', accountType: 'EXPENSE' },
    ],
  });

  const wallet = await prisma.wallet.create({
    data: {
      storeOwnerId: ownerId,
      name: 'جوالي المرحلة الثانية',
      accountCode: '1101',
      isActive: true,
    },
  });
  walletId = wallet.id;

  const supplier = await prisma.supplier.create({
    data: {
      storeOwnerId: ownerId,
      name: 'مورد المرحلة الثانية',
      phone: '772223344',
    },
  });
  supplierId = supplier.id;

  ownerUser = {
    sub: ownerId,
    role: 'STORE_OWNER',
    storeOwnerId: ownerId,
  };
});

after(async () => {
  if (ownerId) {
    await prisma.ledgerEntry.deleteMany({ where: { storeOwnerId: ownerId } });
    await prisma.rejectedTransaction.deleteMany({ where: { storeOwnerId: ownerId } });
    await prisma.purchaseReturn.deleteMany({ where: { storeOwnerId: ownerId } });
    await prisma.supplierPayment.deleteMany({ where: { storeOwnerId: ownerId } });
    await prisma.purchaseItem.deleteMany({ where: { storeOwnerId: ownerId } });
    await prisma.purchaseInvoice.deleteMany({ where: { storeOwnerId: ownerId } });
    await prisma.sale.deleteMany({ where: { storeOwnerId: ownerId } });
    await prisma.item.deleteMany({ where: { storeOwnerId: ownerId } });
    await prisma.supplier.deleteMany({ where: { storeOwnerId: ownerId } });
    await prisma.wallet.deleteMany({ where: { storeOwnerId: ownerId } });
    await prisma.chartOfAccount.deleteMany({ where: { storeOwnerId: ownerId } });
    await prisma.auditLog.deleteMany({ where: { actorId: ownerId } });
    await prisma.storeOwner.deleteMany({ where: { id: ownerId } });
  }
  await prisma.$disconnect();
});

test('1. Direct item creation with zero stock defines item without creating ledger entries', async () => {
  const res = await itemsService.create(ownerId, {
    name: 'قات تعريف صفري',
    unit: 'كيلو',
    quantity: 0,
    costPrice: 2000,
    sellPrice: 3000,
  });

  assert.equal(res.merged, false);
  assert.equal(Number(res.item.quantity), 0);
  assert.equal(Number(res.item.costPrice), 2000);
  assert.equal(Number(res.item.sellPrice), 3000);

  const itemEntries = await prisma.ledgerEntry.findMany({
    where: { storeOwnerId: ownerId, referenceId: res.item.id },
  });
  assert.equal(itemEntries.length, 0, 'لا يجوز إنشاء قيد محاسبي عند تعريف صنف بكمية صفرية');

  // رفض الكميات السالبة
  await assert.rejects(
    () =>
      itemsService.create(ownerId, {
        name: 'صنف سالب',
        unit: 'كيلو',
        quantity: -1,
        costPrice: 1000,
        sellPrice: 1500,
      }),
    (err) => err.code === 'VALIDATION_ERROR',
  );
});

test('2. Direct item creation with initial stock records balanced inventory journal entry and keeps 1300 non-negative on sale', async () => {
  const invBefore = await getAccountNetBalance(ownerId, '1300');
  const eqBefore = await getAccountNetBalance(ownerId, '3000');

  const res = await itemsService.create(ownerId, {
    name: 'قات توريد مباشر أولي',
    unit: 'كيلو',
    quantity: 4,
    costPrice: 2500,
    sellPrice: 3500,
  });

  assert.equal(Number(res.item.quantity), 4);
  const invAfterCreate = await getAccountNetBalance(ownerId, '1300');
  const eqAfterCreate = await getAccountNetBalance(ownerId, '3000');
  assert.equal(invAfterCreate - invBefore, 10000, 'يجب مدينية حساب المخزون 1300 بقيمة التوريد المباشر (10000)');
  assert.equal(eqAfterCreate - eqBefore, 10000, 'يجب دائنية حساب رأس المال 3000 بقيمة التوريد المباشر (10000)');

  // بيع كامل الكمية (4 كيلو) والتحقق من عودة رصيد 1300 إلى مستواه السابق دون أن يصبح سالباً
  await salesService.create(ownerUser, {
    itemId: res.item.id,
    quantity: 4,
    amount: 14000,
    paymentType: 'CASH',
  });

  const invAfterSale = await getAccountNetBalance(ownerId, '1300');
  assert.equal(invAfterSale, invBefore, 'بعد بيع كامل الكمية الموردة مباشرة يجب أن يعود رصيد 1300 للصفر دون رصيد سالب');
});

test('3 & 4. Purchasing an existing item created on a previous date updates entryDate and makes it visible in GET /v1/inventory', async () => {
  const yesterday = new Date();
  yesterday.setHours(0, 0, 0, 0);
  yesterday.setDate(yesterday.getDate() - 2);

  // صنف منشأ في تاريخ سابق بكمية صفرية
  const previousDateItem = await prisma.item.create({
    data: {
      storeOwnerId: ownerId,
      name: 'قات أرحبي من يوم سابق',
      unit: 'كيلو',
      quantity: 0,
      costPrice: 1800,
      sellPrice: 2500,
      entryDate: yesterday,
    },
  });

  // قبل الشراء، الصنف لا يظهر في مخزون اليوم
  const invBefore = await itemsService.inventory(ownerId, {
    isWorker: false,
    showSellPrices: true,
    showCostPrice: true,
  });
  assert.equal(
    invBefore.some((it) => it.item_id === previousDateItem.id),
    false,
    'الصنف ذو التاريخ السابق لا يظهر في مخزون اليوم قبل شرائه',
  );

  // شراء الصنف اليوم عبر تمرير itemId
  const purchaseRes = await purchasesService.create(ownerUser, {
    supplierId,
    paymentType: 'CASH',
    status: 'POSTED',
    items: [
      {
        itemId: previousDateItem.id,
        itemName: 'قات أرحبي من يوم سابق',
        unit: 'كيلو',
        quantity: 6,
        unitCostPrice: 2200,
        sellPrice: 3200,
      },
    ],
  });

  assert.equal(purchaseRes.items[0].item_id, previousDateItem.id);

  // التحقق من ظهور الصنف فوراً في GET /v1/inventory لليوم الحالي بالقيم المحدثة
  const invAfter = await itemsService.inventory(ownerId, {
    isWorker: false,
    showSellPrices: true,
    showCostPrice: true,
  });
  const foundInInventory = invAfter.find((it) => it.item_id === previousDateItem.id);
  assert.ok(foundInInventory, 'يجب أن يظهر الصنف المشترى اليوم في GET /v1/inventory حتى لو أُنشئ في تاريخ سابق');
  assert.equal(Number(foundInInventory.remaining_qty), 6);
  assert.equal(Number(foundInInventory.cost_price), 2200);
  assert.equal(Number(foundInInventory.sell_price), 3200);
  assert.equal(Number(foundInInventory.remaining_value), 19200);
});

test('5. Partial cash and partial electronic purchase settlements split paid and payable balances accurately', async () => {
  const cashBefore = await getAccountNetBalance(ownerId, '1000');
  const walletBefore = await getAccountNetBalance(ownerId, '1101');
  const payablesBefore = await getAccountNetBalance(ownerId, '2000');
  const supplierBefore = await prisma.supplier.findUnique({ where: { id: supplierId } });

  // 5a) شراء جزئي نقدي (إجمالي 10000، مدفوع نقداً 4000، آجل 6000)
  const partialCashInv = await purchasesService.create(ownerUser, {
    supplierId,
    paymentType: 'PARTIAL',
    paidAmount: 4000,
    status: 'POSTED',
    items: [
      {
        itemName: 'قات دفع جزئي نقدي',
        unit: 'كيلو',
        quantity: 5,
        unitCostPrice: 2000,
        sellPrice: 3000,
      },
    ],
  });

  assert.equal(partialCashInv.paid_amount, 4000);
  assert.equal(partialCashInv.remaining_amount, 6000);
  assert.equal(partialCashInv.wallet, null);

  // 5b) شراء جزئي عبر محفظة إلكترونية (إجمالي 10000، مدفوع إلكترونياً 3500، آجل 6500)
  const partialWalletInv = await purchasesService.create(ownerUser, {
    supplierId,
    paymentType: 'PARTIAL',
    paidAmount: 3500,
    walletId,
    status: 'POSTED',
    items: [
      {
        itemName: 'قات دفع جزئي محفظة',
        unit: 'كيلو',
        quantity: 5,
        unitCostPrice: 2000,
        sellPrice: 3000,
      },
    ],
  });

  assert.equal(partialWalletInv.paid_amount, 3500);
  assert.equal(partialWalletInv.remaining_amount, 6500);
  assert.equal(partialWalletInv.wallet.id, walletId);

  const cashAfter = await getAccountNetBalance(ownerId, '1000');
  const walletAfter = await getAccountNetBalance(ownerId, '1101');
  const payablesAfter = await getAccountNetBalance(ownerId, '2000');
  const supplierAfter = await prisma.supplier.findUnique({ where: { id: supplierId } });

  assert.equal(cashBefore - cashAfter, 4000, 'يجب خصم الجزء النقدي فقط (4000) من الصندوق 1000');
  assert.equal(walletBefore - walletAfter, 3500, 'يجب خصم الجزء الإلكتروني (3500) من حساب المحفظة 1101');
  assert.equal(payablesAfter - payablesBefore, 12500, 'يجب زيادة ذمم الموردين 2000 بمجموع الآجل (6000 + 6500 = 12500)');
  assert.equal(
    Number(supplierAfter.currentBalance) - Number(supplierBefore.currentBalance),
    12500,
    'رصيد المورد يجب أن يزيد بمقدار الجزء غير المسدد فقط (12500)',
  );
});

test('6 & 8. Purchase return with discount and multiple partial fractional returns reverses exact net purchase cost without rounding drift', async () => {
  const supBefore = await prisma.supplier.findUnique({ where: { id: supplierId } });
  const invAccBefore = await getAccountNetBalance(ownerId, '1300');

  // فاتورة آجلة: 3 كيلو × 1000 = 3000 مع خصم إجمالي 100 => الصافي 2900 (966.67 للكيلو بالتقريب)
  const inv = await purchasesService.create(ownerUser, {
    supplierId,
    paymentType: 'CREDIT',
    discountAmount: 100,
    status: 'POSTED',
    items: [
      {
        itemName: 'قات مرتجعات جزئية مع خصم',
        unit: 'كيلو',
        quantity: 3,
        unitCostPrice: 1000,
        sellPrice: 1500,
      },
    ],
  });

  assert.equal(inv.total_amount, 2900);
  const pItemId = inv.items[0].id;
  const itemId = inv.items[0].item_id;

  // مرتجع جزئي أول: 0.5 كيلو
  const ret1 = await purchasesService.createReturn(ownerUser, inv.id, {
    purchaseItemId: pItemId,
    quantity: 0.5,
    quantityUnit: 'KILO',
    refundMethod: 'DEBT_REDUCTION',
    reason: 'مرتجع جزئي أول 0.5 كجم',
  });
  assert.equal(ret1.quantity, 0.5);
  assert.equal(ret1.total_amount, 483.33);

  // مرتجع جزئي ثانٍ: 1.25 كيلو
  const ret2 = await purchasesService.createReturn(ownerUser, inv.id, {
    purchaseItemId: pItemId,
    quantity: 1.25,
    quantityUnit: 'KILO',
    refundMethod: 'DEBT_REDUCTION',
    reason: 'مرتجع جزئي ثانٍ 1.25 كجم',
  });
  assert.equal(ret2.quantity, 1.25);
  assert.equal(ret2.total_amount, 1208.33);

  // محاولة إرجاع كمية أكبر من المتبقي (المتبقي 1.25 كيلو، المحاولة 1.5 كيلو) -> يجب رفضها
  await assert.rejects(
    () =>
      purchasesService.createReturn(ownerUser, inv.id, {
        purchaseItemId: pItemId,
        quantity: 1.5,
        quantityUnit: 'KILO',
        refundMethod: 'DEBT_REDUCTION',
        reason: 'تجاوز المتبقي',
      }),
    (err) => err.code === 'RETURN_QTY_EXCEEDS_PURCHASED',
  );

  // مرتجع جزئي ثالث وأخير: المتبقي 1.25 كيلو بالكامل -> يجب أن يعكس الرصيد المتبقي بدقة (2900 - 483.33 - 1208.33 = 1208.34)
  const ret3 = await purchasesService.createReturn(ownerUser, inv.id, {
    purchaseItemId: pItemId,
    quantity: 1.25,
    quantityUnit: 'KILO',
    refundMethod: 'DEBT_REDUCTION',
    reason: 'مرتجع جزئي أخير 1.25 كجم',
  });
  assert.equal(ret3.quantity, 1.25);
  assert.equal(ret3.total_amount, 1208.34);

  const totalReturned = Math.round((ret1.total_amount + ret2.total_amount + ret3.total_amount) * 100) / 100;
  assert.equal(totalReturned, 2900, 'مجموع المرتجعات الجزئية يجب أن يساوي صافي قيمة الفاتورة الأصلية (2900.00) دون أي انحراف تقريب');

  const updatedInv = await purchasesService.getById(ownerId, inv.id);
  assert.equal(updatedInv.remaining_amount, 0, 'يجب تصفير المتبقي على الفاتورة بالكامل');
  assert.equal(updatedInv.settled_amount, 2900, 'المسوى على الفاتورة يجب أن يساوي 2900');
  assert.equal(updatedInv.items[0].returned_quantity, 3);
  assert.equal(updatedInv.items[0].remaining_fifo_qty, 0);

  const itemAfter = await prisma.item.findUnique({ where: { id: itemId } });
  assert.equal(Number(itemAfter.quantity), 0, 'يجب أن يعود رصيد الصنف إلى صفر بعد إرجاع كامل الكمية');

  const supAfter = await prisma.supplier.findUnique({ where: { id: supplierId } });
  assert.equal(
    Number(supAfter.currentBalance),
    Number(supBefore.currentBalance),
    'يجب أن يعود رصيد المورد لما كان عليه قبل الفاتورة تماماً',
  );

  const invAccAfter = await getAccountNetBalance(ownerId, '1300');
  assert.equal(invAccAfter, invAccBefore, 'رصيد حساب المخزون 1300 يجب أن يعود لما كان عليه دون فرق 0.01');
});

test('7 & 9. Purchase return with tax/fees and multi-line rounding maintains exact supplier balance and ledger consistency', async () => {
  const supBefore = await prisma.supplier.findUnique({ where: { id: supplierId } });
  const invAccBefore = await getAccountNetBalance(ownerId, '1300');

  // فاتورة متعددة البنود مع ضريبة/رسوم إضافية لا تقبل القسمة بدون كسور:
  // 3 بنود × 1000 = 3000 + ضريبة 100 = 3100 (توزيع البنود: 1033.33 + 1033.33 + 1033.34 = 3100.00)
  const inv = await purchasesService.create(ownerUser, {
    supplierId,
    paymentType: 'CREDIT',
    taxAmount: 100,
    status: 'POSTED',
    items: [
      {
        itemName: 'صنف ضريبة 1',
        unit: 'كيلو',
        quantity: 3,
        unitCostPrice: 333.33,
        discountAmount: 0,
        taxAmount: 0.01, // totalLineCost = 1000.00
        sellPrice: 500,
      },
      {
        itemName: 'صنف ضريبة 2',
        unit: 'كيلو',
        quantity: 3,
        unitCostPrice: 333.33,
        discountAmount: 0,
        taxAmount: 0.01, // totalLineCost = 1000.00
        sellPrice: 500,
      },
      {
        itemName: 'صنف ضريبة 3',
        unit: 'كيلو',
        quantity: 3,
        unitCostPrice: 333.33,
        discountAmount: 0,
        taxAmount: 0.01, // totalLineCost = 1000.00
        sellPrice: 500,
      },
    ],
  });

  assert.equal(inv.total_amount, 3100);

  // إرجاع البند الأول بالكامل على دفعتين (1 كيلو ثم 2 كيلو)
  const r1a = await purchasesService.createReturn(ownerUser, inv.id, {
    purchaseItemId: inv.items[0].id,
    quantity: 1,
    refundMethod: 'DEBT_REDUCTION',
    reason: 'إرجاع جزئي بند 1',
  });
  const r1b = await purchasesService.createReturn(ownerUser, inv.id, {
    purchaseItemId: inv.items[0].id,
    quantity: 2,
    refundMethod: 'DEBT_REDUCTION',
    reason: 'إرجاع باقي بند 1',
  });
  assert.equal(Math.round((r1a.total_amount + r1b.total_amount) * 100) / 100, 1033.33);

  // إرجاع البند الثاني بالكامل دفعة واحدة (3 كيلو)
  const r2 = await purchasesService.createReturn(ownerUser, inv.id, {
    purchaseItemId: inv.items[1].id,
    quantity: 3,
    refundMethod: 'DEBT_REDUCTION',
    reason: 'إرجاع كامل بند 2',
  });
  assert.equal(r2.total_amount, 1033.33);

  // إرجاع البند الثالث بالكامل دفعة واحدة (3 كيلو) -> يحمل فرق التقريب 1033.34 ليطابق الإجمالي 3100.00
  const r3 = await purchasesService.createReturn(ownerUser, inv.id, {
    purchaseItemId: inv.items[2].id,
    quantity: 3,
    refundMethod: 'DEBT_REDUCTION',
    reason: 'إرجاع كامل بند 3',
  });
  assert.equal(r3.total_amount, 1033.34);

  const afterInv = await purchasesService.getById(ownerId, inv.id);
  assert.equal(afterInv.remaining_amount, 0, 'يجب تصفير الذمة المتبقية على الفاتورة بعد إرجاع جميع البنود');
  assert.equal(afterInv.settled_amount, 3100, 'المبلغ المسوى على الفاتورة يجب أن يساوي 3100.00 بالضبط');

  const supAfter = await prisma.supplier.findUnique({ where: { id: supplierId } });
  assert.equal(Number(supAfter.currentBalance), Number(supBefore.currentBalance));

  const invAccAfter = await getAccountNetBalance(ownerId, '1300');
  assert.equal(invAccAfter, invAccBefore);
});

test('10. Synchronized 3-option costing engine (FIFO, WEIGHTED_AVERAGE, LAST_PRICE) remains intact and does not corrupt original invoice return cost', async () => {
  // شراء دفعة أولى: 2 كيلو بسعر 2000 (آجل)
  const inv1 = await purchasesService.create(ownerUser, {
    supplierId,
    paymentType: 'CREDIT',
    status: 'POSTED',
    items: [
      {
        itemName: 'قات اختبار توافق التكلفة والمرتجع',
        unit: 'كيلو',
        quantity: 2,
        unitCostPrice: 2000,
        sellPrice: 3500,
      },
    ],
  });
  const sharedItemId = inv1.items[0].item_id;

  // شراء دفعة ثانية في نفس اليوم: 2 كيلو بسعر 3000 مع اختيار WEIGHTED_AVERAGE (المتوسط المرجح = 2500)
  await purchasesService.create(ownerUser, {
    supplierId,
    paymentType: 'CASH',
    costingMethod: 'WEIGHTED_AVERAGE',
    status: 'POSTED',
    items: [
      {
        itemId: sharedItemId,
        itemName: 'قات اختبار توافق التكلفة والمرتجع',
        unit: 'كيلو',
        quantity: 2,
        unitCostPrice: 3000,
        sellPrice: 4000,
      },
    ],
  });

  // قبل أي بيع: إرجاع 1 كيلو من الفاتورة الأولى (التي شُريت بسعر 2000) -> يجب أن يُحسب المرتجع بسعر الفاتورة الأصلية (2000) وليس المتوسط (2500)!
  const retFromInv1 = await purchasesService.createReturn(ownerUser, inv1.id, {
    purchaseItemId: inv1.items[0].id,
    quantity: 1,
    refundMethod: 'DEBT_REDUCTION',
    reason: 'إرجاع من الفاتورة الأولى',
  });
  assert.equal(retFromInv1.total_amount, 2000, 'يجب أن يعكس المرتجع تكلفة الفاتورة الأصلية (2000) وليس المتوسط المرجح اللاحق');

  // الآن نبيع 2 كيلو عبر SalesService -> يجب أن تُحسب التكلفة بالمتوسط المرجح المعتمد على الطبقات النشطة (2 * 2500 = 5000)
  const sale = await salesService.create(ownerUser, {
    itemId: sharedItemId,
    quantity: 2,
    amount: 8000,
    paymentType: 'CASH',
  });
  const saleRow = await prisma.sale.findUnique({ where: { id: sale.sale.id } });
  assert.equal(Number(saleRow.cogsAmount), 5000);

  // التحقق من التوازن المحاسبي الشامل لجميع قيود المالك
  const allEntries = await prisma.ledgerEntry.findMany({ where: { storeOwnerId: ownerId } });
  let totalDebit = 0;
  let totalCredit = 0;
  for (const e of allEntries) {
    totalDebit = Math.round((totalDebit + Number(e.debit)) * 100) / 100;
    totalCredit = Math.round((totalCredit + Number(e.credit)) * 100) / 100;
  }
  assert.equal(totalDebit, totalCredit, 'ميزان المراجعة العام يجب أن يكون متوازناً تماماً');
});

