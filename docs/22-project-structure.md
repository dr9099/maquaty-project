# 22 — Project Structure

هيكل مقترح (مثال عملي، ليس إلزامياً حرفياً — `README.md` يذكر ذلك صراحة):

```text
maqouti-project/
│
├── README.md
├── docs/ ← كل وثائق هذا المستودع (25 ملفاً + openapi.yaml — فجوات الترقيم المقصودة: لا 01، 02، 07، 08، 15)
│ ├── 00-RESOLVED-DECISIONS.md ← يُقرأ أولاً دائماً
│ ├── PROJECT_REQUIREMENTS.md
│ ├── SCREEN_SPEC.md
│ ├── BUSINESS_RULES.md
│ ├── USER_FLOWS.md
│ ├── API_SPEC.md
│ ├── openapi.yaml
│ ├── DATABASE_DESIGN.md
│ └──... (باقي الملفات المرقَّمة 03 إلى 23)
│
├── design/
│ └── Titr.ttf ← خط التطبيق المعتمد
│
├── backend/
│ ├── src/
│ │ ├── modules/
│ │ │ ├── auth/ ← Auth Service
│ │ │ ├── sync/ ← Sync Service
│ │ │ ├── subscription/ ← Subscription/License Service
│ │ │ ├── accounting/ ← Accounting Service (القيد المزدوج)
│ │ │ ├── sales/ ← البيع + البيع الاضطراري
│ │ │ ├── credit/ ← الآجل
│ │ │ ├── workers/ ← إدارة العمال + العامل المسؤول
│ │ │ ├── reporting/ ← التقارير + كشوف الحساب
│ │ │ ├── broadcast/ ← الرسائل/الإعلانات/العروض
│ │ │ ├── backup/ ← النسخ الاحتياطي السحابي
│ │ │ ├── rejected-transactions/ ←
│ │ │ ├── devices/ ← هوية الجهاز، منع التلاعب بالتجربة
│ │ │ └── audit/ ← سجل التدقيق
│ │ ├── database/ ← Migrations + Schema (يعكس DATABASE_DESIGN.md)
│ │ └── common/ ← Middleware مشترك (Auth Guard, Tenant Isolation Guard...)
│ └── tests/ ← يعكس 19-testing-strategy.md
│
├── admin-portal/ ← تطبيق ويب App Owner (منفصل تماماً)
│
├── website/ ← الموقع التعريفي العام
│
└── android/ ← تطبيق الموبايل (أندرويد أولاً)
 ├── app/
 │ ├── data/ ← SQLite محلي + Repository Layer
 │ ├── sync/ ← Sync Engine المحلي
 │ ├── ui/
 │ │ ├── screens/ ← يعكس كل شاشة في SCREEN_SPEC.md (31 شاشة/حالة)
 │ │ └── components/ ← مكوّنات مشتركة (بطاقات، أزرار الهوية...)
 │ └── accounts/ ← Multi-Account Switcher
 └── tests/
```

**ملاحظة معمارية مهمة:** تنظيم `backend/src/modules/` أعلاه يعكس الخدمات الداخلية المنطقية الموصوفة في `05-system-architecture.md` القسم 5، سواء نُشرت كتطبيق خادم واحد منظَّم (Monolith) أو Microservices فعلية لاحقاً — هذا قرار تقني يُترك لفريق التنفيذ ولا يغيّر هذا التنظيم المنطقي للكود.

---

*نهاية الملف. التالي والأخير: `23-development-roadmap.md`.*
