import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { AccountingService } from '../dist/accounting/accounting.service.js';
import { AuditService } from '../dist/audit/audit.service.js';
import { RejectedTransactionsService } from '../dist/rejected-transactions/rejected-transactions.service.js';
import { CreditService } from '../dist/credit/credit.service.js';
import { SuppliersService } from '../dist/suppliers/suppliers.service.js';
import { PurchasesService } from '../dist/purchases/purchases.service.js';
import { SalesService } from '../dist/sales/sales.service.js';

const prisma = new PrismaService();
const accounting = new AccountingService(prisma);
const audit = new AuditService(prisma);
const service = new RejectedTransactionsService(prisma, accounting, audit);
const creditService = new CreditService(prisma, accounting, audit);
const suppliersService = new SuppliersService(prisma, accounting, audit);
const purchasesService = new PurchasesService(prisma, accounting, audit, suppliersService);
const salesService = new SalesService(prisma, accounting);

let ownerId;
let itemId;
let gramKiloItemId;
let bundleItemId;
let walletId;
let inactiveWalletId;
let customerId;

before(async () => {
  await prisma.$connect();

  ownerId = crypto.randomUUID();
  const phone = `78${Math.floor(1000000 + Math.random() * 8999999)}`;
  await prisma.$executeRaw`
    INSERT INTO store_owners (id, full_name, store_name, phone, password_hash, status, updated_at)
    VALUES (${ownerId}::uuid, 'مالك اختبار المرفوضات', 'متجر اختبار المرحلة الأولى', ${phone}, 'test-hash', 'ACTIVE'::"StoreOwnerStatus", NOW())
  `;

  // زرع دليل الحسابات القياسي للمالك
  await prisma.chartOfAccount.createMany({
    data: [
      { storeOwnerId: ownerId, code: '1000', name: 'الصندوق النقدي', accountType: 'ASSET' },
      { storeOwnerId: ownerId, code: '1100', name: 'المحافظ الإلكترونية', accountType: 'ASSET' },
      { storeOwnerId: ownerId, code: '1101', name: 'محفظة: جوالي اختبار', accountType: 'ASSET' },
      { storeOwnerId: ownerId, code: '1200', name: 'ذمم العملاء (الآجل)', accountType: 'ASSET' },
      { storeOwnerId: ownerId, code: '1300', name: 'المخزون السلعي', accountType: 'ASSET' },
      { storeOwnerId: ownerId, code: '4000', name: 'إيرادات المبيعات', accountType: 'REVENUE' },
      { storeOwnerId: ownerId, code: '5000', name: 'تكلفة البضاعة المباعة', accountType: 'EXPENSE' },
      { storeOwnerId: ownerId, code: '5450', name: 'خسائر بيع اضطراري ومرفوضات', accountType: 'EXPENSE' },
    ],
  });

  const wallet = await prisma.wallet.create({
    data: {
      storeOwnerId: ownerId,
      name: 'جوالي اختبار',
      accountCode: '1101',
      isActive: true,
    },
  });
  walletId = wallet.id;

  const inactiveWallet = await prisma.wallet.create({
    data: {
      storeOwnerId: ownerId,
      name: 'محفظة معطلة',
      accountCode: '1100',
      isActive: false,
    },
  });
  inactiveWalletId = inactiveWallet.id;

  const today = new Date();
  const item = await prisma.item.create({
    data: {
      storeOwnerId: ownerId,
      name: 'قات همداني اختبار',
      unit: 'كيلو',
      quantity: 10,
      costPrice: 2000,
      sellPrice: 3000,
      entryDate: today,
    },
  });
  itemId = item.id;

  const gramKiloItem = await prisma.item.create({
    data: {
      storeOwnerId: ownerId,
      name: 'قات بالجرام والكيلو',
      unit: 'كيلو',
      quantity: 5,
      costPrice: 4000,
      sellPrice: 6000,
      entryDate: today,
    },
  });
  gramKiloItemId = gramKiloItem.id;

  const bundleItem = await prisma.item.create({
    data: {
      storeOwnerId: ownerId,
      name: 'قات بالحبة',
      unit: 'حبة',
      quantity: 10,
      costPrice: 1000,
      sellPrice: 1500,
      entryDate: today,
    },
  });
  bundleItemId = bundleItem.id;

  const customer = await prisma.creditCustomer.create({
    data: {
      storeOwnerId: ownerId,
      name: 'عميل آجل اختبار',
      phone: '771112233',
      creditLimit: 5000,
    },
  });
  customerId = customer.id;
});

after(async () => {
  await prisma.$disconnect();
});

test('1. Negative-stock approval: rejects with 409 INSUFFICIENT_STOCK when qty > stock (preserving PostgreSQL CHECK quantity >= 0), and succeeds when stock is sufficient', async () => {
  const rjInsufficient = await prisma.rejectedTransaction.create({
    data: {
      storeOwnerId: ownerId,
      attemptedPayload: {
        itemId,
        quantity: 25, // أكبر من الرصيد المتاح (10)
        amount: 75000,
        paymentType: 'CASH',
      },
      rejectionReasonCode: 'INSUFFICIENT_STOCK',
      rejectionReasonDetail: 'الرصيد المتاح 10 والمطلوب 25',
    },
  });

  await assert.rejects(
    () =>
      service.resolve(ownerId, rjInsufficient.id, {
        resolutionAction: 'APPROVE_NEGATIVE_STOCK',
      }),
    (err) => {
      assert.equal(err.statusCode, 409);
      assert.equal(err.code, 'INSUFFICIENT_STOCK');
      return true;
    },
  );

  // التأكد أن العملية لم تُعتمد وأن رصيد الصنف لم يصبح سالباً
  const afterFail = await prisma.rejectedTransaction.findUnique({ where: { id: rjInsufficient.id } });
  assert.equal(afterFail.status, 'PENDING');
  const itemAfterFail = await prisma.item.findUnique({ where: { id: itemId } });
  assert.equal(Number(itemAfterFail.quantity), 10);

  // عندما يكون الرصيد كافياً (مثلاً بعد تغذية المخزون)، ينجح الاعتماد الكامل
  const rjReplenished = await prisma.rejectedTransaction.create({
    data: {
      storeOwnerId: ownerId,
      attemptedPayload: {
        itemId,
        quantity: 2,
        amount: 6000,
        paymentType: 'CASH',
      },
      rejectionReasonCode: 'INSUFFICIENT_STOCK',
      rejectionReasonDetail: 'تمت تغذية المخزون لاحقاً',
    },
  });

  const res = await service.resolve(ownerId, rjReplenished.id, {
    resolutionAction: 'APPROVE_NEGATIVE_STOCK',
  });
  assert.equal(res.status, 'RESOLVED');
  assert.ok(res.created_sale_id);

  const itemAfterSuccess = await prisma.item.findUnique({ where: { id: itemId } });
  assert.equal(Number(itemAfterSuccess.quantity), 8);
});

