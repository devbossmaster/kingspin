import { BadRequestException } from '@nestjs/common';
import { TELEBIRR_RECEIPT_HOSTNAME } from './telebirr-receipt.config';

const RECEIPT_ID_PATTERN = /^[A-Z0-9]{6,32}$/;
const URL_PATTERN = /\b(?:https?:\/\/)?[a-z0-9.-]+\/[^\s<>"']*/gi;

export function normalizeTelebirrReceiptInput(input: string) {
  const normalizedInput = input.trim().normalize('NFKC');

  if (!normalizedInput || /[^\x20-\x7e\r\n\t]/.test(normalizedInput)) {
    throw new BadRequestException(
      'Receipt input contains unsupported characters.',
    );
  }

  const urlMatches = Array.from(normalizedInput.matchAll(URL_PATTERN)).map(
    (match) => match[0],
  );

  if (urlMatches.length > 0) {
    for (const rawUrl of urlMatches) {
      const receiptNo = receiptNoFromUrl(rawUrl);

      if (receiptNo) {
        return receiptNo;
      }
    }

    throw new BadRequestException(
      'Receipt URL must be an official Telebirr receipt URL.',
    );
  }

  const direct = normalizedInput.toUpperCase();

  if (RECEIPT_ID_PATTERN.test(direct)) {
    return direct;
  }

  const labelledMatch = normalizedInput.match(
    /\b(?:receipt(?:\s*(?:no|number|id))?|transaction\s*(?:id|no))[:#\s-]+([A-Za-z0-9]{6,32})\b/i,
  );

  if (labelledMatch?.[1]) {
    return assertSafeReceiptNo(labelledMatch[1]);
  }

  throw new BadRequestException('Valid Telebirr receipt number was not found.');
}

function receiptNoFromUrl(rawUrl: string) {
  const withProtocol = /^https?:\/\//i.test(rawUrl)
    ? rawUrl
    : `https://${rawUrl}`;
  let parsed: URL;

  try {
    parsed = new URL(withProtocol);
  } catch {
    return null;
  }

  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname.toLowerCase() !== TELEBIRR_RECEIPT_HOSTNAME
  ) {
    return null;
  }

  const parts = parsed.pathname.split('/').filter(Boolean);

  if (parts.length !== 2 || parts[0].toLowerCase() !== 'receipt') {
    return null;
  }

  if (parsed.search || parsed.hash) {
    throw new BadRequestException(
      'Receipt URL must not include query or fragment data.',
    );
  }

  return assertSafeReceiptNo(parts[1]);
}

function assertSafeReceiptNo(value: string) {
  const receiptNo = value.trim().toUpperCase();

  if (!RECEIPT_ID_PATTERN.test(receiptNo)) {
    throw new BadRequestException('Receipt number format is invalid.');
  }

  return receiptNo;
}
