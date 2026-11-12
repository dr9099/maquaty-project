import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { AccountingService } from '../dist/accounting/accounting.service.js';
import { AuditService } from '../dist/audit/audit.service.js';
import { ItemsService } from '../dist/items/items.service.js';
import { WorkersService } from '../dist/workers/workers.service.js';
import { ReportsService } from '../dist/reports/reports.service.js';
import { DamagedGoodsService } from '../dist/damaged-goods/damaged-goods.service.js';
import { ExpensesService } from '../dist/expenses/expenses.service.js';
import { DailyClosingService } from '../dist/daily-closing/daily-closing.service.js';

const prisma = new PrismaService();
const accounting = new AccountingService(prisma);
const audit = new AuditService(prisma);
const itemsService = new ItemsService(prisma, accounting);
const workersService = new WorkersService(prisma, audit);
const reportsService = new ReportsService(prisma, accounting, audit);
const damagedGoodsService = new DamagedGoodsService(prisma, accounting, audit);
const expensesService = new ExpensesService(prisma, accounting, audit);
const dailyClosingService = new DailyClosingService(prisma, accounting, audit);

let ownerId;
let ownerUser;
let respWorkerId;
let respWorkerUser;
let ordWorkerId;
let ordWorkerUser;
let testItemId;

before(async () => {
  await prisma.$connect();

  ownerId = crypto.randomUUID();
  const phone = `73${Math.floor(1000000 + Math.random() * 8999999)}`;
  await prisma.$executeRaw`
    INSERT INTO store_owners (id, full_name, store_name, phone, password_hash, status, default_costing_method, allow_responsible_purchases, max_workers_allowed, updated_at)
    VALUES (${ownerId}::uuid, 'مالك المرحلة الرابعة', 'متجر الصلاحيات والإغلاق', ${phone}, 'test-hash', 'ACTIVE'::"StoreOwnerStatus", 'WEIGHTED_AVERAGE'::"CostingMethod", false, 5, NOW())
  `;

  await prisma.chartOfAccount.createMany({
    data: [
      { storeOwnerId: ownerId, code: '1000', name: 'الصندوق النقدي', accountType: 'ASSET' },
      { storeOwnerId: ownerId, code: '1100', name: 'المحافظ الإلكترونية', accountType: 'ASSET' },
      { storeOwnerId: ownerId, code: '1200', name: 'ذمم العملاء (الآجل)', accountType: 'ASSET' },
      { storeOwnerId: ownerId, code: '1300', name: 'المخزون السلعي', accountType: 'ASSET' },
      { storeOwnerId: ownerId, code: '2000', name: 'الموردون / الذمم الدائنة', accountType: 'LIABILITY' },
      { storeOwnerId: ownerId, code: '3000', name: 'رأس المال', accountType: 'EQUITY' },
      { storeOwnerId: ownerId, code: '3900', name: 'الأرباح المحتجزة / أرباح مقفلة', accountType: 'EQUITY' },
      { storeOwnerId: ownerId, code: '4000', name: 'إيرادات المبيعات', accountType: 'REVENUE' },
      { storeOwnerId: ownerId, code: '4300', name: 'فائض الصندوق', accountType: 'REVENUE' },
      { storeOwnerId: ownerId, code: '5000', name: 'تكلفة البضاعة المباعة', accountType: 'EXPENSE' },
      { storeOwnerId: ownerId, code: '5400', name: 'مصروف البضاعة التالفة', accountType: 'EXPENSE' },
      { storeOwnerId: ownerId, code: '5500', name: 'سلف العمال والعهد', accountType: 'EXPENSE' },
      { storeOwnerId: ownerId, code: '5600', name: 'عجز الصندوق', accountType: 'EXPENSE' },
    ],
  });

  ownerUser = {
    sub: ownerId,
    role: 'STORE_OWNER',
    storeOwnerId: ownerId,
  };

  const createdItem = await itemsService.create(ownerId, {
    name: 'قات رداعي ممتاز',
    unit: 'كيلو',
    quantity: 10,
    costPrice: 4000,
    sellPrice: 6000,
  });
  testItemId = createdItem.item ? createdItem.item.id : createdItem.id;
});

