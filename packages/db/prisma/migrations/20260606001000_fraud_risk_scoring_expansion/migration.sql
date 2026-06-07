ALTER TYPE "RiskEventType" ADD VALUE 'DUPLICATE_IP_BETTING';
ALTER TYPE "RiskEventType" ADD VALUE 'SAME_DEVICE_MULTI_ACCOUNT';
ALTER TYPE "RiskEventType" ADD VALUE 'DUPLICATE_PAYMENT_RECEIPT';
ALTER TYPE "RiskEventType" ADD VALUE 'MANY_FAILED_RECEIPTS';
ALTER TYPE "RiskEventType" ADD VALUE 'SUSPICIOUS_WITHDRAWAL';
ALTER TYPE "RiskEventType" ADD VALUE 'WITHDRAWAL_AFTER_NEW_DEPOSIT';
ALTER TYPE "RiskEventType" ADD VALUE 'REPEATED_WINNER_ANOMALY';
ALTER TYPE "RiskEventType" ADD VALUE 'MULTI_ACCOUNT_PATTERN';
ALTER TYPE "RiskEventStatus" ADD VALUE 'RESOLVED';

ALTER TABLE "risk_events"
  ADD COLUMN "score" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "summary" TEXT NOT NULL DEFAULT 'Risk event requires review.',
  ADD COLUMN "reason" TEXT,
  ADD COLUMN "relatedType" TEXT,
  ADD COLUMN "relatedId" TEXT,
  ADD COLUMN "ipHash" TEXT,
  ADD COLUMN "userAgentHash" TEXT,
  ADD COLUMN "deviceHash" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "reviewNote" TEXT,
  ADD COLUMN "dismissedAt" TIMESTAMP(3),
  ADD COLUMN "dismissedBy" TEXT;

CREATE INDEX "risk_events_userId_status_idx" ON "risk_events"("userId", "status");
CREATE INDEX "risk_events_type_status_idx" ON "risk_events"("type", "status");
CREATE INDEX "risk_events_severity_status_idx" ON "risk_events"("severity", "status");
CREATE INDEX "risk_events_relatedType_relatedId_idx" ON "risk_events"("relatedType", "relatedId");
CREATE INDEX "risk_events_ipHash_createdAt_idx" ON "risk_events"("ipHash", "createdAt");
CREATE INDEX "risk_events_deviceHash_createdAt_idx" ON "risk_events"("deviceHash", "createdAt");
CREATE INDEX "risk_events_createdAt_idx" ON "risk_events"("createdAt");

CREATE TABLE "risk_signals" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "type" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "roomId" TEXT,
  "roundId" TEXT,
  "relatedType" TEXT,
  "relatedId" TEXT,
  "ipHash" TEXT,
  "userAgentHash" TEXT,
  "deviceHash" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "risk_signals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "risk_signals_userId_createdAt_idx" ON "risk_signals"("userId", "createdAt");
CREATE INDEX "risk_signals_type_createdAt_idx" ON "risk_signals"("type", "createdAt");
CREATE INDEX "risk_signals_roomId_roundId_idx" ON "risk_signals"("roomId", "roundId");
CREATE INDEX "risk_signals_relatedType_relatedId_idx" ON "risk_signals"("relatedType", "relatedId");
CREATE INDEX "risk_signals_ipHash_roundId_createdAt_idx" ON "risk_signals"("ipHash", "roundId", "createdAt");
CREATE INDEX "risk_signals_deviceHash_roundId_createdAt_idx" ON "risk_signals"("deviceHash", "roundId", "createdAt");
CREATE INDEX "risk_signals_createdAt_idx" ON "risk_signals"("createdAt");

ALTER TABLE "risk_signals" ADD CONSTRAINT "risk_signals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
