"use client";

import type { EntryWithPlayerSnapshot } from "@kingspin/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCountdown } from "../../hooks/use-countdown";
import { formatCoins, formatMs } from "../../lib/format";
import { getPublicRoundPhase } from "../../lib/room-summary";
import {
  getEntryDisplayColor,
  getPaletteColor,
  getPlayerDisplayName,
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

const SPIN_DURATION_MS = 6500;
const WHEEL_CENTER = 150;
const WHEEL_OUTER_RADIUS = 136;
const WHEEL_INNER_RADIUS = 68;
const COUNTDOWN_RADIUS = 143;
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

function describeDonutSlice({
  centerX,
  centerY,
  outerRadius,
  innerRadius,
  startAngle,
  endAngle,
}: {
  centerX: number;
  centerY: number;
  outerRadius: number;
  innerRadius: number;
  startAngle: number;
  endAngle: number;
}) {
  const safeEndAngle =
    endAngle - startAngle >= 359.99 ? startAngle + 359.99 : endAngle;

  const outerStart = polarToCartesian(
    centerX,
    centerY,
    outerRadius,
    safeEndAngle,
  );
  const outerEnd = polarToCartesian(centerX, centerY, outerRadius, startAngle);
  const innerStart = polarToCartesian(
    centerX,
    centerY,
    innerRadius,
    startAngle,
  );
  const innerEnd = polarToCartesian(
    centerX,
    centerY,
    innerRadius,
    safeEndAngle,
  );

  const largeArcFlag = safeEndAngle - startAngle <= 180 ? "0" : "1";

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 0 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerStart.x} ${innerStart.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 1 ${innerEnd.x} ${innerEnd.y}`,
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

function getWheelStatusCopy(phase: WheelPhase) {
  switch (phase) {
    case "ENTRY_OPEN":
      return {
        label: "Entry Open",
        centerLabel: "Ends in",
        ring: "#22c55e",
      };

    case "RANDOMIZING":
      return {
        label: "Randomizing",
        centerLabel: "Locking",
        ring: "#06b6d4",
      };

    case "SPINNING":
      return {
        label: "Spinning",
        centerLabel: "Spinning",
        ring: "#ec4899",
      };

    case "RESULT":
      return {
        label: "Result",
        centerLabel: "Winner",
        ring: "#facc15",
      };

    default:
      return {
        label: "Preparing",
        centerLabel: "Waiting",
        ring: "#94a3b8",
      };
  }
}

function getFinalWheelAngle(spinAngle: number | null | undefined) {
  if (typeof spinAngle !== "number" || !Number.isFinite(spinAngle)) {
    return null;
  }

  const normalized = normalizeDegrees(spinAngle);
  return normalizeDegrees(360 - normalized);
}

function getEntryName(
  entry: EntryWithPlayerSnapshot | null | undefined,
  fallback = "Winner",
) {
  const displayName = getPlayerDisplayName(entry);

  return displayName === "Player" ? fallback : displayName;
}

function devLog(message: string, details?: unknown) {
  if (process.env.NODE_ENV === "production") return;

  if (details === undefined) {
    console.debug(`[spinning-wheel] ${message}`);
    return;
  }

  console.debug(`[spinning-wheel] ${message}`, details);
}

export function SpinningWheel({
  entries,
  totalEntryAmount,
  spinAngle,
  status,
  phase: publicPhase,
  resultReason,
  winnerEntryId,
  locksAt,
  serverNow,
  durationMs = 45_000,
}: SpinningWheelProps) {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [transitionMs, setTransitionMs] = useState(500);
  const [joinPopKey, setJoinPopKey] = useState(0);
  const [coinBursts, setCoinBursts] = useState<number[]>([]);

  const previousPhaseRef = useRef<WheelPhase>("WAITING");
  const previousEntryCountRef = useRef(entries.length);
  const spinStartedForKeyRef = useRef<string | null>(null);
  const resultSettledForKeyRef = useRef<string | null>(null);

  const phase = normalizePhase(publicPhase, status);
  const statusCopy = getWheelStatusCopy(phase);
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

  // Wheel data mapping: ticket ranges define slice weight, falling back to amount.
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

  const winner = useMemo(() => {
    return displayEntries.find((entry) => entry.id === winnerEntryId) ?? null;
  }, [displayEntries, winnerEntryId]);

  // Wheel data mapping: each entry maps to one slice in the current entry order.
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
        path: describeDonutSlice({
          centerX: WHEEL_CENTER,
          centerY: WHEEL_CENTER,
          outerRadius: WHEEL_OUTER_RADIUS,
          innerRadius: WHEEL_INNER_RADIUS,
          startAngle,
          endAngle,
        }),
      };
    });
  }, [displayEntries, total, weights]);

  const emptyWheelSlices = useMemo(() => {
    const segmentCount = 16;
    const segmentDegrees = 360 / segmentCount;

    return Array.from({ length: segmentCount }, (_, index) => {
      const startAngle = index * segmentDegrees;
      const endAngle = startAngle + segmentDegrees;

      return {
        index,
        path: describeDonutSlice({
          centerX: WHEEL_CENTER,
          centerY: WHEEL_CENTER,
          outerRadius: WHEEL_OUTER_RADIUS,
          innerRadius: WHEEL_INNER_RADIUS,
          startAngle,
          endAngle,
        }),
      };
    });
  }, []);

  // Spin/result behavior: backend spinAngle and winnerEntryId define the landing key.
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
    if (entryCount > previousEntryCountRef.current) {
      setJoinPopKey((key) => key + 1);

      const burstKey = Date.now();
      setCoinBursts((current) => [...current.slice(-3), burstKey]);

      window.setTimeout(() => {
        setCoinBursts((current) => current.filter((key) => key !== burstKey));
      }, 1100);
    }

    previousEntryCountRef.current = entryCount;
  }, [entryCount]);

  // Spin/result behavior: preserves phase timing, spin start, and final settle logic.
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

      setTransitionIfChanged(phase === "ENTRY_OPEN" ? 900 : 450);

      setRotation((currentRotation) => {
        const idleTarget = normalizeDegrees(currentRotation);
        return currentRotation === idleTarget ? currentRotation : idleTarget;
      });

      return;
    }

    if (phase === "RANDOMIZING") {
      resultSettledForKeyRef.current = null;
      setTransitionIfChanged(prefersReducedMotion ? 0 : 450);
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
          const extraTurns = prefersReducedMotion ? 0 : 7;
          const nextRotation =
            currentRotation + extraTurns * 360 + distanceToFinal;

          devLog("smooth spinning animation started", {
            from: previousPhase,
            to: phase,
            spinAngle,
            winnerEntryId,
            nextRotation,
          });

          return nextRotation;
        });
      }

      return;
    }

    if (phase === "RESULT" && finalAngle !== null) {
      if (resultSettledForKeyRef.current !== spinKey) {
        resultSettledForKeyRef.current = spinKey;
        setTransitionIfChanged(prefersReducedMotion ? 0 : 700);

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
  }, [
    finalAngle,
    phase,
    prefersReducedMotion,
    spinAngle,
    spinKey,
    winnerEntryId,
  ]);

  // Center display: copies backend/result phase without changing winner state.
  const shouldGlow = !prefersReducedMotion && phase === "SPINNING";
  const showWinnerName = phase === "RESULT" && resultReason === "WINNER";
  const centerLabel =
    phase === "RESULT"
      ? resultReason === "WINNER"
        ? "Winner"
        : resultReason === "REFUNDED_SINGLE"
          ? "Refund"
          : resultReason === "SKIPPED_EMPTY"
            ? "Skipped"
            : "Result"
      : statusCopy.centerLabel;

  const centerBottomText =
    phase === "ENTRY_OPEN"
      ? formatMs(msLeft)
      : showWinnerName
        ? getEntryName(winner)
        : phase === "RESULT" && resultReason === "SKIPPED_EMPTY"
          ? "No entries"
          : phase === "RESULT" && resultReason === "REFUNDED_SINGLE"
            ? "Refunded"
            : `${entryCount} ${entryCount === 1 ? "entry" : "entries"}`;

  return (
    <section className="relative overflow-visible bg-transparent p-0">
      <style>{`
        .wheel-shell {
          animation: ${
            prefersReducedMotion
              ? "none"
              : "wheelBreath 2.8s ease-in-out infinite"
          };
        }

        .wheel-pop {
          animation: ${
            prefersReducedMotion
              ? "none"
              : "wheelJoinPop 520ms cubic-bezier(0.2, 1.4, 0.35, 1)"
          };
        }

        .coin-burst {
          animation: ${
            prefersReducedMotion ? "none" : "coinBurst 1050ms ease-out forwards"
          };
        }

        .status-shine {
          animation: ${
            prefersReducedMotion ? "none" : "shineSweep 2.2s linear infinite"
          };
        }

        .phase-pulse {
          animation: ${
            prefersReducedMotion
              ? "none"
              : "phaseHeartbeat 1.1s ease-in-out infinite"
          };
        }

        @keyframes wheelBreath {
          0%,
          100% {
            transform: scale(1);
            filter: drop-shadow(0 10px 20px rgba(0, 0, 0, 0.34));
          }
          50% {
            transform: scale(1.003);
            filter: drop-shadow(0 12px 24px rgba(99, 102, 241, 0.08));
          }
        }

        @keyframes wheelJoinPop {
          0% {
            transform: scale(1);
          }
          35% {
            transform: scale(1.045);
          }
          100% {
            transform: scale(1);
          }
        }

        @keyframes coinBurst {
          0% {
            opacity: 0;
            transform: translateY(16px) scale(0.7);
          }
          18% {
            opacity: 1;
          }
          100% {
            opacity: 0;
            transform: translateY(-72px) scale(1.16);
          }
        }

        @keyframes shineSweep {
          0% {
            transform: translateX(-120%);
          }
          100% {
            transform: translateX(120%);
          }
        }

        @keyframes phaseHeartbeat {
          0%,
          100% {
            opacity: 0.78;
            transform: scale(1);
          }
          45% {
            opacity: 1;
            transform: scale(1.06);
          }
        }
      `}</style>

      <div className="relative flex min-h-[280px] items-center justify-center overflow-visible md:min-h-[360px]">
        {/* Pointer */}
        <div className="absolute inset-x-0 top-11 z-30 flex justify-center md:top-12">
          <WheelPointer />
        </div>

        {/* Safe class/layout zone: status badge and decorative overlays. */}
        <div className="pointer-events-none absolute top-2 z-40 overflow-hidden rounded-full border border-white/10 bg-black/55 px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-white/90 shadow-lg backdrop-blur-xl">
          <span
            className={`relative z-10 inline-block ${
              phase === "RANDOMIZING" ? "phase-pulse" : ""
            }`}
          >
            {statusCopy.label}
          </span>
          {phase === "SPINNING" ? (
            <span className="status-shine absolute inset-y-0 w-12 rotate-12 bg-white/10 blur-sm" />
          ) : null}
        </div>

        {coinBursts.map((key, index) => (
          <div
            key={key}
            className="coin-burst pointer-events-none absolute z-30 rounded-full border border-amber-200/50 bg-amber-400 px-2 py-1 text-xs font-black text-amber-950 shadow-[0_0_24px_rgba(251,191,36,0.55)]"
            style={{
              left: `${44 + index * 8}%`,
              bottom: `${20 + index * 4}%`,
              animationDelay: `${index * 80}ms`,
            }}
          >
            +1
          </div>
        ))}

        {shouldGlow ? (
          <>
            <div className="pointer-events-none absolute h-[80%] w-[80%] rounded-full border border-fuchsia-400/10 shadow-[0_0_24px_rgba(217,70,239,0.08)]" />
            <div className="pointer-events-none absolute h-[66%] w-[66%] rounded-full border border-cyan-300/10 shadow-[0_0_20px_rgba(34,211,238,0.08)]" />
          </>
        ) : null}

        <svg
          key={joinPopKey}
          viewBox="0 0 300 300"
          role="img"
          aria-label={
            hasEntries
              ? `Prize wheel with ${entryCount} entries and pool ${formatCoins(
                  totalEntryAmount,
                )} coins`
              : "Prize wheel waiting for entries"
          }
          className="wheel-shell wheel-pop relative z-10 aspect-square w-[84vw] max-w-[310px] md:max-w-[360px]"
          style={{ height: "auto" }}
        >
          <defs>
            <filter
              id="donutWheelShadow"
              x="-30%"
              y="-30%"
              width="160%"
              height="160%"
            >
              <feDropShadow
                dx="0"
                dy="12"
                stdDeviation="10"
                floodColor="rgba(0,0,0,0.68)"
              />
              <feDropShadow
                dx="0"
                dy="0"
                stdDeviation="3"
                floodColor="rgba(250,204,21,0.16)"
              />
            </filter>

            <linearGradient
              id="metalOuterRing"
              x1="0%"
              y1="0%"
              x2="100%"
              y2="100%"
            >
              <stop offset="0%" stopColor="rgba(255,255,255,0.95)" />
              <stop offset="28%" stopColor="rgba(250,204,21,0.88)" />
              <stop offset="52%" stopColor="rgba(15,23,42,0.95)" />
              <stop offset="77%" stopColor="rgba(255,255,255,0.75)" />
              <stop offset="100%" stopColor="rgba(250,204,21,0.92)" />
            </linearGradient>
          </defs>

          {/* Safe class/layout zone: outer rings and countdown ring. */}
          <circle
            cx="150"
            cy="150"
            r="146"
            fill="none"
            stroke="url(#metalOuterRing)"
            strokeWidth="3"
            filter="url(#donutWheelShadow)"
          />

          <circle
            cx="150"
            cy="150"
            r="140"
            fill="none"
            stroke="rgba(2,6,23,0.92)"
            strokeWidth="5"
          />

          <circle
            cx="150"
            cy="150"
            r={COUNTDOWN_RADIUS}
            fill="none"
            stroke="rgba(255,255,255,0.13)"
            strokeWidth="4"
          />

          <circle
            cx="150"
            cy="150"
            r={COUNTDOWN_RADIUS}
            fill="none"
            stroke={statusCopy.ring}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={COUNTDOWN_CIRCUMFERENCE}
            strokeDashoffset={COUNTDOWN_CIRCUMFERENCE * (1 - countdownRatio)}
            transform="rotate(-90 150 150)"
            style={{
              transition: prefersReducedMotion
                ? "none"
                : "stroke-dashoffset 900ms linear, stroke 250ms ease",
              filter:
                phase === "ENTRY_OPEN"
                  ? `drop-shadow(0 0 5px ${statusCopy.ring})`
                  : "none",
            }}
          />

          {/* Slice rendering */}
          <g
            style={{
              transform: `rotate(${rotation}deg)`,
              transformOrigin: "150px 150px",
              transition: prefersReducedMotion
                ? "none"
                : `transform ${transitionMs}ms cubic-bezier(0.12, 0.72, 0.18, 1)`,
            }}
          >
            {!hasEntries ? (
              emptyWheelSlices.map(({ index, path }) => (
                <path
                  key={index}
                  d={path}
                  fill={index % 2 === 0 ? "#172033" : "#111827"}
                  stroke="#020617"
                  strokeWidth="2"
                />
              ))
            ) : entryCount === 1 ? (
              <path
                d={describeDonutSlice({
                  centerX: WHEEL_CENTER,
                  centerY: WHEEL_CENTER,
                  outerRadius: WHEEL_OUTER_RADIUS,
                  innerRadius: WHEEL_INNER_RADIUS,
                  startAngle: 0,
                  endAngle: 360,
                })}
                fill={
                  displayEntries[0]
                    ? getEntrySliceColor(displayEntries[0], 0)
                    : getWheelSliceColor(0)
                }
                opacity={displayEntries[0]?.pending ? 0.72 : 1}
                stroke="#020617"
                strokeWidth="1.8"
              />
            ) : (
              slices.map(({ entry, index, path }) => {
                return (
                  <path
                    key={entry.id}
                    d={path}
                    fill={getEntrySliceColor(entry, index)}
                    opacity={entry.pending ? 0.72 : 1}
                    stroke="#020617"
                    strokeWidth="1.8"
                  />
                );
              })
            )}

            <circle
              cx="150"
              cy="150"
              r={WHEEL_OUTER_RADIUS}
              fill="none"
              stroke="rgba(255,255,255,0.12)"
              strokeWidth="1"
            />

            <circle
              cx="150"
              cy="150"
              r={WHEEL_INNER_RADIUS}
              fill="none"
              stroke="rgba(255,255,255,0.16)"
              strokeWidth="2"
            />
          </g>

          {/* Safe class/layout zone: center ring artwork. */}
          <circle
            cx="150"
            cy="150"
            r="63"
            fill="none"
            stroke="rgba(15,23,42,0.85)"
            strokeWidth="4"
          />

          <circle
            cx="150"
            cy="150"
            r="53"
            fill="none"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth="1.5"
          />
        </svg>

        {/* Center display */}
        <div className="pointer-events-none absolute z-20 flex h-[98px] w-[98px] flex-col items-center justify-center rounded-full text-center md:h-[104px] md:w-[104px]">
          <div className="absolute inset-0 rounded-full bg-slate-950/20 backdrop-blur-[1px]" />
          <div className="relative">
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-white/85">
              {centerLabel}
            </p>

            <p className="mt-1 font-mono text-xl font-black leading-none text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.85)]">
              {formatCoins(totalEntryAmount)}
            </p>

            <p className="mt-2 max-w-[84px] truncate text-[10px] font-bold text-slate-200 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
              {centerBottomText}
            </p>
          </div>
        </div>

        {phase === "SPINNING" ? (
          <div className="pointer-events-none absolute bottom-5 z-20 rounded-full bg-black/45 px-4 py-2 text-center text-xs font-black uppercase tracking-[0.16em] text-white backdrop-blur">
            Revealing winner
          </div>
        ) : null}
      </div>
    </section>
  );
}