after(async () => {
  if (ownerId) {
    await prisma.dailyClosing.deleteMany({ where: { storeOwnerId: ownerId } });
    await prisma.workerAdvance.deleteMany({ where: { storeOwnerId: ownerId } });
    await prisma.damagedGood.deleteMany({ where: { storeOwnerId: ownerId } });
    await prisma.sale.deleteMany({ where: { storeOwnerId: ownerId } });
    await prisma.ledgerEntry.deleteMany({ where: { storeOwnerId: ownerId } });
    await prisma.item.deleteMany({ where: { storeOwnerId: ownerId } });
    await prisma.worker.deleteMany({ where: { storeOwnerId: ownerId } });
    await prisma.chartOfAccount.deleteMany({ where: { storeOwnerId: ownerId } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: [ownerId, respWorkerId, ordWorkerId].filter(Boolean) } } });
    await prisma.storeOwner.deleteMany({ where: { id: ownerId } });
  }
  await prisma.$disconnect();
});

test('1 & 2. Individual permission keys and responsible-worker discrete flags', async () => {
  // إنشاء عامل مسؤول مع تعطيل التقارير وتفعيل التالف
  const respPhone = `71${Math.floor(1000000 + Math.random() * 8999999)}`;
  const createdResp = await workersService.create(ownerId, {
    fullName: 'مسؤول الاختبار',
    phone: respPhone,
    password: 'password123',
    passwordConfirmation: 'password123',
    isResponsible: true,
    permissions: {
      reportsAccess: false,
      damagedGoodsEntry: true,
      showCostPrice: false,
      showSellPricesInventory: false,
      enterOwnAdvance: true,
      editWorkerClosingCash: true,
    },
  });

  respWorkerId = createdResp.id;
  respWorkerUser = {
    sub: respWorkerId,
    role: 'WORKER',
    storeOwnerId: ownerId,
    workerId: respWorkerId,
    isResponsible: true,
  };

  assert.equal(createdResp.is_responsible, true);
  assert.equal(createdResp.permissions.reports_access, false);
  assert.equal(createdResp.permissions.damaged_goods_entry, true);
  assert.equal(createdResp.permissions.show_cost_price, false);
  assert.equal(createdResp.permissions.show_sell_prices_inventory, false);
  assert.equal(createdResp.permissions.enter_own_advance, true);
  assert.equal(createdResp.permissions.edit_worker_closing_cash, true);

  // إنشاء عامل عادي مع تعطيل سلفة نفسه وافتراضيات الصلاحيات
  const ordPhone = `70${Math.floor(1000000 + Math.random() * 8999999)}`;
  const createdOrd = await workersService.create(ownerId, {
    fullName: 'عامل عادي للاختبار',
    phone: ordPhone,
    password: 'password123',
    passwordConfirmation: 'password123',
    isResponsible: false,
    permissions: {
      reportsAccess: false,
      damagedGoodsEntry: false,
      showCostPrice: false,
      showSellPricesInventory: false,
      enterOwnAdvance: false,
      editWorkerClosingCash: false,
    },
  });

  ordWorkerId = createdOrd.id;
  ordWorkerUser = {
    sub: ordWorkerId,
    role: 'WORKER',
    storeOwnerId: ownerId,
    workerId: ordWorkerId,
    isResponsible: false,
  };

  assert.equal(createdOrd.is_responsible, false);
});

test('3. Reports access with permission enabled and disabled (no automatic grant for responsible)', async () => {
  // العامل المسؤول حالياً لديه reportsAccess = false، لذا يجب أن يُمنع بـ 403
  await assert.rejects(
    async () => {
      await reportsService.getReport(respWorkerUser, { type: 'SALES' });
    },
    (err) => err.code === 'PERMISSION_DENIED',
    'العامل المسؤول بدون صلاحية تقارير يجب أن يُمنع بـ 403'
  );

  // المالك يمنح العامل المسؤول صلاحية التقارير
  await workersService.update(ownerId, respWorkerId, {
    permissions: { reportsAccess: true },
  });

  // الآن يجب أن ينجح طلب التقرير
  const report = await reportsService.getReport(respWorkerUser, { type: 'sales' });
  assert.ok(report, 'طلب التقرير يجب أن ينجح بعد تفعيل الصلاحية');
  assert.equal(report.type, 'sales');

  // إعادة تعطيل الصلاحية
  await workersService.update(ownerId, respWorkerId, {
    permissions: { reportsAccess: false },
  });
});

