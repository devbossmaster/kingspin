import { clsx } from "clsx";
import type { ReactNode } from "react";

type BadgeVariant =
  | "neutral"
  | "open"
  | "locked"
  | "spinning"
  | "settled"
  | "danger"
  | "success";

const variantClassName: Record<BadgeVariant, string> = {
  neutral: "border-[var(--border)] bg-white/[0.04] text-text-secondary",
  open: "border-[rgba(74,222,128,0.38)] bg-[rgba(74,222,128,0.12)] text-green-go",
  locked: "border-[rgba(246,197,71,0.42)] bg-[rgba(246,197,71,0.12)] text-gold",
  spinning:
    "border-[rgba(232,121,249,0.38)] bg-[rgba(232,121,249,0.12)] text-magenta",
  settled: "border-[rgba(45,212,191,0.38)] bg-[rgba(45,212,191,0.12)] text-teal",
  danger: "border-[rgba(248,113,113,0.42)] bg-[rgba(248,113,113,0.12)] text-red-hot",
  success: "border-[rgba(74,222,128,0.38)] bg-[rgba(74,222,128,0.12)] text-green-go",
};

export function Badge({
  children,
  variant = "neutral",
  className,
}: {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-bold",
        variantClassName[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function phaseBadgeVariant(status: string | null | undefined): BadgeVariant {
  switch (status) {
    case "OPEN":
      return "open";
    case "LOCKED":
    case "DRAWING":
      return "locked";
    case "SPINNING":
      return "spinning";
    case "SETTLING":
    case "COMPLETED":
      return "settled";
    case "CANCELLED":
      return "danger";
    default:
      return "neutral";
  }
}
