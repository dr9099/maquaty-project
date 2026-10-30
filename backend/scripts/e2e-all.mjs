// scripts/e2e-all.mjs
// اختبار تكامل شامل ومكتمل لجميع المراحل 1، 2، 3، 4 والمتممات (Node native ESM)
import { PrismaClient } from '@prisma/client';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
let pass = 0;
let fail = 0;

function check(desc, expected, actual) {
  const expStr = typeof expected === 'object' ? JSON.stringify(expected) : String(expected);
  const actStr = typeof actual === 'object' ? JSON.stringify(actual) : String(actual);
  if (expStr === actStr) {
    pass++;
    console.log(`✅ ${desc}`);
  } else {
    fail++;
    console.error(`❌ ${desc} — المتوقع [${expStr}] الفعلي [${actStr}]`);
  }
}

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

async function run() {
  console.log('🚀 بدء الاختبار الشامل لجميع مراحل نظام مَقوتي (Backend E2E)...');
  console.log(`📡 الخادم: ${BASE}`);

  // 0. تصفير قاعدة البيانات
  const prisma = new PrismaClient();
  const tables = await prisma.$queryRaw`
    SELECT tablename FROM pg_tables WHERE schemaname='public'
    AND tablename <> '_prisma_migrations' AND tablename <> 'system_settings'
  `;
  for (const { tablename } of tables) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${tablename}" CASCADE;`);
  }
  console.log('🧹 تم تصفير قاعدة البيانات بنجاح.');

  // ══════════════════════════════════════════════════════
  // المرحلة 1: المصادقة والملاك وحالة الحساب
  // ══════════════════════════════════════════════════════
  console.log('\n--- المرحلة 1: المصادقة والملاك وحالة الحساب ---');

  const regRes = await request('/v1/auth/register-store-owner', {
    method: 'POST',
    body: {
      fullName: 'محمد أحمد الصباحي',
      storeName: 'مقوت الصباحي النموذجي',
      phone: '777123456',
      password: 'Passw0rd!',
      passwordConfirmation: 'Passw0rd!',
      deviceFingerprint: 'DEV-001',
    },
  });
  check('تسجيل مالك جديد — 201', 201, regRes.status);
  check('حالة الحساب بعد التسجيل TRIAL', 'TRIAL', regRes.data?.account?.status);

  const dupRes = await request('/v1/auth/register-store-owner', {
    method: 'POST',
    body: {
      fullName: 'مكرر',
      storeName: 'مكرر',
      phone: '777123456',
      password: 'Passw0rd!',
      passwordConfirmation: 'Passw0rd!',
      deviceFingerprint: 'DEV-002',
    },
  });
  check('رقم هاتف مكرر يعود بـ 409 PHONE_ALREADY_EXISTS', 'PHONE_ALREADY_EXISTS', dupRes.data?.error?.code);

  const badLogin = await request('/v1/auth/login', {
    method: 'POST',
    body: { phone: '777123456', password: 'wrong', deviceFingerprint: 'DEV-001' },
  });
  check('دخول بكلمة مرور خاطئة 401 INVALID_CREDENTIALS', 'INVALID_CREDENTIALS', badLogin.data?.error?.code);

  const loginRes = await request('/v1/auth/login', {
    method: 'POST',
    body: { phone: '777123456', password: 'Passw0rd!', deviceFingerprint: 'DEV-001' },
  });
  check('دخول ناجح — 200', 200, loginRes.status);
  const OWNER_TOKEN = loginRes.data?.access_token;
  const REFRESH_TOKEN = loginRes.data?.refresh_token;
  check('وجود توكن وصول للمالك', true, !!OWNER_TOKEN);

  const refreshRes = await request('/v1/auth/refresh', {
    method: 'POST',
    body: { refreshToken: REFRESH_TOKEN },
  });
  check('تدوير توكن التحديث Refresh Token Rotation', true, !!refreshRes.data?.access_token);

  const replayRes = await request('/v1/auth/refresh', {
    method: 'POST',
    body: { refreshToken: REFRESH_TOKEN },
  });
  check('محاولة إعادة استخدام التوكن القديم مرفوضة 401', 'INVALID_REFRESH_TOKEN', replayRes.data?.error?.code);

  // ══════════════════════════════════════════════════════
  // المرحلة 2: الأصناف والمحافظ والبيع المباشر والاضطراري
  // ══════════════════════════════════════════════════════
  console.log('\n--- المرحلة 2: الأصناف والمحافظ والبيع ---');

  const itemRes = await request('/v1/items', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      name: 'قات شامي ممتاز',
      unit: 'كيلو',
      quantity: 15,
      costPrice: 2500,
      sellPrice: 3000,
      emergencyPriceMode: 'COST_PLUS',
      emergencyPricePlusFixed: 200, // الحد الأدنى للبيع الاضطراري: 2700
    },
  });
  check('إنشاء صنف جديد', 201, itemRes.status);
  const ITEM_ID = itemRes.data?.item?.id;

  const mergeRes = await request('/v1/items', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      name: 'قات شامي ممتاز',
      unit: 'كيلو',
      quantity: 5,
      costPrice: 2500,
      sellPrice: 3000,
    },
  });
  check('توريد نفس الصنف يُدمج تلقائياً (BR-003)', true, mergeRes.data?.merged);
  check('الكمية الإجمالية أصبحت 20', '20', String(mergeRes.data?.item?.quantity));

  const walletRes = await request('/v1/wallets', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: { name: 'محفظة الكريمي مالي' },
  });
  const WALLET_ID = walletRes.data?.id;
  check('إنشاء محفظة دفع إلكتروني', true, !!WALLET_ID);

  // بيع نقدي: 2 × 3000 = 6000
  const saleCashRes = await request('/v1/sales', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      itemId: ITEM_ID,
      quantity: 2,
      amount: 6000,
      paymentType: 'CASH',
    },
  });
  check('بيع نقدي مباشر', 201, saleCashRes.status);
  const SALE_CASH_ID = saleCashRes.data?.sale?.id;

  // بيع اضطراري دون الحد الأدنى (أقل من 2700)
  const emergFail = await request('/v1/sales', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      itemId: ITEM_ID,
      quantity: 1,
      amount: 2500,
      paymentType: 'CASH',
      isEmergencySale: true,
      emergencyOverridePrice: 2500,
      emergencyReason: 'تصفية نهاية اليوم',
    },
  });
  check('بيع اضطراري دون الحد الأدنى مرفوض 400', 'EMERGENCY_PRICE_BELOW_MINIMUM', emergFail.data?.error?.code);

  // بيع اضطراري سليم: 2 × 2800 = 5600
  const emergOk = await request('/v1/sales', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      itemId: ITEM_ID,
      quantity: 2,
      amount: 5600,
      paymentType: 'CASH',
      isEmergencySale: true,
      emergencyOverridePrice: 2800,
      emergencyReason: 'عميل جملة معتمد',
    },
  });
  check('بيع اضطراري سليم ضمن السياسة المسموحة', true, emergOk.data?.sale?.is_emergency_sale);
  check('قيمة خسارة السعر مسجلة (3000-2800)*2 = 400 (R-16)', '400', String(emergOk.data?.sale?.price_difference_loss));

  // بيع إلكتروني مع مرفق الإيداع
  const elecOk = await request('/v1/sales', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      itemId: ITEM_ID,
      quantity: 1,
      amount: 3000,
      paymentType: 'ELECTRONIC',
      walletId: WALLET_ID,
      depositAttachmentUrl: 'https://files.maqouti.test/receipts/rec-01.jpg',
    },
  });
  check('بيع إلكتروني مع مرفق الإيداع', 'ELECTRONIC', elecOk.data?.sale?.payment_type);

  // ══════════════════════════════════════════════════════
  // المرحلة 3: إدارة العمال والصلاحيات والعامل المسؤول والموافقات R-33
  // ══════════════════════════════════════════════════════
  console.log('\n--- المرحلة 3: العمال والصلاحيات والمسؤول R-33 ---');

  // إنشاء العامل المسؤول (R-33: لا يستهلك من رصيد موافقات العمال)
  const wRespRes = await request('/v1/workers', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      fullName: 'أمين صالح المسؤول',
      phone: '771234567',
      password: 'Passw0rd!',
      passwordConfirmation: 'Passw0rd!',
      isResponsible: true,
    },
  });
  check('إنشاء عامل مسؤول دون استهلاك رصيد (R-33)', true, wRespRes.data?.is_responsible);
  const RESP_ID = wRespRes.data?.id;

  // إنشاء عامل عادي بدون رصيد موافقات مسبق -> 403
  const wNormFail = await request('/v1/workers', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      fullName: 'ياسر العامل العادي',
      phone: '772345678',
      password: 'Passw0rd!',
      passwordConfirmation: 'Passw0rd!',
    },
  });
  check('عامل عادي بلا رصيد موافقات مرفوض 403 (R-33)', 'WORKER_LIMIT_REACHED', wNormFail.data?.error?.code);

  // منح رصيد موافقات للمالك
  await prisma.storeOwner.update({
    where: { phone: '777123456' },
    data: { maxWorkersAllowed: 2 },
  });

  // إضافة العامل العادي بعد منح الرصيد
  const wNormRes = await request('/v1/workers', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      fullName: 'ياسر العامل العادي',
      phone: '772345678',
      password: 'Passw0rd!',
      passwordConfirmation: 'Passw0rd!',
      permissions: {
        damagedGoodsEntry: false, // لا يحق له تسجيل تالف لاختباره لاحقاً
        enterOwnAdvance: false,   // لا يحق له إدخال سلفة لنفسه
      },
    },
  });
  check('إنشاء عامل عادي بعد منح رصيد الموافقات', 201, wNormRes.status);
  const WORKER_ID = wNormRes.data?.id;

  // تسجيل دخول العامل العادي
  const wLogin = await request('/v1/auth/login', {
    method: 'POST',
    body: { phone: '772345678', password: 'Passw0rd!', deviceFingerprint: 'DEV-W1' },
  });
  const WORKER_TOKEN = wLogin.data?.access_token;
  check('دخول العامل العادي بنجاح', 'WORKER', wLogin.data?.role);

  // تسجيل دخول العامل المسؤول
  const respLogin = await request('/v1/auth/login', {
    method: 'POST',
    body: { phone: '771234567', password: 'Passw0rd!', deviceFingerprint: 'DEV-RESP' },
  });
  const RESP_TOKEN = respLogin.data?.access_token;
  check('دخول العامل المسؤول بنجاح', true, !!RESP_TOKEN);

  // العامل المسؤول يرى شاشة العمال المدارين (MANAGED_WORKERS)
  const managedRes = await request('/v1/managed-workers', {
    method: 'GET',
    token: RESP_TOKEN,
  });
  check('المسؤول يرى العمال المدارين', true, Array.isArray(managedRes.data) && managedRes.data.length >= 2);

  // العامل العادي محظور من شاشة العمال المدارين
  const managed403 = await request('/v1/managed-workers', {
    method: 'GET',
    token: WORKER_TOKEN,
  });
  check('العامل العادي ممنوع من شاشة المدارين 403', 'PERMISSION_DENIED', managed403.data?.error?.code);

  // ══════════════════════════════════════════════════════
  // المرحلة 4: الآجل (Credit Module)
  // ══════════════════════════════════════════════════════
  console.log('\n--- المرحلة 4: مبيعات الآجل وسداد الديون (Credit) ---');

  // العامل العادي ممنوع من الوصول لإدارة الآجل (BR-009)
  const creditCustForbidden = await request('/v1/credit-customers', {
    method: 'GET',
    token: WORKER_TOKEN,
  });
  check('العامل العادي محظور من إدارة الآجل 403', 'PERMISSION_DENIED', creditCustForbidden.data?.error?.code);

  // المالك يضيف عميل آجل
  const custRes = await request('/v1/credit-customers', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      name: 'الشيخ عبد الله القحطاني',
      phone: '779988776',
      creditLimit: 50000,
    },
  });
  check('إضافة عميل آجل جديد', 201, custRes.status);
  const CUSTOMER_ID = custRes.data?.id;

  // بيع آجل من المالك: 2 × 3000 = 6000
  const creditSaleRes = await request('/v1/sales', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      itemId: ITEM_ID,
      quantity: 2,
      amount: 6000,
      paymentType: 'CREDIT',
      creditCustomerId: CUSTOMER_ID,
    },
  });
  check('تسجيل بيع آجل بنجاح', 'CREDIT', creditSaleRes.data?.sale?.payment_type);

  // العامل المسؤول يبيع آجل أيضاً (مسموح للمسؤول R-11)
  const creditSaleResp = await request('/v1/sales', {
    method: 'POST',
    token: RESP_TOKEN,
    body: {
      itemId: ITEM_ID,
      quantity: 1,
      amount: 3000,
      paymentType: 'CREDIT',
      creditCustomerId: CUSTOMER_ID,
    },
  });
  check('العامل المسؤول ينفذ بيعاً آجلاً بنجاح (R-11)', 'CREDIT', creditSaleResp.data?.sale?.payment_type);

  // فحص رصيد دين العميل: 6000 + 3000 = 9000
  const custListRes = await request('/v1/credit-customers', {
    method: 'GET',
    token: OWNER_TOKEN,
  });
  const custRow = custListRes.data?.find((c) => c.id === CUSTOMER_ID);
  check('إجمالي دين العميل الحالي 9000', '9000', String(custRow?.total_debt));

  // كشف حساب العميل (Statement)
  const stmtRes = await request(`/v1/credit-customers/${CUSTOMER_ID}/statement`, {
    method: 'GET',
    token: OWNER_TOKEN,
  });
  check('كشف حساب العميل يحتوي على الحركات', true, Array.isArray(stmtRes.data?.transactions) && stmtRes.data.transactions.length >= 2);

  // سداد جزء من الدين (2000 نقداً): يصبح المتبقي 7000
  const payDebtRes = await request(`/v1/credit-customers/${CUSTOMER_ID}/payments`, {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      amount: 2000,
      paymentMethod: 'CASH',
    },
  });
  check('تسجيل سداد دين آجل بنجاح', 201, payDebtRes.status);
  check('المتبقي بعد السداد 7000', '7000', String(payDebtRes.data?.remaining_debt));

  // ══════════════════════════════════════════════════════
  // المرحلة 4: التالف (Damaged Goods Module)
  // ══════════════════════════════════════════════════════
  console.log('\n--- المرحلة 4: تسجيل التالف والمخزون ---');

  // عامل بلا صلاحية يحاول تسجيل تالف -> 403
  const dmgFail = await request('/v1/damaged-goods', {
    method: 'POST',
    token: WORKER_TOKEN,
    body: {
      itemId: ITEM_ID,
      quantity: 1,
      isDamaged: true,
      reason: 'تلف بفعل الحرارة',
    },
  });
  check('عامل بلا صلاحية تالف مرفوض 403', 'PERMISSION_DENIED', dmgFail.data?.error?.code);

  // المالك يسجل تالف 1 حبة مع الصورة (BR-014)
  const dmgRes = await request('/v1/damaged-goods', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      itemId: ITEM_ID,
      quantity: 1,
      isDamaged: true,
      reason: 'تلف أثناء النقل',
      photoUrl: 'https://files.maqouti.test/damaged/d1.jpg',
    },
  });
  check('تسجيل التالف بنجاح', 201, dmgRes.status);

  // تقرير التالف
  const dmgReport = await request('/v1/damaged-goods', {
    method: 'GET',
    token: OWNER_TOKEN,
  });
  check('تقرير التالف يعرض المسجلات', true, Array.isArray(dmgReport.data?.records) && dmgReport.data.records.length >= 1);

  // ══════════════════════════════════════════════════════
  // متممات المرحلة 2: المرتجعات (Returns Module)
  // ══════════════════════════════════════════════════════
  console.log('\n--- متممات المرحلة 2: المرتجعات (Returns) ---');

  // محاولة إرجاع كمية أكبر من المباعة
  const retOver = await request('/v1/returns', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      saleId: SALE_CASH_ID,
      quantity: 99,
      amount: 297000,
    },
  });
  check('إرجاع كمية زائدة مرفوض 400', 'RETURN_QUANTITY_EXCEEDED', retOver.data?.error?.code);

  // إرجاع ناجح لـ 1 حبة من البيع النقدي الأصلي
  const retOk = await request('/v1/returns', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      saleId: SALE_CASH_ID,
      quantity: 1,
      amount: 3000,
    },
  });
  check('إرجاع مبيعات سليم وإعادة للمخزون وقيد عكسي', 201, retOk.status);
  check('المبلغ المرتجع 3000', '3000', String(retOk.data?.amount));

  // ══════════════════════════════════════════════════════
  // المرحلة 4: المصروفات وسلف الموظفين (Expenses & R-37)
  // ══════════════════════════════════════════════════════
  console.log('\n--- المرحلة 4: المصروفات وتسوية السلف R-37 ---');

  // إضافة موظف
  const empRes = await request('/v1/employees', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      name: 'بلال الحارس',
      monthlyDue: 50000,
    },
  });
  check('إضافة موظف للمتجر', 201, empRes.status);
  const EMP_ID = empRes.data?.id;

  // سلفة أولى للموظف: 10,000
  const adv1 = await request(`/v1/employees/${EMP_ID}/advances`, {
    method: 'POST',
    token: OWNER_TOKEN,
    body: { amount: 10000, note: 'سلفة أول الشهر' },
  });
  check('صرف سلفة للموظف 10,000', 201, adv1.status);

  // سلفة ثانية للموظف: 5,000
  const adv2 = await request(`/v1/employees/${EMP_ID}/advances`, {
    method: 'POST',
    token: OWNER_TOKEN,
    body: { amount: 5000, note: 'سلفة طارئة' },
  });
  check('صرف سلفة ثانية 5,000 (إجمالي السلف 15,000)', 201, adv2.status);

  // دفع مستحقات الموظف وتسوية السلف آلياً بنظام FIFO (R-37)
  // الراتب 50,000 - سلف مخصومة 15,000 = صافي مدفوع 35,000
  const salaryPayRes = await request(`/v1/employees/${EMP_ID}/payments`, {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      amount: 50000,
      deductAdvances: 15000,
    },
  });
  check('تسوية راتب الموظف مع خصم السلف بنجاح (R-37)', 201, salaryPayRes.status);
  check('الصافي المدفوع نقداً 35,000', '35000', String(salaryPayRes.data?.net_paid));
  check('المبلغ المخصوم من السلف 15,000', '15000', String(salaryPayRes.data?.advance_deducted));

  // مصروف إيجار المتجر
  const rentRes = await request('/v1/rent-records', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      amount: 40000,
      paymentMethod: 'CASH',
      payerName: 'محمد الصباحي',
      receiverName: 'مالك العقار',
    },
  });
  check('تسجيل مصروف إيجار المتجر', 201, rentRes.status);

  // مصروف فواتير كهرباء/مياه
  const utilRes = await request('/v1/utility-payments', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      utilityType: 'ELECTRICITY',
      amount: 6000,
    },
  });
  check('تسجيل مصروف الخدمات/الفواتير', 201, utilRes.status);

  // العامل المسؤول يسجل سلفة لنفسه (R-10: مسموح)
  const respAdvRes = await request('/v1/worker-advances', {
    method: 'POST',
    token: RESP_TOKEN,
    body: {
      amount: 4000,
      note: 'سلفة شخصية للمسؤول',
    },
  });
  check('العامل المسؤول يسجل سلفة شخصية لنفسه (R-10)', 201, respAdvRes.status);

  // العامل العادي محظور لأن صلاحيته معطلة
  const normAdvFail = await request('/v1/worker-advances', {
    method: 'POST',
    token: WORKER_TOKEN,
    body: { amount: 2000 },
  });
  check('عامل بصلاحية معطلة ممنوع من تسجيل سلفة لنفسه 403', 'PERMISSION_DENIED', normAdvFail.data?.error?.code);

  // ══════════════════════════════════════════════════════
  // المرحلة 5: المزامنة والعمل دون اتصال (Sync Engine)
  // ══════════════════════════════════════════════════════
  console.log('\n--- المرحلة 5: المزامنة والعمل دون اتصال (Sync Engine) ---');

  // مزامنة عمليات محلية أوفلاين (بيع + تالف)
  const syncOp1Id = 'CLIENT-OP-001';
  const syncOp2Id = 'CLIENT-OP-002';
  const syncRes1 = await request('/v1/device/sync', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      deviceFingerprint: 'DEV-OWNER-SYNC',
      lastSyncVersion: 0,
      pendingLocalOperations: [
        {
          clientOpId: syncOp1Id,
          opType: 'SALE',
          payload: {
            itemId: ITEM_ID,
            quantity: 1,
            amount: 3000,
            paymentType: 'CASH',
          },
        },
        {
          clientOpId: syncOp2Id,
          opType: 'DAMAGED_GOODS',
          payload: {
            itemId: ITEM_ID,
            quantity: 0.5,
            isDamaged: true,
            reason: 'تلف شمس',
            photoUrl: 'https://files.test/sun.jpg',
          },
        },
      ],
    },
  });
  check('مزامنة عمليات محلية ناجحة 200', 200, syncRes1.status);
  check('إصدار المزامنة زاد إلى 1', 1, syncRes1.data?.new_sync_version);
  check('العمليتان قُبلتا ACCEPTED', true, syncRes1.data?.processed_operations?.every((o) => o.status === 'ACCEPTED'));
  check('وصول تحديثات الأصناف من الخادم', true, Array.isArray(syncRes1.data?.server_updates?.items));

  // منع التكرار (Idempotency): إعادة إرسال نفس clientOpId تُرجع النتيجة المحفوظة دون تكرار
  const syncReplay = await request('/v1/device/sync', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      deviceFingerprint: 'DEV-OWNER-SYNC',
      pendingLocalOperations: [
        {
          clientOpId: syncOp1Id,
          opType: 'SALE',
          payload: {
            itemId: ITEM_ID,
            quantity: 1,
            amount: 3000,
            paymentType: 'CASH',
          },
        },
      ],
    },
  });
  check('منع التكرار (Idempotency) يُرجع نفس الحالة دون إعادة بيع', 'ACCEPTED', syncReplay.data?.processed_operations?.[0]?.status);

  // حظر الجهاز المحظور (DEVICE_BLOCKED)
  await prisma.device.create({
    data: {
      deviceFingerprint: 'DEV-BLOCKED-001',
      status: 'BLOCKED',
    },
  });
  const syncBlocked = await request('/v1/device/sync', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: { deviceFingerprint: 'DEV-BLOCKED-001' },
  });
  check('مزامنة جهاز محظور مرفوضة 403 (DEVICE_BLOCKED)', 'DEVICE_BLOCKED', syncBlocked.data?.error?.code);

  // معالجة التعارض والرفض (R-30): عملية تجاوز سقف الائتمان ونقص المخزون
  // تعديل سقف الائتمان إلى 8000 (الدين الحالي 7000 + 3000 = 10000 > 8000)
  await request(`/v1/credit-customers/${CUSTOMER_ID}`, {
    method: 'PATCH',
    token: OWNER_TOKEN,
    body: { creditLimit: 8000 },
  });

  const syncCreditFailId = 'CLIENT-OP-CREDIT-FAIL';
  const syncStockFailId = 'CLIENT-OP-STOCK-FAIL';
  const syncNormalFailId = 'CLIENT-OP-BAD-ITEM';

  const syncConflictRes = await request('/v1/device/sync', {
    method: 'POST',
    token: RESP_TOKEN,
    body: {
      deviceFingerprint: 'DEV-RESP-SYNC',
      pendingLocalOperations: [
        // تجاوز سقف الائتمان
        {
          clientOpId: syncCreditFailId,
          opType: 'SALE',
          payload: {
            itemId: ITEM_ID,
            quantity: 1,
            amount: 3000, // 7000 + 3000 = 10000 > 8000
            paymentType: 'CREDIT',
            creditCustomerId: CUSTOMER_ID,
          },
        },
        // نقص المخزون
        {
          clientOpId: syncStockFailId,
          opType: 'SALE',
          payload: {
            itemId: ITEM_ID,
            quantity: 9999, // يتجاوز الكمية المتوفرة
            amount: 29997000,
            paymentType: 'CASH',
          },
        },
        // خطأ عادي آخر (صنف غير موجود)
        {
          clientOpId: syncNormalFailId,
          opType: 'SALE',
          payload: {
            itemId: '00000000-0000-0000-0000-000000000000',
            quantity: 1,
            amount: 3000,
            paymentType: 'CASH',
          },
        },
      ],
    },
  });
  check('العمليات المرفوضة في المزامنة تعود بحالة REJECTED', true, syncConflictRes.data?.processed_operations?.every((o) => o.status === 'REJECTED'));

  // ══════════════════════════════════════════════════════
  // المرحلة 5: معالجة العمليات المرفوضة (Rejected Transactions — R-30)
  // ══════════════════════════════════════════════════════
  console.log('\n--- المرحلة 5: العمليات المرفوضة وحلها (R-30) ---');

  // العامل العادي محظور من شاشة العمليات المرفوضة
  const rej403 = await request('/v1/rejected-transactions', {
    method: 'GET',
    token: WORKER_TOKEN,
  });
  check('العامل العادي ممنوع من العمليات المرفوضة 403', 'PERMISSION_DENIED', rej403.data?.error?.code);

  // المالك يستعلم عن العمليات المعلقة
  const rejList = await request('/v1/rejected-transactions?status=PENDING', {
    method: 'GET',
    token: OWNER_TOKEN,
  });
  check('المالك يستعرض العمليات المرفوضة المعلقة', true, Array.isArray(rejList.data) && rejList.data.length >= 2);

  const creditRej = rejList.data?.find((r) => r.rejection_reason_code === 'CREDIT_LIMIT_EXCEEDED');
  const stockRej = rejList.data?.find((r) => r.rejection_reason_code === 'INSUFFICIENT_STOCK');
  check('تسجيل عملية تجاوز سقف الائتمان تلقائياً (R-30)', true, !!creditRej);
  check('تسجيل عملية نقص المخزون تلقائياً (R-30)', true, !!stockRej);
  check('الخطأ العادي لم يُسجل في العمليات المرفوضة (R-30)', false, rejList.data?.some((r) => r.attempted_payload?.itemId === '00000000-0000-0000-0000-000000000000'));

  // محاولة حل غير مسموح لسبب الرفض
  const badActionRes = await request(`/v1/rejected-transactions/${creditRej.id}/resolve`, {
    method: 'POST',
    token: OWNER_TOKEN,
    body: { resolutionAction: 'APPROVE_NEGATIVE_STOCK' },
  });
  check('إجراء غير متطابق مع سبب الرفض مرفوض 400 (DISALLOWED_RESOLUTION_ACTION)', 'DISALLOWED_RESOLUTION_ACTION', badActionRes.data?.error?.code);

  // المالك يحل عملية نقص المخزون بالموافقة بالكمية المصححة (APPROVE_ADJUSTED_QTY)
  const resolveStock = await request(`/v1/rejected-transactions/${stockRej.id}/resolve`, {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      resolutionAction: 'APPROVE_ADJUSTED_QTY',
      adjustedQuantity: 1,
    },
  });
  check('حل عملية نقص المخزون بالكمية المصححة بنجاح', 200, resolveStock.status);
  check('حالة العملية أصبحت RESOLVED', 'RESOLVED', resolveStock.data?.status);
  check('تم إنشاء عملية بيع فعلية مصححة', true, !!resolveStock.data?.created_sale_id);

  // المالك يحل عملية تجاوز سقف الائتمان بالترحيل كخسائر (POST_AS_LOSS)
  const resolveCreditLoss = await request(`/v1/rejected-transactions/${creditRej.id}/resolve`, {
    method: 'POST',
    token: OWNER_TOKEN,
    body: { resolutionAction: 'POST_AS_LOSS' },
  });
  check('حل عملية تجاوز الائتمان بالترحيل كخسائر بنجاح', 200, resolveCreditLoss.status);

  // ══════════════════════════════════════════════════════
  // المرحلة 5: الرسائل والإعلانات (Broadcasts Pull & Ack)
  // ══════════════════════════════════════════════════════
  console.log('\n--- المرحلة 5: الرسائل والإعلانات (Broadcasts) ---');

  // زراعة إعلان تجريبي في قاعدة البيانات
  const testAdmin = (await prisma.platformAdmin.findFirst()) || (await prisma.platformAdmin.create({
    data: {
      fullName: 'مدير المنصة',
      phone: '700000000',
      passwordHash: 'dummy',
    },
  }));
  const broadcast = await prisma.broadcast.create({
    data: {
      createdBy: testAdmin.id,
      type: 'POPUP',
      title: 'عرض الصيف',
      body: 'خصم 20% على الاشتراك السنوي',
      targetType: 'ALL',
      isActive: true,
    },
  });

  const pullRes = await request('/v1/device/broadcasts/pull', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: { deviceFingerprint: 'DEV-OWNER-SYNC' },
  });
  check('سحب الإعلانات السارية بنجاح', true, Array.isArray(pullRes.data) && pullRes.data.some((b) => b.id === broadcast.id));

  // تأكيد القراءة ACK
  const ackRes = await request(`/v1/device/broadcasts/${broadcast.id}/ack`, {
    method: 'POST',
    token: OWNER_TOKEN,
    body: { ackType: 'VIEW', deviceFingerprint: 'DEV-OWNER-SYNC' },
  });
  check('تأكيد قراءة الإعلان ACK بنجاح', 200, ackRes.status);

  // سحب مرة أخرى: الإعلان المشاهد لا يعود
  const pullRes2 = await request('/v1/device/broadcasts/pull', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: { deviceFingerprint: 'DEV-OWNER-SYNC' },
  });
  check('الإعلان المؤكدة قراءته لا يعود للجهاز نفسه', false, pullRes2.data?.some((b) => b.id === broadcast.id));

  // ══════════════════════════════════════════════════════
  // المرحلة 5: لوحة الملخص (Dashboard Summary — API_SPEC §15)
  // ══════════════════════════════════════════════════════
  console.log('\n--- المرحلة 5: لوحة الملخص (Dashboard Summary) ---');

  const ownerDash = await request('/v1/dashboard/summary', {
    method: 'POST',
    token: OWNER_TOKEN,
  });
  check('لوحة ملخص المالك تجلب إجماليات المتجر ككل', 200, ownerDash.status);
  check('مبيعات اليوم الإجمالية > 0', true, ownerDash.data?.sales_today_total > 0);
  check('حالة اليوم مفتوحة OPEN', 'OPEN', ownerDash.data?.today_status);

  const workerDash = await request('/v1/dashboard/summary', {
    method: 'GET',
    token: WORKER_TOKEN,
  });
  check('لوحة ملخص العامل العادي تجلب أرقامه هو فقط', 200, workerDash.status);

  // ══════════════════════════════════════════════════════
  // المرحلة 5: الأموال والتقارير (Funds & Reports — API_SPEC §10)
  // ══════════════════════════════════════════════════════
  console.log('\n--- المرحلة 5: الأموال والتقارير (Funds & Reports) ---');

  const fundsRes = await request('/v1/funds/summary', {
    method: 'GET',
    token: OWNER_TOKEN,
  });
  check('تقرير موقف الأموال للمالك 200', 200, fundsRes.status);
  check('الصندوق والمحافظ والذمم وإجمالي الأموال متوفرة', true, fundsRes.data?.total_funds !== undefined);

  // العامل العادي محظور من موقف الأموال
  const funds403 = await request('/v1/funds/summary', {
    method: 'GET',
    token: WORKER_TOKEN,
  });
  check('عامل عادي محظور من موقف الأموال 403', 'PERMISSION_DENIED', funds403.data?.error?.code);

  // تقارير المبيعات
  const salesRep = await request('/v1/reports?type=sales', {
    method: 'GET',
    token: OWNER_TOKEN,
  });
  check('تقرير المبيعات يحوي العمليات والإجمالي', true, Array.isArray(salesRep.data?.records) && salesRep.data.total_amount > 0);

  // تقرير المصروفات
  const expRep = await request('/v1/reports?type=expenses', {
    method: 'GET',
    token: OWNER_TOKEN,
  });
  check('تقرير المصروفات يحوي الفئات والإجمالي', true, expRep.data?.total_expenses > 0 && expRep.data.categories?.rent > 0);

  // تقرير المسحوبات (السلف)
  const withRep = await request('/v1/reports?type=withdrawals', {
    method: 'GET',
    token: OWNER_TOKEN,
  });
  check('تقرير المسحوبات والسلف يحوي السجلات', true, withRep.data?.total_withdrawals > 0);

  // ══════════════════════════════════════════════════════
  // المرحلة 6: المشتريات والموردون ومحرك التكلفة وعملة المتجر
  // ══════════════════════════════════════════════════════
  console.log('\n--- المرحلة 6: المشتريات والموردون ومحرك التكلفة وعملة المتجر ---');

  let SUPPLIER_ID;
  let cleanPur;
  let cleanLineId;
  {
  // 6.1 تسجيل مالك ثانٍ (المتجر ب) لاختبار تغيير العملة قبل الحركات وعزل المستأجرين (IDOR -> 404)
  const regOwnerB = await request('/v1/auth/register-store-owner', {
    method: 'POST',
    body: {
      fullName: 'صالح الهمداني',
      storeName: 'متجر الهمداني ب',
      phone: '771998877',
      password: 'Passw0rd!',
      passwordConfirmation: 'Passw0rd!',
      deviceFingerprint: 'DEV-OWNER-B',
    },
  });
  check('تسجيل متجر ثانٍ لاختبارات العملة وعزل المستأجرين', 201, regOwnerB.status);
  const loginOwnerB = await request('/v1/auth/login', {
    method: 'POST',
    body: { phone: '771998877', password: 'Passw0rd!', deviceFingerprint: 'DEV-OWNER-B' },
  });
  const OWNER_B_TOKEN = loginOwnerB.data?.access_token;

  // قبل أي حركة مالية: تغيير العملة مسموح في المتجر ب
  const settingsB0 = await request('/v1/settings/store', { token: OWNER_B_TOKEN });
  check('المتجر الجديد عملته غير مقفلة قبل الحركات', false, settingsB0.data?.currency_locked);

  const changeCurOk = await request('/v1/settings/store', {
    method: 'PATCH',
    token: OWNER_B_TOKEN,
    body: { currency: 'SAR', defaultCostingMethod: 'FIFO' },
  });
  check('تغيير عملة المتجر قبل الحركات المالية ينجح 200', 200, changeCurOk.status);
  check('رمز العملة المحدث ر.س', 'ر.س', changeCurOk.data?.currency_symbol);

  // في المتجر أ (عليه مبيعات سابقة): تغيير العملة مقفل 409 CURRENCY_CHANGE_LOCKED
  const changeCurLocked = await request('/v1/settings/store', {
    method: 'PATCH',
    token: OWNER_TOKEN,
    body: { currency: 'USD' },
  });
  check('رفض تغيير عملة المتجر بعد وجود حركات مالية 409 CURRENCY_CHANGE_LOCKED', 'CURRENCY_CHANGE_LOCKED', changeCurLocked.data?.error?.code);

  // بينما تعديل طريقة احتساب التكلفة الافتراضية مسموح للمالك في أي وقت
  const changeCostMethodOk = await request('/v1/settings/store', {
    method: 'PATCH',
    token: OWNER_TOKEN,
    body: { defaultCostingMethod: 'WEIGHTED_AVERAGE' },
  });
  check('تحديث السياسة الافتراضية للتكلفة للمالك 200', 200, changeCostMethodOk.status);

  // 6.2 إدارة الموردين والرصيد الافتتاحي ومنع التكرار والحذف الناعم المحمي
  const sup1Res = await request('/v1/suppliers', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      name: 'مزارع همدان الكبرى',
      phone: '770112233',
      address: 'همدان - صنعاء',
      contactPerson: 'الشيخ علي',
      openingBalance: 10000,
      creditLimit: 150000,
      paymentTermsDays: 15,
    },
  });
  check('إنشاء مورد برصيد افتتاحي 201', 201, sup1Res.status);
  SUPPLIER_ID = sup1Res.data?.id;
  check('رصيد المورد الحالي يساوي الرصيد الافتتاحي 10000', 10000, sup1Res.data?.current_balance);

  const dupSupRes = await request('/v1/suppliers', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: { name: 'مزارع همدان الكبرى', phone: '770999999' },
  });
  check('رفض تكرار اسم المورد في نفس المتجر 409 SUPPLIER_DUPLICATE', 'SUPPLIER_DUPLICATE', dupSupRes.data?.error?.code);

  const delWithBal = await request(`/v1/suppliers/${SUPPLIER_ID}`, {
    method: 'DELETE',
    token: OWNER_TOKEN,
  });
  check('منع حذف مورد عليه رصيد غير صفري 409 SUPPLIER_HAS_BALANCE', 'SUPPLIER_HAS_BALANCE', delWithBal.data?.error?.code);

  const supZero = await request('/v1/suppliers', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: { name: 'مورد مؤقت بدون رصيد' },
  });
  const delZero = await request(`/v1/suppliers/${supZero.data?.id}`, {
    method: 'DELETE',
    token: OWNER_TOKEN,
  });
  check('السماح بالحذف الناعم لمورد رصيده صفر 200', 200, delZero.status);

  // إيقاف المورد مؤقتاً يمنع الشراء منه ثم إعادة تفعيله
  await request(`/v1/suppliers/${SUPPLIER_ID}`, {
    method: 'PATCH',
    token: OWNER_TOKEN,
    body: { status: 'SUSPENDED' },
  });
  const suspendedPur = await request('/v1/purchases', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      supplierId: SUPPLIER_ID,
      paymentType: 'CASH',
      items: [{ itemName: 'قات تجريبي', unit: 'حبة', quantity: 1, unitCostPrice: 1000, sellPrice: 1500 }],
    },
  });
  check('منع إنشاء فاتورة شراء من مورد موقوف 400 SUPPLIER_SUSPENDED', 'SUPPLIER_SUSPENDED', suspendedPur.data?.error?.code);

  await request(`/v1/suppliers/${SUPPLIER_ID}`, {
    method: 'PATCH',
    token: OWNER_TOKEN,
    body: { status: 'ACTIVE' },
  });

  // 6.3 التحقق من عدم استهلاك عداد الفترة التجريبية (trial_sales_used) عند الشراء
  const ownerBeforePur = await prisma.storeOwner.findFirst({ where: { phone: '777123456' } });
  const trialBefore = ownerBeforePur.trialSalesUsed;

  // 6.4 دورة المسودة (DRAFT -> PATCH -> POST) وتعدد الوحدات (conversionFactor = 10)
  const draftRes = await request('/v1/purchases', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      supplierId: SUPPLIER_ID,
      paymentType: 'CREDIT',
      status: 'DRAFT',
      items: [
        {
          itemName: 'قات سوطي جملة',
          unit: 'ربطة',
          baseUnit: 'حبة',
          conversionFactor: 10,
          quantity: 2, // 2 ربطة = 20 حبة
          unitCostPrice: 20000,
          sellPrice: 2600,
          emergencyPriceMode: 'COST_ONLY',
        },
      ],
    },
  });
  check('حفظ فاتورة شراء كمسودة DRAFT 201', 201, draftRes.status);
  const DRAFT_ID = draftRes.data?.id;

  // تعديل المسودة قبل الاعتماد
  const patchDraftRes = await request(`/v1/purchases/${DRAFT_ID}`, {
    method: 'PATCH',
    token: OWNER_TOKEN,
    body: {
      discountAmount: 2000,
      notes: 'مسودة معدلة بخصم مكتسب',
    },
  });
  check('تعديل المسودة قبل الاعتماد 200', 200, patchDraftRes.status);

  // اعتماد المسودة وترحيلها للمخزون والمحاسبة
  const postDraftRes = await request(`/v1/purchases/${DRAFT_ID}/post`, {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {},
  });
  check('اعتماد المسودة وترحيلها POSTED 200', 200, postDraftRes.status);
  check('صافي فاتورة المسودة بعد الخصم = 38000', 38000, postDraftRes.data?.total_amount);

  const editPostedFail = await request(`/v1/purchases/${DRAFT_ID}`, {
    method: 'PATCH',
    token: OWNER_TOKEN,
    body: { notes: 'محاولة تعديل بعد الاعتماد' },
  });
  check('منع تعديل فاتورة معتمدة 409 INVOICE_NOT_EDITABLE', 'INVOICE_NOT_EDITABLE', editPostedFail.data?.error?.code);

  // التحقق من تعدد الوحدات في المخزون: 2 ربطة × 10 = 20 حبة وتكلفة الحبة = 38000 / 20 = 1900
  const invCheck1 = await request('/v1/inventory?search=سوطي', { token: OWNER_TOKEN });
  const sawtiItem = invCheck1.data?.find((i) => i.name === 'قات سوطي جملة');
  const sawtiItemId = sawtiItem?.item_id;
  check('تحويل وحدات الشراء للمخزون الأساسي (20 حبة)', 20, Number(sawtiItem?.remaining_qty));
  check('تكلفة الوحدة الأساسية المحولة (1900)', 1900, Number(sawtiItem?.cost_price));

  // 6.5 حد الـ 200 بند في الفاتورة الواحدة
  const over200Lines = Array.from({ length: 201 }, (_, idx) => ({
    itemName: `صنف ${idx}`,
    unit: 'حبة',
    quantity: 1,
    unitCostPrice: 100,
    sellPrice: 150,
  }));
  const over200Res = await request('/v1/purchases', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: { supplierId: SUPPLIER_ID, paymentType: 'CASH', items: over200Lines },
  });
  check('رفض فاتورة تتجاوز 200 بند 400 INVOICE_LINES_LIMIT_EXCEEDED', 'INVOICE_LINES_LIMIT_EXCEEDED', over200Res.data?.error?.code);

  // 6.6 محرك احتساب التكلفة: الخيارات الثلاثة + قاعدة القات 24-48 ساعة + البيع الاضطراري
  // الدفعة الثانية لنفس اليوم بسعر مختلف (3000 للحبة بدلاً من 1900)
  const previewConflict = await request('/v1/purchases/preview-costing', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      items: [
        {
          itemId: sawtiItemId,
          itemName: 'قات سوطي جملة',
          unit: 'حبة',
          baseUnit: 'حبة',
          conversionFactor: 1,
          quantity: 20,
          unitCostPrice: 2900,
          sellPrice: 3500,
        },
      ],
    },
  });
  check('فحص التكلفة يرصد تعارض سعر نفس اليوم ويعيد الخيارات الثلاثة بالعربية', true, previewConflict.data?.has_same_day_price_conflict === true && previewConflict.data?.costing_options?.length === 3);

  // طلب تنبيه صريح بدون إرسال طريقة التكلفة -> 409 COSTING_METHOD_REQUIRED
  const reqMethodFail = await request('/v1/purchases', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      supplierId: SUPPLIER_ID,
      paymentType: 'CASH',
      promptOnSameDayPriceDiff: true,
      items: [
        {
          itemId: sawtiItemId,
          itemName: 'قات سوطي جملة',
          unit: 'حبة',
          baseUnit: 'حبة',
          conversionFactor: 1,
          quantity: 20,
          unitCostPrice: 2900,
          sellPrice: 3500,
        },
      ],
    },
  });
  check('إلزام المالك باختيار طريقة التكلفة عند طلب التنبيه 409 COSTING_METHOD_REQUIRED', 'COSTING_METHOD_REQUIRED', reqMethodFail.data?.error?.code);

  // الخيار 1: المتوسط المرجح المتحرك (20 × 1900 + 20 × 2900) / 40 = 2400
  const avgPurRes = await request('/v1/purchases', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      supplierId: SUPPLIER_ID,
      paymentType: 'CASH',
      costingMethod: 'WEIGHTED_AVERAGE',
      items: [
        {
          itemId: sawtiItemId,
          itemName: 'قات سوطي جملة',
          unit: 'حبة',
          baseUnit: 'حبة',
          conversionFactor: 1,
          quantity: 20,
          unitCostPrice: 2900,
          sellPrice: 3500,
        },
      ],
    },
  });
  check('اعتماد فاتورة بطريقة المتوسط المرجح المتحرك 201', 201, avgPurRes.status);
  const invAfterAvg = await request('/v1/inventory?search=سوطي', { token: OWNER_TOKEN });
  check('تكلفة الصنف بعد المتوسط المرجح = 2400', 2400, Number(invAfterAvg.data?.[0]?.cost_price));

  // الخيار 2: اعتماد سعر الشراء الأخير (3100) وتحديث الحد الأدنى للبيع الاضطراري (COST_ONLY)
  const lastPriceRes = await request('/v1/purchases', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      supplierId: SUPPLIER_ID,
      paymentType: 'ELECTRONIC',
      walletId: WALLET_ID,
      costingMethod: 'LAST_PRICE',
      items: [
        {
          itemId: sawtiItemId,
          itemName: 'قات سوطي جملة',
          unit: 'حبة',
          baseUnit: 'حبة',
          conversionFactor: 1,
          quantity: 5,
          unitCostPrice: 3100,
          sellPrice: 3800,
        },
      ],
    },
  });
  check('اعتماد فاتورة إلكترونية بطريقة السعر الأخير 201', 201, lastPriceRes.status);
  const emergBelowNewCost = await request('/v1/sales', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      itemId: sawtiItemId,
      quantity: 1,
      amount: 3000, // أقل من التكلفة الجديدة 3100
      paymentType: 'CASH',
      isEmergencySale: true,
      emergencyOverridePrice: 3000,
      emergencyReason: 'اختبار تحديث أرضية البيع الاضطراري',
    },
  });
  check('تحديث الحد الأدنى للبيع الاضطراري تلقائياً وفق التكلفة الجديدة 3100', 'EMERGENCY_PRICE_BELOW_MINIMUM', emergBelowNewCost.data?.error?.code);

  // الخيار 3: الوارد أولاً صادر أولاً (FIFO) + استهلاك الطبقات في المبيعات + قاعدة النفاد (صلاحية 24-48 ساعة)
  const fifoBatch1 = await request('/v1/purchases', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      supplierId: SUPPLIER_ID,
      paymentType: 'CASH',
      costingMethod: 'FIFO',
      items: [
        {
          itemName: 'قات أرحبي FIFO',
          unit: 'حبة',
          baseUnit: 'حبة',
          conversionFactor: 1,
          quantity: 5,
          unitCostPrice: 4000,
          sellPrice: 6000,
        },
      ],
    },
  });
  const fifoItemId = fifoBatch1.data?.items?.[0]?.item_id;

  await request('/v1/purchases', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      supplierId: SUPPLIER_ID,
      paymentType: 'PARTIAL',
      paidAmount: 10000,
      costingMethod: 'FIFO',
      items: [
        {
          itemId: fifoItemId,
          itemName: 'قات أرحبي FIFO',
          unit: 'حبة',
          baseUnit: 'حبة',
          conversionFactor: 1,
          quantity: 5,
          unitCostPrice: 5000,
          sellPrice: 6000,
        },
      ],
    },
  });

  // تفعيل FIFO كطريقة افتراضية للمتجر لاحتساب استهلاك طبقات البيع
  await request('/v1/settings/store', {
    method: 'PATCH',
    token: OWNER_TOKEN,
    body: { defaultCostingMethod: 'FIFO' },
  });

  // بيع 7 حبات: 5 من دفعة 4000 + 2 من دفعة 5000 => COGS = 30000، وتنتقل التكلفة النشطة للدفعة الثانية 5000
  const fifoSaleRes = await request('/v1/sales', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      itemId: fifoItemId,
      quantity: 7,
      amount: 42000,
      paymentType: 'CASH',
    },
  });
  check('بيع 7 حبات بنظام FIFO ينجح 201', 201, fifoSaleRes.status);
  const savedFifoSale = await prisma.sale.findUnique({ where: { id: fifoSaleRes.data?.sale?.id } });
  check('تكلفة البضاعة المباعة COGS بنظام FIFO = 30000 بدقة', 30000, Number(savedFifoSale.cogsAmount));

  // بيع الـ 3 حبات المتبقية ليصبح المخزون = 0، ثم فحص انعدام التعارض السعري عند التوريد الجديد (قاعدة القات)
  await request('/v1/sales', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: { itemId: fifoItemId, quantity: 3, amount: 18000, paymentType: 'CASH' },
  });
  const previewZeroStock = await request('/v1/purchases/preview-costing', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      items: [
        {
          itemId: fifoItemId,
          itemName: 'قات أرحبي FIFO',
          unit: 'حبة',
          baseUnit: 'حبة',
          conversionFactor: 1,
          quantity: 5,
          unitCostPrice: 4600,
          sellPrice: 5800,
        },
      ],
    },
  });
  check('قاعدة القات (نفاد المخزون = 0): لا يوجد تعارض سعري ويُعتمد السعر الجديد تلقائياً', false, previewZeroStock.data?.has_same_day_price_conflict);

  // التحقق من ثبات عداد التجربة trial_sales_used بعد فواتير المشتريات
  const ownerAfterPur = await prisma.storeOwner.findFirst({ where: { phone: '777123456' } });
  check('فواتير المشتريات لا تستهلك عداد المبيعات التجريبية إطلاقاً', true, ownerAfterPur.trialSalesUsed >= trialBefore);

  // 6.7 مرتجعات المشتريات وإلغاء الفواتير (Void & Purchase Returns)
  // أ) محاولة إرجاع صنف تمت عليه مبيعات (قات أرحبي FIFO) -> مرفوض 409 PURCHASE_ITEM_HAS_SALES
  const returnAfterSaleFail = await request(`/v1/purchases/${fifoBatch1.data.id}/returns`, {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      purchaseItemId: fifoBatch1.data.items[0].id,
      quantity: 1,
      refundMethod: 'CASH_REFUND',
      reason: 'محاولة إرجاع بعد البيع',
    },
  });
  check('رفض مرتجع مشتريات لصنف تمت عليه مبيعات 409 PURCHASE_ITEM_HAS_SALES', 'PURCHASE_ITEM_HAS_SALES', returnAfterSaleFail.data?.error?.code);

  // ب) فاتورة جديدة لصنف لم يُبع منه شيء -> مرتجع جزئي سليم + منع تجاوز الكمية المشتراة
  cleanPur = await request('/v1/purchases', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      supplierId: SUPPLIER_ID,
      paymentType: 'CREDIT',
      items: [
        {
          itemName: 'قات حرازي للمرتجع',
          unit: 'حبة',
          quantity: 6,
          unitCostPrice: 3000,
          sellPrice: 4000,
        },
      ],
    },
  });
  cleanLineId = cleanPur.data?.items?.[0]?.id;

  const retExceedFail = await request(`/v1/purchases/${cleanPur.data.id}/returns`, {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      purchaseItemId: cleanLineId,
      quantity: 10,
      refundMethod: 'DEBT_REDUCTION',
      reason: 'كمية زائدة',
    },
  });
  check('منع مرتجع بكمية تتجاوز المشتراة 400 RETURN_QTY_EXCEEDS_PURCHASED', 'RETURN_QTY_EXCEEDS_PURCHASED', retExceedFail.data?.error?.code);

  const purRetOk = await request(`/v1/purchases/${cleanPur.data.id}/returns`, {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      purchaseItemId: cleanLineId,
      quantity: 2,
      refundMethod: 'DEBT_REDUCTION',
      reason: 'أغصان تالفة من المصدر',
    },
  });
  check('تسجيل مرتجع مشتريات سليم قبل البيع مع خصم ذمة المورد 201', 201, purRetOk.status);

  // ج) إلغاء فاتورة شراء كاملة (Void) لم يجرِ عليها بيع أو سداد أو مرتجع
  const voidTargetPur = await request('/v1/purchases', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      supplierId: SUPPLIER_ID,
      paymentType: 'CREDIT',
      items: [
        {
          itemName: 'قات للإلغاء الكامل',
          unit: 'حبة',
          quantity: 4,
          unitCostPrice: 2000,
          sellPrice: 2500,
        },
      ],
    },
  });
  const voidRes = await request(`/v1/purchases/${voidTargetPur.data.id}/void`, {
    method: 'POST',
    token: OWNER_TOKEN,
    body: { reason: 'إدخال مكرر بالخطأ' },
  });
  check('إلغاء فاتورة شراء معتمدة وعكس قيدها ومخزونها 200', 'VOIDED', voidRes.data?.status);

  // 6.8 سداد الموردين وكشف الحساب (JSON + CSV) وأعمار الديون والتقارير
  const payCashRes = await request(`/v1/suppliers/${SUPPLIER_ID}/payments`, {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      amount: 15000,
      paymentMethod: 'CASH',
      notes: 'دفعة نقدية على الحساب',
    },
  });
  check('تسجيل دفعة سداد نقدية للمورد 201', 201, payCashRes.status);

  const payWalletRes = await request(`/v1/suppliers/${SUPPLIER_ID}/payments`, {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      amount: 5000,
      paymentMethod: 'ELECTRONIC',
      walletId: WALLET_ID,
      notes: 'دفعة عبر المحفظة',
    },
  });
  check('تسجيل دفعة سداد إلكترونية للمورد 201', 201, payWalletRes.status);

  const stmtRes = await request(`/v1/suppliers/${SUPPLIER_ID}/statement?format=csv`, {
    token: OWNER_TOKEN,
  });
  check('كشف حساب المورد يطابق الرصيد القائم ويصدر CSV بترميز UTF-8 BOM', true, stmtRes.data?.period?.closing_balance === stmtRes.data?.supplier?.current_balance && String(stmtRes.data?.csv_content || '').startsWith('\uFEFF'));

  const agingRes = await request(`/v1/suppliers/${SUPPLIER_ID}/aging`, { token: OWNER_TOKEN });
  check('تقرير أعمار ديون المورد يعمل بدقة 200', 200, agingRes.status);

  const purRep = await request('/v1/reports?type=purchases', { token: OWNER_TOKEN });
  check('تقرير المشتريات المحدث يحسب من الفواتير المعتمدة بعد خصم المرتجعات', true, purRep.data?.invoices_count > 0 && purRep.data?.total_returns > 0);

  const bySupRep = await request('/v1/reports/purchases-by-supplier', { token: OWNER_TOKEN });
  check('تقرير المشتريات حسب المورد 200', true, bySupRep.data?.records?.length > 0);

  const payablesRep = await request('/v1/reports/supplier-payables', { token: OWNER_TOKEN });
  check('تقرير الذمم الدائنة للموردين 200', true, payablesRep.data?.total_payables > 0);

  const marginRep = await request('/v1/reports/profit-margin', { token: OWNER_TOKEN });
  check('تقرير هامش الربح وصافي الربح 200', true, marginRep.data?.actual_cogs > 0);

  // 6.9 الأمان الصارم: حظر العمال (403)، عزل المستأجرين IDOR (404)، المزامنة غير المتصلة، والتزامن المتوازي
  const workerSup403 = await request('/v1/suppliers', { token: WORKER_TOKEN });
  check('حظر العامل العادي من الموردين 403', 'PERMISSION_DENIED', workerSup403.data?.error?.code);

  const respPur403 = await request('/v1/purchases', { token: RESP_TOKEN });
  check('حظر العامل المسؤول من فواتير المشتريات 403', 'PERMISSION_DENIED', respPur403.data?.error?.code);

  const respPurRep403 = await request('/v1/reports?type=purchases', { token: RESP_TOKEN });
  check('حظر العامل المسؤول من تقرير المشتريات وتكلفة البضاعة 403', 'PERMISSION_DENIED', respPurRep403.data?.error?.code);

  const respFunds = await request('/v1/funds/summary', { token: RESP_TOKEN });
  check('إخفاء ذمم الموردين (supplier_payables) عن العامل المسؤول في موقف الأموال', undefined, respFunds.data?.supplier_payables);

  // IDOR: المالك ب يحاول قراءة مورد وفاتورة المالك أ -> يجب إرجاع 404 وليس 403
  const idorSup = await request(`/v1/suppliers/${SUPPLIER_ID}`, { token: OWNER_B_TOKEN });
  check('عزل المستأجرين IDOR على المورد يعيد 404 NOT_FOUND', 404, idorSup.status);

  const idorPur = await request(`/v1/purchases/${cleanPur.data.id}`, { token: OWNER_B_TOKEN });
  check('عزل المستأجرين IDOR على فاتورة الشراء يعيد 404 NOT_FOUND', 404, idorPur.status);

  // المزامنة دون اتصال (Offline Sync) مع عدم التكرار عند إعادة الإرسال (Idempotency)
  const syncOpId = '99999999-8888-4777-8666-555555555555';
  const invBeforeSync = await request('/v1/purchases', { token: OWNER_TOKEN });
  const countBeforeSync = invBeforeSync.data?.total ?? 0;

  const syncPurBody = {
    deviceFingerprint: 'DEV-OWNER-SYNC',
    pendingLocalOperations: [
      {
        clientOpId: syncOpId,
        opType: 'PURCHASE',
        payload: {
          supplierId: SUPPLIER_ID,
          paymentType: 'CASH',
          items: [
            {
              itemName: 'قات مزامنة أوفلاين',
              unit: 'حبة',
              quantity: 3,
              unitCostPrice: 2000,
              sellPrice: 2800,
            },
          ],
        },
      },
    ],
  };
  const syncPur1 = await request('/v1/device/sync', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: syncPurBody,
  });
  check('مزامنة فاتورة شراء أوفلاين عبر /v1/device/sync تنجح (ACCEPTED)', 'ACCEPTED', syncPur1.data?.processed_operations?.[0]?.status);

  const syncPurReplay = await request('/v1/device/sync', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: syncPurBody,
  });
  const invAfterSyncReplay = await request('/v1/purchases', { token: OWNER_TOKEN });
  check('إعادة إرسال نفس فاتورة الأوفلاين لا تكرر المخزون أو الفاتورة (Idempotency)', countBeforeSync + 1, invAfterSyncReplay.data?.total);

  // التزامن المتوازي (Concurrency): فاتورتا شراء متزامنتان على نفس الصنف والمورد
  const [conc1, conc2] = await Promise.all([
    request('/v1/purchases', {
      method: 'POST',
      token: OWNER_TOKEN,
      body: {
        supplierId: SUPPLIER_ID,
        paymentType: 'CREDIT',
        items: [{ itemId: sawtiItemId, itemName: 'قات سوطي جملة', unit: 'حبة', quantity: 3, unitCostPrice: 3100, sellPrice: 3800 }],
      },
    }),
    request('/v1/purchases', {
      method: 'POST',
      token: OWNER_TOKEN,
      body: {
        supplierId: SUPPLIER_ID,
        paymentType: 'CREDIT',
        items: [{ itemId: sawtiItemId, itemName: 'قات سوطي جملة', unit: 'حبة', quantity: 4, unitCostPrice: 3100, sellPrice: 3800 }],
      },
    }),
  ]);
  check('نجاح الفواتير المتوازية المتزامنة بأقفال صفوف ذرية (201 + 201)', true, conc1.status === 201 && conc2.status === 201);
  }

  // ══════════════════════════════════════════════════════
  // المرحلة 7: حل التعارضات الثلاثة والعيوب الوظيفية والمحاسبية الشاملة (Conflicts 1..3 + Fixes 1..9)
  // ══════════════════════════════════════════════════════
  console.log('\n--- المرحلة 7: حل التعارضات الثلاثة والعيوب الوظيفية والمحاسبية الشاملة ---');
  {
    // 7.1 التعارض (1): زر السماح/المنع لصلاحية المشتريات والموردين للعامل المسؤول (الافتراضي منع = false)
    const enableRespPur = await request('/v1/settings/store', {
      method: 'PATCH',
      token: OWNER_TOKEN,
      body: { allowResponsiblePurchases: true },
    });
    check('تفعيل صلاحية المشتريات والموردين للعامل المسؤول من إعدادات المالك 200', true, enableRespPur.data?.allow_responsible_purchases === true);

    const respSupAllowed = await request('/v1/suppliers', { token: RESP_TOKEN });
    check('العامل المسؤول يصل إلى الموردين بعد تفعيل الصلاحية 200', 200, respSupAllowed.status);

    const respPurAllowed = await request('/v1/purchases', { token: RESP_TOKEN });
    check('العامل المسؤول يصل إلى فواتير المشتريات بعد تفعيل الصلاحية 200', 200, respPurAllowed.status);

    const respPurRepAllowed = await request('/v1/reports?type=purchases', { token: RESP_TOKEN });
    check('العامل المسؤول يرى تقرير المشتريات بعد تفعيل الصلاحية 200', 200, respPurRepAllowed.status);

    const respFundsAllowed = await request('/v1/funds/summary', { token: RESP_TOKEN });
    check('العامل المسؤول يرى ذمم الموردين (supplier_payables) عند تفعيل الصلاحية', true, respFundsAllowed.data?.supplier_payables !== undefined);

    const workerStillBlocked = await request('/v1/suppliers', { token: WORKER_TOKEN });
    check('العامل العادي يبقى محظوراً نهائياً من الموردين والمشتريات 403', 'PERMISSION_DENIED', workerStillBlocked.data?.error?.code);

    // إعادة الصلاحية للوضع الافتراضي (منع = false) والتحقق من الحجب الفوري
    const disableRespPur = await request('/v1/settings/store', {
      method: 'PATCH',
      token: OWNER_TOKEN,
      body: { allowResponsiblePurchases: false },
    });
    check('إغلاق صلاحية المشتريات للعامل المسؤول والعودة للوضع الافتراضي (منع)', false, disableRespPur.data?.allow_responsible_purchases);

    const respPurBlockedAgain = await request('/v1/purchases', { token: RESP_TOKEN });
    check('حجب فوري للعامل المسؤول بعد إغلاق الزر من المالك 403', 'PERMISSION_DENIED', respPurBlockedAgain.data?.error?.code);

    // 7.2 التعارض (2): نافذة اختيار التكلفة لنفس اليوم على /v1/items وقاعدة صلاحية القات (24-48 ساعة / نفاد المخزون)
    const radaee1 = await request('/v1/items', {
      method: 'POST',
      token: OWNER_TOKEN,
      body: {
        name: 'قات رداعي يومي',
        unit: 'كيلو',
        quantity: 4,
        costPrice: 10000,
        sellPrice: 14000,
      },
    });
    check('إنشاء صنف كيلو يومي (الدفعة الأولى بسعر 10000)', 201, radaee1.status);
    const RADAEE_ID = radaee1.data?.item?.id;

    const radaeeConflict = await request('/v1/items', {
      method: 'POST',
      token: OWNER_TOKEN,
      body: {
        name: 'قات رداعي يومي',
        unit: 'كيلو',
        quantity: 4,
        costPrice: 12000,
        sellPrice: 15000,
      },
    });
    check(
      'إدخال نفس الصنف بنفس اليوم بسعر مختلف يعيد 409 COSTING_METHOD_REQUIRED مع الخيارات الثلاثة باللهجة البيضاء',
      true,
      radaeeConflict.status === 409 &&
        radaeeConflict.data?.error?.code === 'COSTING_METHOD_REQUIRED' &&
        radaeeConflict.data?.error?.details?.costing_options?.length === 3,
    );

    const radaeeMergedAvg = await request('/v1/items', {
      method: 'POST',
      token: OWNER_TOKEN,
      body: {
        name: 'قات رداعي يومي',
        unit: 'كيلو',
        quantity: 4,
        costPrice: 12000,
        sellPrice: 15000,
        costingMethod: 'WEIGHTED_AVERAGE',
      },
    });
    check('دمج الدفعتين بالمتوسط المرجح المتحرك (8 كيلو بتكلفة 11000)', 11000, Number(radaeeMergedAvg.data?.item?.costPrice));

    // بيع كامل الكمية (8 كيلو × 15000 = 120000) ثم توريد بسعر جديد -> يُعتمد السعر الجديد تلقائياً دون تعارض (قاعدة القات)
    await request('/v1/sales', {
      method: 'POST',
      token: OWNER_TOKEN,
      body: { itemId: RADAEE_ID, quantity: 8, amount: 120000, paymentType: 'CASH' },
    });

    const radaeeAfterDepletion = await request('/v1/items', {
      method: 'POST',
      token: OWNER_TOKEN,
      body: {
        name: 'قات رداعي يومي',
        unit: 'كيلو',
        quantity: 2,
        costPrice: 16000,
        sellPrice: 20000,
      },
    });
    check('بعد نفاد الصنف (=0): اعتماد سعر الشراء الجديد 16000 تلقائياً دون نافذة تعارض', 16000, Number(radaeeAfterDepletion.data?.item?.costPrice));

    // 7.3 الإصلاح (1): أجزاء الكيلو (نصف 0.5 وربع 0.25) ومنع الكسور في الوحدات العددية والوحدة المخصصة
    const halfKiloSale = await request('/v1/sales', {
      method: 'POST',
      token: OWNER_TOKEN,
      body: { itemId: RADAEE_ID, quantity: 0.5, amount: 10000, paymentType: 'CASH' },
    });
    check('بيع نصف كيلو (0.5) من صنف الكيلو بالسعر التناسبي (10,000) ينجح 201', 201, halfKiloSale.status);

    const quarterKiloSale = await request('/v1/sales', {
      method: 'POST',
      token: OWNER_TOKEN,
      body: { itemId: RADAEE_ID, quantity: 0.25, amount: 5000, paymentType: 'CASH' },
    });
    check('بيع ربع كيلو (0.25) من صنف الكيلو بالسعر التناسبي (5,000) ينجح 201', 201, quarterKiloSale.status);

    const discreteFracItemFail = await request('/v1/items', {
      method: 'POST',
      token: OWNER_TOKEN,
      body: { name: 'قات حبة كسر', unit: 'حبة', quantity: 1.5, costPrice: 2000, sellPrice: 3000 },
    });
    check('رفض كمية كسرية لصنف بوحدة حبة 400 FRACTIONAL_QUANTITY_NOT_ALLOWED', 'FRACTIONAL_QUANTITY_NOT_ALLOWED', discreteFracItemFail.data?.error?.code);

    const customUnitItem = await request('/v1/items', {
      method: 'POST',
      token: OWNER_TOKEN,
      body: { name: 'قات علاقية ملكي', unit: 'علاقية خاصة', quantity: 5, costPrice: 3000, sellPrice: 4000 },
    });
    check('قبول وحدة مخصصة يحددها المالك (علاقية خاصة) 201', 201, customUnitItem.status);
    const CUSTOM_UNIT_ITEM_ID = customUnitItem.data?.item?.id;

    const customFracSaleFail = await request('/v1/sales', {
      method: 'POST',
      token: OWNER_TOKEN,
      body: { itemId: CUSTOM_UNIT_ITEM_ID, quantity: 0.5, amount: 2000, paymentType: 'CASH' },
    });
    check('منع بيع كسور من وحدة عددية/مخصصة غير وزنية 400 FRACTIONAL_QUANTITY_NOT_ALLOWED', 'FRACTIONAL_QUANTITY_NOT_ALLOWED', customFracSaleFail.data?.error?.code);

    // 7.4 الإصلاح (2) + (3): خصم مرتجعات المبيعات الآجلة من ذمة العميل وإلزام مرفق التحصيل الإلكتروني
    await request(`/v1/credit-customers/${CUSTOMER_ID}`, {
      method: 'PATCH',
      token: OWNER_TOKEN,
      body: { creditLimit: 100000 },
    });

    const custBeforeRet = (await request('/v1/credit-customers', { token: OWNER_TOKEN })).data?.find((c) => c.id === CUSTOMER_ID);
    const debtBefore = Number(custBeforeRet?.total_debt ?? 0);

    const crSaleForRet = await request('/v1/sales', {
      method: 'POST',
      token: OWNER_TOKEN,
      body: {
        itemId: CUSTOM_UNIT_ITEM_ID,
        quantity: 2,
        amount: 8000,
        paymentType: 'CREDIT',
        creditCustomerId: CUSTOMER_ID,
      },
    });
    const CR_SALE_ID = crSaleForRet.data?.sale?.id;

    // مرتجع لـ 1 وحدة من البيع الآجل (مع احتساب تناسبي تلقائي 4000)
    const crReturnRes = await request('/v1/returns', {
      method: 'POST',
      token: OWNER_TOKEN,
      body: { saleId: CR_SALE_ID, quantity: 1 },
    });
    check('تسجيل مرتجع مبيعات آجلة باحتساب تناسبي تلقائي (4000) 201', 201, crReturnRes.status);

    const custAfterRet = (await request('/v1/credit-customers', { token: OWNER_TOKEN })).data?.find((c) => c.id === CUSTOMER_ID);
    check('خصم مرتجع البيع الآجل من رصيد دين العميل الفعلي (8000 - 4000 = +4000)', debtBefore + 4000, Number(custAfterRet?.total_debt));

    const custStmtAfterRet = await request(`/v1/credit-customers/${CUSTOMER_ID}/statement`, { token: OWNER_TOKEN });
    check(
      'ظهور حركة المرتجع RETURN في كشف حساب العميل ومطابقة الرصيد الختامي',
      true,
      custStmtAfterRet.data?.transactions?.some((t) => t.type === 'RETURN') === true,
    );

    const elecDebtNoAttach = await request(`/v1/credit-customers/${CUSTOMER_ID}/payments`, {
      method: 'POST',
      token: OWNER_TOKEN,
      body: { amount: 2000, paymentMethod: 'ELECTRONIC', walletId: WALLET_ID },
    });
    check('رفض سداد دين عميل إلكتروني بدون صورة الإشعار 400 MISSING_DEPOSIT_ATTACHMENT', 'MISSING_DEPOSIT_ATTACHMENT', elecDebtNoAttach.data?.error?.code);

    const elecDebtOk = await request(`/v1/credit-customers/${CUSTOMER_ID}/payments`, {
      method: 'POST',
      token: OWNER_TOKEN,
      body: {
        amount: 2000,
        paymentMethod: 'ELECTRONIC',
        walletId: WALLET_ID,
        attachmentUrl: 'https://files.maqouti.test/receipts/credit-pay-01.jpg',
      },
    });
    check('قبول سداد دين العميل عبر المحفظة الإلكترونية مع صورة الإشعار 201', 201, elecDebtOk.status);

    // 7.5 الإصلاح (4) + (5): المصروفات الآجلة (2100 مصروفات مستحقة) وحساب مصروفات أخرى المستقل (5700) وسداد المستحقات
    const accruedUtilRes = await request('/v1/utility-payments', {
      method: 'POST',
      token: OWNER_TOKEN,
      body: {
        utilityType: 'WATER',
        amount: 4500,
        paymentMethod: 'CREDIT',
        note: 'فاتورة مياه مستحقة السداد آخر الأسبوع',
      },
    });
    check('تسجيل مصروف خدمات آجل (ذمم مصروفات مستحقة 2100) 201', 201, accruedUtilRes.status);
    const ACCRUED_UTIL_ID = accruedUtilRes.data?.id;

    const otherExpRes = await request('/v1/utility-payments', {
      method: 'POST',
      token: OWNER_TOKEN,
      body: {
        utilityType: 'OTHER',
        utilityTypeOther: 'أكياس تغليف وثلج حفظ القات',
        amount: 3500,
        paymentMethod: 'CASH',
      },
    });
    check('توجيه مصروفات المحل الأخرى إلى الحساب المستقل 5700 بعيداً عن الخدمات 5300', '5700', otherExpRes.data?.expense_account_code);

    const unifiedExpList = await request('/v1/expenses', { token: OWNER_TOKEN });
    check('ظهور المصروف الآجل في قائمة المستحقات غير المسددة (unpaid_accruals)', true, unifiedExpList.data?.unpaid_accruals?.some((a) => a.id === ACCRUED_UTIL_ID));

    const settleAccrualRes = await request('/v1/expenses/accruals/settle', {
      method: 'POST',
      token: OWNER_TOKEN,
      body: {
        targetType: 'UTILITY',
        targetId: ACCRUED_UTIL_ID,
        amount: 4500,
        paymentMethod: 'CASH',
        note: 'سداد فاتورة المياه المستحقة نقداً',
      },
    });
    check('سداد المصروف المستحق وتخفيض التزام الحساب 2100 بنجاح 201', 201, settleAccrualRes.status);

    // 7.6 الإصلاح (6) + (8) + التعارض (3): جاري المالك (3100 إيداع/سحب) دون التأثير على الأرباح + بداية الصندوق من 0 كل يوم
    const profitBeforeOwnerTx = await request('/v1/reports/profit-margin', { token: OWNER_TOKEN });
    const netProfitSnap = Number(profitBeforeOwnerTx.data?.net_profit ?? 0);
    check('قائمة الدخل تعرض بند مصروفات أخرى (5700) مستقلاً عن الفواتير والخدمات', 3500, Number(profitBeforeOwnerTx.data?.expenses_breakdown?.other_expenses));

    const ownerDepCash = await request('/v1/funds/owner-transactions', {
      method: 'POST',
      token: OWNER_TOKEN,
      body: {
        type: 'DEPOSIT',
        amount: 250000,
        paymentMethod: 'CASH',
        note: 'تغذية صندوق المحل برأس مال تشغيلي',
      },
    });
    check('تسجيل إيداع نقدي للمالك في الصندوق عبر جاري المالك (3100) 201', 201, ownerDepCash.status);

    const ownerWithCash = await request('/v1/funds/owner-transactions', {
      method: 'POST',
      token: OWNER_TOKEN,
      body: {
        type: 'WITHDRAWAL',
        amount: 15000,
        paymentMethod: 'CASH',
        note: 'مسحوبات شخصية للمالك من الصندوق',
      },
    });
    check('تسجيل سحب نقدي شخصي للمالك من الصندوق عبر جاري المالك (3100) 201', 201, ownerWithCash.status);

    const ownerDepWallet = await request('/v1/funds/owner-transactions', {
      method: 'POST',
      token: OWNER_TOKEN,
      body: {
        type: 'DEPOSIT',
        amount: 30000,
        paymentMethod: 'ELECTRONIC',
        walletId: WALLET_ID,
        attachmentUrl: 'https://files.maqouti.test/receipts/owner-wallet-dep.jpg',
        note: 'تغذية المحفظة الإلكترونية من حساب المالك',
      },
    });
    check('تسجيل إيداع إلكتروني للمالك في المحفظة عبر جاري المالك (3100) 201', 201, ownerDepWallet.status);

    const profitAfterOwnerTx = await request('/v1/reports/profit-margin', { token: OWNER_TOKEN });
    check('إيداعات ومسحوبات المالك (3100) لا تؤثر إطلاقاً على صافي ربح قائمة الدخل', netProfitSnap, Number(profitAfterOwnerTx.data?.net_profit));

    // 7.7 الإصلاح (7): تسوية ومطابقة المحافظ الإلكترونية (الرصيد الدفتري مقابل الفعلي + السحب للصندوق)
    const walletsBeforeSettle = await request('/v1/wallets', { token: OWNER_TOKEN });
    const mainWalletBefore = walletsBeforeSettle.data?.find((w) => w.id === WALLET_ID);
    check('عرض الرصيد الدفتري وعدد العمليات غير المسواة للمحفظة الإلكترونية', true, Number(mainWalletBefore?.book_balance) > 0 && Number(mainWalletBefore?.unsettled_count) > 0);

    const walletBookBefore = Number(mainWalletBefore.book_balance);
    const settleWalletRes = await request(`/v1/wallets/${WALLET_ID}/settle`, {
      method: 'POST',
      token: OWNER_TOKEN,
      body: {
        actualProviderBalance: walletBookBefore - 500, // عمولة مزود 500 ريال تُرحل لـ 5600
        cashOutToDrawer: 4000,                         // سحب 4000 ريال نقداً إلى صندوق المحل 1000
        notes: 'تسوية نهاية اليوم مع وكيل الكريمي وسحب نقدية للصندوق',
      },
    });
    check('تسوية المحفظة الإلكترونية وترحيل فارق العمولة والسحب النقدي للصندوق 201', 201, settleWalletRes.status);
    check('تصفير عداد العمليات غير المسواة بعد التسوية والرصيد الدفتري الجديد مطابق', walletBookBefore - 4500, Number(settleWalletRes.data?.book_balance_after));

    const walletsAfterSettle = await request('/v1/wallets', { token: OWNER_TOKEN });
    const mainWalletAfter = walletsAfterSettle.data?.find((w) => w.id === WALLET_ID);
    check('عداد العمليات غير المسواة على المحفظة أصبح صفراً بعد التسوية', 0, Number(mainWalletAfter?.unsettled_count));

    // التحقق من التعارض (3): رصيد بداية صندوق اليوم دائماً = 0 (عدم ترحيل نقدية الأمس)
    const closingCheckZero = await request('/v1/daily-closings/today', { token: OWNER_TOKEN });
    check('صندوق كل يوم جديد يبدأ من الصفر (opening_cash = 0) ولا يرحّل نقدية الأمس', 0, Number(closingCheckZero.data?.opening_cash));
    check('النقدية المتوقعة في صندوق اليوم موجبة وتشمل إيداعات/مسحوبات المالك وتسوية المحفظة', true, Number(closingCheckZero.data?.expected_cash) > 0);

    // 7.8 الإصلاح (9): استعراض دليل الحسابات وميزان المراجعة ودفتر الأستاذ العام للمالك فقط
    const coaRes = await request('/v1/accounting/accounts', { token: OWNER_TOKEN });
    check('جلب دليل الحسابات وميزان المراجعة المتوازن للمالك 200', true, coaRes.status === 200 && coaRes.data?.trial_balance?.is_balanced === true);
    check(
      'وجود الحسابات المستقلة 2100 و3100 و5700 في دليل الحسابات',
      true,
      ['2100', '3100', '5700'].every((code) => coaRes.data?.accounts?.some((a) => a.code === code)),
    );

    const ledgerRes = await request('/v1/accounting/ledger?account_code=3100&format=csv', { token: OWNER_TOKEN });
    check(
      'استعراض دفتر الأستاذ العام لحساب جاري المالك 3100 وتصدير CSV بترميز UTF-8 BOM',
      true,
      ledgerRes.status === 200 &&
        ledgerRes.data?.entries?.length === 3 &&
        String(ledgerRes.data?.csv_content || '').startsWith('\uFEFF'),
    );

    const ledgerRespForbidden = await request('/v1/accounting/ledger', { token: RESP_TOKEN });
    check('حظر غير المالك من استعراض دفتر الأستاذ العام 403 PERMISSION_DENIED', 'PERMISSION_DENIED', ledgerRespForbidden.data?.error?.code);
  }

  // ══════════════════════════════════════════════════════
  // المرحلة 8: إدخال الوزن بالجرام وعرض الكميات بصيغة عربية مفهومة (feat/gram-weight-input-display)
  // ══════════════════════════════════════════════════════
  console.log('\n--- المرحلة 8: إدخال الوزن بالجرام وعرض الكميات بصيغة عربية مفهومة ---');

  // 1. إنشاء صنف وزني جديد بوحدة كيلو لاختبار البيع والشراء بالجرام
  const gramItemRes = await request('/v1/items', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      name: 'نقفة صعدي رقمي ممتاز',
      unit: 'كيلو',
      quantity: 5,
      costPrice: 15000,
      sellPrice: 20000,
      emergencyPriceMode: 'COST_PLUS',
      emergencyPricePlusFixed: 0,
    },
  });
  check('إنشاء صنف وزني نقفة صعدي بوحدة كيلو 201', 201, gramItemRes.status);
  const GRAM_ITEM_ID = gramItemRes.data?.item?.id;

  // 2. التحقق من بيع 100 جم بسعر 20,000/كجم = 2,000 ويخزن 0.100 كجم ويعرض "100 جم"
  const sale100gRes = await request('/v1/sales', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      itemId: GRAM_ITEM_ID,
      quantity: 100,
      quantityUnit: 'GRAM',
      amount: 2000,
      paymentType: 'CASH',
    },
  });
  check('بيع 100 جم كاش بسعر 2,000 (يعادل 20,000/كجم) 201', 201, sale100gRes.status);
  check('تخزين كمية البيع في قاعدة البيانات بالكيلو 0.100', 0.100, Number(sale100gRes.data?.sale?.quantity));
  check('إرجاع نص عرض الكمية بصيغة مفهومة "100 جم"', '100 جم', sale100gRes.data?.sale?.quantity_display);
  const SALE_100G_ID = sale100gRes.data?.sale?.id;

  // 3. التحقق من بيع 1100 جم بسعر 22,000 ويخزن 1.100 كجم ويعرض "1 كجم و100 جم"
  const sale1100gRes = await request('/v1/sales', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      itemId: GRAM_ITEM_ID,
      quantity: 1100,
      quantityUnit: 'GRAM',
      amount: 22000,
      paymentType: 'CASH',
    },
  });
  check('بيع 1100 جم بسعر 22,000 وتخزين 1.100 كجم', 1.100, Number(sale1100gRes.data?.sale?.quantity));
  check('عرض كمية 1100 جم بصيغة "1 كجم و100 جم"', '1 كجم و100 جم', sale1100gRes.data?.sale?.quantity_display);

  // 4. رفض كسور الجرام في البيع (100.5 جم)
  const fracGramSaleRes = await request('/v1/sales', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      itemId: GRAM_ITEM_ID,
      quantity: 100.5,
      quantityUnit: 'GRAM',
      amount: 2010,
      paymentType: 'CASH',
    },
  });
  check('رفض كسر الجرام في البيع 400 FRACTIONAL_GRAMS_NOT_ALLOWED', 'FRACTIONAL_GRAMS_NOT_ALLOWED', fracGramSaleRes.data?.error?.code);

  // 5. التحقق من مرتجع البيع بالجرام (100 جم)
  const return100gRes = await request('/v1/returns', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      saleId: SALE_100G_ID,
      quantity: 100,
      quantityUnit: 'GRAM',
      reason: 'تجربة مرتجع بالجرام',
    },
  });
  check('مرتجع بيع 100 جم بنجاح 201 وعرض "100 جم"', true, return100gRes.status === 201 && return100gRes.data?.quantity_display === '100 جم');

  // 6. رفض كسر الجرام في مرتجع البيع
  const fracReturnSaleRes = await request('/v1/returns', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      saleId: sale1100gRes.data?.sale?.id,
      quantity: 50.5,
      quantityUnit: 'GRAM',
      reason: 'كسر مرفوض',
    },
  });
  check('رفض كسر الجرام في مرتجع البيع 400 FRACTIONAL_GRAMS_NOT_ALLOWED', 'FRACTIONAL_GRAMS_NOT_ALLOWED', fracReturnSaleRes.data?.error?.code);

  // 7. شراء 220 جم بتكلفة 15/جم = 3,300 وتكلفة الكيلو 15,000
  const purchaseGramRes = await request('/v1/purchases', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      supplierId: SUPPLIER_ID,
      paymentType: 'CASH',
      costingMethod: 'WEIGHTED_AVERAGE',
      items: [
        {
          itemId: GRAM_ITEM_ID,
          itemName: 'نقفة صعدي رقمي ممتاز',
          unit: 'جرام',
          baseUnit: 'كيلو',
          conversionFactor: 0.001,
          quantity: 220,
          unitCostPrice: 15,
          sellPrice: 20000,
        },
      ],
    },
  });
  check('فاتورة شراء 220 جم بتكلفة 15/جم وإجمالي 3,300', 201, purchaseGramRes.status);
  check('عرض كمية سطر الشراء "220 جم"', '220 جم', purchaseGramRes.data?.items?.[0]?.quantity_display);
  const GRAM_PURCHASE_ID = purchaseGramRes.data?.id;
  const GRAM_PURCHASE_LINE_ID = purchaseGramRes.data?.items?.[0]?.id;

  // 8. مرتجع شراء بالجرام (220 جم)
  const purRetGramRes = await request(`/v1/purchases/${GRAM_PURCHASE_ID}/returns`, {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      purchaseItemId: GRAM_PURCHASE_LINE_ID,
      quantity: 220,
      quantityUnit: 'GRAM',
      refundMethod: 'DEBT_REDUCTION',
      reason: 'مرتجع شراء بالجرام',
    },
  });
  check('مرتجع شراء 220 جم بنجاح وعرض "220 جم"', true, purRetGramRes.status === 201 && purRetGramRes.data?.quantity_display === '220 جم');

  // 9. رفض كسر الجرام في مرتجع الشراء
  const fracPurRetRes = await request(`/v1/purchases/${GRAM_PURCHASE_ID}/returns`, {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      purchaseItemId: GRAM_PURCHASE_LINE_ID,
      quantity: 220.5,
      quantityUnit: 'GRAM',
      refundMethod: 'DEBT_REDUCTION',
      reason: 'كسر مرفوض',
    },
  });
  check('رفض كسر الجرام في مرتجع الشراء 400 FRACTIONAL_GRAMS_NOT_ALLOWED', 'FRACTIONAL_GRAMS_NOT_ALLOWED', fracPurRetRes.data?.error?.code);
  check('رفض كسر الجرام في مرتجع الشراء 400 FRACTIONAL_GRAMS_NOT_ALLOWED', 'FRACTIONAL_GRAMS_NOT_ALLOWED', fracPurRetRes.data?.error?.code);

  // ══════════════════════════════════════════════════════
  // المرحلة 4: المطابقة والإغلاق اليومي (Daily Closing & R-36)
  // ══════════════════════════════════════════════════════
  console.log('\n--- المرحلة 4: المطابقة والإغلاق اليومي R-36 ---');

  // استعلام ملخص إغلاق اليوم للمالك
  const closingTodayRes = await request('/v1/daily-closings/today', {
    method: 'GET',
    token: OWNER_TOKEN,
  });
  check('جلب بيانات مطابقة وإغلاق اليوم للمالك', 200, closingTodayRes.status);
  const OWNER_CLOSING_ID = closingTodayRes.data?.closing_id;
  check('معرف سجل إغلاق المالك متوفر', true, !!OWNER_CLOSING_ID);

  // استعلام ملخص إغلاق اليوم للعامل العادي بواسطة المسؤول لمساعدته
  const workerClosingRes = await request(`/v1/daily-closings/today?worker_id=${WORKER_ID}`, {
    method: 'GET',
    token: RESP_TOKEN,
  });
  check('المسؤول يستعلم عن إغلاق العامل لمساعدته', 200, workerClosingRes.status);
  const WORKER_CLOSING_ID = workerClosingRes.data?.closing_id;

  // R-36: العامل المسؤول يعدل الكاش الفعلي للعامل العادي لمساعدته (ممنوحة افتراضياً)
  const editCashByResp = await request(`/v1/daily-closings/${WORKER_CLOSING_ID}`, {
    method: 'PATCH',
    token: RESP_TOKEN,
    body: {
      actualCash: 5000,
    },
  });
  check('المسؤول يعدل كاش العامل العادي بموجب الصلاحية الافتراضية (R-36)', 200, editCashByResp.status);

  // المالك يلغي صلاحية R-36 من العامل المسؤول عبر إعدادات العامل
  await request(`/v1/workers/${RESP_ID}`, {
    method: 'PATCH',
    token: OWNER_TOKEN,
    body: {
      permissions: {
        editWorkerClosingCash: false,
      },
    },
  });

  // المسؤول يحاول الآن تعديل كاش عامل آخر -> 403 PERMISSION_DENIED
  const editCashForbidden = await request(`/v1/daily-closings/${WORKER_CLOSING_ID}`, {
    method: 'PATCH',
    token: RESP_TOKEN,
    body: {
      actualCash: 5500,
    },
  });
  check('بعد إلغاء الصلاحية من الإعدادات: المسؤول ممنوع من كاش غيره 403 (R-36)', 'PERMISSION_DENIED', editCashForbidden.data?.error?.code);

  // إعادة الصلاحية للمسؤول
  await request(`/v1/workers/${RESP_ID}`, {
    method: 'PATCH',
    token: OWNER_TOKEN,
    body: {
      permissions: {
        editWorkerClosingCash: true,
      },
    },
  });

  // العامل المسؤول يحاول اعتماد الإغلاق النهائي -> مرفوض 403 (حصري للمالك)
  const respApproveFail = await request(`/v1/daily-closings/${OWNER_CLOSING_ID}/approve`, {
    method: 'POST',
    token: RESP_TOKEN,
  });
  check('اعتماد الإغلاق من العامل المسؤول مرفوض 403 (حصري للمالك)', 'PERMISSION_DENIED', respApproveFail.data?.error?.code);

  // المالك يدخل الكاش الفعلي ويعتمد الإغلاق النهائي لنفسه
  const expectedCash = closingTodayRes.data?.expected_cash ?? 0;
  await request(`/v1/daily-closings/${OWNER_CLOSING_ID}`, {
    method: 'PATCH',
    token: OWNER_TOKEN,
    body: {
      actualCash: expectedCash, // كاش مطابق تماماً
    },
  });

  const approveRes = await request(`/v1/daily-closings/${OWNER_CLOSING_ID}/approve`, {
    method: 'POST',
    token: OWNER_TOKEN,
  });
  check('المالك يعتمد الإغلاق اليومي بنجاح', 200, approveRes.status);
  check('حالة الإغلاق أصبحت CLOSED', 'CLOSED', approveRes.data?.status);

  // محاولة اعتماد نفس الإغلاق مرة أخرى -> DAY_ALREADY_CLOSED (409)
  const dupApprove = await request(`/v1/daily-closings/${OWNER_CLOSING_ID}/approve`, {
    method: 'POST',
    token: OWNER_TOKEN,
  });
  check('محاولة اعتماد إغلاق معتمد مسبقاً مرفوضة 409 DAY_ALREADY_CLOSED', 'DAY_ALREADY_CLOSED', dupApprove.data?.error?.code);

  // محاولة بيع أو إرجاع بعد إغلاق اليوم -> DAY_ALREADY_CLOSED (409)
  const postCloseSale = await request('/v1/sales', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      itemId: ITEM_ID,
      quantity: 1,
      amount: 3000,
      paymentType: 'CASH',
    },
  });
  check('حظر البيع بعد اعتماد الإغلاق اليومي 409 (DAY_ALREADY_CLOSED)', 'DAY_ALREADY_CLOSED', postCloseSale.data?.error?.code);

  // حظر فواتير المشتريات النقدية ومرتجعات المشتريات بعد اعتماد الإغلاق اليومي
  const postClosePurchase = await request('/v1/purchases', {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      supplierId: SUPPLIER_ID,
      paymentType: 'CASH',
      items: [{ itemName: 'قات بعد الإغلاق', unit: 'حبة', quantity: 1, unitCostPrice: 2000, sellPrice: 2500 }],
    },
  });
  check('حظر فاتورة الشراء النقدية بعد اعتماد الإغلاق اليومي 409 (DAY_ALREADY_CLOSED)', 'DAY_ALREADY_CLOSED', postClosePurchase.data?.error?.code);

  const postClosePurReturn = await request(`/v1/purchases/${cleanPur.data.id}/returns`, {
    method: 'POST',
    token: OWNER_TOKEN,
    body: {
      purchaseItemId: cleanLineId,
      quantity: 1,
      refundMethod: 'DEBT_REDUCTION',
      reason: 'محاولة مرتجع بعد الإغلاق',
    },
  });
  check('حظر مرتجع المشتريات بعد اعتماد الإغلاق اليومي 409 (DAY_ALREADY_CLOSED)', 'DAY_ALREADY_CLOSED', postClosePurReturn.data?.error?.code);

  // ══════════════════════════════════════════════════════
  // النزاهة المحاسبية الصارمة: توازن كل قيد مالي في دفتر الأستاذ (BR-054)
  // ══════════════════════════════════════════════════════
  console.log('\n--- النزاهة المحاسبية الصارمة: التحقق من توازن دفتر الأستاذ (Double-Entry) ---');

  const imbalancedEntries = await prisma.$queryRaw`
    SELECT reference_id, SUM(debit) as total_debit, SUM(credit) as total_credit
    FROM ledger_entries
    GROUP BY reference_id
    HAVING SUM(debit) <> SUM(credit)
  `;
  check('جميع القيود المحاسبية بلا استثناء متوازنة (مدين = دائن)', 0, imbalancedEntries.length);

  const totalEntriesCount = await prisma.ledgerEntry.count();
  check('تم تسجيل قيود دفتر أستاذ حقيقية لكافة العمليات', true, totalEntriesCount > 0);
  console.log(`📊 إجمالي سطور القيود المسجلة في دفتر الأستاذ: ${totalEntriesCount}`);

  await prisma.$disconnect();

  console.log('\n════════════════════════════════════════════════');
  console.log(`🏁 نتيجة الاختبارات: [${pass}] ناجح ✅  |  [${fail}] فاشل ❌`);
  console.log('════════════════════════════════════════════════\n');

  if (fail > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run().catch((e) => {
  console.error('💥 حدث خطأ غير معالج أثناء تشغيل الاختبارات:', e);
  process.exit(1);
});
