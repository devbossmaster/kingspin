export type TelebirrReceiptConfig = {
  enabled: boolean;
  baseUrl: string;
  expectedReceiverName: string | null;
  expectedReceiverAccount: string | null;
  expectedShortCode: string | null;
  minDeposit: number;
  maxDeposit: number;
  intentTtlMinutes: number;
  httpTimeoutMs: number;
  maxHtmlBytes: number;
};

export type TelebirrReceiptFetchResult = {
  receiptNo: string;
  url: string;
  httpStatus: number;
  contentType: string | null;
  body: string;
  rawProviderHash: string;
};

export type ParsedTelebirrReceipt = {
  receiptNo: string | null;
  transactionStatus: string | null;
  paidAt: Date | null;
  settledAmount: string | null;
  totalAmountPaid: string | null;
  currency: string | null;
  creditedPartyName: string | null;
  creditedPartyAccount: string | null;
  payerName: string | null;
  payerPhoneMasked: string | null;
  paymentReason: string | null;
  paymentMode: string | null;
};

export type TelebirrReceiptVerificationResult = {
  receiptNo: string;
  httpStatus: number;
  providerStatus: string | null;
  rawProviderHash: string;
  parsed: ParsedTelebirrReceipt;
};
