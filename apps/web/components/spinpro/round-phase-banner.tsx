"use client";

import { formatCoins } from "../../lib/format";

type RoundPhaseBannerProps = {
  status: string | null | undefined;
  roundNumber: number | null | undefined;
  totalEntryAmount: string | null | undefined;
  winningTicket: string | null | undefined;
};

type PhaseKey =
  | "OPEN"
  | "LOCKED"
  | "DRAWING"
  | "SPINNING"
  | "SETTLING"
  | "COMPLETED"
  | "CANCELLED"
  | "WAITING";

const PHASE_FLOW: Array<Exclude<PhaseKey, "CANCELLED" | "WAITING">> = [
  "OPEN",
  "LOCKED",
  "DRAWING",
  "SPINNING",
  "SETTLING",
  "COMPLETED",
];

function normalizePhase(status: string | null | undefined): PhaseKey {
  switch (status) {
    case "OPEN":
    case "LOCKED":
    case "DRAWING":
    case "SPINNING":
    case "SETTLING":
    case "COMPLETED":
    case "CANCELLED":
      return status;
    default:
      return "WAITING";
  }
}

function getPhaseCopy(status: string | null | undefined) {
  switch (status) {
    case "OPEN":
      return {
        icon: "●",
        eyebrow: "Live Round",
        title: "Entries open",
        message: "Choose your entry before the countdown locks this round.",
        detail: "Players can still join. Pool and player list update live.",
        tone: "border-[rgba(74,222,128,0.35)] bg-[rgba(74,222,128,0.08)]",
        iconTone:
          "bg-[rgba(74,222,128,0.14)] text-green-go border-[rgba(74,222,128,0.32)]",
        badgeTone:
          "bg-[rgba(74,222,128,0.1)] text-green-go border-[rgba(74,222,128,0.28)]",
      };

    case "LOCKED":
      return {
        icon: "◆",
        eyebrow: "Locked",
        title: "Entries locked",
        message: "No more entries. Final ticket ranges are being assigned.",
        detail: "The server is freezing the entry list before the draw.",
        tone: "border-[rgba(250,204,21,0.35)] bg-[rgba(250,204,21,0.08)]",
        iconTone:
          "bg-[rgba(250,204,21,0.14)] text-[var(--gold)] border-[rgba(250,204,21,0.32)]",
        badgeTone:
          "bg-[rgba(250,204,21,0.1)] text-[var(--gold)] border-[rgba(250,204,21,0.28)]",
      };

    case "DRAWING":
      return {
        icon: "✦",
        eyebrow: "Secure Draw",
        title: "Selecting winning ticket",
        message: "The server is resolving the winning ticket fairly.",
        detail: "Winner selection is server-authoritative, not client-side.",
        tone: "border-[rgba(96,165,250,0.38)] bg-[rgba(96,165,250,0.08)]",
        iconTone:
          "bg-[rgba(96,165,250,0.14)] text-blue-300 border-[rgba(96,165,250,0.32)]",
        badgeTone:
          "bg-[rgba(96,165,250,0.1)] text-blue-300 border-[rgba(96,165,250,0.28)]",
      };

    case "SPINNING":
      return {
        icon: "↻",
        eyebrow: "Live Reveal",
        title: "Wheel spinning",
        message: "The winner is locked. The wheel reveal is running now.",
        detail: "The wheel uses the server-provided spin angle.",
        tone: "border-[rgba(232,121,249,0.35)] bg-[rgba(232,121,249,0.08)]",
        iconTone:
          "bg-[rgba(232,121,249,0.14)] text-magenta border-[rgba(232,121,249,0.32)]",
        badgeTone:
          "bg-[rgba(232,121,249,0.1)] text-magenta border-[rgba(232,121,249,0.28)]",
      };

    case "SETTLING":
      return {
        icon: "$",
        eyebrow: "Ledger",
        title: "Finalizing payout",
        message: "The payout is being settled safely in the ledger.",
        detail: "Please wait while the round result is finalized.",
        tone: "border-[rgba(251,146,60,0.42)] bg-[rgba(251,146,60,0.08)]",
        iconTone:
          "bg-[rgba(251,146,60,0.14)] text-orange-300 border-[rgba(251,146,60,0.32)]",
        badgeTone:
          "bg-[rgba(251,146,60,0.1)] text-orange-300 border-[rgba(251,146,60,0.28)]",
      };

    case "COMPLETED":
      return {
        icon: "★",
        eyebrow: "Completed",
        title: "Round completed",
        message: "Winner selected and payout settled.",
        detail: "A new round will start soon.",
        tone: "border-[rgba(250,204,21,0.42)] bg-[rgba(250,204,21,0.08)]",
        iconTone:
          "bg-[rgba(250,204,21,0.14)] text-[var(--gold)] border-[rgba(250,204,21,0.32)]",
        badgeTone:
          "bg-[rgba(250,204,21,0.1)] text-[var(--gold)] border-[rgba(250,204,21,0.28)]",
      };

    case "CANCELLED":
      return {
        icon: "!",
        eyebrow: "Skipped",
        title: "Round skipped/refunded",
        message: "This round did not draw. A new round will start.",
        detail: "Empty or single-player rounds are safely skipped/refunded.",
        tone: "border-[rgba(248,113,113,0.42)] bg-[rgba(248,113,113,0.08)]",
        iconTone:
          "bg-[rgba(248,113,113,0.14)] text-red-hot border-[rgba(248,113,113,0.32)]",
        badgeTone:
          "bg-[rgba(248,113,113,0.1)] text-red-hot border-[rgba(248,113,113,0.28)]",
      };

    default:
      return {
        icon: "–",
        eyebrow: "Waiting",
        title: "Waiting for round",
        message: "The next round is preparing.",
        detail: "Live status will appear as soon as the room starts.",
        tone: "border-[var(--border)] bg-white/[0.04]",
        iconTone: "bg-white/[0.06] text-text-secondary border-[var(--border)]",
        badgeTone: "bg-white/[0.06] text-text-secondary border-[var(--border)]",
      };
  }
}

