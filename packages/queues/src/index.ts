export const queueNames = {
  reconciliation: "reconciliationQueue",
  settlementRetry: "settlementRetryQueue",
  refundRetry: "refundRetryQueue",
  fraudCheck: "fraudCheckQueue",
  notification: "notificationQueue",
  adminExport: "adminExportQueue",
} as const;

export type QueueName = (typeof queueNames)[keyof typeof queueNames];

export type ReconciliationJob = {
  walletAccountId?: string;
  onlyDrift?: boolean;
};

export type SettlementRetryJob = {
  roundId: string;
  idempotencyKey: string;
};

export type RefundRetryJob = {
  entryId?: string;
  withdrawalId?: string;
  idempotencyKey: string;
};

export type FraudCheckJob = {
  riskEventId: string;
};

export type NotificationJob = {
  userId: string;
  template: string;
  payload?: Record<string, unknown>;
};

export type AdminExportJob = {
  adminId: string;
  exportType: "AUDIT" | "LEDGER" | "USERS" | "RISK";
  filters?: Record<string, unknown>;
};
