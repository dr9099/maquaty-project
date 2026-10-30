# API_SPEC.md — مَقوتي

مرجع: `DATABASE_DESIGN.md`, `SCREEN_SPEC.md`, `06-user-roles-permissions.md`.

Base URL (مثال): `https://api.maqouti.app/v1`

## اصطلاحات عامة
- كل الاستجابات JSON، ترميز `UTF-8`.
- المصادقة: `Authorization: Bearer <JWT>` لكل Endpoint ما عدا `POST /auth/login` و`POST /auth/register-store-owner`.
- `role` داخل الـ Token: `STORE_OWNER` أو `WORKER` أو `PLATFORM_ADMIN`، بالإضافة إلى `store_owner_id` (و`worker_id` و`is_responsible` إن كان عاملاً).
- تسلسل التحقق الإلزامي لكل Endpoint: `Authentication → Authorization → Input Validation → Business Rules → Database Operation → Audit Log`.
- رموز الحالة: `200` نجاح، `201` إنشاء ناجح، `400` خطأ تحقق مدخلات، `401` غير مصادَق، `403` غير مصرَّح، `404` غير موجود، `409` تعارض، `423` مقفل، `500` خطأ خادم.
- شكل خطأ موحّد:
```json
{
  "error": {
    "code": "CREDIT_LIMIT_EXCEEDED",
    "message": "تجاوز المبلغ سقف ائتمان العميل المسموح.",
    "details": { "available_credit": 2000 }
  }
}
```

---

## 1. المصادقة — Auth

### `POST /auth/register-store-owner`
إنشاء حساب مالك متجر جديد.
**Auth:** لا يتطلب.
**Request:**
```json
{
  "full_name": "محمد أحمد",
  "store_name": "مقوت الصباحي",
  "phone": "777123456",
  "password": "********",
  "password_confirmation": "********",
  "device_fingerprint": "DEVICE-XYZ-..."
}
```
**Business Logic:** `phone` فريد عالمياً؛ فحص `device_fingerprint` مقابل `devices.trial_consumed` — إن كان الجهاز استهلك تجربة سابقة، يُرفض منح تجربة جديدة. إنشاء `store_owners` بحالة `TRIAL`، `trial_sales_used=0`، `max_workers_allowed=0` (رصيد العمال العاديين يُمنح لاحقاً من Admin Portal — R-33).
**Response 201:** بيانات الحساب + `access_token` + `refresh_token`.
**Errors:** `400`, `409 PHONE_ALREADY_EXISTS`, `403 DEVICE_TRIAL_ALREADY_CONSUMED`.

### `POST /auth/login`
تسجيل دخول (مالك أو عامل).
**Request:** `{ "phone": "...", "password": "...", "device_fingerprint": "..." }`
**Business Logic:** يتحقق أولاً من `password_hash`؛ إن فشلت ولم يكن الحساب عاملاً، يتحقق من `temp_password_hash` (إن وُجدت، غير منتهية 24 ساعة، غير مستخدمة).
**Response 200 (دخول عادي):** `{ "role": "STORE_OWNER|WORKER", "access_token": "...", "refresh_token": "...", "account_status": "ACTIVE|TRIAL|..." }`
**Response 200 (دخول بكلمة مرور مؤقتة):** `{ "must_change_password": true, "temp_access_token": "..." }`
**Errors:** `401 INVALID_CREDENTIALS`, `423 ACCOUNT_LOCKED` — كود موحّد لكل حالات الحساب، مع `reason` في جسم الخطأ: `WORKER_SUSPENDED` (يعرض شاشة 21 «تواصل مع المالك») أو `TRIAL_EXPIRED` أو `SUBSCRIPTION_EXPIRED` (يعرضان شاشة 24) — انظر `14-validation-error-handling.md`.

### `POST /auth/set-new-password`
إكمال تدفق كلمة المرور المؤقتة. **Auth:** `temp_access_token` فقط.
**Request:** `{ "new_password": "...", "new_password_confirmation": "..." }`
**Business Logic:** تحديث `password_hash`، إبطال `temp_password_hash`، `must_change_password=false`، إصدار توكنات كاملة.
**Response 200:** `{ "access_token": "...", "refresh_token": "..." }`

### `POST /auth/refresh`
تجديد `access_token` عبر `refresh_token`.

### `POST /auth/logout`
إبطال الجلسة الحالية (إبطال `refresh_token` في `refresh_sessions`).

