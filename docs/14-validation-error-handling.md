# 14 — Validation & Error Handling

مرجع: `API_SPEC.md` (أشكال الأخطاء لكل Endpoint)، `BUSINESS_RULES.md`.
الهدف: **Valid Input → Correct Processing → Correct Output**، ولا تمرّ أي بيانات غير صحيحة لمراحل لاحقة.

---

## 1. جدول التحقق من أهم المدخلات

| الحقل | إلزامي/اختياري | النوع | قيود |
|---|---|---|---|
| `phone` (تسجيل/دخول) | إلزامي | نص رقمي | فريد عالمياً (Store Owner + Worker معاً) |
| `password` | إلزامي | نص | حد أدنى 8 أحرف — قرار معتمد (R-34) |
| `store_name`, `full_name` | إلزامي | نص | غير فارغ |
| `item.name`, `item.unit` | إلزامي | نص | غير فارغ |
| `item.quantity`, `cost_price`, `sell_price` | إلزامي | رقم | `>= 0`؛ `sell_price` أقل من `cost_price` في الإدخال العادي (غير الاضطراري): **تحذير فقط دون رفض — قرار معتمد** (النقطة 8 مغلقة في `23-development-roadmap.md`)، لأن المالك قد يتعمد بيع بخسارة لسبب تجاري خاص به حتى خارج آلية البيع الاضطراري الرسمية؛ الرفض `400` يبقى للقيم السالبة/الصفرية والبيانات الناقصة |
| `sales.quantity` | إلزامي | رقم | `> 0`، `<= items.quantity` المتاحة وقت المعالجة |
| `sales.payment_type` | إلزامي | Enum | `CASH \| ELECTRONIC \| CREDIT` فقط |
| `deposit_attachment_url` | إلزامي إن `ELECTRONIC` | رابط ملف | نوع صورة حقيقي مُتحقَّق منه (`13-authentication-security.md` القسم 7) |
| `credit_customer.credit_limit` | اختياري | رقم | `>= 0` أو `NULL` (بلا حد) |
| `damaged_goods.reason`, `photo_url` | إلزامي إن `is_damaged=true` | نص/ملف | |
| `emergency_reason` | إلزامي إن `is_emergency_sale=true` | نص | غير فارغ |
| `emergency_override_price` | إلزامي إن `is_emergency_sale=true` | رقم | يحترم `items.emergency_price_mode` |
| `worker.phone` | إلزامي | نص رقمي | فريد عالمياً |
| `new_password` + `confirmation` (أي شاشة تغيير كلمة مرور) | إلزامي | نص | يتطابقان حرفياً، وإلا `400 PASSWORD_MISMATCH` |
| نطاق تاريخ (تقارير، فلاتر) | إلزامي إن مطلوباً | تاريخ | `date_from <= date_to`، وإلا `400 INVALID_DATE_RANGE` |

## 2. فئات الأخطاء ومعالجتها

