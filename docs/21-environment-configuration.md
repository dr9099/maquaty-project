# 21 — Environment Configuration

مرجع: `00-RESOLVED-DECISIONS.md` (R-48)، `20-deployment.md`.

---

## 1. متغيرات البيئة (Backend) — مثال توضيحي، القيم الفعلية تُحدَّد عند التنفيذ

```env
# قاعدة البيانات
DATABASE_URL=postgresql://user:pass@host:5432/maquaty?schema=public

# المصادقة
JWT_SECRET=...
JWT_ACCESS_TOKEN_TTL=15m
JWT_REFRESH_TOKEN_TTL=30d
ADMIN_JWT_ACCESS_TOKEN_TTL=10m
ADMIN_JWT_REFRESH_TOKEN_TTL=4h
TEMP_PASSWORD_VALIDITY_HOURS=24

# إجبار تحديث التطبيق
MIN_SUPPORTED_APP_VERSION=1.0.0

# البيئة والتشغيل
APP_ENV=production
NODE_ENV=production
PORT=3000
LOG_LEVEL=info

# عدد مستويات الـ Proxy الموثوقة خلف Cloudflare/Caddy
TRUST_PROXY=2

# CORS — نطاقات مفصولة بفاصلة (مطلوب في الإنتاج)
CORS_ORIGINS=https://admin.maquaty.app

# مراقبة الأخطاء (اختياري)
SENTRY_DSN=

# Firebase
FIREBASE_PROJECT_ID=...
FIREBASE_ADMIN_SDK_CREDENTIALS_PATH=...

# تخزين الملفات (S3-compatible: R2/B2)
FILE_STORAGE_PROVIDER=r2
FILE_STORAGE_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
FILE_STORAGE_REGION=auto
FILE_STORAGE_BUCKET=...
FILE_STORAGE_ACCESS_KEY=...
FILE_STORAGE_SECRET_KEY=...
```

- `TRUST_PROXY=2` مطلوب خلف Cloudflare/Caddy للحصول على IP الحقيقي (Rate Limiting وسجل التدقيق). محلياً `0`.
- `CORS_ORIGINS` فارغ في الإنتاج = منع كل الأصول الخارجية (same-origin فقط). لا تتركه فارغاً إن كانت البوابة على نطاق فرعي.
- **كل هذه القيم تُدار عبر Secret Manager أو متغيرات بيئة خادم فقط — لا تُكتب أبداً في الكود أو Git (`13-authentication-security.md` القسم 12).**

## 2. إعدادات قابلة للتعديل من Admin Portal (وليست متغيرات بيئة ثابتة)
مرجع كامل: `18-payment-subscription-system.md` القسم 9. إعدادات العمل (حدود التجربة، النصوص، `min_sync_interval_hours`، `default_emergency_price_mode`) حقول `system_settings` تُدار من البوابة — بينما متغيرات البيئة أعلاه أسرار بنية لا تعرض في واجهة. رصيد موافقات العمال العاديين (`max_workers_allowed`) يُدار لكل مالك على حدة من Admin Portal (R-33) وليس إعداداً عاماً.

## 3. إعدادات لوحة الأدمن (Admin Portal — وقت البناء)
```env
NEXT_PUBLIC_API_URL=https://api.maquaty.app/v1
NEXT_TELEMETRY_DISABLED=1
```
`NEXT_PUBLIC_API_URL` يُدمج وقت **بناء** صورة Next.js (build arg)، وليس وقت التشغيل. أي تغيير فيه يتطلب إعادة بناء الصورة.

## 4. إعدادات النشر على الخادم (`deploy/.env.production`)
```env
GHCR_OWNER=<github-owner>
IMAGE_TAG=<sha>
ACME_EMAIL=admin@maquaty.app
API_DOMAIN=api.maquaty.app
ADMIN_DOMAIN=admin.maquaty.app
SITE_DOMAIN=www.maquaty.app
APEX_DOMAIN=maquaty.app
```
إضافة إلى أسرار الـ Backend في القسم 1، وأسرار النسخ الاحتياطي:
```env
BACKUP_PASSPHRASE=...
RCLONE_REMOTE=r2:maquaty-backups
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
BACKUP_RETENTION=30d
```
هذه القيم في GitHub Secrets للـ CI/CD، وفي `deploy/.env.production` على الخادم. **لا تُرفع إلى Git.**

### أسرار ومتغيرات GitHub Actions المطلوبة
| الاسم | النوع | الغرض |
|---|---|---|
| `VPS_HOST` / `VPS_USER` / `VPS_SSH_KEY` | Secret | SSH إلى خادم الإنتاج |
| `DEPLOY_PATH` | Secret | مسار المستودد على الخادم (مثل `/opt/maquaty`) |
| `GHCR_USER` / `GHCR_TOKEN` | Secret | PAT بصلاحية `read:packages` لسحب الصور على الخادم |
| `PRODUCTION_DATABASE_URL` | Secret | اتصال PostgreSQL للنسخ الاحتياطي |
| `BACKUP_PASSPHRASE` | Secret | تشفير النسخ (GPG AES256) |
| `RCLONE_REMOTE` | Secret | وجهة النسخ (مثل `r2:maquaty-backups`) |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_ENDPOINT` | Secret | بيانات R2/B2 |
| `NEXT_PUBLIC_API_URL` | Variable | عنوان API وقت بناء لوحة الأدمن |
| `API_DOMAIN` | Variable | نطاق API لفحص الصحة بعد النشر |
| `BACKUP_RETENTION` | Variable | مدة الاحتفاظ (افتراضي `30d`) |

## 5. إعدادات تطبيق الموبايل (Build-time Config)
```text
API_BASE_URL (يختلف بين Development/Staging/Production)
FIREBASE_CONFIG (ملف google-services.json لكل بيئة)
MIN_SYNC_INTERVAL_HOURS (قيمة احتياطية محلية إن تعذّر الوصول لـ system_settings)
```

---

*نهاية الملف. التالي: `22-project-structure.md`.*
