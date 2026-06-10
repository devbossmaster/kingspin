"use client";

import type { EntryWithPlayerSnapshot } from "@kingspin/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCountdown } from "../../hooks/use-countdown";
import { formatCoins, formatMs } from "../../lib/format";
import { getPublicRoundPhase } from "../../lib/room-summary";
import {
  getEntryDisplayColor,
  getPaletteColor,
  PLAYER_SLICE_COLORS,
  sortDisplayEntries,
} from "./player-display";
import { WheelPointer } from "./wheel-pointer";

type WheelEntry = EntryWithPlayerSnapshot & {
  pending?: boolean;
  optimisticBaseEntryId?: string | null;
};

type SpinningWheelProps = {
  entries: WheelEntry[];
  totalEntryAmount: string;
  netPrizeAmount?: string | null;
  spinAngle: number | null | undefined;
  status: string | null | undefined;
  phase?: string | null | undefined;
  resultReason?: string | null | undefined;
  winnerEntryId?: string | null;
  locksAt?: string | null;
  serverNow?: string | null;
  durationMs?: number;
};

type WheelPhase =
  | "ENTRY_OPEN"
  | "RANDOMIZING"
  | "SPINNING"
  | "RESULT"
  | "WAITING";

export const WHEEL_SLICE_COLORS = PLAYER_SLICE_COLORS;

const SPIN_DURATION_MS = 8_000;
const WHEEL_CENTER = 150;
const WHEEL_RADIUS = 136;
const CENTER_DISC_RADIUS = 57;
const COUNTDOWN_RADIUS = 144;
const COUNTDOWN_CIRCUMFERENCE = 2 * Math.PI * COUNTDOWN_RADIUS;

export function getWheelSliceColor(index: number, stableKey?: string | null) {
  return getPaletteColor(index, stableKey);
}

export function getEntrySliceColor(entry: WheelEntry, index: number) {
  return getEntryDisplayColor(entry, index);
}

function normalizePhase(
  phase: string | null | undefined,
  status: string | null | undefined,
): WheelPhase {
  return getPublicRoundPhase({ phase, status }) ?? "WAITING";
}

function normalizeDegrees(value: number) {
  return ((value % 360) + 360) % 360;
}

function polarToCartesian(
  centerX: number,
  centerY: number,
  radius: number,
  angleInDegrees: number,
) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;

  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  };
}

function describePieSlice({
  centerX,
  centerY,
  radius,
  startAngle,
  endAngle,
}: {
  centerX: number;
  centerY: number;
  radius: number;
  startAngle: number;
  endAngle: number;
}) {
  const safeEndAngle =
    endAngle - startAngle >= 359.99 ? startAngle + 359.99 : endAngle;

  const start = polarToCartesian(centerX, centerY, radius, safeEndAngle);
  const end = polarToCartesian(centerX, centerY, radius, startAngle);
  const largeArcFlag = safeEndAngle - startAngle <= 180 ? "0" : "1";

  return [
    `M ${centerX} ${centerY}`,
    `L ${start.x} ${start.y}`,
    `A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`,
    "Z",
  ].join(" ");
}

function entryWeight(entry: EntryWithPlayerSnapshot) {
  if (entry.ticketStart !== null && entry.ticketEnd !== null) {
    const start = BigInt(entry.ticketStart);
    const end = BigInt(entry.ticketEnd);

    if (end >= start) {
      return Number(end - start + 1n);
    }
  }

  return Number(entry.amount);
}

function getPhaseRingColor(phase: WheelPhase) {
  switch (phase) {
    case "ENTRY_OPEN":
      return "#22c55e";
    case "RANDOMIZING":
      return "#06b6d4";
    case "SPINNING":
      return "#ec4899";
    case "RESULT":
      return "#facc15";
    default:
      return "#94a3b8";
  }
}

function getFinalWheelAngle(spinAngle: number | null | undefined) {
  if (typeof spinAngle !== "number" || !Number.isFinite(spinAngle)) {
    return null;
  }

  const normalized = normalizeDegrees(spinAngle);
  return normalizeDegrees(360 - normalized);
}