| الفئة | السلوك المطلوب |
|---|---|
| أخطاء تحقق مدخلات (`400`) | رسالة عربية واضحة تحت الحقل المعني مباشرة في الواجهة؛ لا إرسال للخادم إن كان التحقق المحلي (`09-mobile-app.md` القسم 4) قد رصدها مسبقاً |
| أخطاء صلاحيات (`403`) | رسالة عامة ("لا تملك صلاحية الوصول لهذا الإجراء") بلا كشف تفاصيل تقنية؛ العنصر المرتبط يُخفى من الواجهة أصلاً وليس فقط معطَّلاً |
| أخطاء حالة حساب (`423`) | **كود موحّد `423 ACCOUNT_LOCKED` في كل المسارات** (تسجيل الدخول وبقية الطلبات) مع `reason` في الجسم يحدد الحالة: `TRIAL_EXPIRED` أو `SUBSCRIPTION_EXPIRED` → توجيه لشاشة القفل 24؛ `WORKER_SUSPENDED` → بطاقة "حساب موقوف" في LOGIN (شاشة 21). توجيه فوري لشاشة القفل/الإيقاف المخصصة (لا رسالة عابرة فقط) — تحجب أي تفاعل آخر |
| تعارض مزامنة (`409` على عملية محلية) | تُعرَض للمالك لاحقاً عبر `REJECTED_TRANSACTIONS` (بيع بسبب `CREDIT_LIMIT_EXCEEDED` أو `INSUFFICIENT_STOCK` حصراً — R-30)؛ لا تختفي بصمت |
| أخطاء شبكة/Timeout | العملية تبقى محلياً بحالة "بانتظار المزامنة"؛ لا رسالة خطأ مزعجة متكررة، بل مؤشر حالة اتصال هادئ (`09-mobile-app.md` القسم 3) |
| أخطاء خادم (`500`) | رسالة عامة "حدث خطأ غير متوقع، حاول لاحقاً" + تسجيل تفصيلي داخلي في سجلات التشغيل (وليس للمستخدم) |

## 3. مبدأ عدم كشف المعلومات الحساسة في رسائل الخطأ
- `401 INVALID_CREDENTIALS` موحَّدة لكل أسباب فشل تسجيل الدخول المتعلقة بصحة البيانات (لا تمييز بين "رقم غير موجود" و"كلمة مرور خاطئة").
- محاولة الوصول لمورد غير مملوك (IDOR) تُرجع `404` (غير موجود) وليس `403` (ممنوع)، لتفادي تأكيد وجود المورد لجهة غير مخوَّلة (`13-authentication-security.md` القسم 2.2).

## 4. جدول أكواد الأخطاء الموحّدة (مرجع سريع)
| الكود | المسار | المعنى |
|---|---|---|
| `423 ACCOUNT_LOCKED` (+reason) | كل المسارات | الحساب مقفل: `TRIAL_EXPIRED`/`SUBSCRIPTION_EXPIRED` (شاشة 24) أو `WORKER_SUSPENDED` (شاشة 21) |
| `403 WORKER_LIMIT_REACHED` | `POST /workers` | لا رصيد موافقات عمال عاديين كافٍ — التواصل مع App Owner (R-33) |
| `403 DEVICE_TRIAL_ALREADY_CONSUMED` | `POST /auth/register-store-owner` | الجهاز استهلك التجربة (R-25) |
| `403 SUBSCRIPTION_REQUIRED` | النسخ الاحتياطي | حساب تجريبي — نافذة `BACKUP_PAYWALL_MODAL` (R-28) |
| `400 MISSING_DEPOSIT_ATTACHMENT` | `POST /sales` | صورة إيداع ناقصة |
| `400 EMERGENCY_REASON_REQUIRED` | `POST /sales` | سبب تعديل مفقود للبيع الاضطراري |
| `400 EMERGENCY_PRICE_BELOW_MINIMUM` | `POST /sales` | سعر اضطراري دون الحد الأدنى |
| `400 EMERGENCY_PRICE_ABOVE_MAXIMUM` | `POST /sales` | سعر اضطراري فوق الحد الأقصى (إن حُدد من المالك) |
| `400 RETURN_QUANTITY_EXCEEDED` | `POST /returns` | كمية مرتجعة أكبر من المباع |
| `400 RETURN_DAY_PASSED` | `POST /returns` | مرتجع لعملية بيع من يوم سابق (R-20) |
| `409 DAY_ALREADY_CLOSED` | returns/daily-closings | اليوم معتمد — لا مرتجع ولا تعديل |
| `400 DISALLOWED_RESOLUTION_ACTION` | resolve المرفوضة | خيار معالجة لا يطابق سبب الرفض |
| `403 NOT_OWN_SALE` | `POST /returns` | عامل يرتجع عملية ليست له |

---

*نهاية الملف. التالي: `16-notifications.md`.*
