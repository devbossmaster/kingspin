import { Injectable } from "@nestjs/common";
import { PaymentProvider } from "@kingspin/db";
import type {
  CreateDepositIntentInput,
  CreateDepositIntentResult,
  CreateWithdrawalPayoutInput,
  CreateWithdrawalPayoutResult,
  PaymentGatewayProvider,
  VerifiedDepositWebhook,
  VerifiedWithdrawalWebhook,
} from "./payment-gateway.provider";

@Injectable()
export class ManualPaymentProvider implements PaymentGatewayProvider {
  getProviderName() {
    return PaymentProvider.MANUAL;
  }

  async createDepositIntent(
    input: CreateDepositIntentInput,
  ): Promise<CreateDepositIntentResult> {
    return {
      providerReference: `manual-deposit:${input.depositId}`,
      checkoutUrl: null,
      metadata: {
        providerMode: "MANUAL",
        requiresAdminReview: true,
      },
    };
  }

  async verifyDepositWebhook(): Promise<VerifiedDepositWebhook> {
    return {
      valid: false,
      reason: "MANUAL provider does not accept public webhooks.",
    };
  }

  async createWithdrawalPayout(
    input: CreateWithdrawalPayoutInput,
  ): Promise<CreateWithdrawalPayoutResult> {
    return {
      providerReference: `manual-withdrawal:${input.withdrawalId}`,
      status: "PROCESSING",
      metadata: {
        providerMode: "MANUAL",
        requiresAdminPayoutMarking: true,
      },
    };
  }

  async verifyWithdrawalWebhook(): Promise<VerifiedWithdrawalWebhook> {
    return {
      valid: false,
      reason: "MANUAL provider does not accept public webhooks.",
    };
  }
}
