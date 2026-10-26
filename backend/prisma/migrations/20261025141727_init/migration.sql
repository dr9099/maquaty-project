-- CreateEnum
CREATE TYPE "StoreOwnerStatus" AS ENUM ('TRIAL', 'TRIAL_WARNING', 'TRIAL_EXPIRED', 'ACTIVE', 'EXPIRED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "WorkerStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('CASH', 'ELECTRONIC', 'CREDIT');

-- CreateEnum
CREATE TYPE "EmergencyPriceMode" AS ENUM ('COST_ONLY', 'COST_PLUS', 'RANGE_OR_OPEN');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('ACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "SyncOpStatus" AS ENUM ('ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ClosingStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "LedgerReferenceType" AS ENUM ('SALE', 'CREDIT_PAYMENT', 'EXPENSE', 'DAMAGED_GOODS', 'CLOSING', 'RETURN', 'EMERGENCY_SALE_LOSS', 'REJECTED_TRANSACTION_RESOLUTION');

-- CreateEnum
CREATE TYPE "RejectionReasonCode" AS ENUM ('CREDIT_LIMIT_EXCEEDED', 'INSUFFICIENT_STOCK');

-- CreateEnum
CREATE TYPE "RejectedStatus" AS ENUM ('PENDING', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ResolutionAction" AS ENUM ('POST_AS_LOSS', 'ADD_CREDIT', 'APPROVE_ADJUSTED_QTY', 'APPROVE_NEGATIVE_STOCK', 'FINAL_REJECT');

-- CreateEnum
CREATE TYPE "UtilityType" AS ENUM ('WATER', 'ELECTRICITY', 'INTERNET', 'OTHER');

-- CreateEnum
CREATE TYPE "BroadcastType" AS ENUM ('POPUP', 'NOTIFICATION', 'OFFER', 'ADVERTISEMENT', 'STICKY_BANNER');

-- CreateEnum
CREATE TYPE "BroadcastTargetType" AS ENUM ('ALL', 'SPECIFIC_DEVICE', 'TRIAL', 'ACTIVE', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BroadcastPriority" AS ENUM ('NORMAL', 'HIGH');

-- CreateEnum
CREATE TYPE "BroadcastAckType" AS ENUM ('VIEW', 'CLICK');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('PLATFORM_ADMIN', 'STORE_OWNER', 'WORKER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AuditResult" AS ENUM ('SUCCESS', 'FAILURE');

-- CreateEnum
CREATE TYPE "RefreshUserType" AS ENUM ('PLATFORM_ADMIN', 'STORE_OWNER', 'WORKER');

-- CreateTable
CREATE TABLE "platform_admins" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "full_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "mfa_secret" TEXT,
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_owners" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "full_name" TEXT NOT NULL,
    "store_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "status" "StoreOwnerStatus" NOT NULL DEFAULT 'TRIAL',
    "trial_sales_used" INTEGER NOT NULL DEFAULT 0,
    "trial_sales_limit" INTEGER NOT NULL DEFAULT 100,
    "max_workers_allowed" INTEGER NOT NULL DEFAULT 0,
    "temp_password_hash" TEXT,
    "temp_password_generated_at" TIMESTAMP(3),
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_owners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_owner_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "status" "WorkerStatus" NOT NULL DEFAULT 'ACTIVE',
    "suspended_manually_before_owner_lock" BOOLEAN NOT NULL DEFAULT false,
    "is_responsible" BOOLEAN NOT NULL DEFAULT false,
    "perm_show_cost_price" BOOLEAN NOT NULL DEFAULT false,
    "perm_show_sell_prices_inventory" BOOLEAN NOT NULL DEFAULT false,
    "perm_damaged_goods_entry" BOOLEAN NOT NULL DEFAULT true,
    "perm_reports_access" BOOLEAN NOT NULL DEFAULT false,
    "perm_enter_own_advance" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "duration_days" INTEGER NOT NULL,
    "is_custom" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_owner_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "activated_by" UUID NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "agreed_amount" DECIMAL(12,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "device_fingerprint" TEXT NOT NULL,
    "store_owner_id" UUID,
    "worker_id" UUID,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_sync_at" TIMESTAMP(3),
    "last_sync_version" BIGINT NOT NULL DEFAULT 0,
    "app_version" TEXT,
    "os" TEXT,
    "status" "DeviceStatus" NOT NULL DEFAULT 'ACTIVE',
    "trial_consumed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_operations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_owner_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "client_op_id" TEXT NOT NULL,
    "op_type" TEXT NOT NULL,
    "status" "SyncOpStatus" NOT NULL,
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_type" "RefreshUserType" NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" UUID,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "cost_price" DECIMAL(12,2) NOT NULL,
    "sell_price" DECIMAL(12,2) NOT NULL,
    "entry_date" DATE NOT NULL,
    "emergency_price_mode" "EmergencyPriceMode" NOT NULL DEFAULT 'RANGE_OR_OPEN',
    "emergency_price_plus_fixed" DECIMAL(12,2),
    "emergency_price_plus_percent" DECIMAL(5,2),
    "emergency_price_min" DECIMAL(12,2),
    "emergency_price_max" DECIMAL(12,2),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_owner_id" UUID NOT NULL,
    "worker_id" UUID,
    "item_id" UUID NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "payment_type" "PaymentType" NOT NULL,
    "wallet_id" UUID,
    "deposit_attachment_url" TEXT,
    "credit_customer_id" UUID,
    "is_emergency_sale" BOOLEAN NOT NULL DEFAULT false,
    "emergency_reason" TEXT,
    "emergency_override_price" DECIMAL(12,2),
    "price_difference_loss" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "daily_closing_id" UUID,
    "sold_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rejected_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_owner_id" UUID NOT NULL,
    "worker_id" UUID,
    "attempted_payload" JSONB NOT NULL,
    "rejection_reason_code" "RejectionReasonCode" NOT NULL,
    "rejection_reason_detail" TEXT,
    "status" "RejectedStatus" NOT NULL DEFAULT 'PENDING',
    "resolution_action" "ResolutionAction",
    "adjusted_quantity" DECIMAL(12,3),
    "resolved_by" UUID,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rejected_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "damaged_goods" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_owner_id" UUID NOT NULL,
    "worker_id" UUID,
    "item_id" UUID NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "is_damaged" BOOLEAN NOT NULL,
    "reason" TEXT,
    "photo_url" TEXT,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "damaged_goods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_customers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "credit_limit" DECIMAL(12,2),
    "added_by_worker_id" UUID,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_owner_id" UUID NOT NULL,
    "credit_customer_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "payment_method" "PaymentType" NOT NULL,
    "wallet_id" UUID,
    "worker_id" UUID,
    "daily_closing_id" UUID,
    "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_owner_id" UUID NOT NULL,
    "linked_worker_id" UUID,
    "name" TEXT NOT NULL,
    "monthly_due" DECIMAL(12,2) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_advances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_owner_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_owner_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rent_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_owner_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "payment_method" TEXT NOT NULL,
    "payer_name" TEXT NOT NULL,
    "receiver_name" TEXT NOT NULL,
    "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "utility_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_owner_id" UUID NOT NULL,
    "utility_type" "UtilityType" NOT NULL,
    "utility_type_other" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "utility_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_advances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_owner_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worker_advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_closings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_owner_id" UUID NOT NULL,
    "worker_id" UUID,
    "closing_date" DATE NOT NULL,
    "actual_cash" DECIMAL(12,2) NOT NULL,
    "expected_cash" DECIMAL(12,2) NOT NULL,
    "difference" DECIMAL(12,2) NOT NULL,
    "status" "ClosingStatus" NOT NULL DEFAULT 'OPEN',
    "approved_by" UUID,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_closings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chart_of_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_owner_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "account_type" "AccountType" NOT NULL,
    "parent_account_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chart_of_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_owner_id" UUID NOT NULL,
    "entry_date" DATE NOT NULL,
    "reference_type" "LedgerReferenceType" NOT NULL,
    "reference_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "debit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "returns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_owner_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "worker_id" UUID,
    "quantity" DECIMAL(12,3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "returned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "item_id" UUID,

    CONSTRAINT "returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broadcasts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_by" UUID NOT NULL,
    "type" "BroadcastType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "image_url" TEXT,
    "button_text" TEXT,
    "button_url" TEXT,
    "duration_hours" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3),
    "dismissible" BOOLEAN NOT NULL DEFAULT true,
    "priority" "BroadcastPriority" NOT NULL DEFAULT 'NORMAL',
    "target_type" "BroadcastTargetType" NOT NULL,
    "target_device_id" UUID,
    "discount_code" TEXT,
    "discount_percent_text" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "views_count" INTEGER NOT NULL DEFAULT 0,
    "clicks_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broadcast_acks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "broadcast_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "store_owner_id" UUID,
    "ack_type" "BroadcastAckType" NOT NULL,
    "acked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broadcast_acks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_type" "ActorType" NOT NULL,
    "actor_id" UUID,
    "action_type" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" UUID,
    "old_value" JSONB,
    "new_value" JSONB,
    "ip_address" TEXT,
    "device_info" TEXT,
    "result" "AuditResult" NOT NULL,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "cloud_backups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_owner_id" UUID NOT NULL,
    "file_url" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "tenant_binding_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cloud_backups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "temp_password_audits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admin_id" UUID NOT NULL,
    "store_owner_id" UUID NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),

    CONSTRAINT "temp_password_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_admins_phone_key" ON "platform_admins"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "store_owners_phone_key" ON "store_owners"("phone");

-- CreateIndex
CREATE INDEX "store_owners_status_idx" ON "store_owners"("status");

-- CreateIndex
CREATE UNIQUE INDEX "workers_phone_key" ON "workers"("phone");

-- CreateIndex
CREATE INDEX "workers_store_owner_id_status_idx" ON "workers"("store_owner_id", "status");

-- CreateIndex
CREATE INDEX "subscriptions_store_owner_id_status_idx" ON "subscriptions"("store_owner_id", "status");

-- CreateIndex
CREATE INDEX "subscriptions_expires_at_idx" ON "subscriptions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "devices_device_fingerprint_key" ON "devices"("device_fingerprint");

-- CreateIndex
CREATE INDEX "devices_store_owner_id_idx" ON "devices"("store_owner_id");

-- CreateIndex
CREATE INDEX "devices_worker_id_idx" ON "devices"("worker_id");

-- CreateIndex
CREATE UNIQUE INDEX "sync_operations_store_owner_id_client_op_id_key" ON "sync_operations"("store_owner_id", "client_op_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_sessions_token_hash_key" ON "refresh_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_sessions_user_id_user_type_idx" ON "refresh_sessions"("user_id", "user_type");

-- CreateIndex
CREATE INDEX "items_store_owner_id_entry_date_idx" ON "items"("store_owner_id", "entry_date");

-- CreateIndex
CREATE INDEX "sales_store_owner_id_worker_id_sold_at_idx" ON "sales"("store_owner_id", "worker_id", "sold_at");

-- CreateIndex
CREATE INDEX "sales_daily_closing_id_idx" ON "sales"("daily_closing_id");

-- CreateIndex
CREATE INDEX "rejected_transactions_store_owner_id_status_idx" ON "rejected_transactions"("store_owner_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "daily_closings_store_owner_id_worker_id_closing_date_key" ON "daily_closings"("store_owner_id", "worker_id", "closing_date");

-- CreateIndex
CREATE UNIQUE INDEX "chart_of_accounts_store_owner_id_code_key" ON "chart_of_accounts"("store_owner_id", "code");

-- CreateIndex
CREATE INDEX "ledger_entries_store_owner_id_entry_date_idx" ON "ledger_entries"("store_owner_id", "entry_date");

-- CreateIndex
CREATE INDEX "ledger_entries_reference_type_reference_id_idx" ON "ledger_entries"("reference_type", "reference_id");

-- CreateIndex
CREATE INDEX "ledger_entries_account_id_idx" ON "ledger_entries"("account_id");

-- CreateIndex
CREATE INDEX "audit_log_actor_id_idx" ON "audit_log"("actor_id");

-- CreateIndex
CREATE INDEX "audit_log_target_type_target_id_idx" ON "audit_log"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- CreateIndex
CREATE INDEX "cloud_backups_store_owner_id_created_at_idx" ON "cloud_backups"("store_owner_id", "created_at");

-- CreateIndex
CREATE INDEX "temp_password_audits_store_owner_id_idx" ON "temp_password_audits"("store_owner_id");

-- AddForeignKey
ALTER TABLE "workers" ADD CONSTRAINT "workers_store_owner_id_fkey" FOREIGN KEY ("store_owner_id") REFERENCES "store_owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_store_owner_id_fkey" FOREIGN KEY ("store_owner_id") REFERENCES "store_owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_activated_by_fkey" FOREIGN KEY ("activated_by") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_store_owner_id_fkey" FOREIGN KEY ("store_owner_id") REFERENCES "store_owners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_operations" ADD CONSTRAINT "sync_operations_store_owner_id_fkey" FOREIGN KEY ("store_owner_id") REFERENCES "store_owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_operations" ADD CONSTRAINT "sync_operations_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_store_owner_id_fkey" FOREIGN KEY ("store_owner_id") REFERENCES "store_owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_store_owner_id_fkey" FOREIGN KEY ("store_owner_id") REFERENCES "store_owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_credit_customer_id_fkey" FOREIGN KEY ("credit_customer_id") REFERENCES "credit_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_daily_closing_id_fkey" FOREIGN KEY ("daily_closing_id") REFERENCES "daily_closings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_store_owner_id_fkey" FOREIGN KEY ("store_owner_id") REFERENCES "store_owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rejected_transactions" ADD CONSTRAINT "rejected_transactions_store_owner_id_fkey" FOREIGN KEY ("store_owner_id") REFERENCES "store_owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damaged_goods" ADD CONSTRAINT "damaged_goods_store_owner_id_fkey" FOREIGN KEY ("store_owner_id") REFERENCES "store_owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damaged_goods" ADD CONSTRAINT "damaged_goods_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damaged_goods" ADD CONSTRAINT "damaged_goods_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_customers" ADD CONSTRAINT "credit_customers_store_owner_id_fkey" FOREIGN KEY ("store_owner_id") REFERENCES "store_owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_payments" ADD CONSTRAINT "credit_payments_store_owner_id_fkey" FOREIGN KEY ("store_owner_id") REFERENCES "store_owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_payments" ADD CONSTRAINT "credit_payments_credit_customer_id_fkey" FOREIGN KEY ("credit_customer_id") REFERENCES "credit_customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_payments" ADD CONSTRAINT "credit_payments_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_payments" ADD CONSTRAINT "credit_payments_daily_closing_id_fkey" FOREIGN KEY ("daily_closing_id") REFERENCES "daily_closings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_store_owner_id_fkey" FOREIGN KEY ("store_owner_id") REFERENCES "store_owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_linked_worker_id_fkey" FOREIGN KEY ("linked_worker_id") REFERENCES "workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_payments" ADD CONSTRAINT "employee_payments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rent_records" ADD CONSTRAINT "rent_records_store_owner_id_fkey" FOREIGN KEY ("store_owner_id") REFERENCES "store_owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "utility_payments" ADD CONSTRAINT "utility_payments_store_owner_id_fkey" FOREIGN KEY ("store_owner_id") REFERENCES "store_owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_advances" ADD CONSTRAINT "worker_advances_store_owner_id_fkey" FOREIGN KEY ("store_owner_id") REFERENCES "store_owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_advances" ADD CONSTRAINT "worker_advances_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_closings" ADD CONSTRAINT "daily_closings_store_owner_id_fkey" FOREIGN KEY ("store_owner_id") REFERENCES "store_owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_store_owner_id_fkey" FOREIGN KEY ("store_owner_id") REFERENCES "store_owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_parent_account_id_fkey" FOREIGN KEY ("parent_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_store_owner_id_fkey" FOREIGN KEY ("store_owner_id") REFERENCES "store_owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_store_owner_id_fkey" FOREIGN KEY ("store_owner_id") REFERENCES "store_owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_acks" ADD CONSTRAINT "broadcast_acks_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "broadcasts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_acks" ADD CONSTRAINT "broadcast_acks_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_acks" ADD CONSTRAINT "broadcast_acks_store_owner_id_fkey" FOREIGN KEY ("store_owner_id") REFERENCES "store_owners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cloud_backups" ADD CONSTRAINT "cloud_backups_store_owner_id_fkey" FOREIGN KEY ("store_owner_id") REFERENCES "store_owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temp_password_audits" ADD CONSTRAINT "temp_password_audits_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═══ قيود سلامة إضافية من DATABASE_DESIGN.md ═══

-- daily_closings: منع تكرار إغلاق المالك (worker_id NULL) في نفس اليوم — PostgreSQL 15+
DROP INDEX IF EXISTS "daily_closings_store_owner_id_worker_id_closing_date_key";
ALTER TABLE "daily_closings"
  ADD CONSTRAINT "daily_closings_owner_worker_date_unique"
  UNIQUE NULLS NOT DISTINCT ("store_owner_id", "worker_id", "closing_date");

-- items: قاعدة سلامة quantity >= 0 (BR-004)
ALTER TABLE "items" ADD CONSTRAINT "items_quantity_non_negative" CHECK ("quantity" >= 0);

-- damaged_goods: السبب والصورة إلزاميان معاً عند is_damaged=true (BR-014)
ALTER TABLE "damaged_goods" ADD CONSTRAINT "damaged_reason_photo_required"
  CHECK (NOT ("is_damaged" = TRUE AND ("reason" IS NULL OR "photo_url" IS NULL)));

-- sales: الإلكتروني يتطلب محفظة + مرفق إيداع معاً (BR-007)
ALTER TABLE "sales" ADD CONSTRAINT "sales_electronic_requires_wallet_and_deposit"
  CHECK (("payment_type" = 'ELECTRONIC' AND "wallet_id" IS NOT NULL AND "deposit_attachment_url" IS NOT NULL)
      OR ("payment_type" <> 'ELECTRONIC'));

-- sales: الآجل يتطلب عميلاً (قاعدة سلامة من DATABASE_DESIGN.md)
ALTER TABLE "sales" ADD CONSTRAINT "sales_credit_requires_customer"
  CHECK (("payment_type" = 'CREDIT' AND "credit_customer_id" IS NOT NULL)
      OR ("payment_type" <> 'CREDIT'));

-- rejected_transactions: خيارات المعالجة حسب R-30
ALTER TABLE "rejected_transactions" DROP CONSTRAINT IF EXISTS "rejected_transactions_resolution_action_check";
ALTER TABLE "rejected_transactions" ADD CONSTRAINT "rejected_transactions_resolution_action_check"
  CHECK ("resolution_action" IN ('POST_AS_LOSS','ADD_CREDIT','APPROVE_ADJUSTED_QTY','APPROVE_NEGATIVE_STOCK','FINAL_REJECT'));
ALTER TABLE "rejected_transactions" ADD CONSTRAINT "rejected_transactions_reason_check"
  CHECK ("rejection_reason_code" IN ('CREDIT_LIMIT_EXCEEDED','INSUFFICIENT_STOCK'));