### `POST /auth/admin/login`
دخول Platform Admin إلى بوابة الإدارة (مسار منفصل حصراً — لا يستخدم `/auth/login`).
**Request:** `{ "phone": "...", "password": "..." }`
**Response 200:** `{ "mfa_required": true, "mfa_challenge_token": "..." }` — لا تُصدر توكنات نهائية قبل إتمام MFA.
**Errors:** `401 INVALID_CREDENTIALS`.

### `POST /auth/admin/mfa/verify`
تحقق MFA (إلزامي — 13-auth) وإصدار توكنات الأدمن.
**Request:** `{ "mfa_challenge_token": "...", "code": "123456" }`
**Response 200:** `{ "role": "PLATFORM_ADMIN", "access_token": "...", "refresh_token": "..." }` — مدة الجلسة من `ADMIN_JWT_*` في `21-environment-configuration.md` (أقصر من جلسات المتجر).
**Errors:** `401 INVALID_MFA_CODE`, `419 MFA_CHALLENGE_EXPIRED`.

---

## 2. إدارة العمال — Workers

### `GET /workers`
قائمة عمال المالك. **Auth:** `STORE_OWNER`.
**Response 200:** `[{ id, full_name, phone, status, is_responsible, permissions, last_login_at }]`

### `POST /workers`
إنشاء عامل جديد. **Auth:** `STORE_OWNER`.
**Request:**
```json
{
  "full_name": "أمين صالح",
  "phone": "222111777",
  "password": "********",
  "password_confirmation": "********",
  "permissions": {
    "show_cost_price": false,
    "show_sell_prices_inventory": false,
    "damaged_goods_entry": true,
    "reports_access": false,
    "enter_own_advance": true
  }
}
```
**Business Logic:** تحقق فريدية `phone` عالمياً. إن كان العامل الجديد عادياً (غير مسؤول): يتطلب رصيد موافقات — `عدد العمال العاديين غير المحذوفين (نشط أو موقوف) < max_workers_allowed` — وإلا يُرفض إنشاؤه (R-33). العامل المسؤول (`is_responsible=true`) يُنشأ دون أي رصيد أو موافقة إدارية (R-01).
**Response 201:** بيانات العامل المُنشأ.
**Errors:** `409 PHONE_ALREADY_EXISTS`, `403 WORKER_LIMIT_REACHED` (لا رصيد موافقات كافٍ — يوجَّه المالك للتواصل مع App Owner).

### `GET /workers/{id}`
تفاصيل عامل. **Auth:** `STORE_OWNER` (ملكية إلزامية).

### `PATCH /workers/{id}`
تعديل بيانات/صلاحيات عامل. **Auth:** `STORE_OWNER`.

### `PATCH /workers/{id}/password`
تغيير كلمة مرور عامل من المالك. **Auth:** `STORE_OWNER`.
**Request:** `{ "new_password": "...", "new_password_confirmation": "..." }`

### `PATCH /workers/{id}/suspend`
تفعيل/إلغاء إيقاف مؤقت. **Auth:** `STORE_OWNER`.
**Request:** `{ "suspended": true|false }`

### `DELETE /workers/{id}`
حذف حساب عامل. **Auth:** `STORE_OWNER`.
**Response 200:** `{ "deleted": true }`

### `POST /workers/{id}/promote-responsible`
ترقية عامل كـ"العامل المسؤول" الوحيد. **Auth:** `STORE_OWNER`.
**Business Logic:** إن وُجد عامل مسؤول آخر حالياً، يتطلب `{ "confirm_replace": true }` وإلا يُرجع `409 RESPONSIBLE_WORKER_EXISTS` مع بيانات العامل الحالي. عند التأكيد: عملية ذرّية (إلغاء القديم + تفعيل الجديد).
**Response 200:** `{ "worker_id": "...", "is_responsible": true }`

### `POST /workers/{id}/demote-responsible`
إلغاء صفة "مسؤول" عن عامل. **Auth:** `STORE_OWNER`.

### `GET /managed-workers`
قائمة كل عمال المتجر. **Auth:** `WORKER` حيث `is_responsible=true` فقط.

### `GET /managed-workers/{worker_id}/sales-summary?date=`
ملخص مبيعات عامل محدد ليوم معيّن. **Auth:** العامل المسؤول فقط.

---

## 3. الأصناف والمخزون — Items / Inventory

### `GET /items`
جدول أصناف اليوم. **Auth:** `STORE_OWNER`.

### `POST /items`
إضافة صنف جديد. **Auth:** `STORE_OWNER`.
**Request:**
```json
{
  "name": "شامي", "unit": "كيلو", "quantity": 20,
  "cost_price": 2500, "sell_price": 3000,
  "emergency_price_mode": "COST_PLUS",
  "emergency_price_plus_fixed": 200
}
```