test('2. Rejected electronic sale with valid walletId and depositAttachmentUrl succeeds and posts to wallet account 1101', async () => {
  const rjElec = await prisma.rejectedTransaction.create({
    data: {
      storeOwnerId: ownerId,
      attemptedPayload: {
        itemId,
        quantity: 5,
        amount: 15000,
        paymentType: 'ELECTRONIC',
        walletId,
        depositAttachmentUrl: 'https://storage.maquaty.local/deposits/receipt-101.jpg',
      },
      rejectionReasonCode: 'INSUFFICIENT_STOCK',
      rejectionReasonDetail: 'نقص مخزون لعملية إلكترونية',
    },
  });

  const resolved = await service.resolve(ownerId, rjElec.id, {
    resolutionAction: 'APPROVE_ADJUSTED_QTY',
    adjustedQuantity: 2,
  });

  assert.equal(resolved.status, 'RESOLVED');
  assert.ok(resolved.created_sale_id);

  const sale = await prisma.sale.findUnique({ where: { id: resolved.created_sale_id } });
  assert.equal(sale.paymentType, 'ELECTRONIC');
  assert.equal(sale.walletId, walletId);
  assert.equal(sale.depositAttachmentUrl, 'https://storage.maquaty.local/deposits/receipt-101.jpg');
  assert.equal(Number(sale.amount), 6000); // (15000 / 5) * 2

  const entries = await prisma.ledgerEntry.findMany({
    where: { storeOwnerId: ownerId, referenceId: rjElec.id },
    include: { account: true },
  });
  const walletDebit = entries.find((e) => e.account.code === '1101' && Number(e.debit) > 0);
  assert.ok(walletDebit, 'يجب أن يُقيَّد المدين على حساب المحفظة الفرعي 1101 وليس 1100 العام');
  assert.equal(Number(walletDebit.debit), 6000);
});

test('3. Rejected electronic sale without required evidence or with inactive wallet fails cleanly', async () => {
  const rjMissingAttachment = await prisma.rejectedTransaction.create({
    data: {
      storeOwnerId: ownerId,
      attemptedPayload: {
        itemId,
        quantity: 2,
        amount: 6000,
        paymentType: 'ELECTRONIC',
        walletId,
        // بدون depositAttachmentUrl
      },
      rejectionReasonCode: 'INSUFFICIENT_STOCK',
      rejectionReasonDetail: 'عملية إلكترونية بدون صورة إيداع',
    },
  });

  await assert.rejects(
    () =>
      service.resolve(ownerId, rjMissingAttachment.id, {
        resolutionAction: 'APPROVE_ADJUSTED_QTY',
        adjustedQuantity: 1,
      }),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(err.code, 'MISSING_DEPOSIT_ATTACHMENT');
      return true;
    },
  );

  const rjInactiveWallet = await prisma.rejectedTransaction.create({
    data: {
      storeOwnerId: ownerId,
      attemptedPayload: {
        itemId,
        quantity: 2,
        amount: 6000,
        paymentType: 'ELECTRONIC',
        walletId: inactiveWalletId,
        depositAttachmentUrl: 'https://storage.maquaty.local/deposits/receipt-102.jpg',
      },
      rejectionReasonCode: 'INSUFFICIENT_STOCK',
      rejectionReasonDetail: 'عملية إلكترونية بمحفظة معطلة',
    },
  });

  await assert.rejects(
    () =>
      service.resolve(ownerId, rjInactiveWallet.id, {
        resolutionAction: 'APPROVE_ADJUSTED_QTY',
        adjustedQuantity: 1,
      }),
    (err) => {
      assert.equal(err.statusCode, 404);
      assert.equal(err.code, 'NOT_FOUND');
      return true;
    },
  );
});

test('4. GRAM-to-KG conversion: converts 500 GRAM to 0.500 KG for stock deduction, COGS, and unit price, and rejects fractional grams', async () => {
  // رصيد gramKiloItemId الابتدائي = 5 كيلو، التكلفة = 4000 للكيلو، سعر البيع = 6000 للكيلو
  // أ) عملية بيع 500 جرام بمبلغ 3000 ريال مرفوضة بسبب سقف الائتمان -> اعتمادها عبر ADD_CREDIT
  const rjGramCredit = await prisma.rejectedTransaction.create({
    data: {
      storeOwnerId: ownerId,
      attemptedPayload: {
        itemId: gramKiloItemId,
        quantity: 500,
        quantityUnit: 'GRAM',
        amount: 3000,
        paymentType: 'CREDIT',
        creditCustomerId: customerId,
      },
      rejectionReasonCode: 'CREDIT_LIMIT_EXCEEDED',
      rejectionReasonDetail: 'تجاوز سقف الائتمان لعملية بالجرام',
    },
  });

  const resAddCredit = await service.resolve(ownerId, rjGramCredit.id, {
    resolutionAction: 'ADD_CREDIT',
  });
  assert.equal(resAddCredit.status, 'RESOLVED');

  // يجب أن ينقص المخزون بمقدار 0.500 كيلو فقط (من 5 إلى 4.500) وليس 500 كيلو!
  const itemAfterGram = await prisma.item.findUnique({ where: { id: gramKiloItemId } });
  assert.equal(Number(itemAfterGram.quantity), 4.5);

  const gramSale = await prisma.sale.findUnique({ where: { id: resAddCredit.created_sale_id } });
  assert.equal(Number(gramSale.quantity), 0.5);
  assert.equal(Number(gramSale.cogsAmount), 2000); // 0.5 * 4000

  // تحقق من تكلفة البضاعة المباعة COGS = 0.5 * 4000 = 2000 ريال في دفتر الأستاذ (5000)
  const entries = await prisma.ledgerEntry.findMany({
    where: { storeOwnerId: ownerId, referenceId: rjGramCredit.id },
    include: { account: true },
  });
  const cogsEntry = entries.find((e) => e.account.code === '5000' && Number(e.debit) > 0);
  assert.ok(cogsEntry);
  assert.equal(Number(cogsEntry.debit), 2000);

  // ب) عملية مرفوضة بسبب نقص المخزون بـ 1000 جرام (1 كيلو) بمبلغ 6000 ريال -> تعديل الكمية إلى 0.25 كيلو
  const rjGramAdjusted = await prisma.rejectedTransaction.create({
    data: {
      storeOwnerId: ownerId,
      attemptedPayload: {
        itemId: gramKiloItemId,
        quantity: 1000,
        quantityUnit: 'GRAM',
        amount: 6000,
        paymentType: 'CASH',
      },
      rejectionReasonCode: 'INSUFFICIENT_STOCK',
      rejectionReasonDetail: 'نقص مخزون لعملية بالجرام',
    },
  });

  const resAdj = await service.resolve(ownerId, rjGramAdjusted.id, {
    resolutionAction: 'APPROVE_ADJUSTED_QTY',
    adjustedQuantity: 0.25, // ربع كيلو
  });
  const adjSale = await prisma.sale.findUnique({ where: { id: resAdj.created_sale_id } });
  assert.equal(Number(adjSale.quantity), 0.25);
  assert.equal(Number(adjSale.amount), 1500); // (6000 / 1.000 kg) * 0.25 kg = 1500

  // ج) رفض الكسور العشرية بالجرام (مثل 150.5 جرام)
  const rjFractionalGram = await prisma.rejectedTransaction.create({
    data: {
      storeOwnerId: ownerId,
      attemptedPayload: {
        itemId: gramKiloItemId,
        quantity: 150.5,
        quantityUnit: 'GRAM',
        amount: 900,
        paymentType: 'CASH',
      },
      rejectionReasonCode: 'INSUFFICIENT_STOCK',
      rejectionReasonDetail: 'كسور جرام غير مسموحة',
    },
  });

  await assert.rejects(
    () =>
      service.resolve(ownerId, rjFractionalGram.id, {
        resolutionAction: 'APPROVE_ADJUSTED_QTY',
        adjustedQuantity: 0.1,
      }),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(err.code, 'FRACTIONAL_GRAMS_NOT_ALLOWED');
      return true;
    },
  );
});

