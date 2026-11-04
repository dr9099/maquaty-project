# 22 — Project Structure

هيكل المشروع الفعلي بعد اعتماد قرارات التشغيل (R-48). بعض المجلدات توضيحية وليست إلزامية حرفياً (`README.md` يذكر ذلك صراحة).

```text
maqouti-project/
│
├── README.md
├── AGENT.md
├── docs/ ← كل وثائق هذا المستودع (25 ملفاً + openapi.yaml — فجوات الترقيم المقصودة: لا 01، 02، 07، 08، 15)
│ ├── 00-RESOLVED-DECISIONS.md ← يُقرأ أولاً دائماً
│ ├── PROJECT_REQUIREMENTS.md
│ ├── SCREEN_SPEC.md
│ ├── BUSINESS_RULES.md
│ ├── USER_FLOWS.md
│ ├── API_SPEC.md
│ ├── openapi.yaml
│ ├── DATABASE_DESIGN.md
│ └── ... (باقي الملفات المرقَّمة 03 إلى 23)
│
├── design/
│ ├── Titr.ttf ← خط التطبيق المعتمد
│ └── screens/ ← صور الشاشات + INDEX.md
│
├── backend/
│ ├── Dockerfile ← صورة الإنتاج (API + Worker من نفس الصورة)
│ ├── .dockerignore
│ ├── package.json / package-lock.json
│ ├── tsconfig.json / tsconfig.build.json / nest-cli.json
│ ├── prisma/
│ │ ├── schema.prisma ← مصدر الحقيقة للنماذج
│ │ └── migrations/ ← ترحيلات Prisma المتسلسلة
│ ├── scripts/ ← أدوات التطوير + E2E
│ └── src/
│   ├── main.ts ← الإقلاع (v1 + CORS + trust proxy)
│   ├── worker-standby.ts ← عامل احتياطي مؤقت (بلا مهام — R-48)
│   ├── app.module.ts
│   ├── health/ ← /v1/health و/v1/health/ready
│   ├── prisma/ ← PrismaService (الوصول الوحيد للقاعدة)
│   ├── common/ ← Auth Guard, Tenant Isolation, ApiExceptionFilter...
│   ├── auth/
│   ├── accounting/
│   ├── items/
│   ├── sales/
│   ├── workers/
│   ├── credit/
│   ├── expenses/
│   ├── daily-closing/
│   ├── damaged-goods/
│   ├── rejected-transactions/
│   ├── sync/
│   ├── dashboard/
│   ├── reports/
│   ├── settings/
│   ├── suppliers/
│   └── purchases/
│
├── admin-portal/ ← تطبيق ويب App Owner (Next.js + TypeScript + Tailwind، RTL)
│ ├── Dockerfile
│ ├── .env.example
│ ├── app/
│ │ ├── layout.tsx / globals.css
│ │ ├── login/ / mfa/ / set-new-password/
│ │ └── (portal)/ ← Layout + Sidebar + dashboard
│ ├── components/
│ ├── lib/api.ts ← عميل API موحّد على /v1
│ └── public/fonts/Titr.ttf
│
├── website/ ← الموقع التعريفي الثابت (معزول تماماً)
│ ├── index.html
│ ├── privacy.html / terms.html
│ └── assets/ ← style.css / main.js / fonts/Titr.ttf
│
├── deploy/
│ ├── docker-compose.prod.yml ← api + worker + admin-portal + caddy
│ ├── Caddyfile ← النطاقات + TLS + رؤوس الأمان
│ ├── env.production.example
│ └── scripts/ ← release.sh / backup.sh / restore.sh
│
├── docker-compose.yml ← بيئة التطوير (PostgreSQL + API)
│
├── .github/
│ └── workflows/ ← ci.yml / deploy.yml / backup.yml
│
└── android/ ← تطبيق الموبايل (Flutter — النقطة 12)
  ├── lib/
  │ ├── data/ ← SQLite محلي + Repository Layer
  │ ├── sync/ ← Sync Engine المحلي
  │ ├── ui/
  │ │ ├── screens/ ← يعكس كل شاشة في SCREEN_SPEC.md (31 شاشة/حالة)
  │ │ └── components/ ← مكوّنات مشتركة
  │ └── accounts/ ← Multi-Account Switcher
  └── test/
```

**ملاحظة معمارية مهمة:** تنظيم `backend/src/` يعكس الخدمات الداخلية المنطقية الموصوفة في `05-system-architecture.md` القسم 5، وتُنشر كتطبيق خادم واحد منظَّم (Modular Monolith) + Worker كعملية ثانية من نفس الصورة (R-48). لا تُستخرج Microservices إلا عند حاجة مقيسة.

---

*نهاية الملف. التالي والأخير: `23-development-roadmap.md`.*