### `PATCH /items/{id}`
تعديل صنف (سعر/كمية/سياسة البيع الاضطراري).

### `DELETE /items/{id}`
حذف صنف.

### `GET /inventory?search=`
عرض المخزون الحالي. **Auth:** `STORE_OWNER | WORKER`.
**حماية سعر التكلفة:** حقل `cost_price` لا يُعاد لأي Worker من الخادم إطلاقاً في أي Endpoint (حماية خادمية أساسية). صلاحية `show_cost_price` تبقى الزر بيد المالك للتحكم بإظهار/إخفاء سعر التكلفة في أي شاشة أو حقل — حالية أو مستقبلية — يعرضه النظام للعامل.
**Response (للمالك):** `[{ "item_id": "...", "name": "شامي", "unit": "كيلو", "remaining_qty": 14, "remaining_value": 42000 }]`
**Response (لعامل بدون `show_sell_prices_inventory`):** يُحذف حقل `remaining_value` من جهة الخادم نفسه.

---

## 4. البيع — Sales

### `POST /sales`
تنفيذ عملية بيع. **Auth:** `STORE_OWNER | WORKER`.
**Request:**
```json
{
  "item_id": "uuid",
  "quantity": 2,
  "quantity_unit": "KILO | GRAM (اختياري، الافتراضي KILO للحفاظ على التوافق الرجعي)",
  "amount": 6000,
  "payment_type": "CASH | ELECTRONIC | CREDIT",
  "wallet_id": "uuid (إلزامي إذا ELECTRONIC)",
  "deposit_attachment_url": "... (إلزامي إذا ELECTRONIC)",
  "credit_customer_id": "uuid (إلزامي إذا CREDIT)",
  "is_emergency_sale": false,
  "emergency_override_price": null,
  "emergency_reason": null
}
```
**Business Logic بالترتيب:**
1. إن `payment_type=CREDIT` والطالب عامل بدون `is_responsible` → `403 PERMISSION_DENIED`.
2. فحص وحدة الإدخال: إذا تم إرسال `quantity_unit=GRAM` على صنف وزني (كيلو)، يُلزم أن تكون الكمية بالجرام عدداً صحيحاً دون أي كسور (`Math.round(quantity) === quantity`) وإلا يُرفض بـ `400 FRACTIONAL_GRAMS_NOT_ALLOWED` لأن أصغر وحدة مادية هي 1 جرام صحيح. وتُحوّل الكمية تلقائياً إلى كيلو بقسمتها على 1000 للتخزين الموحد (`0.100` كجم). أما الأصناف غير الوزنية (حبة، ربطة، حزمة) فلا يقبل معها `GRAM`.
3. قفل صف `items` (`SELECT ... FOR UPDATE`) ضمن معاملة ذرّية، ثم فحص الكمية المتوفرة → وإلا `409 INSUFFICIENT_STOCK`.
4. إن `is_emergency_sale=true`: فحص `emergency_reason` غير فارغ، وفحص `emergency_override_price` يحترم `items.emergency_price_mode` (الحد الأدنى والأقصى كلاهما عند تحديدهما، حتى لو ترك المالك الحد الأدنى فارغاً في النمط المفتوح) → وإلا `400`.
5. إن `CREDIT`: فحص سقف الائتمان (Hard Block) → وإلا `409 CREDIT_LIMIT_EXCEEDED`.
6. خصم الكمية من `items.quantity` (ضمن نفس القفل).
7. إنشاء سجل `sales` متضمناً `quantity_display` بصيغة عربية مفهومة (مثل "100 جم"، "1 كجم"، "1 كجم و100 جم").
8. إنشاء قيود `ledger_entries` (بيع عادي + قيد خسارة منفصل إن `price_difference_loss > 0`).
9. زيادة `store_owners.trial_sales_used` بمقدار 1 طالما `trial_sales_used < trial_sales_limit` (شرط مستقل عن الحالة — يشمل `TRIAL` و`TRIAL_WARNING`).
**Response 201:** سجل البيع الكامل مع `quantity_display`.
**Errors:** `403 PERMISSION_DENIED`, `409 INSUFFICIENT_STOCK`, `409 CREDIT_LIMIT_EXCEEDED`, `400 FRACTIONAL_GRAMS_NOT_ALLOWED`, `400 MISSING_DEPOSIT_ATTACHMENT`, `400 EMERGENCY_REASON_REQUIRED`, `400 EMERGENCY_PRICE_BELOW_MINIMUM`, `400 EMERGENCY_PRICE_ABOVE_MAXIMUM`, `423 ACCOUNT_LOCKED`.

