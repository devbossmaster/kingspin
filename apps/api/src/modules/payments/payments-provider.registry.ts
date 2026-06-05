import { Injectable } from '@nestjs/common';
import { PaymentProvider } from '@kingspin/db';
import { getApiEnv } from '../../config/api-env';
import { ManualPaymentProvider } from './providers/manual-payment.provider';
import { MockPaymentProvider } from './providers/mock-payment.provider';
import type { PaymentGatewayProvider } from './providers/payment-gateway.provider';
import { StubPaymentProvider } from './providers/stub-payment.provider';
import { TelebirrReceiptProvider } from './providers/telebirr-receipt/telebirr-receipt.provider';

@Injectable()
export class PaymentsProviderRegistry {
  private readonly stubs = new Map<PaymentProvider, PaymentGatewayProvider>();

  constructor(
    private readonly manualProvider: ManualPaymentProvider,
    private readonly mockProvider: MockPaymentProvider,
    private readonly telebirrReceiptProvider: TelebirrReceiptProvider,
  ) {}

  getDefaultProvider() {
    const configured = process.env.PAYMENT_PROVIDER?.trim().toUpperCase();

    if (configured && this.isProvider(configured)) {
      return configured;
    }

    return getApiEnv().APP_ENV === 'local'
      ? PaymentProvider.MOCK
      : PaymentProvider.MANUAL;
  }

  getProvider(provider = this.getDefaultProvider()): PaymentGatewayProvider {
    if (provider === PaymentProvider.MANUAL) {
      return this.manualProvider;
    }

    if (provider === PaymentProvider.MOCK) {
      return this.mockProvider;
    }

    if (provider === PaymentProvider.TELEBIRR_RECEIPT) {
      return this.manualProvider;
    }

    const existing = this.stubs.get(provider);

    if (existing) {
      return existing;
    }

    const stub = new StubPaymentProvider(provider);
    this.stubs.set(provider, stub);

    return stub;
  }

  listProviders() {
    return Object.values(PaymentProvider).map((provider) => ({
      provider,
      configured:
        provider === PaymentProvider.MANUAL ||
        provider === PaymentProvider.MOCK ||
        (provider === PaymentProvider.TELEBIRR_RECEIPT &&
          this.telebirrReceiptProvider.getConfig().enabled),
      default: provider === this.getDefaultProvider(),
    }));
  }

  private isProvider(value: string): value is PaymentProvider {
    return Object.values(PaymentProvider).includes(value as PaymentProvider);
  }
}
