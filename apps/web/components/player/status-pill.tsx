import { clsx } from "clsx";
import type { ReactNode } from "react";

type StatusTone = "gold" | "lime" | "teal" | "purple" | "muted" | "danger";

const toneClassName: Record<StatusTone, string> = {
  gold: "border-[rgba(246,197,71,0.42)] bg-[rgba(246,197,71,0.12)] text-gold",
  lime: "border-[rgba(163,230,53,0.38)] bg-[rgba(163,230,53,0.1)] text-lime-300",
  teal: "border-[rgba(45,212,191,0.38)] bg-[rgba(45,212,191,0.1)] text-teal",
  purple:
    "border-[rgba(232,121,249,0.36)] bg-[rgba(232,121,249,0.1)] text-magenta",
  muted: "border-[var(--border)] bg-white/[0.04] text-text-secondary",
  danger:
    "border-[rgba(248,113,113,0.42)] bg-[rgba(248,113,113,0.12)] text-red-hot",
};

export function StatusPill({
  children,
  tone = "muted",
  className,
}: {
  children: ReactNode;
  tone?: StatusTone;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex min-h-7 items-center rounded-md border px-2.5 py-1 text-xs font-black uppercase tracking-[0.12em]",
        toneClassName[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