### `GET /sales/summary-by-item?date=`
للمالك: مجمّع لكل العمال مع `quantity_display`. للعامل: عملياته فقط. **Auth:** `STORE_OWNER | WORKER`.

### `GET /sales/log?date=&worker_id=`
`worker_id` اختياري ومتاح فقط لطلب المالك، ويعيد `quantity_display` لكل عملية. **Auth:** `STORE_OWNER | WORKER`.

### `POST /returns`
تسجيل مرتجع. **Auth:** `STORE_OWNER | WORKER`. عامل يستطيع تسجيل مرتجع فقط لعملية `sales.worker_id` يطابق هويته هو؛ المالك لأي عملية. يُعيد الكمية للمخزون تلقائياً وينشئ قيداً عكسياً. يدعم `quantity_unit: "KILO" | "GRAM"` ويرفض كسور الجرام بـ `400 FRACTIONAL_GRAMS_NOT_ALLOWED`. يعيد `quantity_display` بصيغة مفهومة.
**قيد زمني صارم (R-20):** المرتجع مسموح حصراً لعملية بيع من **نفس اليوم الحالي** وقبل اعتماد إغلاق ذلك اليوم — بعد مرور يوم البيع أو اعتماده يُرفض المرتجع قطعياً (طبيعة القات).
**مدخل الواجهة:** نافذة مرتجع تُفتح من الضغط على عملية بيع في شاشة `OPERATIONS_LOG` (تظهر لعمليات اليوم فقط).
**Errors:** `403 NOT_OWN_SALE`, `404`, `400 RETURN_QUANTITY_EXCEEDED` (كمية مرتجعة أكبر من المباع), `400 FRACTIONAL_GRAMS_NOT_ALLOWED`, `400 RETURN_DAY_PASSED` (عملية ليوم سابق), `409 DAY_ALREADY_CLOSED`.

---

## 5. المحافظ الإلكترونية — Wallets

### `GET /wallets`
**Auth:** `STORE_OWNER | WORKER(is_responsible=true)` حصراً.
### `GET /wallets/summary?wallet_ids=&range_type=(ALL|SINGLE_DAY|BETWEEN)&date=&date_from=&date_to=`
**Auth:** `STORE_OWNER | WORKER(is_responsible=true)` حصراً.

---

## 6. التالف — Damaged Goods

### `POST /damaged-goods`
**Auth:** `STORE_OWNER | WORKER` (مشروط بـ `damaged_goods_entry`).
**Request:** `{ "item_id": "...", "quantity": 0.5, "is_damaged": true, "reason": "ذبول بسبب الحرارة", "photo_url": "..." }`

### `GET /damaged-goods?date=`
تقرير التالف (المالك فقط).

---

## 7. الآجل — Credit

**Auth لكل Endpoints هذا القسم:** `STORE_OWNER | WORKER(is_responsible=true)` حصراً.
**سقف الائتمان:** يحدده المالك أو العامل المسؤول عند إنشاء العميل، ويعدّله كلاهما لاحقاً.

### `GET /credit-customers?search=`
### `POST /credit-customers`
### `PATCH /credit-customers/{id}`
تعديل بيانات عميل آجل (الاسم، الهاتف، سقف الائتمان). **Request:** `{ "full_name": "...", "phone": "...", "credit_limit": 5000 }` (كل الحقول اختيارية).
### `GET /credit-customers/{id}/debts`
### `GET /credit-customers/{id}/payments`
### `POST /credit-customers/{id}/payments`
**Request:** `{ "amount": 2000, "payment_method": "CASH|ELECTRONIC", "wallet_id": "..." }`
### `GET /credit-customers/{id}/statement?format=pdf|excel`

---

## 8. المصروفات — Expenses

### `GET /employees`
قائمة الموظفين (أجور). **Auth:** `STORE_OWNER`.
### `POST /employees`
إضافة موظف. **Auth:** `STORE_OWNER`.
### `POST /employees/{id}/advances`
سلفة موظف. **Auth:** `STORE_OWNER`.
### `POST /employees/{id}/payments`
دفع مستحقات موظف. **Auth:** `STORE_OWNER`.
### `GET /employees/{id}/statement`
كشف حساب موظف. **Auth:** `STORE_OWNER`.
### `GET /rent-records`
**Auth:** `STORE_OWNER`.
### `POST /rent-records`
**Auth:** `STORE_OWNER`.
### `GET /utility-payments`
**Auth:** `STORE_OWNER`.
### `POST /utility-payments`
**Auth:** `STORE_OWNER`.
### `POST /worker-advances`
تسجيل سلفة عامل لنفسه. **Auth:** `WORKER(is_responsible=true)` مشروط بتفعيل `enter_own_advance` من المالك — يدخل شاشة المصروفات (تبويب «سلفتي» فقط) ويسجل سلفته هو حصراً (R-10). سلفة أي عامل عادي أو موظف يُدخلها المالك من تبويب «الأجور» (`POST /employees/{id}/advances`). `worker_id` يُستخرج من هوية الطالب تلقائياً.

