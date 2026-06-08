import { getApiEnv } from '../../../../config/api-env';
import type { TelebirrReceiptConfig } from './telebirr-receipt.types';

export const TELEBIRR_RECEIPT_HOSTNAME = 'transactioninfo.ethiotelecom.et';

export function getTelebirrReceiptConfig(): TelebirrReceiptConfig {
  const env = getApiEnv();

  return {
    enabled: env.TELEBIRR_RECEIPT_VERIFICATION_ENABLED === true,
    baseUrl: env.TELEBIRR_RECEIPT_BASE_URL,
    expectedReceiverName: env.TELEBIRR_EXPECTED_RECEIVER_NAME ?? null,
    expectedReceiverAccount: env.TELEBIRR_EXPECTED_RECEIVER_ACCOUNT ?? null,
    expectedShortCode: env.TELEBIRR_EXPECTED_SHORT_CODE ?? null,
    minDeposit: env.DEPOSIT_MIN_ETB,
    maxDeposit: env.DEPOSIT_MAX_ETB,
    intentTtlMinutes: env.TELEBIRR_DEPOSIT_INTENT_TTL_MINUTES,
    httpTimeoutMs: env.TELEBIRR_RECEIPT_HTTP_TIMEOUT_MS,
    maxHtmlBytes: env.TELEBIRR_RECEIPT_MAX_HTML_BYTES,
  };
}
