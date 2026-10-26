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
