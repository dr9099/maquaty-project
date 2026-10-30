-- سكريبت التراجع العكسي الكامل (Reversible Down Migration) لموديول المشتريات والموردين
-- يُنفّذ فقط في حال الرغبة بالتراجع الكامل قبل الاستخدام الإنتاجي

BEGIN;

-- 1. حذف الجداول الفرعية ثم الرئيسية بالترتيب العكسي للمفاتيح الأجنبية
DROP TABLE IF EXISTS "purchase_returns" CASCADE;
DROP TABLE IF EXISTS "supplier_payments" CASCADE;
DROP TABLE IF EXISTS "purchase_items" CASCADE;
DROP TABLE IF EXISTS "purchase_invoices" CASCADE;
DROP TABLE IF EXISTS "suppliers" CASCADE;

-- 2. إزالة الأعمدة المضافة من الجداول القائمة
ALTER TABLE "sales" DROP COLUMN IF EXISTS "cogs_amount";
ALTER TABLE "store_owners" DROP COLUMN IF EXISTS "default_costing_method";
ALTER TABLE "store_owners" DROP COLUMN IF EXISTS "currency";

-- 3. حذف حساب 2000 إن لم يكن مرتبطاً بقيود دفتر أستاذ
DELETE FROM "chart_of_accounts" a
WHERE a."code" = '2000'
  AND NOT EXISTS (SELECT 1 FROM "ledger_entries" le WHERE le."account_id" = a."id");

-- 4. حذف التعدادات المضافة
DROP TYPE IF EXISTS "PurchaseRefundMethod";
DROP TYPE IF EXISTS "PurchasePaymentType";
DROP TYPE IF EXISTS "PurchaseInvoiceStatus";
DROP TYPE IF EXISTS "SupplierStatus";
DROP TYPE IF EXISTS "CostingMethod";
DROP TYPE IF EXISTS "Currency";

COMMIT;
