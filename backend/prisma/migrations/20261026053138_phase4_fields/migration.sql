-- AlterTable
ALTER TABLE "employee_advances" ADD COLUMN     "settled_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "employee_payments" ADD COLUMN     "advance_deducted" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "net_paid" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "workers" ADD COLUMN     "perm_edit_worker_closing_cash" BOOLEAN NOT NULL DEFAULT true;

-- RenameIndex
ALTER INDEX "daily_closings_owner_worker_date_unique" RENAME TO "daily_closings_store_owner_id_worker_id_closing_date_key";
