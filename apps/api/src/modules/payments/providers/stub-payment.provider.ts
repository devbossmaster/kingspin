import { BadRequestException } from "@nestjs/common";
import type { PaymentProvider } from "@kingspin/db";
import type {
  CreateDepositIntentResult,
  CreateDepositIntentInput,
  CreateWithdrawalPayoutInput,
  CreateWithdrawalPayoutResult,
  PaymentGatewayProvider,
  VerifiedDepositWebhook,
  VerifiedWithdrawalWebhook,
} from "./payment-gateway.provider";

export class StubPaymentProvider implements PaymentGatewayProvider {
  constructor(private readonly provider: PaymentProvider) {}

  getProviderName() {
    return this.provider;
  }

  async createDepositIntent(
    _input: CreateDepositIntentInput,
  ): Promise<CreateDepositIntentResult> {
    throw new BadRequestException(
      `${this.provider} payment adapter is not configured. Install a provider adapter before enabling it.`,
    );
  }

  async verifyDepositWebhook(): Promise<VerifiedDepositWebhook> {
    return {
      valid: false,
      reason: `${this.provider} webhook verification is not configured.`,
    };
  }

  async createWithdrawalPayout(
    _input: CreateWithdrawalPayoutInput,
  ): Promise<CreateWithdrawalPayoutResult> {
    throw new BadRequestException(
      `${this.provider} payout adapter is not configured. Install a provider adapter before enabling it.`,
    );
  }

  async verifyWithdrawalWebhook(): Promise<VerifiedWithdrawalWebhook> {
    return {
      valid: false,
      reason: `${this.provider} withdrawal webhook verification is not configured.`,
    };
  }
}
