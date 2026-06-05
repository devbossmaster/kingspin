import { BadRequestException, Injectable } from '@nestjs/common';
import { PaymentProvider } from '@kingspin/db';
import { getTelebirrReceiptConfig } from './telebirr-receipt.config';
import { TelebirrReceiptClient } from './telebirr-receipt.client';
import { normalizeTelebirrReceiptInput } from './telebirr-receipt.normalizer';
import { TelebirrReceiptParser } from './telebirr-receipt.parser';
import type {
  TelebirrReceiptConfig,
  TelebirrReceiptVerificationResult,
} from './telebirr-receipt.types';

@Injectable()
export class TelebirrReceiptProvider {
  constructor(
    private readonly client: TelebirrReceiptClient,
    private readonly parser: TelebirrReceiptParser,
  ) {}

  getProviderName() {
    return PaymentProvider.TELEBIRR_RECEIPT;
  }

  getConfig(): TelebirrReceiptConfig {
    return getTelebirrReceiptConfig();
  }

  normalizeReceiptInput(input: string) {
    return normalizeTelebirrReceiptInput(input);
  }

  async fetchAndParseReceipt(
    receiptNo: string,
  ): Promise<TelebirrReceiptVerificationResult> {
    const config = this.getConfig();

    if (!config.enabled) {
      throw new BadRequestException(
        'Telebirr receipt verification is not enabled.',
      );
    }

    const fetched = await this.client.fetchReceipt(receiptNo, config);
    const parsed = this.parser.parse(fetched.body);

    return {
      receiptNo,
      httpStatus: fetched.httpStatus,
      providerStatus: parsed.transactionStatus,
      rawProviderHash: fetched.rawProviderHash,
      parsed,
    };
  }
}
