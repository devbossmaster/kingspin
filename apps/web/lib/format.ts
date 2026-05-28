export function formatCoins(value: string | number | null | undefined) {
  const numericValue = Number(value ?? 0);

  if (!Number.isFinite(numericValue)) {
    return "0";
  }

  return numericValue.toLocaleString();
}

export function formatMs(value: number | null | undefined) {
  const ms = Math.max(0, Number(value ?? 0));
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) {
    return `${seconds}s`;
  }

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function truncateId(value: string | null | undefined, edge = 4) {
  if (!value) {
    return "-";
  }

  if (value.length <= edge * 2 + 3) {
    return value;
  }

  return `${value.slice(0, edge)}...${value.slice(-edge)}`;
}

export function ticketRangeLabel(
  ticketStart: string | null | undefined,
  ticketEnd: string | null | undefined,
) {
  if (!ticketStart || !ticketEnd) {
    return "-";
  }

  return `${ticketStart}-${ticketEnd}`;
}

function toPositiveInteger(value: string | number | null | undefined) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.floor(parsed);
}

function roundToStep(value: number, step: number) {
  return Math.max(step, Math.round(value / step) * step);
}

export function deriveChipOptions(
  min: string | number | null | undefined,
  max: string | number | null | undefined,
) {
  const minAmount = toPositiveInteger(min) ?? 1;
  const maxAmount = Math.max(minAmount, toPositiveInteger(max) ?? minAmount);
  const roughStep = Math.max(1, Math.floor(minAmount / 10));
  const multipliers = [1, 2, 3, 5, 8, 13, 21];
  const options = new Set<number>();

  for (const multiplier of multipliers) {
    const value = roundToStep(minAmount * multiplier, roughStep);

    if (value >= minAmount && value <= maxAmount) {
      options.add(value);
    }
  }

  options.add(minAmount);
  options.add(maxAmount);

  return [...options].sort((a, b) => a - b);
}
