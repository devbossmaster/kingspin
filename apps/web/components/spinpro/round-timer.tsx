"use client";

import { useMemo } from "react";
import { useCountdown } from "../../hooks/use-countdown";
import { formatMs } from "../../lib/format";

type RoundTimerProps = {
  status: string | null | undefined;
  serverNow: string;
  locksAt: string | null | undefined;
  durationMs: number;
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

function timerTone(msLeft: number, durationMs: number) {
  const ratio = durationMs > 0 ? msLeft / durationMs : 0;

  if (ratio <= 0.15) {
    return {
      label: "Final seconds",
      text: "text-red-hot",
      bar: "bg-[var(--red-hot)]",
      ring: "border-[rgba(248,113,113,0.52)]",
      glow: "shadow-[0_0_28px_rgba(248,113,113,0.16)]",
      badge:
        "border-[rgba(248,113,113,0.34)] bg-[rgba(248,113,113,0.12)] text-red-hot",
    };
  }

  if (ratio <= 0.4) {
    return {
      label: "Closing soon",
      text: "text-[var(--gold)]",
      bar: "bg-[var(--gold)]",
      ring: "border-[rgba(250,204,21,0.48)]",
      glow: "shadow-[0_0_28px_rgba(250,204,21,0.14)]",
      badge:
        "border-[rgba(250,204,21,0.34)] bg-[rgba(250,204,21,0.1)] text-[var(--gold)]",
    };
  }

  return {
    label: "Entries open",
    text: "text-green-go",
    bar: "bg-[var(--green-go)]",
    ring: "border-[rgba(74,222,128,0.44)]",
    glow: "shadow-[0_0_28px_rgba(74,222,128,0.12)]",
    badge:
      "border-[rgba(74,222,128,0.3)] bg-[rgba(74,222,128,0.1)] text-green-go",
  };
}

function phaseCopy(phase: PhaseKey) {
  switch (phase) {
    case "LOCKED":
      return {
        eyebrow: "Round Phase",
        title: "Round in progress",
        subtitle: "Entries are closed. Ticket ranges are being finalized.",
        badge: "Randomizing",
        tone: "border-[rgba(250,204,21,0.35)] bg-[rgba(250,204,21,0.08)]",
        badgeTone:
          "border-[rgba(250,204,21,0.32)] bg-[rgba(250,204,21,0.1)] text-[var(--gold)]",
        bar: "bg-[var(--gold)]",
      };

    case "DRAWING":
      return {
        eyebrow: "Secure Draw",
        title: "Selecting winner",
        subtitle: "The server is resolving the winning ticket fairly.",
        badge: "Drawing",
        tone: "border-[rgba(96,165,250,0.35)] bg-[rgba(96,165,250,0.08)]",
        badgeTone:
          "border-[rgba(96,165,250,0.32)] bg-[rgba(96,165,250,0.1)] text-blue-300",
        bar: "bg-blue-300",
      };

    case "SPINNING":
      return {
        eyebrow: "Live Reveal",
        title: "Wheel spinning",
        subtitle: "The server result is ready. The wheel reveal is running.",
        badge: "Spinning",
        tone: "border-[rgba(232,121,249,0.35)] bg-[rgba(232,121,249,0.08)]",
        badgeTone:
          "border-[rgba(232,121,249,0.32)] bg-[rgba(232,121,249,0.1)] text-magenta",
        bar: "bg-[var(--magenta)]",
      };

    case "SETTLING":
      return {
        eyebrow: "Ledger",
        title: "Finalizing payout",
        subtitle: "The winner payout is being settled safely.",
        badge: "Settling",
        tone: "border-[rgba(251,146,60,0.38)] bg-[rgba(251,146,60,0.08)]",
        badgeTone:
          "border-[rgba(251,146,60,0.32)] bg-[rgba(251,146,60,0.1)] text-orange-300",
        bar: "bg-orange-300",
      };

    case "COMPLETED":
      return {
        eyebrow: "Completed",
        title: "Round completed",
        subtitle: "Winner selected and payout settled. Next round starts soon.",
        badge: "Done",
        tone: "border-[rgba(250,204,21,0.42)] bg-[rgba(250,204,21,0.08)]",
        badgeTone:
          "border-[rgba(250,204,21,0.32)] bg-[rgba(250,204,21,0.1)] text-[var(--gold)]",
        bar: "bg-[var(--gold)]",
      };

    case "CANCELLED":
      return {
        eyebrow: "Skipped",
        title: "Round skipped/refunded",
        subtitle: "No winner was drawn. The next round is preparing.",
        badge: "Skipped",
        tone: "border-[rgba(248,113,113,0.38)] bg-[rgba(248,113,113,0.08)]",
        badgeTone:
          "border-[rgba(248,113,113,0.32)] bg-[rgba(248,113,113,0.1)] text-red-hot",
        bar: "bg-[var(--red-hot)]",
      };

    default:
      return {
        eyebrow: "Waiting",
        title: "Waiting for round",
        subtitle: "The next round is preparing.",
        badge: "Waiting",
        tone: "border-[var(--border)] bg-white/[0.04]",
        badgeTone:
          "border-[rgba(148,163,184,0.28)] bg-[rgba(148,163,184,0.1)] text-text-secondary",
        bar: "bg-white/[0.35]",
      };
  }
}

function getPhaseIndex(phase: PhaseKey) {
  return PHASE_FLOW.findIndex((item) => item === phase);
}

function phaseShortLabel(phase: string) {
  switch (phase) {
    case "OPEN":
      return "Open";
    case "LOCKED":
      return "Random";
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

export function RoundTimer({
  status,
  serverNow,
  locksAt,
  durationMs,
}: RoundTimerProps) {
  const phase = normalizePhase(status);

  const { msLeft } = useCountdown({
    locksAt,
    serverNow,
    enabled: phase === "OPEN",
  });

  const progress = Math.max(
    0,
    Math.min(1, durationMs > 0 ? msLeft / durationMs : 0),
  );

  const tone = useMemo(
    () => timerTone(msLeft, durationMs),
    [durationMs, msLeft],
  );

  if (phase !== "OPEN") {
    const copy = phaseCopy(phase);
    const phaseIndex = getPhaseIndex(phase);
    const showFlow = phase !== "WAITING" && phase !== "CANCELLED";
    const isActiveMotion =
      phase === "LOCKED" ||
      phase === "DRAWING" ||
      phase === "SPINNING" ||
      phase === "SETTLING";

    return (
      <div
        className={`arcadia-surface relative mt-2 overflow-hidden rounded-lg border p-4 ${copy.tone}`}
        aria-live="polite"
      >
        {isActiveMotion ? (
          <div className="pointer-events-none absolute right-4 top-4 h-16 w-16 rounded-full bg-[rgba(250,204,21,0.08)] blur-2xl animate-pulse" />
        ) : null}

        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-text-dim">
              {copy.eyebrow}
            </p>
            <p className="mt-1 font-display text-xl font-black text-text-primary">
              {copy.title}
            </p>
            <p className="mt-1 text-sm text-text-secondary">{copy.subtitle}</p>
          </div>

          <div
            className={`rounded-full border px-3 py-1 text-xs font-black uppercase tracking-[0.16em] ${copy.badgeTone}`}
          >
            {copy.badge}
          </div>
        </div>

        {showFlow ? (
          <div className="mt-4 rounded-lg border border-[var(--border)] bg-black/20 p-3">
            <div className="grid grid-cols-6 gap-1">
              {PHASE_FLOW.map((item, index) => {
                const isActive = item === phase;
                const isDone = phaseIndex > index;

                return (
                  <div key={item} className="min-w-0">
                    <div
                      className={`h-2 rounded-full ${
                        isActive
                          ? copy.bar
                          : isDone
                            ? "bg-green-go"
                            : "bg-white/[0.12]"
                      } ${isActive && isActiveMotion ? "animate-pulse" : ""}`}
                    />
                    <p
                      className={`mt-1 truncate text-center text-[10px] font-black uppercase tracking-[0.08em] ${
                        isActive
                          ? "text-text-primary"
                          : isDone
                            ? "text-green-go"
                            : "text-text-dim"
                      }`}
                    >
                      {phaseShortLabel(item)}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--bg-raised)]">
            <div className={`h-full w-full rounded-full ${copy.bar}`} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`arcadia-surface relative mt-2 overflow-hidden rounded-lg border ${tone.ring} p-4 ${tone.glow}`}
      aria-live="polite"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-text-dim">
            Time Left
          </p>
          <p
            className={`mt-1 font-mono text-4xl font-black leading-none ${tone.text}`}
          >
            {formatMs(msLeft)}
          </p>
        </div>

        <div
          className={`rounded-full border px-3 py-1 text-xs font-black uppercase tracking-[0.16em] ${tone.badge}`}
        >
          {tone.label}
        </div>
      </div>

      <div className="mt-4 h-3 overflow-hidden rounded-full bg-[var(--bg-raised)]">
        <div
          className={`h-full rounded-full ${tone.bar} transition-[width] duration-300 ease-out`}
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <div className="mt-2 flex items-center justify-between text-xs font-semibold text-text-dim">
        <span>Open</span>
        <span>{Math.round(progress * 100)}%</span>
        <span>Lock</span>
      </div>
    </div>
  );
}
