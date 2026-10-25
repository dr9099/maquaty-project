# مَقوتي (Muqawati) — Engineering Documentation

هذا المستودع يحتوي الوثائق الهندسية الكاملة لبناء نظام مَقوتي: تطبيق موبايل + Backend مركزي + بوابة إدارة (App Owner) + موقع تعريفي.

## 🤖 وكيل ذكاء اصطناعي يعمل على هذا المشروع؟
اقرأ **`AGENT.md`** في جذر هذا المستودع أولاً — يحتوي تسلسل القراءة الإلزامي وقواعد العمل الكاملة.

## ⚠️ تعليمات إلزامية لأي مطوّر أو وكيل ذكاء اصطناعي
1. اقرأ `docs/00-RESOLVED-DECISIONS.md` **أولاً وقبل أي شيء آخر**. كل قاعدة فيه نهائية ومعتمدة.
2. أي نقطة تجدها غامضة، متعارضة، أو غير محسومة — **توقف واسأل**. لا تفترض ولا تختر حلاً من عندك. الأسئلة المفتوحة المعروفة مجمّعة في `docs/23-development-roadmap.md`.
3. المرجع البصري للواجهات: `design/screens/` (صور كل الشاشات الـ31 + `INDEX.md`).
4. خط التطبيق: **Titr** (الملف في `design/Titr.ttf`). التطبيق بالكامل باللغة العربية.

## الوثائق

| الملف | المحتوى |
|---|---|
| `docs/00-RESOLVED-DECISIONS.md` | القواعد الحاكمة المعتمدة (R-01 إلى R-35) |
| `docs/PROJECT_REQUIREMENTS.md` | فكرة النظام ونطاقه ووظائفه |
| `docs/06-user-roles-permissions.md` | الأدوار والصلاحيات |
| `docs/DATABASE_DESIGN.md` | تصميم قاعدة البيانات |
| `docs/SCREEN_SPEC.md` | توصيف الشاشات (31 شاشة/حالة) |
| `docs/05-system-architecture.md` | معمارية النظام |
| `docs/API_SPEC.md` + `docs/openapi.yaml` | مواصفات الـ API |
| `docs/USER_FLOWS.md` | تدفقات المستخدم |
| `docs/BUSINESS_RULES.md` | قواعد العمل المرقّمة (BR-001 إلى BR-077) |
| `docs/03-functional-requirements.md` | المتطلبات الوظيفية |
| `docs/04-non-functional-requirements.md` | المتطلبات غير الوظيفية |
| `docs/09-mobile-app.md` | تطبيق الموبايل |
| `docs/10-website.md` | الموقع التعريفي |
| `docs/11-admin-dashboard.md` | بوابة App Owner |
| `docs/12-business-logic.md` | منطق الأعمال التقني (مزامنة، تزامن، آلة حالة) |
| `docs/13-authentication-security.md` | المصادقة والأمان |
| `docs/14-validation-error-handling.md` | التحقق ومعالجة الأخطاء |
| `docs/16-notifications.md` | الإشعارات |
| `docs/17-messages-ads-offers.md` | الرسائل والإعلانات والعروض |
| `docs/18-payment-subscription-system.md` | الاشتراكات والترخيص |
| `docs/19-testing-strategy.md` | استراتيجية الاختبار |
| `docs/20-deployment.md` | النشر |
| `docs/21-environment-configuration.md` | إعدادات البيئة |
| `docs/22-project-structure.md` | هيكل المشروع |
| `docs/23-development-roadmap.md` | خارطة الطريق والنقاط المفتوحة |

## هيكل المشروع

```text
maqouti-project/
├── README.md
├── AGENT.md                   ← يُقرأ أولاً من قِبل أي وكيل ذكاء اصطناعي
├── docs/                      ← كل الوثائق الهندسية
├── design/
│   ├── Titr.ttf               ← خط التطبيق
│   └── screens/               ← صور الشاشات + INDEX.md
├── android/                   ← مصدر تطبيق الموبايل
└── backend/                   ← مصدر الـ Backend
```

## ترتيب القراءة الموصى به
1. `docs/00-RESOLVED-DECISIONS.md`
2. `docs/PROJECT_REQUIREMENTS.md`
3. `docs/06-user-roles-permissions.md`
4. `docs/DATABASE_DESIGN.md`
5. `docs/SCREEN_SPEC.md`
6. `docs/05-system-architecture.md`
7. `docs/API_SPEC.md` + `docs/openapi.yaml`
8. `docs/USER_FLOWS.md`, `docs/BUSINESS_RULES.md`, `docs/12-business-logic.md`
9. باقي الملفات حسب الحاجة.
