"use client";

import { formatCoins } from "../../lib/format";

type RoundPhaseBannerProps = {
  status: string | null | undefined;
  roundNumber: number | null | undefined;
  totalEntryAmount: string | null | undefined;
  winningTicket: string | null | undefined;
};

function getPhaseCopy(status: string | null | undefined) {
  switch (status) {
    case "OPEN":
      return {
        icon: "●",
        eyebrow: "Live Round",
        title: "Entry window open",
        message: "Choose your entry amount before the timer locks.",
        tone: "border-[rgba(74,222,128,0.35)] bg-[rgba(74,222,128,0.08)]",
        iconTone: "bg-[rgba(74,222,128,0.14)] text-green-go border-[rgba(74,222,128,0.32)]",
        badgeTone: "bg-[rgba(74,222,128,0.1)] text-green-go border-[rgba(74,222,128,0.28)]",
      };

    case "LOCKED":
      return {
        icon: "◆",
        eyebrow: "Locked",
        title: "Entries locked",
        message: "Ticket ranges are final. The draw is preparing.",
        tone: "border-[rgba(250,204,21,0.35)] bg-[rgba(250,204,21,0.08)]",
        iconTone: "bg-[rgba(250,204,21,0.14)] text-[var(--gold)] border-[rgba(250,204,21,0.32)]",
        badgeTone: "bg-[rgba(250,204,21,0.1)] text-[var(--gold)] border-[rgba(250,204,21,0.28)]",
      };

    case "DRAWING":
      return {
        icon: "✦",
        eyebrow: "Drawing",
        title: "Finding the winner",
        message: "The winning ticket is being calculated fairly.",
        tone: "border-[rgba(96,165,250,0.38)] bg-[rgba(96,165,250,0.08)]",
        iconTone: "bg-[rgba(96,165,250,0.14)] text-blue-300 border-[rgba(96,165,250,0.32)]",
        badgeTone: "bg-[rgba(96,165,250,0.1)] text-blue-300 border-[rgba(96,165,250,0.28)]",
      };

    case "SPINNING":
      return {
        icon: "↻",
        eyebrow: "Reveal",
        title: "Wheel spinning",
        message: "The live reveal animation is in progress.",
        tone: "border-[rgba(232,121,249,0.35)] bg-[rgba(232,121,249,0.08)]",
        iconTone: "bg-[rgba(232,121,249,0.14)] text-magenta border-[rgba(232,121,249,0.32)]",
        badgeTone: "bg-[rgba(232,121,249,0.1)] text-magenta border-[rgba(232,121,249,0.28)]",
      };

    case "SETTLING":
      return {
        icon: "$",
        eyebrow: "Payout",
        title: "Settling payout",
        message: "Ledger payout and final result are being confirmed.",
        tone: "border-[rgba(251,146,60,0.42)] bg-[rgba(251,146,60,0.08)]",
        iconTone: "bg-[rgba(251,146,60,0.14)] text-orange-300 border-[rgba(251,146,60,0.32)]",
        badgeTone: "bg-[rgba(251,146,60,0.1)] text-orange-300 border-[rgba(251,146,60,0.28)]",
      };

    case "COMPLETED":
      return {
        icon: "★",
        eyebrow: "Completed",
        title: "Round completed",
        message: "Winner selected and payout settled.",
        tone: "border-[rgba(250,204,21,0.42)] bg-[rgba(250,204,21,0.08)]",
        iconTone: "bg-[rgba(250,204,21,0.14)] text-[var(--gold)] border-[rgba(250,204,21,0.32)]",
        badgeTone: "bg-[rgba(250,204,21,0.1)] text-[var(--gold)] border-[rgba(250,204,21,0.28)]",
      };

    case "CANCELLED":
      return {
        icon: "!",
        eyebrow: "Cancelled",
        title: "Round cancelled",
        message: "This round did not complete. A new one will start.",
        tone: "border-[rgba(248,113,113,0.42)] bg-[rgba(248,113,113,0.08)]",
        iconTone: "bg-[rgba(248,113,113,0.14)] text-red-hot border-[rgba(248,113,113,0.32)]",
        badgeTone: "bg-[rgba(248,113,113,0.1)] text-red-hot border-[rgba(248,113,113,0.28)]",
      };

    default:
      return {
        icon: "–",
        eyebrow: "Waiting",
        title: "Waiting for round",
        message: "The next round is preparing.",
        tone: "border-[var(--border)] bg-white/[0.04]",
        iconTone: "bg-white/[0.06] text-text-secondary border-[var(--border)]",
        badgeTone: "bg-white/[0.06] text-text-secondary border-[var(--border)]",
      };
  }
}

export function RoundPhaseBanner({
  status,
  roundNumber,
  totalEntryAmount,
  winningTicket,
}: RoundPhaseBannerProps) {
  const copy = getPhaseCopy(status);

  return (
    <div
      className={`arcadia-surface relative mt-5 overflow-hidden rounded-lg border p-4 ${copy.tone}`}
      aria-live="polite"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[rgba(250,204,21,0.55)] to-transparent" />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl border font-mono text-lg font-black ${copy.iconTone}`}
            aria-hidden="true"
          >
            {copy.icon}
          </span>

          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-text-dim">
              {copy.eyebrow}
            </p>
            <h2 className="mt-1 font-display text-xl font-black text-text-primary">
              {copy.title}
            </h2>
            <p className="mt-1 max-w-xl text-sm text-text-secondary">
              {copy.message}
            </p>
          </div>
        </div>

        <div className="grid min-w-[150px] gap-2 text-right">
          <div
            className={`rounded-full border px-3 py-1 text-xs font-black uppercase tracking-[0.16em] ${copy.badgeTone}`}
          >
            {status ?? "NO ROUND"}
          </div>

          <div className="rounded-md border border-[var(--border)] bg-black/20 px-3 py-2 font-mono text-xs text-text-secondary">
            <p>
              Round{" "}
              <span className="font-black text-text-primary">
                #{roundNumber ?? "-"}
              </span>
            </p>
            <p className="mt-1">
              Pool{" "}
              <span className="font-black text-[var(--gold)]">
                {formatCoins(totalEntryAmount)}
              </span>
            </p>
          </div>
        </div>
      </div>

      {status === "COMPLETED" ? (
        <div className="mt-4 rounded-md border border-[rgba(250,204,21,0.24)] bg-black/20 p-3 font-mono text-xs text-text-secondary">
          Winning ticket{" "}
          <span className="font-black text-[var(--gold)]">
            {winningTicket ?? "-"}
          </span>
        </div>
      ) : null}
    </div>
  );
}
