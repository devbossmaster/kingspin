import type { PaymentProvider } from "@kingspin/db";

export type CreateDepositIntentInput = {
  depositId: string;
  userId: string;
  amount: bigint;
  currency: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
};

export type CreateDepositIntentResult = {
  providerReference: string;
  checkoutUrl?: string | null;
  metadata?: Record<string, unknown>;
};

export type VerifyDepositWebhookInput = {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
};

export type VerifiedDepositWebhook = {
  valid: boolean;
  providerReference?: string;
  status?: "CONFIRMED" | "FAILED" | "EXPIRED" | "CANCELLED";
  amount?: bigint;
  currency?: string;
  metadata?: Record<string, unknown>;
  reason?: string;
};

export type CreateWithdrawalPayoutInput = {
  withdrawalId: string;
  userId: string;
  amount: bigint;
  currency: string;
  destination: Record<string, unknown>;
  idempotencyKey: string;
};

export type CreateWithdrawalPayoutResult = {
  providerReference: string;
  status: "PROCESSING" | "PAID";
  metadata?: Record<string, unknown>;
};

export type VerifyWithdrawalWebhookInput = VerifyDepositWebhookInput;

export type VerifiedWithdrawalWebhook = {
  valid: boolean;
  providerReference?: string;
  status?: "PROCESSING" | "PAID" | "FAILED" | "CANCELLED";
  metadata?: Record<string, unknown>;
  reason?: string;
};

export interface PaymentGatewayProvider {
  getProviderName(): PaymentProvider;
  createDepositIntent(
    input: CreateDepositIntentInput,
  ): Promise<CreateDepositIntentResult>;
  verifyDepositWebhook(
    input: VerifyDepositWebhookInput,
  ): Promise<VerifiedDepositWebhook>;
  createWithdrawalPayout(
    input: CreateWithdrawalPayoutInput,
  ): Promise<CreateWithdrawalPayoutResult>;
  verifyWithdrawalWebhook(
    input: VerifyWithdrawalWebhookInput,
  ): Promise<VerifiedWithdrawalWebhook>;
}