test('4. Damaged goods access with permission enabled and disabled', async () => {
  // العامل العادي ordWorkerUser لديه permDamagedGoodsEntry = false
  await assert.rejects(
    async () => {
      await damagedGoodsService.record(ordWorkerUser, {
        itemId: testItemId,
        quantity: 1,
        quantityUnit: 'KILO',
        isDamaged: true,
        reason: 'تالف بسبب الشمس',
        photoUrl: 'https://example.com/photo.jpg',
      });
    },
    (err) => err.code === 'PERMISSION_DENIED',
    'العامل بدون صلاحية تالف يجب أن يُرفض بـ 403'
  );

  // العامل المسؤول respWorkerUser لديه permDamagedGoodsEntry = true، فينجح تسجيل التالف
  const damagedRes = await damagedGoodsService.record(respWorkerUser, {
    itemId: testItemId,
    quantity: 1,
    quantityUnit: 'KILO',
    isDamaged: true,
    reason: 'تالف طبيعي',
    photoUrl: 'https://example.com/photo.jpg',
  });
  assert.ok(damagedRes.id, 'يجب توليد معرف للتالف المسجل');
  assert.equal(damagedRes.is_damaged, true, 'حالة التالف مؤكدة');
});

test('5 & 6. Inventory selling-price & cost-price visibility', async () => {
  // استعلام المخزون للعامل العادي مع تعطيل سعر التكلفة وسعر البيع
  const invHidden = await itemsService.inventory(ownerId, {
    isWorker: true,
    showSellPrices: false,
    showCostPrice: false,
  });
  const itemHidden = invHidden.find((i) => i.item_id === testItemId);
  assert.ok(itemHidden, 'الصنف موجود بالمخزون');
  assert.equal(itemHidden.remaining_value, undefined, 'القيمة البيعية للمخزون يجب أن تُخفى عند showSellPrices = false');
  assert.equal(itemHidden.cost_price, undefined, 'سعر التكلفة يجب أن يُخفى عند showCostPrice = false');

  // استعلام المخزون عند تفعيل سعر البيع وسعر التكلفة
  const invVisible = await itemsService.inventory(ownerId, {
    isWorker: true,
    showSellPrices: true,
    showCostPrice: true,
  });
  const itemVisible = invVisible.find((i) => i.item_id === testItemId);
  assert.ok(itemVisible, 'الصنف موجود بالمخزون');
  assert.ok(itemVisible.remaining_value !== undefined, 'القيمة البيعية للمخزون يجب أن تظهر عند تفعيل الصلاحية');
  assert.ok(itemVisible.cost_price !== undefined, 'سعر التكلفة يجب أن يظهر عند تفعيل الصلاحية');
});

test('7 & 8. Worker advance: ordinary worker denial vs. responsible worker setting', async () => {
  // العامل العادي ممنوع قطعياً من تسجيل سلفة لنفسه
  await assert.rejects(
    async () => {
      await expensesService.recordWorkerAdvance(ordWorkerUser, {
        amount: 2000,
        paymentMethod: 'CASH',
        note: 'محاولة سلفة لعامل عادي',
      });
    },
    (err) => err.code === 'PERMISSION_DENIED',
    'العامل العادي ممنوع من سلفة نفسه'
  );

  // العامل المسؤول ولديه permEnterOwnAdvance = true ينجح في تسجيل سلفة نقدية لنفسه
  const advRes = await expensesService.recordWorkerAdvance(respWorkerUser, {
    amount: 3000,
    paymentMethod: 'CASH',
    note: 'سلفة العامل المسؤول',
  });
  assert.equal(advRes.amount, 3000);
  assert.equal(advRes.payment_method, 'CASH');

  // تعطيل صلاحية السلفة للمسؤول والتحقق من المنع
  await workersService.update(ownerId, respWorkerId, {
    permissions: { enterOwnAdvance: false },
  });
  await assert.rejects(
    async () => {
      await expensesService.recordWorkerAdvance(respWorkerUser, {
        amount: 1000,
        paymentMethod: 'CASH',
      });
    },
    (err) => err.code === 'PERMISSION_DENIED',
    'العامل المسؤول بدون permEnterOwnAdvance يمنع بـ 403'
  );
  // إعادة تفعيلها
  await workersService.update(ownerId, respWorkerId, {
    permissions: { enterOwnAdvance: true },
  });
});

