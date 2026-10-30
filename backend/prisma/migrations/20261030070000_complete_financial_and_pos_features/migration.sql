-- CreateEnum
CREATE TYPE "ExpensePaymentMethod" AS ENUM ('CASH', 'ELECTRONIC', 'CREDIT');

-- CreateEnum
CREATE TYPE "ExpenseAccrualTargetType" AS ENUM ('RENT', 'UTILITY', 'EMPLOYEE_SALARY');

-- CreateEnum
CREATE TYPE "OwnerTransactionType" AS ENUM ('DEPOSIT', 'WITHDRAWAL');

-- CreateEnum
CREATE TYPE "WalletSettlementStatus" AS ENUM ('MATCHED', 'DISCREPANCY_RESOLVED');

-- AlterEnum
ALTER TYPE "LedgerReferenceType" ADD VALUE 'OWNER_DEPOSIT';
ALTER TYPE "LedgerReferenceType" ADD VALUE 'OWNER_WITHDRAWAL';
ALTER TYPE "LedgerReferenceType" ADD VALUE 'WALLET_SETTLEMENT';
ALTER TYPE "LedgerReferenceType" ADD VALUE 'EXPENSE_SETTLEMENT';

-- CreateTable
CREATE TABLE "wallet_settlements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_owner_id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "book_balance_before" DECIMAL(12,2) NOT NULL,
    "actual_provider_balance" DECIMAL(12,2) NOT NULL,
    "difference" DECIMAL(12,2) NOT NULL,
    "cash_out_to_drawer" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "book_balance_after" DECIMAL(12,2) NOT NULL,
    "settled_operations_count" INTEGER NOT NULL DEFAULT 0,
    "status" "WalletSettlementStatus" NOT NULL DEFAULT 'MATCHED',
    "notes" TEXT,
    "settled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owner_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_owner_id" UUID NOT NULL,
    "type" "OwnerTransactionType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "payment_method" "PaymentType" NOT NULL,
    "wallet_id" UUID,
    "attachment_url" TEXT,
    "note" TEXT,
    "wallet_settled" BOOLEAN NOT NULL DEFAULT false,
    "wallet_settlement_id" UUID,
    "transacted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "owner_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_settlements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_owner_id" UUID NOT NULL,
    "target_type" "ExpenseAccrualTargetType" NOT NULL,
    "target_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "payment_method" "PaymentType" NOT NULL,
    "wallet_id" UUID,
    "attachment_url" TEXT,
    "note" TEXT,
    "wallet_settled" BOOLEAN NOT NULL DEFAULT false,
    "wallet_settlement_id" UUID,
    "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_settlements_pkey" PRIMARY KEY ("id")
);

-- AlterTable: store_owners
ALTER TABLE "store_owners" ADD COLUMN "allow_responsible_purchases" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: wallets
ALTER TABLE "wallets" ADD COLUMN "account_code" TEXT;

-- AlterTable: sales
ALTER TABLE "sales" ADD COLUMN "wallet_settled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "wallet_settlement_id" UUID;

-- AlterTable: credit_payments
ALTER TABLE "credit_payments" ADD COLUMN "attachment_url" TEXT,
ADD COLUMN "notes" TEXT,
ADD COLUMN "wallet_settled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "wallet_settlement_id" UUID;

-- AlterTable: employee_advances
ALTER TABLE "employee_advances" ADD COLUMN "payment_method" "ExpensePaymentMethod" NOT NULL DEFAULT 'CASH',
ADD COLUMN "wallet_id" UUID,
ADD COLUMN "attachment_url" TEXT,
ADD COLUMN "wallet_settled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "wallet_settlement_id" UUID;

-- AlterTable: employee_payments
ALTER TABLE "employee_payments" ADD COLUMN "payment_method" "ExpensePaymentMethod" NOT NULL DEFAULT 'CASH',
ADD COLUMN "wallet_id" UUID,
ADD COLUMN "attachment_url" TEXT,
ADD COLUMN "paid_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "remaining_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "wallet_settled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "wallet_settlement_id" UUID;

-- AlterTable: rent_records
ALTER TABLE "rent_records"
ALTER COLUMN "payment_method" TYPE "ExpensePaymentMethod"
USING (
  CASE
    WHEN "payment_method" IN ('CASH', 'ELECTRONIC', 'CREDIT') THEN "payment_method"::"ExpensePaymentMethod"
    ELSE 'CASH'::"ExpensePaymentMethod"
  END
);
ALTER TABLE "rent_records" ALTER COLUMN "payment_method" SET DEFAULT 'CASH';

