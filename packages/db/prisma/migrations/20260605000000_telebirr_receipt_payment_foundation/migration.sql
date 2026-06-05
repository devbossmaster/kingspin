-- Telebirr receipt payment foundation.
-- Adds server-side receipt verification intent/attempt tables while keeping
-- wallet mutation in the existing append-only ledger service.

ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'TELEBIRR_RECEIPT';
ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'TELEBIRR_OFFICIAL';
ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'MANUAL_BANK';

ALTER TYPE "DepositStatus" ADD VALUE IF NOT EXISTS 'VERIFYING';
ALTER TYPE "DepositStatus" ADD VALUE IF NOT EXISTS 'VERIFIED';
ALTER TYPE "DepositStatus" ADD VALUE IF NOT EXISTS 'CREDITED';
ALTER TYPE "DepositStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
ALTER TYPE "DepositStatus" ADD VALUE IF NOT EXISTS 'NEEDS_MANUAL_REVIEW';

ALTER TYPE "WithdrawalStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';

ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'DEPOSIT_REJECTED';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'WITHDRAWAL_COMPLETED';

CREATE TYPE "VerificationAttemptStatus" AS ENUM (
  'ACCEPTED',
  'REJECTED',
  'NEEDS_MANUAL_REVIEW',
  'FETCH_FAILED',
  'PARSE_FAILED'
);

CREATE TABLE "deposit_intents" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "status" "DepositStatus" NOT NULL DEFAULT 'PENDING',
  "expectedAmount" DECIMAL(18, 2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'ETB',
  "receiverName" TEXT,
  "receiverAccount" TEXT,
  "receiverShortCode" TEXT,
  "providerRef" TEXT,
  "receiptNo" TEXT,
  "creditedWalletEntryId" TEXT,
  "idempotencyKey" TEXT,
  "rejectionReason" TEXT,
  "reviewReason" TEXT,
  "rawProviderHash" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "creditedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "deposit_intents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "deposit_intents_providerRef_key" ON "deposit_intents"("providerRef");
CREATE UNIQUE INDEX "deposit_intents_receiptNo_key" ON "deposit_intents"("receiptNo");
CREATE UNIQUE INDEX "deposit_intents_idempotencyKey_key" ON "deposit_intents"("idempotencyKey");
CREATE INDEX "deposit_intents_userId_status_idx" ON "deposit_intents"("userId", "status");
CREATE INDEX "deposit_intents_provider_status_idx" ON "deposit_intents"("provider", "status");
CREATE INDEX "deposit_intents_createdAt_idx" ON "deposit_intents"("createdAt");

CREATE TABLE "payment_verification_attempts" (
  "id" TEXT NOT NULL,
  "depositIntentId" TEXT NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "submittedValue" TEXT NOT NULL,
  "normalizedRef" TEXT,
  "status" "VerificationAttemptStatus" NOT NULL,
  "reason" TEXT,
  "httpStatus" INTEGER,
  "providerStatus" TEXT,
  "parsedAmount" DECIMAL(18, 2),
  "parsedCurrency" TEXT,
  "parsedReceiver" TEXT,
  "parsedPayer" TEXT,
  "parsedPaidAt" TIMESTAMP(3),
  "rawProviderHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_verification_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payment_verification_attempts_depositIntentId_idx" ON "payment_verification_attempts"("depositIntentId");
CREATE INDEX "payment_verification_attempts_normalizedRef_idx" ON "payment_verification_attempts"("normalizedRef");
CREATE INDEX "payment_verification_attempts_createdAt_idx" ON "payment_verification_attempts"("createdAt");

ALTER TABLE "deposit_intents" ADD CONSTRAINT "deposit_intents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_verification_attempts" ADD CONSTRAINT "payment_verification_attempts_depositIntentId_fkey" FOREIGN KEY ("depositIntentId") REFERENCES "deposit_intents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
