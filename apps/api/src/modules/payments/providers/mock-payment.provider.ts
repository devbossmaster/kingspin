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
  VerifyDepositWebhookInput,
  VerifyWithdrawalWebhookInput,
} from "./payment-gateway.provider";

@Injectable()
export class MockPaymentProvider implements PaymentGatewayProvider {
  getProviderName() {
    return PaymentProvider.MOCK;
  }

  async createDepositIntent(
    input: CreateDepositIntentInput,
  ): Promise<CreateDepositIntentResult> {
    return {
      providerReference: `mock-deposit:${input.depositId}`,
      checkoutUrl: null,
      metadata: {
        providerMode: "MOCK",
        localOnly: true,
      },
    };
  }

  async verifyDepositWebhook(
    input: VerifyDepositWebhookInput,
  ): Promise<VerifiedDepositWebhook> {
    const body = this.toRecord(input.body);

    return {
      valid: body.providerReference !== null,
      providerReference: body.providerReference ?? undefined,
      status: this.toDepositStatus(body.status) ?? "CONFIRMED",
      amount: body.amount,
      currency: body.currency ?? "COIN",
      metadata: body.raw,
    };
  }

  async createWithdrawalPayout(
    input: CreateWithdrawalPayoutInput,
  ): Promise<CreateWithdrawalPayoutResult> {
    return {
      providerReference: `mock-withdrawal:${input.withdrawalId}`,
      status: "PROCESSING",
      metadata: {
        providerMode: "MOCK",
        localOnly: true,
      },
    };
  }

  async verifyWithdrawalWebhook(
    input: VerifyWithdrawalWebhookInput,
  ): Promise<VerifiedWithdrawalWebhook> {
    const body = this.toRecord(input.body);

    return {
      valid: body.providerReference !== null,
      providerReference: body.providerReference ?? undefined,
      status: this.toWithdrawalStatus(body.status) ?? "PROCESSING",
      metadata: body.raw,
    };
  }

  private toRecord(body: unknown) {
    const raw =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const providerReference =
      typeof raw.providerReference === "string"
        ? raw.providerReference
        : typeof raw.reference === "string"
          ? raw.reference
          : null;
    const amount =
      typeof raw.amount === "number" && Number.isSafeInteger(raw.amount)
        ? BigInt(raw.amount)
        : typeof raw.amount === "string" && /^\d+$/.test(raw.amount)
          ? BigInt(raw.amount)
          : undefined;
    const currency = typeof raw.currency === "string" ? raw.currency : undefined;
    const status = typeof raw.status === "string" ? raw.status : undefined;

    return { raw, providerReference, amount, currency, status };
  }

  private toDepositStatus(status: string | undefined) {
    if (
      status === "CONFIRMED" ||
      status === "FAILED" ||
      status === "EXPIRED" ||
      status === "CANCELLED"
    ) {
      return status;
    }

    return null;
  }

  private toWithdrawalStatus(status: string | undefined) {
    if (
      status === "PROCESSING" ||
      status === "PAID" ||
      status === "FAILED" ||
      status === "CANCELLED"
    ) {
      return status;
    }

    return null;
  }
}
