"use client";

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

  if (ratio <= 0.25) {
    return {
      text: "text-red-hot",
      bar: "bg-[var(--red-hot)]",
      ring: "border-[rgba(248,113,113,0.48)]",
    };
  }

  if (ratio <= 0.5) {
    return {
      text: "text-gold",
      bar: "bg-[var(--gold)]",
      ring: "border-[rgba(246,197,71,0.48)]",
    };
  }

  return {
    text: "text-green-go",
    bar: "bg-[var(--green-go)]",
    ring: "border-[rgba(74,222,128,0.44)]",
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
  const tone = timerTone(msLeft, durationMs);
  const progress = Math.max(0, Math.min(1, durationMs > 0 ? msLeft / durationMs : 0));

  if (status !== "OPEN") {
    return (
      <div
        className={`mt-2 rounded-md border ${tone.ring} bg-white/[0.04] px-3 py-2`}
        aria-live="polite"
      >
        <p className="font-display text-lg font-black">{status ?? "Inactive"}</p>
        <p className="text-sm text-text-secondary">Entries closed</p>
      </div>
    );
  }

  return (
    <div aria-live="polite">
      <div className={`mt-1 rounded-md border ${tone.ring} bg-white/[0.04] p-3`}>
        <p className={`font-mono text-3xl font-black ${tone.text}`}>
          {formatMs(msLeft)}
        </p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--bg-raised)]">
          <div
            className={`h-full rounded-full ${tone.bar} transition-[width] duration-200`}
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