test('9. Responsible-worker replacement confirmation (M-07)', async () => {
  const newRespPhone = `78${Math.floor(1000000 + Math.random() * 8999999)}`;

  // محاولة إضافة عامل مسؤول جديد دون تأكيد الاستبدال confirmReplace = false يجب أن تفشل بـ 409
  await assert.rejects(
    async () => {
      await workersService.create(ownerId, {
        fullName: 'مسؤول بديل',
        phone: newRespPhone,
        password: 'password123',
        passwordConfirmation: 'password123',
        isResponsible: true,
        confirmReplace: false,
      });
    },
    (err) => err.code === 'RESPONSIBLE_WORKER_EXISTS' || err.statusCode === 409,
    'يجب أن يفشل بـ 409 عند وجود مسؤول قائم دون تأكيد'
  );

  // إعادة المحاولة مع confirmReplace = true
  const replacedWorker = await workersService.create(ownerId, {
    fullName: 'مسؤول بديل مؤكد',
    phone: newRespPhone,
    password: 'password123',
    passwordConfirmation: 'password123',
    isResponsible: true,
    confirmReplace: true,
  });
  assert.equal(replacedWorker.is_responsible, true);

  // التحقق من تجريد المسؤول السابق تلقائياً
  const oldResp = await prisma.worker.findUnique({ where: { id: respWorkerId } });
  assert.equal(oldResp.isResponsible, false, 'المسؤول السابق يجب أن يُجرّد من الصفة ذرّياً');

  // إعادة صفة المسؤول لـ respWorkerId لمتابعة الاختبارات
  await workersService.promoteResponsible(ownerId, respWorkerId, true);
});

test('10. Worker soft deletion preserves historical relations and frees quota', async () => {
  // حذف العامل العادي soft-delete
  const delRes = await workersService.remove(ownerId, ordWorkerId);
  assert.equal(delRes.deleted, true);

  const deletedWorkerInDb = await prisma.worker.findUnique({ where: { id: ordWorkerId } });
  assert.equal(deletedWorkerInDb.status, 'DELETED');
  assert.ok(deletedWorkerInDb.deletedAt !== null);

  // رصيد الموافقة تحرر: يمكن إضافة عامل عادي جديد بدلاً منه
  const newOrdPhone = `79${Math.floor(1000000 + Math.random() * 8999999)}`;
  const addedWorker = await workersService.create(ownerId, {
    fullName: 'عامل عادي بديل',
    phone: newOrdPhone,
    password: 'password123',
    passwordConfirmation: 'password123',
    isResponsible: false,
  });
  assert.ok(addedWorker.id);
});

test('11 & 12. Daily closing authorization: responsible worker cannot modify owner closing', async () => {
  // جلب إغلاق اليوم للمالك
  const ownerClosing = await dailyClosingService.getToday(ownerUser);
  assert.equal(ownerClosing.worker_id, null, 'إغلاق المالك يحمل worker_id: null');

  // محاولة العامل المسؤول تعديل كاش إغلاق المالك (workerId: null) يجب أن تُرفض بـ 403
  await assert.rejects(
    async () => {
      await dailyClosingService.updateActualCash(respWorkerUser, ownerClosing.closing_id, {
        actualCash: 50000,
      });
    },
    (err) => err.code === 'PERMISSION_DENIED',
    'العامل المسؤول ممنوع قطعياً من تعديل إغلاق المالك'
  );

  // محاولة استدعاء updateWorkerActualCash من العامل باستهداف المالك
  await assert.rejects(
    async () => {
      await dailyClosingService.updateWorkerActualCash(respWorkerUser, ownerClosing.closing_id, '', {
        actualCash: 50000,
      });
    },
    (err) => err.code === 'PERMISSION_DENIED',
    'العامل ممنوع من استهداف إغلاق المالك'
  );

  // المالك فقط يحق له تعديل الكاش الفعلي لإغلاقه
  const updatedOwnerClosing = await dailyClosingService.updateActualCash(ownerUser, ownerClosing.closing_id, {
    actualCash: 10000,
  });
  assert.equal(updatedOwnerClosing.actual_cash, 10000);
});

