import { Injectable } from '@nestjs/common';
import type { ParsedTelebirrReceipt } from './telebirr-receipt.types';

type FieldPattern = {
  key: keyof ParsedTelebirrReceipt;
  labels: string[];
};

const FIELD_PATTERNS: FieldPattern[] = [
  {
    key: 'receiptNo',
    labels: ['receipt no', 'receipt number', 'receipt id', 'transaction id'],
  },
  {
    key: 'transactionStatus',
    labels: ['transaction status', 'payment status', 'status', 'የክፍያ ሁኔታ'],
  },
  {
    key: 'settledAmount',
    labels: ['settled amount', 'paid amount', 'amount', 'የተከፈለው መጠን'],
  },
  {
    key: 'totalAmountPaid',
    labels: ['total amount paid', 'total paid', 'total amount'],
  },
  {
    key: 'currency',
    labels: ['currency'],
  },
  {
    key: 'creditedPartyName',
    labels: [
      'credited party name',
      'receiver name',
      'merchant name',
      'credited party',
      'receiver',
    ],
  },
  {
    key: 'creditedPartyAccount',
    labels: [
      'credited party account',
      'receiver account',
      'merchant account',
      'short code',
    ],
  },
  {
    key: 'payerName',
    labels: ['payer name', 'debited party name', 'customer name', 'payer'],
  },
  {
    key: 'payerPhoneMasked',
    labels: ['payer phone', 'debited party account', 'customer account'],
  },
  {
    key: 'paymentReason',
    labels: ['payment reason', 'reason', 'description'],
  },
  {
    key: 'paymentMode',
    labels: ['payment mode', 'channel', 'payment channel'],
  },
];

@Injectable()
export class TelebirrReceiptParser {
  parse(input: string): ParsedTelebirrReceipt {
    const text = this.toReceiptText(input);

    return {
      receiptNo: this.findReceiptNo(text),
      transactionStatus: this.extractField(text, 'transactionStatus'),
      paidAt: this.parsePaidAt(text),
      settledAmount:
        this.parseAmount(this.extractField(text, 'settledAmount')) ??
        this.parseAmount(this.extractField(text, 'totalAmountPaid')),
      totalAmountPaid:
        this.parseAmount(this.extractField(text, 'totalAmountPaid')) ??
        this.parseAmount(this.extractField(text, 'settledAmount')),
      currency: this.parseCurrency(text),
      creditedPartyName: this.extractField(text, 'creditedPartyName'),
      creditedPartyAccount: this.extractField(text, 'creditedPartyAccount'),
      payerName: this.extractField(text, 'payerName'),
      payerPhoneMasked: this.extractField(text, 'payerPhoneMasked'),
      paymentReason: this.extractField(text, 'paymentReason'),
      paymentMode: this.extractField(text, 'paymentMode'),
    };
  }

  private toReceiptText(input: string) {
    return input
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|tr|li|section|article|table)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&#x([0-9a-f]+);/gi, (_match, hex) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      )
      .replace(/&#(\d+);/g, (_match, code) =>
        String.fromCharCode(Number.parseInt(code, 10)),
      )
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s+/g, '\n')
      .trim();
  }

  private extractField(text: string, key: keyof ParsedTelebirrReceipt) {
    const field = FIELD_PATTERNS.find((candidate) => candidate.key === key);

    if (!field) {
      return null;
    }

    for (const label of field.labels) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`${escaped}\\s*[:：-]\\s*([^\\n|]+)`, 'i');
      const match = text.match(pattern);
      const value = this.cleanValue(match?.[1]);

      if (value) {
        return value;
      }
    }

    return null;
  }

  private findReceiptNo(text: string) {
    const labelled = this.extractField(text, 'receiptNo');

    if (labelled) {
      const match = labelled.match(/\b[A-Z0-9]{6,32}\b/i);

      if (match) {
        return match[0].toUpperCase();
      }
    }

    const urlMatch = text.match(
      /transactioninfo\.ethiotelecom\.et\/receipt\/([A-Z0-9]{6,32})/i,
    );

    return urlMatch?.[1]?.toUpperCase() ?? null;
  }

  private parsePaidAt(text: string) {
    const raw =
      this.extractDateLabel(text, [
        'paid at',
        'payment date',
        'transaction date',
      ]) ?? null;

    if (!raw) {
      return null;
    }

    const normalized = raw.replace(/\//g, '-');
    const parsed = new Date(normalized);

    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private extractDateLabel(text: string, labels: string[]) {
    for (const label of labels) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = text.match(
        new RegExp(`${escaped}\\s*[:：-]\\s*([^\\n|]+)`, 'i'),
      );
      const value = this.cleanValue(match?.[1]);

      if (value) {
        return value;
      }
    }

    return null;
  }

  private parseAmount(value: string | null) {
    if (!value) {
      return null;
    }

    const match = value.replace(/,/g, '').match(/\d+(?:\.\d{1,2})?/);

    return match ? normalizeDecimalString(match[0]) : null;
  }

  private parseCurrency(text: string) {
    const explicit = this.extractField(text, 'currency');

    if (explicit) {
      return explicit.toUpperCase();
    }

    if (/\b(?:ETB|BIRR)\b/i.test(text) || /ብር/.test(text)) {
      return 'ETB';
    }

    return null;
  }

  private cleanValue(value: string | undefined) {
    const cleaned = value
      ?.replace(/\s{2,}/g, ' ')
      .replace(/\s+\|.*$/, '')
      .trim();

    return cleaned && cleaned.length > 0 ? cleaned : null;
  }
}

export function normalizeDecimalString(value: string) {
  const [major, fraction = ''] = value.replace(/,/g, '').split('.');

  return `${Number.parseInt(major, 10)}.${fraction.padEnd(2, '0').slice(0, 2)}`;
}
