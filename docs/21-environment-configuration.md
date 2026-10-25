# 21 — Environment Configuration

---

## 1. متغيرات البيئة (Backend) — مثال توضيحي، القيم الفعلية تُحدَّد عند التنفيذ

```env
# قاعدة البيانات
DATABASE_URL=postgresql://user:pass@host:5432/maqouti

# المصادقة
JWT_SECRET=...
JWT_ACCESS_TOKEN_TTL=15m
JWT_REFRESH_TOKEN_TTL=30d
ADMIN_JWT_ACCESS_TOKEN_TTL=10m
ADMIN_JWT_REFRESH_TOKEN_TTL=4h

# إجبار تحديث التطبيق
MIN_SUPPORTED_APP_VERSION=1.0.0

# Firebase
FIREBASE_PROJECT_ID=...
FIREBASE_ADMIN_SDK_CREDENTIALS_PATH=...

# تخزين الملفات
FILE_STORAGE_PROVIDER=s3-compatible
FILE_STORAGE_BUCKET=...
FILE_STORAGE_ACCESS_KEY=...
FILE_STORAGE_SECRET_KEY=...

# عامة
NODE_ENV=production
LOG_LEVEL=info
```
**كل هذه القيم تُدار عبر Secret Manager أو متغيرات بيئة خادم فقط — لا تُكتب أبداً في الكود أو Git (`13-authentication-security.md` القسم 12).**

## 2. إعدادات قابلة للتعديل من Admin Portal (وليست متغيرات بيئة ثابتة)
مرجع كامل: `18-payment-subscription-system.md` القسم 9. إعدادات العمل (حدود التجربة، النصوص، `min_sync_interval_hours`، `default_emergency_price_mode`) حقول `system_settings` تُدار من البوابة — بينما متغيرات البيئة أعلاه أسرار بنية لا تعرض في واجهة. رصيد موافقات العمال العاديين (`max_workers_allowed`) يُدار لكل مالك على حدة من Admin Portal (R-33) وليس إعداداً عاماً.

## 3. إعدادات تطبيق الموبايل (Build-time Config)
```text
API_BASE_URL (يختلف بين Development/Staging/Production)
FIREBASE_CONFIG (ملف google-services.json لكل بيئة)
MIN_SYNC_INTERVAL_HOURS (قيمة احتياطية محلية إن تعذّر الوصول لـ system_settings)
```

---

*نهاية الملف. التالي: `22-project-structure.md`.*