test('13. Worker-specific closing retrieval & update with permEditWorkerClosingCash', async () => {
  // جلب إغلاق خاص بالعامل المسؤول
  const respClosing = await dailyClosingService.getToday(respWorkerUser, respWorkerId);
  assert.equal(respClosing.worker_id, respWorkerId);

  // العامل المسؤول يعدل كاش إغلاقه الخاص
  const updatedOwn = await dailyClosingService.updateActualCash(respWorkerUser, respClosing.closing_id, {
    actualCash: 2500,
  });
  assert.equal(updatedOwn.actual_cash, 2500);

  // استجابة getToday للمالك أو المسؤول تتضمن قائمة العمال النشطين (workers)
  const todayResponse = await dailyClosingService.getToday(ownerUser);
  assert.ok(Array.isArray(todayResponse.workers), 'يجب أن تحتوي الاستجابة على مصفوفة workers');
  assert.ok(todayResponse.workers.length >= 2, 'تتضمن العمال النشطين للمتجر');
  assert.ok(todayResponse.workers.some((w) => w.id === respWorkerId));
});

test('14 & 15. Cash worker advances deducted in owner closing without double counting & full closing regression', async () => {
  // تسجيل حركة بيع نقدي للمالك بمبلغ 15,000
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  await prisma.sale.create({
    data: {
      storeOwnerId: ownerId,
      workerId: null,
      itemId: testItemId,
      quantity: 2,
      amount: 15000,
      cogsAmount: 8000,
      paymentType: 'CASH',
      soldAt: today,
    },
  });

  // في الخطوة 7 سجلنا سلفة نقدية للعامل بمبلغ 3,000
  // الكاش المتوقع لصندوق المتجر العام (المالك):
  // + 15,000 (مبيعات نقدية) - 3,000 (سلفة العامل النقدية المصروفة من الدرج) = 12,000
  const ownerClosingAfter = await dailyClosingService.getToday(ownerUser);
  assert.equal(
    ownerClosingAfter.summary.cash_sales,
    15000,
    'المبيعات النقدية للمالك 15,000'
  );
  assert.equal(
    ownerClosingAfter.summary.cash_expenses,
    3000,
    'سلفة العامل النقدية مخصومة كمصروف نقدي من الصندوق بمبلغ 3,000'
  );
  assert.equal(
    ownerClosingAfter.expected_cash,
    12000,
    'الكاش المتوقع لصندوق المالك = 15,000 - 3,000 = 12,000'
  );

  // كاش إغلاق العامل نفسه يخصم سلفته فقط دون احتساب مبيعات المالك
  const respWorkerClosing = await dailyClosingService.getToday(ownerUser, respWorkerId);
  assert.equal(
    respWorkerClosing.summary.cash_expenses,
    3000,
    'سلفة العامل مخصومة في إغلاق العامل نفسه'
  );
  assert.equal(
    respWorkerClosing.expected_cash,
    -3000,
    'كاش العامل المتوقع = 0 - 3,000 = -3,000 (عجز سلفة لم يقابلها مبيعات نقدية للعامل)'
  );

  // اعتماد إغلاق المالك بنجاح (Approve)
  await dailyClosingService.updateActualCash(ownerUser, ownerClosingAfter.closing_id, {
    actualCash: 12000,
  });
  const approved = await dailyClosingService.approve(ownerUser, ownerClosingAfter.closing_id);
  assert.equal(approved.status, 'CLOSED');
});