ALTER TABLE "rent_records" ADD COLUMN "wallet_id" UUID,
ADD COLUMN "attachment_url" TEXT,
ADD COLUMN "paid_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "remaining_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "note" TEXT,
ADD COLUMN "wallet_settled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "wallet_settlement_id" UUID;

-- AlterTable: utility_payments
ALTER TABLE "utility_payments" ADD COLUMN "payment_method" "ExpensePaymentMethod" NOT NULL DEFAULT 'CASH',
ADD COLUMN "wallet_id" UUID,
ADD COLUMN "attachment_url" TEXT,
ADD COLUMN "paid_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "remaining_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "note" TEXT,
ADD COLUMN "wallet_settled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "wallet_settlement_id" UUID;

-- AlterTable: worker_advances
ALTER TABLE "worker_advances" ADD COLUMN "payment_method" "ExpensePaymentMethod" NOT NULL DEFAULT 'CASH',
ADD COLUMN "wallet_id" UUID,
ADD COLUMN "attachment_url" TEXT,
ADD COLUMN "wallet_settled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "wallet_settlement_id" UUID;

-- AlterTable: purchase_invoices
ALTER TABLE "purchase_invoices" ADD COLUMN "worker_id" UUID,
ADD COLUMN "wallet_settled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "wallet_settlement_id" UUID;

-- AlterTable: supplier_payments
ALTER TABLE "supplier_payments" ADD COLUMN "worker_id" UUID,
ADD COLUMN "wallet_settled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "wallet_settlement_id" UUID;

-- AlterTable: purchase_returns
ALTER TABLE "purchase_returns" ADD COLUMN "worker_id" UUID;

-- Indexes
CREATE INDEX "sales_wallet_id_wallet_settled_idx" ON "sales"("wallet_id", "wallet_settled");
CREATE INDEX "credit_payments_wallet_id_wallet_settled_idx" ON "credit_payments"("wallet_id", "wallet_settled");
CREATE INDEX "purchase_invoices_wallet_id_wallet_settled_idx" ON "purchase_invoices"("wallet_id", "wallet_settled");
CREATE INDEX "supplier_payments_wallet_id_wallet_settled_idx" ON "supplier_payments"("wallet_id", "wallet_settled");
CREATE INDEX "owner_transactions_store_owner_id_transacted_at_idx" ON "owner_transactions"("store_owner_id", "transacted_at");
CREATE INDEX "owner_transactions_wallet_id_wallet_settled_idx" ON "owner_transactions"("wallet_id", "wallet_settled");
CREATE INDEX "wallet_settlements_store_owner_id_wallet_id_settled_at_idx" ON "wallet_settlements"("store_owner_id", "wallet_id", "settled_at");
CREATE INDEX "expense_settlements_store_owner_id_target_type_target_id_idx" ON "expense_settlements"("store_owner_id", "target_type", "target_id");

