# 20 — Deployment

مرجع: `00-RESOLVED-DECISIONS.md` (R-48)، `04-non-functional-requirements.md`، `05-system-architecture.md`، `21-environment-configuration.md`.

---

## 1. مكونات تحتاج نشراً منفصلاً

| المكوّن | النشر المعتمد | ملاحظات |
|---|---|---|
| Central Backend Server (API) | حاوية Docker على VPS | API + Sync + كل الخدمات الداخلية (`05-system-architecture.md`) |
| Worker | حاوية Docker على نفس VPS | **نفس صورة الـ API** بأمر تشغيل مختلف. فعّال بعد اعتماد جدول `jobs` (R-48) |
| PostgreSQL | خدمة مُدارة (Neon/Supabase) | خارج الـ VPS؛ النسخ والاستعادة مسؤولية الخدمة + نسخة خارجية مشفّرة |
| Caddy | حاوية Docker على الـ VPS | TLS تلقائي + Reverse Proxy + تقديم الموقع الثابت |
| Admin Portal (ويب) | حاوية Docker مستقلة | Next.js، نطاق فرعي معزول (`admin.`) |
| الموقع العام (ويب) | ملفات ثابتة يخدمها Caddy | نطاق `www.` + تحويل `apex`، معزول تماماً عن الـ API |
| Cloudflare | DNS + WAF + CDN | أمام النطاقات الثلاثة؛ لا يخزّن استجابات API الحساسة |
| Object Storage (R2/B2) | خدمة خارجية | النسخ الاحتياطية والملفات (S3-compatible) |
| تطبيق Android | توزيع APK مباشر | النشر عبر Google Play قرار تجاري لاحق خارج نطاق هذه الوثائق |

## 2. بيئات التشغيل (Environments)
- **Development** — بيانات وهمية، كل الحمايات مفعَّلة لكن بسجلات تفصيلية أوسع. تُشغَّل محلياً عبر `docker-compose.yml` (PostgreSQL + API).
- **Staging** — نسخة مطابقة للإنتاج لاختبار E2E والترحيلات قبل الإصدار.
- **Production** — البيئة الحقيقية، أقل مستوى تفصيل في السجلات العامة، كل حمايات `13-authentication-security.md` مفعَّلة كاملة بلا استثناء.

## 3. الطوبولوجيا

```text
                       Cloudflare (DNS / WAF / TLS)
                                   │
                        ┌──────────┴──────────┐
                        │      VPS (Hetzner)   │
                        │  ┌────────────────┐  │
    api.  ──────────────┼─▶│ Caddy          │  │
    admin. ─────────────┼─▶│ (TLS + Proxy)  │  │
    www.  ──────────────┼─▶│ static website │  │
                        │  └───┬────────┬───┘  │
                        │      │        │      │
                        │  ┌───▼───┐ ┌──▼────┐ │
                        │  │ API   │ │ Admin │ │
                        │  └───┬───┘ │ Portal│ │
                        │  ┌───▼───┐ └───────┘ │
                        │  │Worker │             │
                        │  └───┬───┘             │
                        └──────┼─────────────────┘
                               │ TLS
                    ┌──────────▼──────────┐
                    │ PostgreSQL مُدارة    │
                    │ (Neon / Supabase)   │
                    └─────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │ R2 / B2 (نسخ مشفّرة)│
                    └─────────────────────┘
```

## 4. النطاقات و DNS
| النطاق | الخدمة | ملاحظات |
|---|---|---|
| `api.maquaty.app` | API | تستدعيه تطبيقات الموبايل والبوابة عبر `/v1` |
| `admin.maquaty.app` | Admin Portal | نطاق فرعي مستقل؛ CORS مقيّد به |
| `www.maquaty.app` | الموقع الثابت | لا يتصل بقاعدة البيانات |
| `maquaty.app` | تحويل دائم | يُحوَّل إلى `www.` |

