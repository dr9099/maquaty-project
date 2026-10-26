-- R-11: عامل مسؤول واحد كحد أقصى لكل مالك — ضمان على مستوى قاعدة البيانات
-- (فهرس فريد جزئي: يمنع تفعيل مسؤولَين لنفس المالك في أي ظرف، ويُهمل المحذوفين)
CREATE UNIQUE INDEX "workers_single_responsible_per_owner"
  ON "workers" ("store_owner_id")
  WHERE "is_responsible" = true AND "status" <> 'DELETED';
