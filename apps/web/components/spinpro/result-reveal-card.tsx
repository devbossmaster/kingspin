"use client";

import type { EntryWithPlayerSnapshot } from "@kingspin/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatCoins, formatMs } from "../../lib/format";
import {
  getEntryDisplayColor,
  getPlayerDisplayName,
  sortDisplayEntries,
} from "./player-display";

type RevealEntry = EntryWithPlayerSnapshot & {
  pending?: boolean;
  optimisticBaseEntryId?: string | null;
};

type ResultRevealCardProps = {
  entries: RevealEntry[];
  winnerEntryId?: string | null;
  netPrizeAmount?: string | null;
  totalEntryAmount?: string | null;
  msUntilNextRound?: number | null;
  resultReason?: string | null;
  publicPhase?: string | null;
};

const PARTICLE_COUNT = 26;

function normalizeMs(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, value);
}

export function ResultRevealCard({
  entries,
  winnerEntryId,
  netPrizeAmount,
  totalEntryAmount,
  msUntilNextRound,
  resultReason,
  publicPhase,
}: ResultRevealCardProps) {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [localMsLeft, setLocalMsLeft] = useState(() =>
    normalizeMs(msUntilNextRound),
  );

  const previousRevealKeyRef = useRef<string | null>(null);
  const [burstKey, setBurstKey] = useState(0);

  const displayEntries = useMemo(() => sortDisplayEntries(entries), [entries]);

  const winnerIndex = useMemo(() => {
    if (!winnerEntryId) return -1;
    return displayEntries.findIndex((entry) => entry.id === winnerEntryId);
  }, [displayEntries, winnerEntryId]);

  const winner = winnerIndex >= 0 ? displayEntries[winnerIndex] : null;

  const showWinner =
    publicPhase === "RESULT" && resultReason === "WINNER" && winnerEntryId;

  const showRefund =
    publicPhase === "RESULT" && resultReason === "REFUNDED_SINGLE";

  const showSkipped =
    publicPhase === "RESULT" && resultReason === "SKIPPED_EMPTY";

  const isVisible = showWinner || showRefund || showSkipped;

  const revealKey = `${publicPhase ?? "none"}:${resultReason ?? "none"}:${
    winnerEntryId ?? "none"
  }`;

  const prizeAmount = netPrizeAmount ?? totalEntryAmount ?? "0";
  const formattedPrizeAmount = formatCoins(prizeAmount);
  const winnerName = getPlayerDisplayName(winner, winnerIndex);
  const winnerColor =
    winner && winnerIndex >= 0
      ? getEntryDisplayColor(winner, winnerIndex)
      : "#facc15";

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");

    setPrefersReducedMotion(media.matches);

    const onChange = () => setPrefersReducedMotion(media.matches);
    media.addEventListener("change", onChange);

    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    setLocalMsLeft(normalizeMs(msUntilNextRound));
  }, [msUntilNextRound, revealKey]);

  useEffect(() => {
    if (!isVisible) return;

    const interval = window.setInterval(() => {
      setLocalMsLeft((current) => Math.max(0, current - 1_000));
    }, 1_000);

    return () => window.clearInterval(interval);
  }, [isVisible, revealKey]);

  useEffect(() => {
    if (!isVisible) {
      previousRevealKeyRef.current = null;
      return;
    }

    if (previousRevealKeyRef.current !== revealKey) {
      previousRevealKeyRef.current = revealKey;
      setBurstKey((current) => current + 1);
    }
  }, [isVisible, revealKey]);

  if (!isVisible) {
    return null;
  }

  const title = showWinner
    ? "Winner"
    : showRefund
      ? "Refunded"
      : "Skipped";

  const subtitle = showWinner
    ? winnerName
    : showRefund
      ? "Single player round"
      : "No entries this round";

  const amountLabel = showWinner
    ? formattedPrizeAmount
    : showRefund
      ? "Entry returned"
      : "No winner";

  const countdownText =
    localMsLeft > 0 ? `Next round in ${formatMs(localMsLeft)}` : "Next round";

  return (
    <div className="pointer-events-none absolute inset-x-3 top-[58%] z-50 flex -translate-y-1/2 justify-center">
      <style>{`
        .result-card-pop {
          animation: ${
            prefersReducedMotion
              ? "none"
              : "resultCardPop 620ms cubic-bezier(0.16, 1.18, 0.26, 1) both"
          };
        }

        .result-card-shine {
          animation: ${
            prefersReducedMotion ? "none" : "resultShine 1.7s ease-in-out 1"
          };
        }

        .result-particle {
          animation: ${
            prefersReducedMotion
              ? "none"
              : "resultParticle 960ms ease-out forwards"
          };
        }

        .result-countdown-pulse {
          animation: ${
            prefersReducedMotion
              ? "none"
              : "resultCountdownPulse 1.1s ease-in-out infinite"
          };
        }

        @keyframes resultCardPop {
          0% {
            opacity: 0;
            transform: translate3d(0, 18px, 0) scale(0.78) rotate(-1deg);
          }
          58% {
            opacity: 1;
            transform: translate3d(0, -4px, 0) scale(1.06) rotate(0.6deg);
          }
          100% {
            opacity: 1;
            transform: translate3d(0, 0, 0) scale(1) rotate(0deg);
          }
        }

        @keyframes resultShine {
          0% {
            transform: translateX(-140%) rotate(14deg);
          }
          100% {
            transform: translateX(160%) rotate(14deg);
          }
        }

        @keyframes resultParticle {
          0% {
            opacity: 0;
            transform: translate3d(0, 0, 0) scale(0.55);
          }
          15% {
            opacity: 1;
          }
          100% {
            opacity: 0;
            transform: translate3d(var(--particle-x), var(--particle-y), 0)
              scale(1.05);
          }
        }

        @keyframes resultCountdownPulse {
          0%,
          100% {
            transform: scale(1);
            opacity: 0.86;
          }
          50% {
            transform: scale(1.04);
            opacity: 1;
          }
        }
      `}</style>

      <div className="relative w-full max-w-[300px]">
        <div
          key={burstKey}
          className="pointer-events-none absolute inset-0 z-0"
          aria-hidden="true"
        >
          {Array.from({ length: PARTICLE_COUNT }, (_, index) => {
            const angle = (index / PARTICLE_COUNT) * Math.PI * 2;
            const distance = 54 + (index % 6) * 13;
            const x = Math.cos(angle) * distance;
            const y = Math.sin(angle) * distance - 12;
            const size = 4 + (index % 4) * 2;

            return (
              <span
                key={`${burstKey}-${index}`}
                className="result-particle absolute left-1/2 top-1/2 rounded-full"
                style={
                  {
                    width: size,
                    height: size,
                    background:
                      index % 3 === 0
                        ? winnerColor
                        : index % 3 === 1
                          ? "#facc15"
                          : "#ffffff",
                    boxShadow: "0 0 16px rgba(250,204,21,0.45)",
                    "--particle-x": `${x}px`,
                    "--particle-y": `${y}px`,
                    animationDelay: `${(index % 7) * 22}ms`,
                  } as React.CSSProperties
                }
              />
            );
          })}
        </div>

        <div className="result-card-pop relative z-10 overflow-hidden rounded-[28px] border border-yellow-300/25 bg-slate-950/88 p-4 text-center shadow-[0_24px_70px_rgba(0,0,0,0.58),0_0_34px_rgba(250,204,21,0.16)] backdrop-blur-xl">
          <div className="result-card-shine pointer-events-none absolute inset-y-[-30%] left-0 w-14 bg-white/10 blur-md" />

          <div
            className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full border border-white/20 text-xl font-black text-slate-950 shadow-[0_0_26px_rgba(250,204,21,0.35)]"
            style={{ background: showWinner ? winnerColor : "#facc15" }}
          >
            {showWinner ? "★" : showRefund ? "↺" : "!"}
          </div>

          <p className="text-[11px] font-black uppercase tracking-[0.28em] text-yellow-200">
            {title}
          </p>

          <h3 className="mt-1 truncate text-2xl font-black leading-tight text-white">
            {subtitle}
          </h3>

          <div className="mx-auto mt-3 max-w-[220px] rounded-2xl border border-white/10 bg-white/[0.07] px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/55">
              {showWinner ? "Winner gets" : "Result"}
            </p>
            <p className="mt-1 font-mono text-3xl font-black leading-none text-yellow-200">
              {amountLabel}
            </p>
          </div>

          <p className="result-countdown-pulse mt-3 text-xs font-black uppercase tracking-[0.16em] text-white/80">
            {countdownText}
          </p>
        </div>
      </div>
    </div>
  );
}