---

## 9. المطابقة والإغلاق اليومي — Daily Closing

### `GET /daily-closings/today?worker_id=`
شاشة المطابقة؛ `worker_id` اختياري، افتراضي = هوية الطالب. **Auth:** `STORE_OWNER | WORKER` (العامل يطّلع على إغلاقه هو فقط؛ المالك على أي إغلاق تابع له).

### `PATCH /daily-closings/{id}`
إدخال/تعديل الكاش الفعلي قبل الاعتماد. **Auth:** `STORE_OWNER` (لنفسه أو لأي عامل تابع له) أو `WORKER` (لإغلاقه هو فقط). يُرفض التعديل بعد الاعتماد بـ `409 DAY_ALREADY_CLOSED`.
**Errors:** `409 DAY_ALREADY_CLOSED`.

### `POST /daily-closings/{id}/approve`
**Auth:** `STORE_OWNER` فقط (لاعتماد نفسه أو أي عامل تابع له).
**Business Logic:** `status=CLOSED`، ربط العمليات بـ `daily_closing_id`، منع أي تعديل لاحق، إنشاء قيود الإقفال.
**Errors:** `409 ALREADY_CLOSED`.

---

## 10. الأموال والتقارير — Funds / Reports

**Auth:** `STORE_OWNER | WORKER(is_responsible=true)`.

### `GET /funds/summary?date=`
### `GET /reports?type=sales|purchases|expenses|withdrawals&date_from=&date_to=&format=pdf|excel|json`
العامل يحتاج `reports_access`.
**مصادر البيانات لكل نوع:**
- `sales` (مبيعات): من جدول `sales`.
- `purchases` (مشتريات): من إدخالات أصناف اليوم (`items` — الكمية المدخلة × `cost_price`).
- `expenses` (مصاريف): من الإيجارات والخدمات وأجور الموظفين (`rent_records`, `utility_payments`, employees payments).
- `withdrawals` (الخرج/المسحوبات): كل ما خرج من الصندوق كسلف ومسحوبات غير مباشرة — `worker_advances` وسلف الموظفين (`employees` advances).

---

## 11. العمليات المرفوضة — Rejected Transactions

**Auth:** `STORE_OWNER` فقط. تُحفظ هنا حصراً عمليات البيع المرفوضة عند المزامنة بسبب `CREDIT_LIMIT_EXCEEDED` أو `INSUFFICIENT_STOCK` (R-30) — أي فشل آخر يُعاد للجهاز في `processed_operations` دون حفظ إداري.

### `GET /rejected-transactions?status=PENDING`
### `POST /rejected-transactions/{id}/resolve`
**Request:** `{ "resolution_action": "POST_AS_LOSS | ADD_CREDIT | APPROVE_ADJUSTED_QTY | APPROVE_NEGATIVE_STOCK | FINAL_REJECT", "adjusted_quantity": 1.5 }`
**خيارات كل سبب:**
- `CREDIT_LIMIT_EXCEEDED` (تجاوز سقف الائتمان): `POST_AS_LOSS` (ترحيل كخسائر) أو `ADD_CREDIT` (قيد كدين على العميل).
- `INSUFFICIENT_STOCK` (نقص المخزون): `APPROVE_ADJUSTED_QTY` (تعديل الكمية فوراً إلى الكمية المتوفرة والموافقة — مع `adjusted_quantity`) أو `APPROVE_NEGATIVE_STOCK` (قبول البيع كما ورد مع جعل رصيد الصنف سالباً) أو `FINAL_REJECT` (رفض نهائي دون تنفيذ).
**Business Logic:** يتحقق من مطابقة الخيار لسبب الرفض، يُنشئ القيد المناسب، يُغلق السجل ويسجّل في `audit_log`.
**Errors:** `400 DISALLOWED_RESOLUTION_ACTION` (خيار غير مسموح لسبب الرفض المحدد), `404`.

---

## 12. النسخ الاحتياطي — Backup

**الوصول:** المالك + العامل المسؤول، وحصراً لحسابات `status=ACTIVE`. أي استدعاء من حساب تجريبي يُرجع `403 SUBSCRIPTION_REQUIRED`.

التصدير/الاستيراد الأساسي محلي بالكامل على الجهاز (ملف `.db`)، مع تضمين `tenant_binding_hash` يُتحقق منه عند أي استيراد محلي قبل القبول — وإلا `403 BACKUP_TENANT_MISMATCH`.

