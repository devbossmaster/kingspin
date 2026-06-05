import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { TelebirrReceiptClient } from './telebirr-receipt.client';
import { normalizeTelebirrReceiptInput } from './telebirr-receipt.normalizer';
import { TelebirrReceiptParser } from './telebirr-receipt.parser';

describe('Telebirr receipt provider foundation', () => {
  it('extracts a receipt id from an official URL', () => {
    expect(
      normalizeTelebirrReceiptInput(
        'https://transactioninfo.ethiotelecom.et/receipt/abc123xyz',
      ),
    ).toBe('ABC123XYZ');
  });

  it('extracts a receipt id from SMS text without trusting other SMS fields', () => {
    expect(
      normalizeTelebirrReceiptInput(
        'You paid 500 ETB. Receipt No: abc123xyz. Receiver says anyone.',
      ),
    ).toBe('ABC123XYZ');
  });

  it('rejects receipt URLs on malicious hosts', () => {
    expect(() =>
      normalizeTelebirrReceiptInput(
        'https://evil.example.com/receipt/ABC123XYZ',
      ),
    ).toThrow(BadRequestException);
  });

  it('builds fetch URLs only on the configured official host', () => {
    const client = new TelebirrReceiptClient();
    const url = client.buildReceiptUrl('ABC123XYZ', {
      enabled: true,
      baseUrl: 'https://transactioninfo.ethiotelecom.et/receipt',
      expectedReceiverName: 'SpinPro Test Merchant',
      expectedReceiverAccount: '123456',
      expectedShortCode: null,
      minDeposit: 10,
      maxDeposit: 10_000,
      intentTtlMinutes: 15,
      httpTimeoutMs: 8_000,
      maxHtmlBytes: 200_000,
    });

    expect(url.toString()).toBe(
      'https://transactioninfo.ethiotelecom.et/receipt/ABC123XYZ',
    );
  });

  it('parses a sanitized Telebirr receipt fixture', () => {
    const html = readFileSync(
      join(__dirname, '__fixtures__', 'sample-receipt.html'),
      'utf8',
    );
    const parsed = new TelebirrReceiptParser().parse(html);

    expect(parsed).toEqual(
      expect.objectContaining({
        receiptNo: 'ABC123XYZ',
        transactionStatus: 'Completed',
        settledAmount: '500.00',
        totalAmountPaid: '500.00',
        currency: 'ETB',
        creditedPartyName: 'SpinPro Test Merchant',
        creditedPartyAccount: '123456',
        payerName: 'Sample Player',
      }),
    );
  });
});