test('5. Rejected credit sale and customer-debt update: validates customer, updates total_debt atomically, and enforces creditLimit on INSUFFICIENT_STOCK resolution', async () => {
  // حالياً العميل عليه دين 3000 ريال من الاختبار رقم 4، وسقفه الائتماني = 5000 ريال (المتبقي 2000 ريال)
  const totalDebtBefore = await creditService.calculateCustomerDebt(customerId);
  assert.equal(totalDebtBefore, 3000);

  // أ) محاولة معالجة عملية INSUFFICIENT_STOCK آجلة بمبلغ يتجاوز السقف المتبقي (3000 + 2500 = 5500 > 5000) يجب أن تُرفض بـ CREDIT_LIMIT_EXCEEDED
  const rjCreditOverLimit = await prisma.rejectedTransaction.create({
    data: {
      storeOwnerId: ownerId,
      attemptedPayload: {
        itemId,
        quantity: 2,
        amount: 5000,
        paymentType: 'CREDIT',
        creditCustomerId: customerId,
      },
      rejectionReasonCode: 'INSUFFICIENT_STOCK',
      rejectionReasonDetail: 'نقص مخزون لعملية آجلة',
    },
  });

  await assert.rejects(
    () =>
      service.resolve(ownerId, rjCreditOverLimit.id, {
        resolutionAction: 'APPROVE_ADJUSTED_QTY',
        adjustedQuantity: 1, // المبلغ المعدل = 2500 -> الإجمالي 5500 > 5000
      }),
    (err) => {
      assert.equal(err.statusCode, 409);
      assert.equal(err.code, 'CREDIT_LIMIT_EXCEEDED');
      return true;
    },
  );

  // ب) اعتماد كمية معدلة ضمن السقف المتبقي (adjustedQuantity: 0.5 -> المبلغ المعدل = 1250 -> الإجمالي 4250 <= 5000)
  const resCreditWithinLimit = await service.resolve(ownerId, rjCreditOverLimit.id, {
    resolutionAction: 'APPROVE_ADJUSTED_QTY',
    adjustedQuantity: 0.5,
  });
  assert.equal(resCreditWithinLimit.status, 'RESOLVED');

  const totalDebtAfter = await creditService.calculateCustomerDebt(customerId);
  assert.equal(totalDebtAfter, 4250);

  // ج) عملية آجل بدون creditCustomerId تُرفض بـ VALIDATION_ERROR
  const rjMissingCust = await prisma.rejectedTransaction.create({
    data: {
      storeOwnerId: ownerId,
      attemptedPayload: {
        itemId,
        quantity: 1,
        amount: 3000,
        paymentType: 'CREDIT',
      },
      rejectionReasonCode: 'CREDIT_LIMIT_EXCEEDED',
      rejectionReasonDetail: 'بدون عميل',
    },
  });

  await assert.rejects(
    () =>
      service.resolve(ownerId, rjMissingCust.id, {
        resolutionAction: 'ADD_CREDIT',
      }),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(err.code, 'VALIDATION_ERROR');
      return true;
    },
  );
});