- شهادات TLS تُصدرها Caddy تلقائياً (Let's Encrypt)؛ يبقى وضع Cloudflare **Full (strict)**.
- لا تُخدم خدمتان على نفس اسم المضيف (R-48 / قرار الفصل).
- CORS في الإنتاج من `CORS_ORIGINS=https://admin.maquaty.app` فقط.

## 5. نموذج النشر
- **الصور:** `ghcr.io/<owner>/maquaty-backend:<sha>` و`ghcr.io/<owner>/maquaty-admin-portal:<sha>`.
- **التشغيل:** `deploy/docker-compose.prod.yml` (api + worker + admin-portal + caddy) بلا PostgreSQL محلي.
- **الإعداد:** `deploy/.env.production` (غير متتبَّع في Git) + `deploy/Caddyfile`.
- **الموقع:** `website/` يُربط كـ volume للقراءة فقط داخل Caddy.

### الإعداد الأول على الخادم
1. تثبيت Docker + Docker Compose plugin، وإنشاء مستخدم غير root.
2. استنساخ المستودد إلى `DEPLOY_PATH` (مثلاً `/opt/maquaty`).
3. نسخ `deploy/env.production.example` إلى `deploy/.env.production` وملء الأسرار.
4. توجيه DNS في Cloudflare إلى IP الخادم، وفتح `80/443` فقط.
5. `docker login ghcr.io` ثم `bash deploy/scripts/release.sh`.

## 6. تدفق الإصدار (CI/CD)
1. **CI** (`.github/workflows/ci.yml`): بناء الـ Backend + `prisma migrate deploy` على PostgreSQL مؤقت + `npm run test:e2e`، وبناء لوحة الأدمن.
2. **Build & Push** (`.github/workflows/deploy.yml`): بناء صورتَي الـ API والبوابة ودفعهما إلى GHCR بوسم SHA.
3. **Deploy**: SSH إلى الـ VPS → `git reset --hard origin/main` (لتحديث `deploy/` و`website/`) → `docker login` → `release.sh`.
4. **release.sh**: `pull` → `prisma migrate deploy` → `up -d` → فحص `https://api.../v1/health` → تثبيت الوسم، أو تراجع تلقائي للوسم السابق.
5. **Staging** يُشغَّل يدوياً بنفس السكربت مع نطاقات وبيئة منفصلة قبل ترقية الإنتاج.

## 7. النسخ الاحتياطي والاستعادة
- **يومياً:** `.github/workflows/backup.yml` يشغّل `deploy/scripts/backup.sh` (pg_dump → gzip → GPG AES256 → R2/B2) مع احتفاظ افتراضي 30 يوماً.
- **شهرياً:** اختبار استعادة فعلي على قاعدة Staging عبر `deploy/scripts/restore.sh` (يتطلب كتابة `RESTORE` للتأكيد).
- **قبل كل إصدار:** التأكد من نجاح آخر نسخة احتياطية، وأن `prisma migrate deploy` مُختبَر على Staging.

## 8. التراجع (Rollback)
- تراجع تلقائي عند فشل فحص الصحة إلى آخر وسم ناجح محفوظ في `deploy/.current_tag`.
- تراجع يدوي: `IMAGE_TAG=<previous-sha> docker compose -f deploy/docker-compose.prod.yml up -d`.
- تراجع قاعدة البيانات: استعادة النسخة السابقة فقط عند وجود Migration غير متوافقة، وبعد إيقاف الكتابة.

## 9. التكلفة والسعة المستهدفة
- **التكلفة:** VPS ~5$ + PostgreSQL مُدارة 0–5$ + نطاق ~1$ ≈ **5–10$ شهرياً** (Cloudflare/GitHub Actions بخطط مجانية).
- **السعة التقريبية:** 1 vCPU / 1GB + DB مجانية ≈ مئات المتاجر وآلاف الأجهزة، بشرط Pooler ومراقبة اتصالات قاعدة البيانات.
- **مؤشرات الترقية:** CPU > 70% أو زمن استجابة DB > 100ms باستمرار → خطة DB أعلى؛ تأخر مهام الطابور > دقيقة → Redis/BullMQ؛ تقارير تُبطئ البيع → Read Replica.

## 10. قائمة تحقق قبل أي إصدار جديد (Release Checklist)
- كل اختبارات `19-testing-strategy.md` ناجحة (خصوصاً اختبارات التزامن والأمن).
- لا أسرار مكشوفة في الكود أو الصور (Secret Scanning — `13-authentication-security.md` القسم 13).
- ترحيل قاعدة البيانات (Migration) مُختبَر على Staging أولاً، مع خطة تراجع (Rollback) واضحة.
- إمكانية إجبار تحديث التطبيق عن بُعد جاهزة وتعمل — **الآلية الموثقة:** الخادم يُرسل `min_app_version` في استجابة `POST /device/sync` (القيمة من `MIN_SUPPORTED_APP_VERSION` في `21-environment-configuration.md`)، والتطبيق الأقدم يمنع الاستخدام ويطلب التحديث.
- `/v1/health` و`/v1/health/ready` يعملان، وآخر نسخة احتياطية ناجحة، و`CORS_ORIGINS` مضبوط.

## 11. آلية ترحيل قاعدة البيانات (Migrations)
كل تغيير بنيوي (مثل `is_responsible`, `max_workers_allowed`, `temp_password_hash`، جدول `rejected_transactions`...) يُدار عبر **Prisma Migrate** (حزمة Backend المعتمدة NestJS + Prisma) مع ترقيم تسلسلي، وليس تعديلاً يدوياً مباشراً على قاعدة الإنتاج. في CI/CD يُنفَّذ `npx prisma migrate deploy` قبل إقلاع الإصدار الجديد.

---

*نهاية الملف. التالي: `21-environment-configuration.md`.*