### `POST /backups/cloud`
رفع نسخة احتياطية سحابية. **Request:** `multipart/form-data` يحتوي ملف `.db`.
**Response 201:** `{ "id": "uuid", "created_at": "...", "size_bytes": 2516582 }`

### `GET /backups/cloud`
عرض آخر نسخة سحابية.

### `POST /backups/cloud/{id}/restore`
**Business Logic:** يتحقق `tenant_binding_hash` → وإلا `403 BACKUP_TENANT_MISMATCH`، ثم تأكيد صارم.

---

## 13. بوابة App Owner — Admin APIs

كل الـ Endpoints هنا تتطلب `Auth: PLATFORM_ADMIN` + MFA لحظي للإجراءات الحساسة.

### الاشتراكات
- `GET /admin/store-owners?phone=`
- `GET /admin/store-owners/{id}`
- `GET /admin/subscription-plans` / `POST /admin/subscription-plans` / `PATCH /admin/subscription-plans/{id}` (تعديل بيانات الباقة أو تعطيلها عبر `is_active`)
- `POST /admin/store-owners/{id}/subscriptions` — `{ "plan_id": "...", "custom_days": null, "agreed_amount": null }` (`agreed_amount` اختياري: المبلغ الفعلي المتفق عليه بعد أي خصم، للسجل والتدقيق فقط — لا خصم آلي R-09)
- `PATCH /admin/subscriptions/{id}`
- `PATCH /admin/store-owners/{id}/status`
- `PATCH /admin/store-owners/{id}/worker-limit` — `{ "max_workers_allowed": 5 }` — **هذه هي آلية الموافقة على العمال العاديين (R-33):** كل زيادة في الرصيد = موافقة على إنشاء عامل عادي إضافي
- `POST /admin/store-owners/{id}/generate-temp-password` — **Response:** `{ "temp_password": "Xk9#mPq2", "expires_at": "..." }` (تُعرض مرة واحدة فقط)

### الأجهزة
- `GET /admin/devices?store_owner_id=`
- `PATCH /admin/devices/{id}/block` / `unblock`

### الرسائل/الإعلانات/العروض
- `GET /admin/broadcasts` / `POST /admin/broadcasts` / `PATCH /admin/broadcasts/{id}` / `DELETE /admin/broadcasts/{id}`

### سجل التدقيق
- `GET /admin/audit-log?actor_id=&target_type=&target_id=&date_from=&date_to=&action_type=`

### الإعدادات
- `GET /admin/settings` / `PATCH /admin/settings`

---

## 14. مزامنة الأجهزة — Device Sync & Broadcasts Pull

### `POST /device/sync`
نقطة المزامنة الرئيسية (مرتين يومياً على الأقل — R-26) وإجبار تحديث التطبيق.
**Request:** `{ "device_fingerprint": "...", "last_sync_version": 142, "pending_local_operations": [ ... ] }`
**Response:** `{ "new_sync_version": 150, "account_status": "ACTIVE", "min_app_version": "1.4.0", "processed_operations": [ { "client_op_id": "...", "status": "ACCEPTED" | "REJECTED", "error_code": "..." (عند الرفض) } ], "server_updates": { "items": [...], "workers": [...], "subscription": {...} } }`
**ملاحظات:**
- منع التكرار (Idempotency): كل عملية واردة تُدوَّن أولاً في `sync_operations` بفهرس فريد `(store_owner_id, client_op_id)` — إعادة إرسال نفس `client_op_id` تُرجع نتيجتها المحفوظة دون إعادة تنفيذ.
- عمليات البيع المرفوضة بسبب `CREDIT_LIMIT_EXCEEDED` أو `INSUFFICIENT_STOCK` تُحفظ إضافياً في `rejected_transactions` للمعالجة من المالك (شاشة 28)، وتبقى ظاهرة للجهاز بحالة `REJECTED` في `processed_operations`. أي فشل آخر يُعاد للجهاز للمعالجة المحلية فقط.
- `min_app_version`: إن كانت نسخة التطبيق أقدم، يمنع الاستخدام ويطلب التحديث (إجبار تحديث عن بُعد).
**Errors:** `423 ACCOUNT_LOCKED`, `403 DEVICE_BLOCKED`.

### `POST /device/broadcasts/pull`
سحب الرسائل/الإعلانات/العروض السارية.
**Request:** `{ "device_fingerprint": "...", "pairing_status": "TRIAL|TRIAL_WARNING|ACTIVE|EXPIRED" }`
رسائل شريحة التجربة المنتهية (`TRIAL_EXPIRED`) تُعرض على شاشة القفل `ACCOUNT_LOCKED` وحدها.

