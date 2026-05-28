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

function phaseCopy(status: string | null | undefined) {
  if (!status) {
    return {
      title: "Inactive",
      subtitle: "Waiting for the next round.",
      badge: "Waiting",
    };
  }

  if (status === "LOCKED") {
    return {
      title: "Round locked",
      subtitle: "Entries are closed. Preparing draw.",
      badge: "Locked",
    };
  }

  if (status === "DRAWING") {
    return {
      title: "Drawing winner",
      subtitle: "Ticket ranges are being resolved.",
      badge: "Drawing",
    };
  }

  if (status === "SPINNING") {
    return {
      title: "Wheel spinning",
      subtitle: "Animation is running live.",
      badge: "Spinning",
    };
  }

  if (status === "SETTLING") {
    return {
      title: "Settling payout",
      subtitle: "Winner and wallet updates are being finalized.",
      badge: "Settling",
    };
  }

  return {
    title: status,
    subtitle: "Entries are currently closed.",
    badge: status,
  };
}

export function RoundTimer({
  status,
  serverNow,
  locksAt,
  durationMs,
}: RoundTimerProps) {
  const { msLeft } = useCountdown({
    locksAt,
    serverNow,
    enabled: status === "OPEN",
  });

  const progress = Math.max(
    0,
    Math.min(1, durationMs > 0 ? msLeft / durationMs : 0),
  );

  const tone = useMemo(
    () => timerTone(msLeft, durationMs),
    [durationMs, msLeft],
  );

  if (status !== "OPEN") {
    const copy = phaseCopy(status);

    return (
      <div
        className="arcadia-surface relative mt-2 overflow-hidden rounded-lg p-4"
        aria-live="polite"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-text-dim">
              Round Phase
            </p>
            <p className="mt-1 font-display text-xl font-black text-text-primary">
              {copy.title}
            </p>
            <p className="mt-1 text-sm text-text-secondary">{copy.subtitle}</p>
          </div>

          <div className="rounded-full border border-[rgba(148,163,184,0.28)] bg-[rgba(148,163,184,0.1)] px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-text-secondary">
            {copy.badge}
          </div>
        </div>

        <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--bg-raised)]">
          <div className="h-full w-full rounded-full bg-[rgba(148,163,184,0.35)]" />
        </div>
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
          <p className={`mt-1 font-mono text-4xl font-black leading-none ${tone.text}`}>
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
