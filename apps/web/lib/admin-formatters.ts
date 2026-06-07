export function adminText(value: unknown, fallback = "-") {
  return value === null || value === undefined || value === ""
    ? fallback
    : String(value);
}

export function adminAmount(value: unknown, currency?: unknown) {
  const amount = Number(value ?? 0);
  const formatted = Number.isFinite(amount)
    ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(
        amount,
      )
    : "0";
  return currency ? `${formatted} ${String(currency)}` : formatted;
}

export function adminDate(value: unknown) {
  if (!value) return "-";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function adminRelativeDate(value: unknown) {
  if (!value) return "-";
  const time = new Date(String(value)).getTime();
  if (Number.isNaN(time)) return "-";
  const seconds = Math.round((time - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}

export function adminShortId(value: unknown) {
  const text = adminText(value, "");
  return text.length <= 12 ? text : `${text.slice(0, 6)}...${text.slice(-4)}`;
}

export function adminDuration(value: unknown) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds)) return "-";
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