### `POST /device/broadcasts/{id}/ack`
**Request:** `{ "ack_type": "VIEW|CLICK", "device_fingerprint": "..." }`

---

## 15. لوحة الملخص — Dashboard

### `POST /dashboard/summary`
لوحة ملخص الشاشة الرئيسية عبر الخادم — تُجمّع أرقام العمليات بين تطبيق المالك وتطبيقات العمال عند المزامنة (مهمة خاصة حين يبيع العمال من أجهزتهم، فترى الشاشة الرئيسية أرقام المتجر كاملاً دون انتظار).
**Auth:** `STORE_OWNER | WORKER`.
**Business Logic:** للمالك والعامل المسؤول: إجماليات المتجر المُجمَّعة لكل العمال (الصندوق، مبيعات اليوم، حالة اليوم). للعامل العادي: أرقامه هو فقط (عزل Tenant كامل). تعمل بجانب الحساب المحلي Offline — الخادم هو المصدر الموحّد عند المزامنة.
**Request:** `{ "device_fingerprint": "..." }`
**Response 200:** `{ "today_status": "OPEN|CLOSED", "cash_today": 42000, "sales_today_total": 96000, "sales_today_count": 31, "currency": "YER", "currency_symbol": "ر.ي" }` (وللمالك إضافياً: `purchases_today_total`, `purchases_today_count`, `supplier_payables_total`).

---

## 16. إعدادات المتجر والموردون والمشتريات (R-38..R-47)

### 16.1 إعدادات العملة الموحدة والتكلفة وصلاحيات المشتريات — `/v1/settings/store`
- `GET /v1/settings/store` (`STORE_OWNER | WORKER`): يُرجع رمز العملة الموحدة للمتجر؛ وحالة صلاحية المشتريات للعامل المسؤول (`allow_responsible_purchases`، افتراضياً `false`)؛ وللمالك إضافياً حالة قفل العملة (`currency_locked`)، العملات المدعومة (`YER`, `SAR`, `USD`)، وطريقة التكلفة الافتراضية والخيارات الثلاثة بالعربية.
- `PATCH /v1/settings/store` (`STORE_OWNER` فقط): تحديث `currency` (قبل أي حركة مالية فقط، وإلا `409 CURRENCY_CHANGE_LOCKED`)، `defaultCostingMethod` (`WEIGHTED_AVERAGE | LAST_PRICE | FIFO`)، `allowResponsiblePurchases` (`true|false` للسماح/المنع للعامل المسؤول R-38)، و`storeName`.

### 16.2 إدارة الموردين وسدادهم — `/v1/suppliers` (`STORE_OWNER` دائماً، أو العامل المسؤول عند تفعيل `allow_responsible_purchases`)
- `GET /v1/suppliers?search=&status=&only_with_debt=&limit=25&offset=0`: قائمة مرقمة للموردين مع `total_payables`.
- `POST /v1/suppliers`: إنشاء مورد (مع `openingBalance` اختياري يُنشئ قيد `SUPPLIER_OPENING_BALANCE`؛ أخطاء: `409 SUPPLIER_DUPLICATE`).
- `GET /v1/suppliers/{id}`, `PATCH /v1/suppliers/{id}`, `DELETE /v1/suppliers/{id}` (حذف ناعم محمي: `409 SUPPLIER_HAS_BALANCE` إن كان الرصيد غير صفري).
- `POST /v1/suppliers/{id}/payments` و`GET /v1/suppliers/{id}/payments`: تسجيل وعرض دفعات السداد نقداً أو عبر محفظة إلكترونية مع تخصيص لفاتورة محددة أو على الحساب بأسبقية FIFO.
- `GET /v1/suppliers/{id}/statement?date_from=&date_to=&format=json|csv|excel`: كشف حساب تراكمي مع تصدير CSV بترميز UTF-8 BOM.
- `GET /v1/suppliers/{id}/aging`: تقرير أعمار الديون (`0-30`, `31-60`, `61-90`, `90+` يوم).

