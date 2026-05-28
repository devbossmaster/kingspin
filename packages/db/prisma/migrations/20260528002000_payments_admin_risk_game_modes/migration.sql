-- Production foundation: provider-agnostic payments, withdrawals, risk events,
-- worker job logs, and room-level game mode configuration.

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'OWNER';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SUPPORT';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'FINANCE';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'RISK';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'VIEWER';

ALTER TYPE "LedgerTransactionType" ADD VALUE IF NOT EXISTS 'WITHDRAWAL_REFUND';

ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'ROOM_CONFIGURED';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'DEPOSIT_APPROVED';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'DEPOSIT_CANCELLED';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'WITHDRAWAL_APPROVED';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'WITHDRAWAL_REJECTED';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'WITHDRAWAL_MARKED_PROCESSING';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'WITHDRAWAL_MARKED_PAID';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'WITHDRAWAL_MARKED_FAILED';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'RISK_EVENT_REVIEWED';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'RISK_EVENT_DISMISSED';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'RISK_EVENT_ACTIONED';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'USER_SUSPENDED';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'USER_UNSUSPENDED';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'ROUND_STARTED';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'ROUND_LOCKED';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'ROUND_DRAWN';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'ROUND_SETTLED';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'ROUND_CANCELLED';

CREATE TYPE "GameMode" AS ENUM ('FLEXIBLE_PROPORTIONAL', 'FIXED_EQUAL_CHANCE');
CREATE TYPE "PaymentProvider" AS ENUM ('MANUAL', 'MOCK', 'NOWPAYMENTS', 'CHAPA', 'STRIPE', 'CUSTOM');
CREATE TYPE "DepositStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'EXPIRED', 'CANCELLED');
CREATE TYPE "WithdrawalStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'PROCESSING', 'PAID', 'REJECTED', 'FAILED', 'CANCELLED');
CREATE TYPE "RiskEventType" AS ENUM (
  'IDEMPOTENCY_MISMATCH',
  'ENTRY_RATE_LIMIT_HIT',
  'INSUFFICIENT_BALANCE_SPAM',
  'DUPLICATE_IP_DEVICE',
  'DEPOSIT_WEBHOOK_MISMATCH',
  'WITHDRAWAL_AMOUNT_SPIKE',
  'FAST_DEPOSIT_WITHDRAWAL',
  'ABNORMAL_WIN_PATTERN',
  'ADMIN_ROUND_INTERVENTION',
  'PAYMENT_FAILURE_PATTERN',
  'MANUAL_FLAG'
);
CREATE TYPE "RiskEventSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "RiskEventStatus" AS ENUM ('OPEN', 'REVIEWED', 'DISMISSED', 'ACTIONED');
CREATE TYPE "WorkerJobStatus" AS ENUM ('QUEUED', 'ACTIVE', 'COMPLETED', 'RETRYING', 'FAILED', 'DEAD_LETTER');

ALTER TABLE "rooms"
  ADD COLUMN "gameMode" "GameMode" NOT NULL DEFAULT 'FLEXIBLE_PROPORTIONAL',
  ADD COLUMN "fixedEntryAmount" BIGINT;

CREATE INDEX "rooms_gameMode_idx" ON "rooms"("gameMode");

CREATE TABLE "deposits" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "providerReference" TEXT,
  "amount" BIGINT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'COIN',
  "status" "DepositStatus" NOT NULL DEFAULT 'PENDING',
  "idempotencyKey" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  CONSTRAINT "deposits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "deposits_idempotencyKey_key" ON "deposits"("idempotencyKey");
CREATE UNIQUE INDEX "deposits_provider_providerReference_key" ON "deposits"("provider", "providerReference");
CREATE INDEX "deposits_userId_createdAt_idx" ON "deposits"("userId", "createdAt");
CREATE INDEX "deposits_status_createdAt_idx" ON "deposits"("status", "createdAt");
CREATE INDEX "deposits_provider_status_createdAt_idx" ON "deposits"("provider", "status", "createdAt");

CREATE TABLE "withdrawals" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "walletAccountId" TEXT NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "amount" BIGINT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'COIN',
  "destination" JSONB NOT NULL,
  "status" "WithdrawalStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "providerReference" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "reviewedByAdminId" TEXT,
  "paidAt" TIMESTAMP(3),
  "rejectionReason" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "withdrawals_idempotencyKey_key" ON "withdrawals"("idempotencyKey");
CREATE INDEX "withdrawals_userId_requestedAt_idx" ON "withdrawals"("userId", "requestedAt");
CREATE INDEX "withdrawals_walletAccountId_requestedAt_idx" ON "withdrawals"("walletAccountId", "requestedAt");
CREATE INDEX "withdrawals_status_requestedAt_idx" ON "withdrawals"("status", "requestedAt");
CREATE INDEX "withdrawals_provider_status_requestedAt_idx" ON "withdrawals"("provider", "status", "requestedAt");

CREATE TABLE "risk_events" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "roomId" TEXT,
  "roundId" TEXT,
  "type" "RiskEventType" NOT NULL,
  "severity" "RiskEventSeverity" NOT NULL,
  "status" "RiskEventStatus" NOT NULL DEFAULT 'OPEN',
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedByAdminId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  CONSTRAINT "risk_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "risk_events_userId_createdAt_idx" ON "risk_events"("userId", "createdAt");
CREATE INDEX "risk_events_roomId_createdAt_idx" ON "risk_events"("roomId", "createdAt");
CREATE INDEX "risk_events_roundId_createdAt_idx" ON "risk_events"("roundId", "createdAt");
CREATE INDEX "risk_events_type_createdAt_idx" ON "risk_events"("type", "createdAt");
CREATE INDEX "risk_events_severity_status_createdAt_idx" ON "risk_events"("severity", "status", "createdAt");

CREATE TABLE "worker_job_logs" (
  "id" TEXT NOT NULL,
  "queue" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "WorkerJobStatus" NOT NULL DEFAULT 'QUEUED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 1,
  "error" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  CONSTRAINT "worker_job_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "worker_job_logs_queue_jobId_key" ON "worker_job_logs"("queue", "jobId");
CREATE INDEX "worker_job_logs_queue_status_createdAt_idx" ON "worker_job_logs"("queue", "status", "createdAt");
CREATE INDEX "worker_job_logs_status_createdAt_idx" ON "worker_job_logs"("status", "createdAt");

ALTER TABLE "deposits" ADD CONSTRAINT "deposits_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_walletAccountId_fkey" FOREIGN KEY ("walletAccountId") REFERENCES "wallet_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_reviewedByAdminId_fkey" FOREIGN KEY ("reviewedByAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "risk_events" ADD CONSTRAINT "risk_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "risk_events" ADD CONSTRAINT "risk_events_reviewedByAdminId_fkey" FOREIGN KEY ("reviewedByAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