function getPhaseIndex(phase: PhaseKey) {
  return PHASE_FLOW.findIndex((item) => item === phase);
}

function phaseLabel(phase: string) {
  switch (phase) {
    case "OPEN":
      return "Open";
    case "LOCKED":
      return "Locked";
    case "DRAWING":
      return "Draw";
    case "SPINNING":
      return "Spin";
    case "SETTLING":
      return "Settle";
    case "COMPLETED":
      return "Done";
    default:
      return phase;
  }
}

export function RoundPhaseBanner({
  status,
  roundNumber,
  totalEntryAmount,
  winningTicket,
}: RoundPhaseBannerProps) {
  const phase = normalizePhase(status);
  const phaseIndex = getPhaseIndex(phase);
  const copy = getPhaseCopy(status);
  const showPulse =
    phase === "LOCKED" ||
    phase === "DRAWING" ||
    phase === "SPINNING" ||
    phase === "SETTLING";

  return (
    <div
      className={`arcadia-surface relative mt-5 overflow-hidden rounded-lg border p-4 ${copy.tone}`}
      aria-live="polite"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[rgba(250,204,21,0.55)] to-transparent" />

      {showPulse ? (
        <div className="pointer-events-none absolute right-4 top-4 h-20 w-20 rounded-full bg-[rgba(250,204,21,0.08)] blur-2xl animate-pulse" />
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl border font-mono text-lg font-black ${copy.iconTone} ${
              showPulse ? "animate-pulse" : ""
            }`}
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
            <p className="mt-2 max-w-xl text-xs font-semibold text-text-dim">
              {copy.detail}
            </p>
          </div>
        </div>

        <div className="grid min-w-[150px] gap-2 text-right">
          <div
            className={`rounded-full border px-3 py-1 text-xs font-black uppercase tracking-[0.16em] ${copy.badgeTone}`}
          >
            {phase === "WAITING" ? "NO ROUND" : phase}
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

      {phase !== "WAITING" && phase !== "CANCELLED" ? (
        <div className="mt-5 rounded-lg border border-[var(--border)] bg-black/20 p-3">
          <div className="grid grid-cols-6 gap-1">
            {PHASE_FLOW.map((item, index) => {
              const isActive = item === phase;
              const isDone = phaseIndex > index;
              const isFuture = phaseIndex < index;

              return (
                <div key={item} className="min-w-0">
                  <div
                    className={`h-1.5 rounded-full ${
                      isActive
                        ? "bg-[var(--gold)]"
                        : isDone
                          ? "bg-green-go"
                          : "bg-white/[0.12]"
                    } ${isActive && showPulse ? "animate-pulse" : ""}`}
                  />
                  <p
                    className={`mt-1 truncate text-center text-[10px] font-black uppercase tracking-[0.08em] ${
                      isActive
                        ? "text-[var(--gold)]"
                        : isDone
                          ? "text-green-go"
                          : isFuture
                            ? "text-text-dim"
                            : "text-text-secondary"
                    }`}
                  >
                    {phaseLabel(item)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {status === "COMPLETED" ? (
        <div className="mt-4 rounded-md border border-[rgba(250,204,21,0.24)] bg-black/20 p-3 font-mono text-xs text-text-secondary">
          Winning ticket{" "}
          <span className="font-black text-[var(--gold)]">
            {winningTicket ?? "-"}
          </span>
        </div>
      ) : null}

      {status === "CANCELLED" ? (
        <div className="mt-4 rounded-md border border-[rgba(248,113,113,0.24)] bg-black/20 p-3 text-xs font-semibold text-text-secondary">
          No winner was drawn for this round. Any eligible held entries are
          refunded by the backend ledger.
        </div>
      ) : null}
    </div>
  );
}