-- Foreign Keys
ALTER TABLE "sales" ADD CONSTRAINT "sales_wallet_settlement_id_fkey" FOREIGN KEY ("wallet_settlement_id") REFERENCES "wallet_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "credit_payments" ADD CONSTRAINT "credit_payments_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "credit_payments" ADD CONSTRAINT "credit_payments_wallet_settlement_id_fkey" FOREIGN KEY ("wallet_settlement_id") REFERENCES "wallet_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_wallet_settlement_id_fkey" FOREIGN KEY ("wallet_settlement_id") REFERENCES "wallet_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "employee_payments" ADD CONSTRAINT "employee_payments_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employee_payments" ADD CONSTRAINT "employee_payments_wallet_settlement_id_fkey" FOREIGN KEY ("wallet_settlement_id") REFERENCES "wallet_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "rent_records" ADD CONSTRAINT "rent_records_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "rent_records" ADD CONSTRAINT "rent_records_wallet_settlement_id_fkey" FOREIGN KEY ("wallet_settlement_id") REFERENCES "wallet_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "utility_payments" ADD CONSTRAINT "utility_payments_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "utility_payments" ADD CONSTRAINT "utility_payments_wallet_settlement_id_fkey" FOREIGN KEY ("wallet_settlement_id") REFERENCES "wallet_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "worker_advances" ADD CONSTRAINT "worker_advances_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "worker_advances" ADD CONSTRAINT "worker_advances_wallet_settlement_id_fkey" FOREIGN KEY ("wallet_settlement_id") REFERENCES "wallet_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "expense_settlements" ADD CONSTRAINT "expense_settlements_store_owner_id_fkey" FOREIGN KEY ("store_owner_id") REFERENCES "store_owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expense_settlements" ADD CONSTRAINT "expense_settlements_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "expense_settlements" ADD CONSTRAINT "expense_settlements_wallet_settlement_id_fkey" FOREIGN KEY ("wallet_settlement_id") REFERENCES "wallet_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_wallet_settlement_id_fkey" FOREIGN KEY ("wallet_settlement_id") REFERENCES "wallet_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_wallet_settlement_id_fkey" FOREIGN KEY ("wallet_settlement_id") REFERENCES "wallet_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "owner_transactions" ADD CONSTRAINT "owner_transactions_store_owner_id_fkey" FOREIGN KEY ("store_owner_id") REFERENCES "store_owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "owner_transactions" ADD CONSTRAINT "owner_transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "owner_transactions" ADD CONSTRAINT "owner_transactions_wallet_settlement_id_fkey" FOREIGN KEY ("wallet_settlement_id") REFERENCES "wallet_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "wallet_settlements" ADD CONSTRAINT "wallet_settlements_store_owner_id_fkey" FOREIGN KEY ("store_owner_id") REFERENCES "store_owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_settlements" ADD CONSTRAINT "wallet_settlements_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK Constraints
ALTER TABLE "owner_transactions" ADD CONSTRAINT "owner_transactions_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "owner_transactions" ADD CONSTRAINT "owner_transactions_method_check" CHECK ("payment_method" IN ('CASH', 'ELECTRONIC'));
ALTER TABLE "expense_settlements" ADD CONSTRAINT "expense_settlements_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "expense_settlements" ADD CONSTRAINT "expense_settlements_method_check" CHECK ("payment_method" IN ('CASH', 'ELECTRONIC'));
ALTER TABLE "wallet_settlements" ADD CONSTRAINT "wallet_settlements_non_negative" CHECK ("actual_provider_balance" >= 0 AND "cash_out_to_drawer" >= 0);

-- Data Backfills
UPDATE "employee_payments" SET "paid_amount" = "net_paid", "remaining_amount" = 0;
UPDATE "rent_records"
SET "paid_amount" = CASE WHEN "payment_method" = 'CREDIT' THEN 0 ELSE "amount" END,
    "remaining_amount" = CASE WHEN "payment_method" = 'CREDIT' THEN "amount" ELSE 0 END;
UPDATE "utility_payments" SET "paid_amount" = "amount", "remaining_amount" = 0;

UPDATE "wallets" w
SET "account_code" = c."code"
FROM "chart_of_accounts" c
WHERE c."store_owner_id" = w."store_owner_id"
  AND c."account_type" = 'ASSET'
  AND c."name" = ('محفظة: ' || w."name")
  AND w."account_code" IS NULL;

-- Backfill New Chart of Accounts (2100, 3100, 5700) for all existing store owners
INSERT INTO "chart_of_accounts" ("id", "store_owner_id", "code", "name", "account_type", "created_at")
SELECT gen_random_uuid(), "id", '2100', 'مصروفات مستحقة', 'LIABILITY', CURRENT_TIMESTAMP
FROM "store_owners"
ON CONFLICT ("store_owner_id", "code") DO NOTHING;

INSERT INTO "chart_of_accounts" ("id", "store_owner_id", "code", "name", "account_type", "created_at")
SELECT gen_random_uuid(), "id", '3100', 'جاري المالك (مسحوبات وإيداعات المالك)', 'EQUITY', CURRENT_TIMESTAMP
FROM "store_owners"
ON CONFLICT ("store_owner_id", "code") DO NOTHING;

INSERT INTO "chart_of_accounts" ("id", "store_owner_id", "code", "name", "account_type", "created_at")
SELECT gen_random_uuid(), "id", '5700', 'مصروفات أخرى', 'EXPENSE', CURRENT_TIMESTAMP
FROM "store_owners"
ON CONFLICT ("store_owner_id", "code") DO NOTHING;