export function SpinningWheel({
  entries,
  totalEntryAmount,
  netPrizeAmount,
  spinAngle,
  status,
  phase: publicPhase,
  resultReason,
  winnerEntryId,
  locksAt,
  serverNow,
  durationMs = 60_000,
}: SpinningWheelProps) {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [transitionMs, setTransitionMs] = useState(450);

  const previousPhaseRef = useRef<WheelPhase>("WAITING");
  const spinStartedForKeyRef = useRef<string | null>(null);
  const resultSettledForKeyRef = useRef<string | null>(null);

  const phase = normalizePhase(publicPhase, status);
  const ringColor = getPhaseRingColor(phase);
  const displayEntries = useMemo(() => sortDisplayEntries(entries), [entries]);
  const entryCount = displayEntries.length;

  const { msLeft } = useCountdown({
    locksAt,
    serverNow,
    enabled: phase === "ENTRY_OPEN",
  });

  const countdownRatio =
    phase === "ENTRY_OPEN" && durationMs > 0
      ? Math.max(0, Math.min(1, msLeft / durationMs))
      : phase === "RESULT"
        ? 1
        : 0;

  const weights = useMemo(
    () => displayEntries.map(entryWeight),
    [displayEntries],
  );

  const total = useMemo(() => {
    return (
      weights.reduce((sum, weight) => sum + weight, 0) ||
      Number(totalEntryAmount)
    );
  }, [totalEntryAmount, weights]);

  const hasEntries = entryCount > 0 && total > 0;

  const slices = useMemo(() => {
    let cursor = 0;

    return displayEntries.map((entry, index) => {
      const safeWeight = weights[index] ?? 0;
      const sliceDegrees = total > 0 ? (safeWeight / total) * 360 : 0;
      const startAngle = cursor;
      const endAngle = cursor + sliceDegrees;
      cursor = endAngle;

      return {
        entry,
        index,
        startAngle,
        endAngle,
        path: describePieSlice({
          centerX: WHEEL_CENTER,
          centerY: WHEEL_CENTER,
          radius: WHEEL_RADIUS,
          startAngle,
          endAngle,
        }),
      };
    });
  }, [displayEntries, total, weights]);

  const emptyWheelSlices = useMemo(() => {
    const segmentCount = 12;
    const segmentDegrees = 360 / segmentCount;

    return Array.from({ length: segmentCount }, (_, index) => {
      const startAngle = index * segmentDegrees;
      const endAngle = startAngle + segmentDegrees;

      return {
        index,
        path: describePieSlice({
          centerX: WHEEL_CENTER,
          centerY: WHEEL_CENTER,
          radius: WHEEL_RADIUS,
          startAngle,
          endAngle,
        }),
      };
    });
  }, []);

  const finalAngle = getFinalWheelAngle(spinAngle);
  const spinKey = `${winnerEntryId ?? "pending"}:${spinAngle ?? "no-angle"}`;

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");

    setPrefersReducedMotion(media.matches);

    const onChange = () => setPrefersReducedMotion(media.matches);
    media.addEventListener("change", onChange);

    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const previousPhase = previousPhaseRef.current;
    previousPhaseRef.current = phase;

    const setTransitionIfChanged = (nextTransitionMs: number) => {
      setTransitionMs((currentTransitionMs) =>
        currentTransitionMs === nextTransitionMs
          ? currentTransitionMs
          : nextTransitionMs,
      );
    };

    if (phase === "ENTRY_OPEN" || phase === "WAITING") {
      spinStartedForKeyRef.current = null;
      resultSettledForKeyRef.current = null;
      setTransitionIfChanged(prefersReducedMotion ? 0 : 520);

      setRotation((currentRotation) =>
        currentRotation === 0 ? currentRotation : 0,
      );

      return;
    }

    if (phase === "RANDOMIZING") {
      resultSettledForKeyRef.current = null;
      setTransitionIfChanged(prefersReducedMotion ? 0 : 360);

      setRotation((currentRotation) => {
        const idleTarget = normalizeDegrees(currentRotation);
        return currentRotation === idleTarget ? currentRotation : idleTarget;
      });

      return;
    }

    if (phase === "SPINNING" && finalAngle !== null) {
      if (spinStartedForKeyRef.current !== spinKey) {
        spinStartedForKeyRef.current = spinKey;
        resultSettledForKeyRef.current = null;

        const nextTransitionMs = prefersReducedMotion ? 0 : SPIN_DURATION_MS;
        setTransitionIfChanged(nextTransitionMs);

        setRotation((currentRotation) => {
          const currentNormalized = normalizeDegrees(currentRotation);
          const distanceToFinal = normalizeDegrees(
            finalAngle - currentNormalized,
          );
          const extraTurns = prefersReducedMotion ? 0 : 8;

          return currentRotation + extraTurns * 360 + distanceToFinal;
        });
      }

      return;
    }

    if (phase === "RESULT" && finalAngle !== null) {
      if (resultSettledForKeyRef.current !== spinKey) {
        resultSettledForKeyRef.current = spinKey;
        setTransitionIfChanged(prefersReducedMotion ? 0 : 260);

        setRotation((currentRotation) => {
          const currentNormalized = normalizeDegrees(currentRotation);
          const distanceToFinal = normalizeDegrees(
            finalAngle - currentNormalized,
          );

          if (distanceToFinal === 0) {
            return currentRotation;
          }

          return currentRotation + distanceToFinal;
        });
      }
    }

    void previousPhase;
  }, [finalAngle, phase, prefersReducedMotion, spinKey]);

  const isWinnerResult = phase === "RESULT" && resultReason === "WINNER";
  const isRefundResult =
    phase === "RESULT" && resultReason === "REFUNDED_SINGLE";
  const isSkippedResult =
    phase === "RESULT" && resultReason === "SKIPPED_EMPTY";

  const displayAmount = isWinnerResult
    ? (netPrizeAmount ?? totalEntryAmount)
    : totalEntryAmount;

  const formattedDisplayAmount = formatCoins(displayAmount);

  const centerLabel = isWinnerResult
    ? "Winner Gets"
    : isRefundResult
      ? "Refund"
      : isSkippedResult
        ? "Skipped"
        : "Total Pool";

  const centerMainText = isSkippedResult ? "0" : formattedDisplayAmount;

  const centerBottomText =
    phase === "ENTRY_OPEN"
      ? `Ends in ${formatMs(msLeft)}`
      : phase === "RANDOMIZING"
        ? "Drawing winner..."
        : phase === "SPINNING"
          ? "Spinning..."
          : isWinnerResult
            ? "Result"
            : isRefundResult
              ? "Refunded"
              : isSkippedResult
                ? "No entries"
                : "Waiting";

  const showPhaseAction = phase === "RANDOMIZING" || phase === "SPINNING";

  return (
    <section className="relative overflow-visible bg-transparent p-0">
      <style>{`
        .wheel-shell {
          transform: translateZ(0);
          animation: ${
            prefersReducedMotion
              ? "none"
              : "wheelBreath 3.2s ease-in-out infinite"
          };
        }

        .phase-action-pill {
          animation: ${
            prefersReducedMotion
              ? "none"
              : "phaseActionPulse 1s ease-in-out infinite"
          };
        }

        @keyframes wheelBreath {
          0%,
          100% {
            transform: translateZ(0) scale(1);
          }
          50% {
            transform: translateZ(0) scale(1.004);
          }
        }

        @keyframes phaseActionPulse {
          0%,
          100% {
            transform: translateY(0) scale(1);
            opacity: 0.9;
            box-shadow: 0 10px 30px rgba(251, 191, 36, 0.18);
          }
          50% {
            transform: translateY(-3px) scale(1.04);
            opacity: 1;
            box-shadow: 0 16px 42px rgba(251, 191, 36, 0.35);
          }
        }
      `}</style>

      <div className="relative flex min-h-[335px] items-center justify-center overflow-visible pb-12 md:min-h-[405px]">
        {/* Pointer exactly at the top edge */}
        <div className="pointer-events-none absolute left-1/2 top-[4px] z-30 -translate-x-1/2">
          <WheelPointer />
        </div>

        <svg
          viewBox="0 0 300 300"
          role="img"
          aria-label={
            hasEntries
              ? `Prize wheel with ${entryCount} entries. Total pool ${formatCoins(
                  totalEntryAmount,
                )} coins`
              : "Prize wheel waiting for entries"
          }
          className="wheel-shell relative z-10 aspect-square w-[86vw] max-w-[320px] md:max-w-[365px]"
          style={{ height: "auto" }}
        >
          <defs>
            <filter
              id="wheelShadow"
              x="-30%"
              y="-30%"
              width="160%"
              height="160%"
            >
              <feDropShadow
                dx="0"
                dy="10"
                stdDeviation="10"
                floodColor="rgba(0,0,0,0.55)"
              />
            </filter>

            <radialGradient id="centerDiscBg" cx="50%" cy="35%" r="75%">
              <stop offset="0%" stopColor="rgba(30,41,59,0.96)" />
              <stop offset="70%" stopColor="rgba(8,15,30,0.98)" />
              <stop offset="100%" stopColor="rgba(2,6,23,1)" />
            </radialGradient>
          </defs>

          {/* Outer white border */}
          <circle
            cx="150"
            cy="150"
            r="145"
            fill="white"
            filter="url(#wheelShadow)"
          />

          {/* Dark rim */}
          <circle cx="150" cy="150" r="140" fill="#0a1020" />

          {/* Countdown ring track */}
          <circle
            cx="150"
            cy="150"
            r={COUNTDOWN_RADIUS}
            fill="none"
            stroke="rgba(255,255,255,0.10)"
            strokeWidth="4"
          />

          {/* Active countdown ring */}
          <circle
            cx="150"
            cy="150"
            r={COUNTDOWN_RADIUS}
            fill="none"
            stroke={ringColor}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={COUNTDOWN_CIRCUMFERENCE}
            strokeDashoffset={COUNTDOWN_CIRCUMFERENCE * (1 - countdownRatio)}
            transform="rotate(-90 150 150)"
            style={{
              transition: prefersReducedMotion
                ? "none"
                : "stroke-dashoffset 700ms linear, stroke 220ms ease",
              filter:
                phase === "ENTRY_OPEN"
                  ? `drop-shadow(0 0 6px ${ringColor})`
                  : "none",
            }}
          />

          {/* Rotating slices */}
          <g
            style={{
              transform: `rotate(${rotation}deg)`,
              transformOrigin: "150px 150px",
              transition: prefersReducedMotion
                ? "none"
                : `transform ${transitionMs}ms cubic-bezier(0.12, 0.72, 0.18, 1)`,
            }}
          >
            {!hasEntries
              ? emptyWheelSlices.map(({ index, path }) => (
                  <path
                    key={index}
                    d={path}
                    fill={index % 2 === 0 ? "#14203c" : "#10192f"}
                    stroke="#0b1325"
                    strokeWidth="2"
                  />
                ))
              : slices.map(({ entry, index, path }) => (
                  <path
                    key={entry.id}
                    d={path}
                    fill={getEntrySliceColor(entry, index)}
                    opacity={entry.pending ? 0.72 : 1}
                    stroke="#0b1325"
                    strokeWidth="2"
                  />
                ))}
          </g>

          {/* Inner wheel outline */}
          <circle
            cx="150"
            cy="150"
            r={WHEEL_RADIUS}
            fill="none"
            stroke="rgba(255,255,255,0.14)"
            strokeWidth="1"
          />

          {/* Center disc ring */}
          <circle
            cx="150"
            cy="150"
            r="66"
            fill="rgba(80,35,10,0.18)"
            stroke="rgba(255,180,90,0.20)"
            strokeWidth="3"
          />

          <circle
            cx="150"
            cy="150"
            r={CENTER_DISC_RADIUS}
            fill="url(#centerDiscBg)"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="2"
          />
        </svg>

        {/* Center content */}
        <div className="pointer-events-none absolute z-20 flex h-[118px] w-[118px] flex-col items-center justify-center rounded-full text-center">
          <div className="mb-1 text-lg leading-none">🪙</div>

          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/82">
            {centerLabel}
          </p>

          <p className="mt-1 font-mono text-[22px] font-black leading-none text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.85)]">
            {centerMainText}
          </p>

          <p className="mt-2 max-w-[96px] text-[11px] font-extrabold text-slate-200 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
            {centerBottomText}
          </p>
        </div>

        {/* Bottom phase badge */}
        {showPhaseAction ? (
          <div className="phase-action-pill pointer-events-none absolute bottom-0 z-30 rounded-full border border-yellow-200/60 bg-gradient-to-r from-yellow-300 via-amber-300 to-orange-400 px-6 py-3 text-center text-[12px] font-black uppercase tracking-[0.18em] text-slate-950 shadow-[0_16px_42px_rgba(251,191,36,0.38)]">
            {phase === "SPINNING" ? "Spinning..." : "Drawing winner..."}
          </div>
        ) : null}
      </div>
    </section>
  );
}