-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('YER', 'SAR', 'USD');

-- CreateEnum
CREATE TYPE "CostingMethod" AS ENUM ('WEIGHTED_AVERAGE', 'LAST_PRICE', 'FIFO');

-- CreateEnum
CREATE TYPE "SupplierStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "PurchaseInvoiceStatus" AS ENUM ('DRAFT', 'POSTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "PurchasePaymentType" AS ENUM ('CASH', 'ELECTRONIC', 'CREDIT', 'PARTIAL');

-- CreateEnum
CREATE TYPE "PurchaseRefundMethod" AS ENUM ('DEBT_REDUCTION', 'CASH_REFUND');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LedgerReferenceType" ADD VALUE 'PURCHASE';
ALTER TYPE "LedgerReferenceType" ADD VALUE 'PURCHASE_VOID';
ALTER TYPE "LedgerReferenceType" ADD VALUE 'SUPPLIER_OPENING_BALANCE';
ALTER TYPE "LedgerReferenceType" ADD VALUE 'PURCHASE_PAYMENT';
ALTER TYPE "LedgerReferenceType" ADD VALUE 'PURCHASE_RETURN';

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "cogs_amount" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "store_owners" ADD COLUMN     "currency" "Currency" NOT NULL DEFAULT 'YER',
ADD COLUMN     "default_costing_method" "CostingMethod" NOT NULL DEFAULT 'WEIGHTED_AVERAGE';

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "contact_person" TEXT,
    "tax_number" TEXT,
    "notes" TEXT,
    "opening_balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "opening_balance_settled" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "current_balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "credit_limit" DECIMAL(12,2),
    "payment_terms_days" INTEGER,
    "status" "SupplierStatus" NOT NULL DEFAULT 'ACTIVE',
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_owner_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "supplier_invoice_ref" TEXT,
    "invoice_date" DATE NOT NULL,
    "due_date" DATE,
    "payment_type" "PurchasePaymentType" NOT NULL,
    "wallet_id" UUID,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "tax_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "paid_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "settled_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "remaining_amount" DECIMAL(12,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'YER',
    "attachment_url" TEXT,
    "notes" TEXT,
    "status" "PurchaseInvoiceStatus" NOT NULL DEFAULT 'POSTED',
    "costing_method_used" "CostingMethod" NOT NULL DEFAULT 'WEIGHTED_AVERAGE',
    "daily_closing_id" UUID,
    "posted_at" TIMESTAMP(3),
    "voided_at" TIMESTAMP(3),
    "void_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_owner_id" UUID NOT NULL,
    "purchase_invoice_id" UUID NOT NULL,
    "item_id" UUID,
    "item_name" TEXT NOT NULL,
    "base_unit" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "conversion_factor" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "quantity" DECIMAL(12,3) NOT NULL,
    "base_quantity" DECIMAL(12,3) NOT NULL,
    "unit_cost_price" DECIMAL(12,2) NOT NULL,
    "tax_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_line_cost" DECIMAL(12,2) NOT NULL,
    "effective_base_unit_cost" DECIMAL(12,2) NOT NULL,
    "sell_price" DECIMAL(12,2) NOT NULL,
    "emergency_price_mode" "EmergencyPriceMode",
    "emergency_price_plus_fixed" DECIMAL(12,2),
    "emergency_price_plus_percent" DECIMAL(5,2),
    "emergency_price_min" DECIMAL(12,2),
    "emergency_price_max" DECIMAL(12,2),
    "remaining_fifo_qty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "returned_quantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_owner_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "purchase_invoice_id" UUID,
    "amount" DECIMAL(12,2) NOT NULL,
    "payment_method" "PaymentType" NOT NULL,
    "wallet_id" UUID,
    "receipt_attachment_url" TEXT,
    "notes" TEXT,
    "daily_closing_id" UUID,
    "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_returns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_owner_id" UUID NOT NULL,
    "purchase_invoice_id" UUID NOT NULL,
    "purchase_item_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "base_quantity" DECIMAL(12,3) NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "refund_method" "PurchaseRefundMethod" NOT NULL,
    "reason" TEXT NOT NULL,
    "returned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_returns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "suppliers_store_owner_id_status_idx" ON "suppliers"("store_owner_id", "status");

-- CreateIndex
CREATE INDEX "suppliers_store_owner_id_name_idx" ON "suppliers"("store_owner_id", "name");

-- CreateIndex
CREATE INDEX "purchase_invoices_store_owner_id_invoice_date_idx" ON "purchase_invoices"("store_owner_id", "invoice_date");

-- CreateIndex
CREATE INDEX "purchase_invoices_store_owner_id_supplier_id_status_idx" ON "purchase_invoices"("store_owner_id", "supplier_id", "status");

