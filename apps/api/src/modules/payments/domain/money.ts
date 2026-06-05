import { BadRequestException } from '@nestjs/common';

export function normalizeMoneyAmount(value: string | number) {
  const raw = typeof value === 'number' ? value.toString() : value.trim();

  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    throw new BadRequestException('Amount must be a positive decimal value.');
  }

  const [major, fraction = ''] = raw.split('.');
  const normalized = `${Number.parseInt(major, 10)}.${fraction
    .padEnd(2, '0')
    .slice(0, 2)}`;

  if (normalized === '0.00') {
    throw new BadRequestException('Amount must be greater than zero.');
  }

  return normalized;
}

export function decimalAmountToWholeWalletUnits(value: string) {
  const normalized = normalizeMoneyAmount(value);
  const [major, fraction] = normalized.split('.');

  if (fraction !== '00') {
    throw new BadRequestException(
      'Telebirr deposits currently support whole ETB amounts only.',
    );
  }

  return BigInt(major);
}
