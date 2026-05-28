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
        icon: "O",
        title: "Entry window open",
        message: "Live entries are being accepted.",
        tone: "border-[rgba(74,222,128,0.35)] bg-[rgba(74,222,128,0.1)] text-green-go",
      };

    case "LOCKED":
      return {
        icon: "L",
        title: "Entries locked",
        message: "Final ticket ranges are being assigned.",
        tone: "border-[rgba(246,197,71,0.35)] bg-[rgba(246,197,71,0.1)] text-gold",
      };

    case "DRAWING":
      return {
        icon: "D",
        title: "Drawing winner",
        message: "Winning ticket is being calculated.",
        tone: "border-[rgba(96,165,250,0.38)] bg-[rgba(96,165,250,0.12)] text-blue-300",
      };

    case "SPINNING":
      return {
        icon: "S",
        title: "Wheel spinning",
        message: "Winner reveal is in progress.",
        tone: "border-[rgba(232,121,249,0.35)] bg-[rgba(232,121,249,0.1)] text-magenta",
      };

    case "SETTLING":
      return {
        icon: "$",
        title: "Settling payout",
        message: "Ledger payout is finalizing.",
        tone: "border-[rgba(251,146,60,0.42)] bg-[rgba(251,146,60,0.12)] text-orange-300",
      };

    case "COMPLETED":
      return {
        icon: "*",
        title: "Round completed",
        message: "Winner selected and payout settled.",
        tone: "border-[rgba(246,197,71,0.42)] bg-[rgba(246,197,71,0.12)] text-gold",
      };

    case "CANCELLED":
      return {
        icon: "!",
        title: "Round cancelled",
        message: "This round did not complete.",
        tone: "border-[rgba(248,113,113,0.42)] bg-[rgba(248,113,113,0.12)] text-red-hot",
      };

    default:
      return {
        icon: "-",
        title: "Waiting for round",
        message: "Next round is preparing.",
        tone: "border-[var(--border)] bg-white/[0.04] text-text-secondary",
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
      className={`mt-5 rounded-lg border p-4 ${copy.tone}`}
      aria-live="polite"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="font-mono text-xl" aria-hidden="true">
            {copy.icon}
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] opacity-80">
              {status ?? "NO ROUND"}
            </p>
            <h2 className="mt-1 font-display text-lg font-black">
              {copy.title}
            </h2>
            <p className="mt-1 text-sm opacity-90">{copy.message}</p>
          </div>
        </div>

        <div className="rounded-md bg-black/20 px-3 py-2 text-right font-mono text-xs">
          <p>Round #{roundNumber ?? "-"}</p>
          <p>Pool {formatCoins(totalEntryAmount)}</p>
        </div>
      </div>

      {status === "COMPLETED" ? (
        <div className="mt-3 rounded-md bg-black/20 p-3 font-mono text-xs">
          Winning ticket: <span className="font-bold">{winningTicket ?? "-"}</span>
        </div>
      ) : null}
    </div>
  );
}