-- CreateIndex
CREATE INDEX "purchase_invoices_daily_closing_id_idx" ON "purchase_invoices"("daily_closing_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_invoices_store_owner_id_invoice_number_key" ON "purchase_invoices"("store_owner_id", "invoice_number");

-- CreateIndex
CREATE INDEX "purchase_items_purchase_invoice_id_idx" ON "purchase_items"("purchase_invoice_id");

-- CreateIndex
CREATE INDEX "purchase_items_store_owner_id_item_id_idx" ON "purchase_items"("store_owner_id", "item_id");

-- CreateIndex
CREATE INDEX "supplier_payments_store_owner_id_supplier_id_paid_at_idx" ON "supplier_payments"("store_owner_id", "supplier_id", "paid_at");

-- CreateIndex
CREATE INDEX "supplier_payments_daily_closing_id_idx" ON "supplier_payments"("daily_closing_id");

-- CreateIndex
CREATE INDEX "purchase_returns_store_owner_id_purchase_invoice_id_idx" ON "purchase_returns"("store_owner_id", "purchase_invoice_id");

-- CreateIndex
CREATE INDEX "purchase_returns_store_owner_id_supplier_id_returned_at_idx" ON "purchase_returns"("store_owner_id", "supplier_id", "returned_at");

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_store_owner_id_fkey" FOREIGN KEY ("store_owner_id") REFERENCES "store_owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_store_owner_id_fkey" FOREIGN KEY ("store_owner_id") REFERENCES "store_owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_daily_closing_id_fkey" FOREIGN KEY ("daily_closing_id") REFERENCES "daily_closings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_store_owner_id_fkey" FOREIGN KEY ("store_owner_id") REFERENCES "store_owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_purchase_invoice_id_fkey" FOREIGN KEY ("purchase_invoice_id") REFERENCES "purchase_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_store_owner_id_fkey" FOREIGN KEY ("store_owner_id") REFERENCES "store_owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_purchase_invoice_id_fkey" FOREIGN KEY ("purchase_invoice_id") REFERENCES "purchase_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_daily_closing_id_fkey" FOREIGN KEY ("daily_closing_id") REFERENCES "daily_closings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_store_owner_id_fkey" FOREIGN KEY ("store_owner_id") REFERENCES "store_owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_purchase_invoice_id_fkey" FOREIGN KEY ("purchase_invoice_id") REFERENCES "purchase_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_purchase_item_id_fkey" FOREIGN KEY ("purchase_item_id") REFERENCES "purchase_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═══ قيود السلامة الإضافية وفهارس عدم التكرار للمشتريات والموردين ═══

-- منع تكرار اسم المورد أو هاتفه النشط ضمن نفس المتجر (مع السماح بإعادة الاستخدام بعد الحذف المرن)
CREATE UNIQUE INDEX "suppliers_store_owner_name_active_unique"
  ON "suppliers"("store_owner_id", LOWER(TRIM("name")))
  WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX "suppliers_store_owner_phone_active_unique"
  ON "suppliers"("store_owner_id", TRIM("phone"))
  WHERE "deleted_at" IS NULL AND "phone" IS NOT NULL AND TRIM("phone") <> '';

-- قيود الموردين
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_opening_balance_non_negative"
  CHECK ("opening_balance" >= 0 AND "opening_balance_settled" >= 0 AND "opening_balance_settled" <= "opening_balance");

ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_credit_limit_non_negative"
  CHECK ("credit_limit" IS NULL OR "credit_limit" >= 0);

-- قيود فواتير الشراء
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_amounts_non_negative"
  CHECK (
    "subtotal" >= 0
    AND "tax_amount" >= 0
    AND "discount_amount" >= 0
    AND "total_amount" >= 0
    AND "paid_amount" >= 0
    AND "settled_amount" >= 0
    AND "remaining_amount" >= 0
    AND "paid_amount" <= "total_amount"
  );

ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_electronic_requires_wallet"
  CHECK (NOT ("payment_type" = 'ELECTRONIC' AND "wallet_id" IS NULL));

-- قيود بنود فواتير الشراء
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_positive_values"
  CHECK (
    "conversion_factor" > 0
    AND "quantity" > 0
    AND "base_quantity" > 0
    AND "unit_cost_price" >= 0
    AND "tax_amount" >= 0
    AND "discount_amount" >= 0
    AND "total_line_cost" >= 0
    AND "effective_base_unit_cost" >= 0
    AND "sell_price" >= 0
    AND "remaining_fifo_qty" >= 0
    AND "returned_quantity" >= 0
    AND "returned_quantity" <= "quantity"
  );

-- قيود سدادات الموردين
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_amount_positive"
  CHECK ("amount" > 0);

ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_method_check"
  CHECK ("payment_method" IN ('CASH', 'ELECTRONIC'));

ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_electronic_requires_wallet"
  CHECK (NOT ("payment_method" = 'ELECTRONIC' AND "wallet_id" IS NULL));

-- قيود مرتجعات المشتريات
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_positive_values"
  CHECK (
    "quantity" > 0
    AND "base_quantity" > 0
    AND "unit_price" >= 0
    AND "total_amount" >= 0
  );

-- زراعة رجعية آمنة (Idempotent Backfill) لحساب 2000 (الموردون / الذمم الدائنة) لجميع الملاك الحاليين
INSERT INTO "chart_of_accounts" ("id", "store_owner_id", "code", "name", "account_type", "created_at")
SELECT gen_random_uuid(), "id", '2000', 'الموردون / الذمم الدائنة', 'LIABILITY', CURRENT_TIMESTAMP
FROM "store_owners"
ON CONFLICT ("store_owner_id", "code") DO NOTHING;