### 16.3 فواتير المشتريات ومحرك التكلفة والمرتجعات — `/v1/purchases` (`STORE_OWNER` دائماً، أو العامل المسؤول عند تفعيل `allow_responsible_purchases`)
- `POST /v1/purchases/preview-costing`: فحص استباقي لتعارض سعر نفس اليوم للأصناف المتبقية (`quantity > 0`) وإرجاع الخيارات الثلاثة بالعربية ومعاينة المتوسط المرجح.
- `GET /v1/purchases`: قائمة فواتير الشراء بفلترة (`supplier_id`, `status`, `payment_type`, `date_from`, `date_to`, `search`, `limit`, `offset`).
- `POST /v1/purchases`: إنشاء فاتورة شراء (`DRAFT` أو `POSTED`) حتى **200 بند** (`400 INVOICE_LINES_LIMIT_EXCEEDED`) بدعم تعدد الوحدات (`conversionFactor`)، الضرائب والخصومات، الدفع النقدي/الإلكتروني/الآجل/الجزئي، واختيار طريقة التكلفة (`409 COSTING_METHOD_REQUIRED` عند طلب التنبيه دون اختيار).
- `GET /v1/purchases/{id}`, `PATCH /v1/purchases/{id}` (للمسودات فقط؛ وإلا `409 INVOICE_NOT_EDITABLE`).
- `POST /v1/purchases/{id}/post`: اعتماد المسودة وترحيلها ذرّياً للمخزون والمحاسبة.
- `POST /v1/purchases/{id}/void`: إلغاء فاتورة معتمدة بقيد عكسي (`PURCHASE_VOID`) بشرط عدم وجود سداد أو مرتجع أو مبيعات أو إغلاق يومي (`409 INVOICE_CANNOT_VOID`).
- `POST /v1/purchases/{id}/returns` و`GET /v1/purchases/{id}/returns`: تسجيل وعرض مرتجعات المشتريات (`DEBT_REDUCTION | CASH_REFUND`) قبل إغلاق اليوم وبشرط عدم حدوث أي بيع على الصنف (`409 PURCHASE_ITEM_HAS_SALES`).

### 16.4 تقارير المشتريات والذمم الدائنة وهامش الربح
- `GET /v1/reports?type=purchases`: صافي المشتريات الفعلية من الفواتير المعتمدة مطروحاً منها مرتجعات الشراء (للمالك، أو المسؤول عند تفعيل الصلاحية).
- `GET /v1/reports/purchases-by-supplier` (للمالك، أو المسؤول عند تفعيل الصلاحية).
- `GET /v1/reports/purchases-by-item` (للمالك، أو المسؤول عند تفعيل الصلاحية).
- `GET /v1/reports/supplier-payables` (للمالك، أو المسؤول عند تفعيل الصلاحية).
- `GET /v1/reports/profit-margin` (`STORE_OWNER` حصراً): قائمة الدخل وهامش الربح مع تفصيل المصروفات التشغيلية متضمنة الحساب المستقل `5700 مصروفات أخرى` وفلترة الفترة.

### 16.5 جاري المالك وتسوية المحافظ والمصروفات المستحقة ودفتر الأستاذ (R-45..R-47)
- **جاري المالك (`3100` - `STORE_OWNER` حصراً):**
  - `GET /v1/funds/owner-transactions?date_from=&date_to=`: استعراض حركات إيداع ومسحوبات المالك.
  - `POST /v1/funds/owner-transactions`: تسجيل إيداع رأسمالي (`DEPOSIT`) أو مسحوبات شخصية (`WITHDRAWAL`) نقداً أو إلكترونياً بقيد مزدوج على `3100` معزولاً عن الأرباح التشغيلية.
- **تسوية المحافظ الإلكترونية (`STORE_OWNER` حصراً):**
  - `GET /v1/wallets/:id/transactions`: كشف حركات المحفظة الدفتري وعمليات الدخل والخرج غير المسواة.
  - `POST /v1/wallets/:id/settle`: مطابقة الرصيد الفعلي للمزود مع الدفتري، ترحيل فارق العمولة/العجز إلى `5600` أو الفائض إلى `4300`، سحب نقدية اختياري إلى صندوق المحل `1000`، وتصفير عداد العمليات غير المسواة.
- **سداد المصروفات المستحقة (`2100` - `STORE_OWNER` حصراً):**
  - `POST /v1/expenses/accruals/settle`: سداد التزام مصروف مستحق (إيجار، خدمات، رواتب) نقداً أو إلكترونياً.
- **دليل الحسابات ودفتر الأستاذ العام (`STORE_OWNER` حصراً):**
  - `GET /v1/accounting/accounts?from=&to=`: ميزان المراجعة المتوازن وأرصدة الدليل.
  - `GET /v1/accounting/ledger?account_code=&reference_type=&from=&to=&limit=&offset=&format=csv`: قيود دفتر الأستاذ العام مع الرصيد التراكمي وتصدير كشف الحساب CSV بترميز UTF-8 BOM.

---

*نهاية الملف. المواصفة الصارمة (Request/Response Schemas الدقيقة) في `openapi.yaml`.*