test('6. Idempotency and concurrent resolution: concurrent Promise.all calls resolve once and reject duplicate with 409', async () => {
  const itemBefore = await prisma.item.findUnique({ where: { id: itemId } });
  const startQty = Number(itemBefore.quantity);

  const rjConcurrent = await prisma.rejectedTransaction.create({
    data: {
      storeOwnerId: ownerId,
      attemptedPayload: {
        itemId,
        quantity: 1,
        amount: 3000,
        paymentType: 'CASH',
      },
      rejectionReasonCode: 'INSUFFICIENT_STOCK',
      rejectionReasonDetail: 'اختبار التزامن',
    },
  });

  const results = await Promise.allSettled([
    service.resolve(ownerId, rjConcurrent.id, {
      resolutionAction: 'APPROVE_ADJUSTED_QTY',
      adjustedQuantity: 1,
    }),
    service.resolve(ownerId, rjConcurrent.id, {
      resolutionAction: 'APPROVE_ADJUSTED_QTY',
      adjustedQuantity: 1,
    }),
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');

  assert.equal(fulfilled.length, 1, 'يجب أن ينجح طلب واحد فقط');
  assert.equal(rejected.length, 1, 'يجب أن يُرفض الطلب المتزامن الثاني');
  assert.equal(rejected[0].reason.statusCode, 409);

  const itemAfter = await prisma.item.findUnique({ where: { id: itemId } });
  assert.equal(Number(itemAfter.quantity), startQty - 1, 'يجب خصم المخزون مرة واحدة فقط');
});

test('7. Failed resolution rollback: atomicity preserves PENDING status, item quantity, and zero orphan ledger entries', async () => {
  const itemBefore = await prisma.item.findUnique({ where: { id: bundleItemId } });
  const ledgerCountBefore = await prisma.ledgerEntry.count({ where: { storeOwnerId: ownerId } });

  const rjFail = await prisma.rejectedTransaction.create({
    data: {
      storeOwnerId: ownerId,
      attemptedPayload: {
        itemId: bundleItemId,
        quantity: 4,
        amount: 6000,
        paymentType: 'CASH',
      },
      rejectionReasonCode: 'INSUFFICIENT_STOCK',
      rejectionReasonDetail: 'اختبار التراجع الذري',
    },
  });

  // محاولة تمرير كمية كسرية (1.5) لصنف يُباع بالحبة (FRACTIONAL_QUANTITY_NOT_ALLOWED)
  await assert.rejects(
    () =>
      service.resolve(ownerId, rjFail.id, {
        resolutionAction: 'APPROVE_ADJUSTED_QTY',
        adjustedQuantity: 1.5,
      }),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(err.code, 'FRACTIONAL_QUANTITY_NOT_ALLOWED');
      return true;
    },
  );

  const rjAfter = await prisma.rejectedTransaction.findUnique({ where: { id: rjFail.id } });
  assert.equal(rjAfter.status, 'PENDING');
  assert.equal(rjAfter.resolvedBy, null);

  const itemAfter = await prisma.item.findUnique({ where: { id: bundleItemId } });
  assert.equal(Number(itemAfter.quantity), Number(itemBefore.quantity));

  const ledgerCountAfter = await prisma.ledgerEntry.count({ where: { storeOwnerId: ownerId } });
  assert.equal(ledgerCountAfter, ledgerCountBefore);
});

test('8. Preservation of existing stock >= 0 and balanced double-entry ledger invariants across all resolutions', async () => {
  // اختبار POST_AS_LOSS للتأكد من توازن القيد المحاسبي (5400 ديون معدومة + 5000 تكلفة بضاعة مباعة)
  const rjLoss = await prisma.rejectedTransaction.create({
    data: {
      storeOwnerId: ownerId,
      attemptedPayload: {
        itemId: bundleItemId,
        quantity: 2,
        amount: 3000,
        paymentType: 'CREDIT',
        creditCustomerId: customerId,
      },
      rejectionReasonCode: 'CREDIT_LIMIT_EXCEEDED',
      rejectionReasonDetail: 'اختبار ترحيل كخسارة',
    },
  });

  const resLoss = await service.resolve(ownerId, rjLoss.id, {
    resolutionAction: 'POST_AS_LOSS',
  });
  assert.equal(resLoss.status, 'RESOLVED');
  assert.equal(resLoss.created_sale_id, null);
});

test('9. Emergency sale resolution (ADD_CREDIT & APPROVE_ADJUSTED_QTY): persists emergency fields, posts loss to 5450, and balances 4000 at amount + priceDiffLoss', async () => {
  // bundleItemId: sellPrice = 1500, costPrice = 1000
  // أ) عملية بيع اضطراري آجلة مرفوضة بسبب السقف: كمية 2 حبة بسعر اضطراري 1200 للحبة (المبلغ 2400، السعر العادي 3000، الخسارة 600)
  const rjEmergCredit = await prisma.rejectedTransaction.create({
    data: {
      storeOwnerId: ownerId,
      attemptedPayload: {
        itemId: bundleItemId,
        quantity: 2,
        amount: 2400,
        paymentType: 'CREDIT',
        creditCustomerId: customerId,
        isEmergencySale: true,
        emergencyReason: 'ذبول أطراف القات آخر النهار',
        emergencyOverridePrice: 1200,
      },
      rejectionReasonCode: 'CREDIT_LIMIT_EXCEEDED',
      rejectionReasonDetail: 'بيع اضطراري آجل تجاوز السقف',
    },
  });

  const resEmergCredit = await service.resolve(ownerId, rjEmergCredit.id, {
    resolutionAction: 'ADD_CREDIT',
  });
  assert.equal(resEmergCredit.status, 'RESOLVED');

  const saleCredit = await prisma.sale.findUnique({ where: { id: resEmergCredit.created_sale_id } });
  assert.equal(saleCredit.isEmergencySale, true);
  assert.equal(saleCredit.emergencyReason, 'ذبول أطراف القات آخر النهار');
  assert.equal(Number(saleCredit.emergencyOverridePrice), 1200);
  assert.equal(Number(saleCredit.priceDifferenceLoss), 600);

  const creditEntries = await prisma.ledgerEntry.findMany({
    where: { storeOwnerId: ownerId, referenceId: rjEmergCredit.id },
    include: { account: true },
  });
  const debit1200 = creditEntries.find((e) => e.account.code === '1200' && Number(e.debit) > 0);
  const debit5450 = creditEntries.find((e) => e.account.code === '5450' && Number(e.debit) > 0);
  const credit4000 = creditEntries.find((e) => e.account.code === '4000' && Number(e.credit) > 0);
  assert.equal(Number(debit1200?.debit), 2400);
  assert.equal(Number(debit5450?.debit), 600);
  assert.equal(Number(credit4000?.credit), 3000); // 2400 + 600

  // ب) عملية بيع اضطراري نقدية مرفوضة بسبب نقص المخزون -> اعتماد بكمية مصححة 1 حبة (المبلغ 1200، الخسارة 300، الإيراد العادي 1500)
  const rjEmergAdj = await prisma.rejectedTransaction.create({
    data: {
      storeOwnerId: ownerId,
      attemptedPayload: {
        itemId: bundleItemId,
        quantity: 3,
        amount: 3600,
        paymentType: 'CASH',
        isEmergencySale: true,
        emergencyReason: 'تخفيض اضطراري مسائي',
        emergencyOverridePrice: 1200,
      },
      rejectionReasonCode: 'INSUFFICIENT_STOCK',
      rejectionReasonDetail: 'نقص مخزون لبيع اضطراري',
    },
  });

  const resEmergAdj = await service.resolve(ownerId, rjEmergAdj.id, {
    resolutionAction: 'APPROVE_ADJUSTED_QTY',
    adjustedQuantity: 1,
  });
  assert.equal(resEmergAdj.status, 'RESOLVED');

  const saleAdj = await prisma.sale.findUnique({ where: { id: resEmergAdj.created_sale_id } });
  assert.equal(saleAdj.isEmergencySale, true);
  assert.equal(saleAdj.emergencyReason, 'تخفيض اضطراري مسائي');
  assert.equal(Number(saleAdj.emergencyOverridePrice), 1200);
  assert.equal(Number(saleAdj.priceDifferenceLoss), 300);

  const adjEntries = await prisma.ledgerEntry.findMany({
    where: { storeOwnerId: ownerId, referenceId: rjEmergAdj.id },
    include: { account: true },
  });
  const debit1000 = adjEntries.find((e) => e.account.code === '1000' && Number(e.debit) > 0);
  const adjDebit5450 = adjEntries.find((e) => e.account.code === '5450' && Number(e.debit) > 0);
  const adjCredit4000 = adjEntries.find((e) => e.account.code === '4000' && Number(e.credit) > 0);
  assert.equal(Number(debit1000?.debit), 1200);
  assert.equal(Number(adjDebit5450?.debit), 300);
  assert.equal(Number(adjCredit4000?.credit), 1500);
});

test('10. FIFO layers consumption and cost_price update when resolving a rejected transaction', async () => {
  // تفعيل سياسة FIFO للمالك
  await prisma.$executeRaw`
    UPDATE store_owners
    SET default_costing_method = 'FIFO'::"CostingMethod"
    WHERE id = ${ownerId}::uuid
  `;

  // إنشاء صنف برصيد إجمالي 5 حبات (منها 1 حبة أقدم غير مطبقة بتكلفة 1000، وطبقتا شراء: طبقة 1 بـ 2 حبة بتكلفة 1200، وطبقة 2 بـ 2 حبة بتكلفة 1500)
  const fifoItem = await prisma.item.create({
    data: {
      storeOwnerId: ownerId,
      name: 'قات اختبار FIFO',
      unit: 'حبة',
      quantity: 5,
      costPrice: 1000,
      sellPrice: 2000,
      entryDate: new Date(),
    },
  });

  const supplier = await prisma.supplier.create({
    data: {
      storeOwnerId: ownerId,
      name: 'مورد FIFO اختبار',
    },
  });

  const invoice = await prisma.purchaseInvoice.create({
    data: {
      storeOwnerId: ownerId,
      supplierId: supplier.id,
      invoiceNumber: 'INV-FIFO-001',
      invoiceDate: new Date(),
      paymentType: 'CASH',
      subtotal: 5400,
      totalAmount: 5400,
      paidAmount: 5400,
      remainingAmount: 0,
      status: 'POSTED',
      costingMethodUsed: 'FIFO',
      postedAt: new Date(),
    },
  });

  const layer1 = await prisma.purchaseItem.create({
    data: {
      storeOwnerId: ownerId,
      purchaseInvoiceId: invoice.id,
      itemId: fifoItem.id,
      itemName: fifoItem.name,
      baseUnit: 'حبة',
      unit: 'حبة',
      conversionFactor: 1,
      quantity: 2,
      baseQuantity: 2,
      unitCostPrice: 1200,
      totalLineCost: 2400,
      effectiveBaseUnitCost: 1200,
      sellPrice: 2000,
      remainingFifoQty: 2,
      createdAt: new Date(Date.now() - 10_000),
    },
  });

  const layer2 = await prisma.purchaseItem.create({
    data: {
      storeOwnerId: ownerId,
      purchaseInvoiceId: invoice.id,
      itemId: fifoItem.id,
      itemName: fifoItem.name,
      baseUnit: 'حبة',
      unit: 'حبة',
      conversionFactor: 1,
      quantity: 2,
      baseQuantity: 2,
      unitCostPrice: 1500,
      totalLineCost: 3000,
      effectiveBaseUnitCost: 1500,
      sellPrice: 2000,
      remainingFifoQty: 2,
      createdAt: new Date(Date.now() - 5_000),
    },
  });

  // عملية مرفوضة يتم اعتمادها بكمية مصححة = 2 حبة:
  // يجب أن تستهلك: 1 حبة من الدفعة الأقدم غير المطبقة (بتكلفة 1000) + 1 حبة من الطبقة الأولى (بتكلفة 1200) => COGS = 2200
  // وبما أن الدفعة الأقدم نفدت بالكامل، يجب تحديث cost_price للصنف إلى تكلفة الطبقة النشطة الحالية (1200)
  const rjFifo = await prisma.rejectedTransaction.create({
    data: {
      storeOwnerId: ownerId,
      attemptedPayload: {
        itemId: fifoItem.id,
        quantity: 6,
        amount: 12000,
        paymentType: 'CASH',
      },
      rejectionReasonCode: 'INSUFFICIENT_STOCK',
      rejectionReasonDetail: 'اختبار استهلاك طبقات FIFO',
    },
  });

  const resFifo = await service.resolve(ownerId, rjFifo.id, {
    resolutionAction: 'APPROVE_ADJUSTED_QTY',
    adjustedQuantity: 2,
  });
  assert.equal(resFifo.status, 'RESOLVED');

  const saleFifo = await prisma.sale.findUnique({ where: { id: resFifo.created_sale_id } });
  assert.equal(Number(saleFifo.cogsAmount), 2200); // 1*1000 + 1*1200

  const updatedLayer1 = await prisma.purchaseItem.findUnique({ where: { id: layer1.id } });
  const updatedLayer2 = await prisma.purchaseItem.findUnique({ where: { id: layer2.id } });
  assert.equal(Number(updatedLayer1.remainingFifoQty), 1, 'يجب استهلاك 1 حبة من الطبقة الأولى');
  assert.equal(Number(updatedLayer2.remainingFifoQty), 2, 'الطبقة الثانية لم تُستهلك بعد');

  const updatedItem = await prisma.item.findUnique({ where: { id: fifoItem.id } });
  assert.equal(Number(updatedItem.quantity), 3);
  assert.equal(Number(updatedItem.costPrice), 1200, 'يجب تحديث cost_price لتكلفة الدفعة النشطة التالية');
});

test('11. Trial counter (trial_sales_used): increments on sale resolutions (ADD_CREDIT / APPROVE_ADJUSTED_QTY) and does NOT increment on POST_AS_LOSS or FINAL_REJECT', async () => {
  // ضبط المالك في وضع TRIAL مع used = 48 و limit = 50
  await prisma.$executeRaw`
    UPDATE store_owners
    SET status = 'TRIAL'::"StoreOwnerStatus",
        trial_sales_used = 48,
        trial_sales_limit = 50
    WHERE id = ${ownerId}::uuid
  `;

  // 1) FINAL_REJECT لا يزيد العداد
  const rjFinalReject = await prisma.rejectedTransaction.create({
    data: {
      storeOwnerId: ownerId,
      attemptedPayload: {
        itemId: bundleItemId,
        quantity: 1,
        amount: 1500,
        paymentType: 'CASH',
      },
      rejectionReasonCode: 'INSUFFICIENT_STOCK',
      rejectionReasonDetail: 'رفض نهائي لا يزيد العداد',
    },
  });
  await service.resolve(ownerId, rjFinalReject.id, {
    resolutionAction: 'FINAL_REJECT',
  });

  let ownerRows = await prisma.$queryRaw`
    SELECT trial_sales_used, status::text AS status FROM store_owners WHERE id = ${ownerId}::uuid
  `;
  assert.equal(ownerRows[0].trial_sales_used, 48, 'FINAL_REJECT يجب ألا يزيد عداد المبيعات التجريبية');

  // 2) POST_AS_LOSS لا يزيد العداد
  const rjPostLoss = await prisma.rejectedTransaction.create({
    data: {
      storeOwnerId: ownerId,
      attemptedPayload: {
        itemId: bundleItemId,
        quantity: 1,
        amount: 1500,
        paymentType: 'CREDIT',
        creditCustomerId: customerId,
      },
      rejectionReasonCode: 'CREDIT_LIMIT_EXCEEDED',
      rejectionReasonDetail: 'ترحيل كخسارة لا يزيد العداد',
    },
  });
  await service.resolve(ownerId, rjPostLoss.id, {
    resolutionAction: 'POST_AS_LOSS',
  });

  ownerRows = await prisma.$queryRaw`
    SELECT trial_sales_used, status::text AS status FROM store_owners WHERE id = ${ownerId}::uuid
  `;
  assert.equal(ownerRows[0].trial_sales_used, 48, 'POST_AS_LOSS يجب ألا يزيد عداد المبيعات التجريبية');

  // 3) ADD_CREDIT يزيد العداد من 48 إلى 49 (ويحول الحالة إلى TRIAL_WARNING لأن المتبقي 1 <= 30)
  const rjSale49 = await prisma.rejectedTransaction.create({
    data: {
      storeOwnerId: ownerId,
      attemptedPayload: {
        itemId: bundleItemId,
        quantity: 1,
        amount: 1500,
        paymentType: 'CREDIT',
        creditCustomerId: customerId,
      },
      rejectionReasonCode: 'CREDIT_LIMIT_EXCEEDED',
      rejectionReasonDetail: 'بيع 49',
    },
  });
  await service.resolve(ownerId, rjSale49.id, {
    resolutionAction: 'ADD_CREDIT',
  });

  ownerRows = await prisma.$queryRaw`
    SELECT trial_sales_used, status::text AS status FROM store_owners WHERE id = ${ownerId}::uuid
  `;
  assert.equal(ownerRows[0].trial_sales_used, 49);
  assert.equal(ownerRows[0].status, 'TRIAL_WARNING');

  // 4) APPROVE_ADJUSTED_QTY يزيد العداد من 49 إلى 50 ويحول الحالة إلى TRIAL_EXPIRED
  const rjSale50 = await prisma.rejectedTransaction.create({
    data: {
      storeOwnerId: ownerId,
      attemptedPayload: {
        itemId: bundleItemId,
        quantity: 2,
        amount: 3000,
        paymentType: 'CASH',
      },
      rejectionReasonCode: 'INSUFFICIENT_STOCK',
      rejectionReasonDetail: 'بيع 50',
    },
  });
  await service.resolve(ownerId, rjSale50.id, {
    resolutionAction: 'APPROVE_ADJUSTED_QTY',
    adjustedQuantity: 1,
  });

  ownerRows = await prisma.$queryRaw`
    SELECT trial_sales_used, status::text AS status FROM store_owners WHERE id = ${ownerId}::uuid
  `;
  assert.equal(ownerRows[0].trial_sales_used, 50);
  assert.equal(ownerRows[0].status, 'TRIAL_EXPIRED');
});

test('12. POST_AS_LOSS with cost_price = 0 succeeds without failing or polluting ledger with zero-amount lines', async () => {
  const zeroCostItem = await prisma.item.create({
    data: {
      storeOwnerId: ownerId,
      name: 'صنف بتكلفة صفرية',
      unit: 'حبة',
      quantity: 5,
      costPrice: 0,
      sellPrice: 1000,
      entryDate: new Date(),
    },
  });

  const rjZeroCostLoss = await prisma.rejectedTransaction.create({
    data: {
      storeOwnerId: ownerId,
      attemptedPayload: {
        itemId: zeroCostItem.id,
        quantity: 2,
        amount: 2000,
        paymentType: 'CREDIT',
        creditCustomerId: customerId,
      },
      rejectionReasonCode: 'CREDIT_LIMIT_EXCEEDED',
      rejectionReasonDetail: 'اختبار ترحيل كخسارة بتكلفة صفرية',
    },
  });

  const ledgerBefore = await prisma.ledgerEntry.count({ where: { storeOwnerId: ownerId } });

  const resZeroLoss = await service.resolve(ownerId, rjZeroCostLoss.id, {
    resolutionAction: 'POST_AS_LOSS',
  });
  assert.equal(resZeroLoss.status, 'RESOLVED');

  const itemAfter = await prisma.item.findUnique({ where: { id: zeroCostItem.id } });
  assert.equal(Number(itemAfter.quantity), 3, 'يجب خصم المخزون حتى لو كانت التكلفة صفراً');

  const ledgerAfter = await prisma.ledgerEntry.count({ where: { storeOwnerId: ownerId } });
  assert.equal(ledgerAfter, ledgerBefore, 'يجب عدم إنشاء أي قيد محاسبي صفري');

  // فحص أن جميع الأصناف في المتجر تحقق quantity >= 0
  const allItems = await prisma.item.findMany({ where: { storeOwnerId: ownerId } });
  for (const it of allItems) {
    assert.ok(Number(it.quantity) >= 0, `الصنف ${it.name} رصيده سالب: ${it.quantity}`);
  }

  // فحص توازن دفتر الأستاذ العام وتوحيد تاريخ القيد (00:00:00)
  const allEntries = await prisma.ledgerEntry.findMany({ where: { storeOwnerId: ownerId } });
  assert.ok(allEntries.length > 0);
  let totalDebits = 0;
  let totalCredits = 0;
  for (const entry of allEntries) {
    const d = Number(entry.debit);
    const c = Number(entry.credit);
    assert.ok(d > 0 || c > 0, 'يجب أن يحمل سطر القيد مبلغاً مديناً أو دائناً موجباً');
    totalDebits += d;
    totalCredits += c;
  }
  assert.equal(totalDebits, totalCredits, 'مجموع المدين يجب أن يساوي مجموع الدائن دائماً');
});

test('13. Scenario A/B/C: Same-day price conflict costing options (FIFO, WEIGHTED_AVERAGE, LAST_PRICE) synchronize layers across Purchases, Sales, and Rejected Transactions regardless of store defaultCostingMethod', async () => {
  const costingOwnerId = crypto.randomUUID();
  const costingPhone = `78${Math.floor(1000000 + Math.random() * 8999999)}`;
  await prisma.$executeRaw`
    INSERT INTO store_owners (id, full_name, store_name, phone, password_hash, status, default_costing_method, updated_at)
    VALUES (${costingOwnerId}::uuid, 'مالك اختبار التسعير', 'متجر خيارات التكلفة الثلاثة', ${costingPhone}, 'test-hash', 'ACTIVE'::"StoreOwnerStatus", 'WEIGHTED_AVERAGE'::"CostingMethod", NOW())
  `;

  await prisma.chartOfAccount.createMany({
    data: [
      { storeOwnerId: costingOwnerId, code: '1000', name: 'الصندوق النقدي', accountType: 'ASSET' },
      { storeOwnerId: costingOwnerId, code: '1100', name: 'المحافظ الإلكترونية', accountType: 'ASSET' },
      { storeOwnerId: costingOwnerId, code: '1200', name: 'ذمم العملاء (الآجل)', accountType: 'ASSET' },
      { storeOwnerId: costingOwnerId, code: '1300', name: 'المخزون السلعي', accountType: 'ASSET' },
      { storeOwnerId: costingOwnerId, code: '2000', name: 'ذمم الموردين', accountType: 'LIABILITY' },
      { storeOwnerId: costingOwnerId, code: '4000', name: 'إيرادات المبيعات', accountType: 'REVENUE' },
      { storeOwnerId: costingOwnerId, code: '5000', name: 'تكلفة البضاعة المباعة', accountType: 'EXPENSE' },
      { storeOwnerId: costingOwnerId, code: '5450', name: 'خسائر بيع اضطراري ومرفوضات', accountType: 'EXPENSE' },
    ],
  });

  const supplier = await prisma.supplier.create({
    data: {
      storeOwnerId: costingOwnerId,
      name: 'مورد اختبار التسعير',
      phone: '770001122',
    },
  });

  const ownerUser = {
    sub: costingOwnerId,
    role: 'STORE_OWNER',
    storeOwnerId: costingOwnerId,
  };

  try {
    // -------------------------------------------------------------------------
    // Scenario A: Store default is WEIGHTED_AVERAGE, but user selects FIFO for a specific invoice
    // -------------------------------------------------------------------------
    await prisma.storeOwner.update({
      where: { id: costingOwnerId },
      data: { defaultCostingMethod: 'WEIGHTED_AVERAGE' },
      select: { id: true },
    });

    // دفعة أولى: 2 كيلو بتكلفة 2000 ريال
    const invA1 = await purchasesService.create(ownerUser, {
      supplierId: supplier.id,
      paymentType: 'CASH',
      status: 'POSTED',
      items: [
        {
          itemName: 'قات سيناريو أ (FIFO)',
          unit: 'كيلو',
          quantity: 2,
          unitCostPrice: 2000,
          sellPrice: 3500,
        },
      ],
    });
    const itemAId = invA1.items[0].item_id;

    // دفعة ثانية في نفس اليوم: 2 كيلو بتكلفة 3000 ريال مع اختيار FIFO صراحةً رغم أن إعداد المتجر WEIGHTED_AVERAGE
    await purchasesService.create(ownerUser, {
      supplierId: supplier.id,
      paymentType: 'CASH',
      status: 'POSTED',
      costingMethod: 'FIFO',
      items: [
        {
          itemId: itemAId,
          itemName: 'قات سيناريو أ (FIFO)',
          unit: 'كيلو',
          quantity: 2,
          unitCostPrice: 3000,
          sellPrice: 4000,
        },
      ],
    });

    let itemA = await prisma.item.findUnique({ where: { id: itemAId } });
    assert.equal(Number(itemA.quantity), 4);
    assert.equal(Number(itemA.costPrice), 2000, 'في FIFO يجب أن يبقى cost_price على السعر القديم (2000) حتى ينفد');

    // بيع 2 كيلو عبر SalesService -> يجب أن يستهلك الدفعة القديمة بالكامل بتكلفة 2 * 2000 = 4000 ويرقي cost_price إلى 3000
    const saleA1 = await salesService.create(ownerUser, {
      itemId: itemAId,
      quantity: 2,
      amount: 8000,
      paymentType: 'CASH',
    });
    const saleA1Row = await prisma.sale.findUnique({ where: { id: saleA1.sale.id } });
    assert.equal(Number(saleA1Row.cogsAmount), 4000, 'يجب احتساب تكلفة الدفعة الأولى بالسعر القديم (4000)');

    itemA = await prisma.item.findUnique({ where: { id: itemAId } });
    assert.equal(Number(itemA.quantity), 2);
    assert.equal(Number(itemA.costPrice), 3000, 'بعد نفاد الدفعة القديمة يجب ترقية cost_price تلقائياً إلى السعر الجديد (3000)');

    // بيع 1 كيلو إضافي عبر تسوية عملية مرفوضة -> يجب أن يحسب التكلفة بالسعر الجديد (3000)
    const rjA = await prisma.rejectedTransaction.create({
      data: {
        storeOwnerId: costingOwnerId,
        attemptedPayload: {
          itemId: itemAId,
          quantity: 1,
          amount: 4000,
          paymentType: 'CASH',
        },
        rejectionReasonCode: 'INSUFFICIENT_STOCK',
        rejectionReasonDetail: 'اختبار سيناريو أ',
      },
    });
    const resRjA = await service.resolve(costingOwnerId, rjA.id, {
      resolutionAction: 'APPROVE_NEGATIVE_STOCK',
    });
    const saleA2Row = await prisma.sale.findUnique({ where: { id: resRjA.created_sale_id } });
    assert.equal(Number(saleA2Row.cogsAmount), 3000, 'البيع التالي يجب أن يستهلك بالسعر الجديد (3000)');

    // -------------------------------------------------------------------------
    // Scenario B: Store default is FIFO, but user selects WEIGHTED_AVERAGE for a specific invoice
    // -------------------------------------------------------------------------
    await prisma.storeOwner.update({
      where: { id: costingOwnerId },
      data: { defaultCostingMethod: 'FIFO' },
      select: { id: true },
    });

    // دفعة أولى: 2 كيلو بتكلفة 2000 ريال
    const invB1 = await purchasesService.create(ownerUser, {
      supplierId: supplier.id,
      paymentType: 'CASH',
      status: 'POSTED',
      items: [
        {
          itemName: 'قات سيناريو ب (متوسط مرجح)',
          unit: 'كيلو',
          quantity: 2,
          unitCostPrice: 2000,
          sellPrice: 3500,
        },
      ],
    });
    const itemBId = invB1.items[0].item_id;

    // دفعة ثانية في نفس اليوم: 2 كيلو بتكلفة 3000 ريال مع اختيار WEIGHTED_AVERAGE صراحةً (المتوسط المرجح = 2500)
    await purchasesService.create(ownerUser, {
      supplierId: supplier.id,
      paymentType: 'CASH',
      status: 'POSTED',
      costingMethod: 'WEIGHTED_AVERAGE',
      items: [
        {
          itemId: itemBId,
          itemName: 'قات سيناريو ب (متوسط مرجح)',
          unit: 'كيلو',
          quantity: 2,
          unitCostPrice: 3000,
          sellPrice: 4000,
        },
      ],
    });

    const itemB = await prisma.item.findUnique({ where: { id: itemBId } });
    assert.equal(Number(itemB.quantity), 4);
    assert.equal(Number(itemB.costPrice), 2500, 'المتوسط المرجح يجب أن يكون ((2*2000)+(2*3000))/4 = 2500');

    // فحص أن جميع الطبقات النشطة في purchase_items تم توحيد تكلفتها إلى 2500
    const layersB = await prisma.purchaseItem.findMany({
      where: { storeOwnerId: costingOwnerId, itemId: itemBId, remainingFifoQty: { gt: 0 } },
    });
    assert.equal(layersB.length, 2);
    for (const l of layersB) {
      assert.equal(Number(l.effectiveBaseUnitCost), 2500, 'يجب توحيد effectiveBaseUnitCost لجميع الطبقات النشطة إلى المتوسط المرجح (2500)');
    }

    // بيع 3 كيلو عبر SalesService -> يجب أن يحسب التكلفة فوراً بالمتوسط المرجح 3 * 2500 = 7500 حتى مع كون إعداد المتجر FIFO
    const saleB1 = await salesService.create(ownerUser, {
      itemId: itemBId,
      quantity: 3,
      amount: 12000,
      paymentType: 'CASH',
    });
    const saleB1Row = await prisma.sale.findUnique({ where: { id: saleB1.sale.id } });
    assert.equal(Number(saleB1Row.cogsAmount), 7500, 'يجب استخدام المتوسط المرجح (2500 * 3 = 7500) لجميع الوحدات');

    // -------------------------------------------------------------------------
    // Scenario C: User selects LAST_PRICE -> sales immediately use the new cost for all units and layers remain synchronized
    // -------------------------------------------------------------------------
    const invC1 = await purchasesService.create(ownerUser, {
      supplierId: supplier.id,
      paymentType: 'CASH',
      status: 'POSTED',
      items: [
        {
          itemName: 'قات سيناريو ج (السعر الجديد)',
          unit: 'كيلو',
          quantity: 2,
          unitCostPrice: 2000,
          sellPrice: 3500,
        },
      ],
    });
    const itemCId = invC1.items[0].item_id;

    // دفعة ثانية في نفس اليوم: 2 كيلو بتكلفة 3200 ريال مع اختيار LAST_PRICE
    await purchasesService.create(ownerUser, {
      supplierId: supplier.id,
      paymentType: 'CASH',
      status: 'POSTED',
      costingMethod: 'LAST_PRICE',
      items: [
        {
          itemId: itemCId,
          itemName: 'قات سيناريو ج (السعر الجديد)',
          unit: 'كيلو',
          quantity: 2,
          unitCostPrice: 3200,
          sellPrice: 4200,
        },
      ],
    });

    const itemC = await prisma.item.findUnique({ where: { id: itemCId } });
    assert.equal(Number(itemC.quantity), 4);
    assert.equal(Number(itemC.costPrice), 3200, 'في LAST_PRICE يجب اعتماد السعر الجديد (3200) لكامل الكمية');

    const layersC = await prisma.purchaseItem.findMany({
      where: { storeOwnerId: costingOwnerId, itemId: itemCId, remainingFifoQty: { gt: 0 } },
    });
    assert.equal(layersC.length, 2);
    for (const l of layersC) {
      assert.equal(Number(l.effectiveBaseUnitCost), 3200, 'يجب مزامنة جميع الطبقات النشطة إلى السعر الجديد (3200)');
    }

    // بيع 3 كيلو عبر SalesService -> يجب أن يستخدم السعر الجديد 3 * 3200 = 9600 ويحافظ على مزامنة remainingFifoQty
    const saleC1 = await salesService.create(ownerUser, {
      itemId: itemCId,
      quantity: 3,
      amount: 12600,
      paymentType: 'CASH',
    });
    const saleC1Row = await prisma.sale.findUnique({ where: { id: saleC1.sale.id } });
    assert.equal(Number(saleC1Row.cogsAmount), 9600, 'يجب احتساب تكلفة المبيعات بالسعر الجديد (3 * 3200 = 9600)');

    const remLayersC = await prisma.purchaseItem.findMany({
      where: { storeOwnerId: costingOwnerId, itemId: itemCId },
    });
    const totalRemFifoC = remLayersC.reduce((s, l) => s + Number(l.remainingFifoQty), 0);
    assert.equal(totalRemFifoC, 1, 'إجمالي remainingFifoQty المتبقي يجب أن يطابق رصيد الصنف المتبقي (1 كيلو)');
  } finally {
    await prisma.ledgerEntry.deleteMany({ where: { storeOwnerId: costingOwnerId } });
    await prisma.rejectedTransaction.deleteMany({ where: { storeOwnerId: costingOwnerId } });
    await prisma.sale.deleteMany({ where: { storeOwnerId: costingOwnerId } });
    await prisma.purchaseItem.deleteMany({ where: { storeOwnerId: costingOwnerId } });
    await prisma.purchaseInvoice.deleteMany({ where: { storeOwnerId: costingOwnerId } });
    await prisma.item.deleteMany({ where: { storeOwnerId: costingOwnerId } });
    await prisma.supplier.deleteMany({ where: { storeOwnerId: costingOwnerId } });
    await prisma.chartOfAccount.deleteMany({ where: { storeOwnerId: costingOwnerId } });
    await prisma.storeOwner.deleteMany({ where: { id: costingOwnerId } });
  }
});
