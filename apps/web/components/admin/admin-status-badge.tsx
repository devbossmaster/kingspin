import { clsx } from "clsx";

const success = new Set([
  "ACTIVE",
  "OPEN",
  "OK",
  "CREDITED",
  "COMPLETED",
  "PAID",
  "REVEALED",
  "CLEAR",
  "REVIEWED",
]);
const warning = new Set([
  "PENDING",
  "PENDING_REVIEW",
  "VERIFYING",
  "NEEDS_MANUAL_REVIEW",
  "LOCKED",
  "DRAWING",
  "SPINNING",
  "SETTLING",
  "PROCESSING",
  "APPROVED",
  "OPEN_RISK",
  "MEDIUM",
  "DEGRADED",
]);
const danger = new Set([
  "DOWN",
  "FAILED",
  "REJECTED",
  "CANCELLED",
  "SUSPENDED",
  "HIGH",
  "CRITICAL",
  "NEEDS ATTENTION",
]);

export function AdminStatusBadge({ value }: { value: unknown }) {
  const status = String(value ?? "UNKNOWN").toUpperCase();
  return (
    <span
      className={clsx(
        "inline-flex min-h-6 items-center border px-2 text-[11px] font-black uppercase",
        success.has(status) &&
          "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
        warning.has(status) &&
          "border-amber-300/30 bg-amber-300/10 text-amber-200",
        danger.has(status) &&
          "border-red-400/30 bg-red-400/10 text-red-300",
        !success.has(status) &&
          !warning.has(status) &&
          !danger.has(status) &&
          "border-slate-500/30 bg-slate-400/10 text-slate-300",
      )}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}
