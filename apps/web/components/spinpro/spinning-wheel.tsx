"use client";

import type { EntryWithPlayerSnapshot } from "@kingspin/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCountdown } from "../../hooks/use-countdown";
import { formatCoins } from "../../lib/format";
import { getPublicRoundPhase } from "../../lib/room-summary";
import { WheelPointer } from "./wheel-pointer";

type SpinningWheelProps = {
  entries: (EntryWithPlayerSnapshot & { pending?: boolean })[];
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

export const WHEEL_SLICE_COLORS = [
  "#F6C547",
  "#4ADE80",
  "#2DD4BF",
  "#E879F9",
  "#F87171",
  "#60A5FA",
  "#C9962A",
  "#14B8A6",
  "#A78BFA",
  "#84CC16",
];

const SPIN_DURATION_MS = 5000;
const WHEEL_CENTER = 150;
const WHEEL_OUTER_RADIUS = 144;
const WHEEL_SLICE_RADIUS = 132;
const COUNTDOWN_CIRCUMFERENCE = 2 * Math.PI * WHEEL_OUTER_RADIUS;

export function getWheelSliceColor(index: number) {
  return WHEEL_SLICE_COLORS[index % WHEEL_SLICE_COLORS.length] ?? "#F6C547";
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

function describeSlice(
  centerX: number,
  centerY: number,
  radius: number,
  startAngle: number,
  endAngle: number,
) {
  const start = polarToCartesian(centerX, centerY, radius, endAngle);
  const end = polarToCartesian(centerX, centerY, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";

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

function getWheelStatusCopy(phase: WheelPhase) {
  switch (phase) {
    case "ENTRY_OPEN":
      return {
        label: "Entries open",
        helper: "Players can enter while the countdown is running.",
        badge:
          "border-[rgba(74,222,128,0.32)] bg-[rgba(74,222,128,0.1)] text-green-go",
        overlay: null,
      };

    case "RANDOMIZING":
      return {
        label: "Randomizing",
        helper: "Tickets and the winning position are being resolved.",
        badge:
          "border-[rgba(45,212,191,0.32)] bg-[rgba(45,212,191,0.1)] text-teal",
        overlay: "Randomizing",
      };

    case "SPINNING":
      return {
        label: "Wheel spinning",
        helper: "Live reveal in progress. The result is server-authoritative.",
        badge:
          "border-[rgba(232,121,249,0.32)] bg-[rgba(232,121,249,0.1)] text-magenta",
        overlay: "Revealing winner",
      };

    case "RESULT":
      return {
        label: "Result",
        helper: "Result is visible. Next round starts soon.",
        badge:
          "border-[rgba(250,204,21,0.32)] bg-[rgba(250,204,21,0.1)] text-[var(--gold)]",
        overlay: "Result",
      };

    default:
      return {
        label: "Waiting for round",
        helper: "The next round is preparing.",
        badge:
          "border-[rgba(148,163,184,0.28)] bg-[rgba(148,163,184,0.1)] text-text-secondary",
        overlay: "Preparing",
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

  const previousPhaseRef = useRef<WheelPhase>("WAITING");
  const spinStartedForKeyRef = useRef<string | null>(null);
  const resultSettledForKeyRef = useRef<string | null>(null);

  const phase = normalizePhase(publicPhase, status);
  const statusCopy = getWheelStatusCopy(phase);

  const { msLeft } = useCountdown({
    locksAt,
    serverNow,
    enabled: phase === "ENTRY_OPEN",
  });

  const countdownRatio =
    phase === "ENTRY_OPEN" && durationMs > 0
      ? Math.max(0, Math.min(1, msLeft / durationMs))
      : 0;

  const weights = useMemo(() => entries.map(entryWeight), [entries]);

  const total = useMemo(() => {
    return (
      weights.reduce((sum, weight) => sum + weight, 0) ||
      Number(totalEntryAmount)
    );
  }, [totalEntryAmount, weights]);

  const hasEntries = entries.length > 0 && total > 0;

  const winner = useMemo(() => {
    return entries.find((entry) => entry.id === winnerEntryId) ?? null;
  }, [entries, winnerEntryId]);

  const slices = useMemo(() => {
    let cursor = 0;

    return entries.map((entry, index) => {
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
        path: describeSlice(
          WHEEL_CENTER,
          WHEEL_CENTER,
          WHEEL_SLICE_RADIUS,
          startAngle,
          endAngle,
        ),
      };
    });
  }, [entries, total, weights]);

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

      setTransitionIfChanged(phase === "ENTRY_OPEN" ? 700 : 400);

      setRotation((currentRotation) =>
        currentRotation === 0 ? currentRotation : 0,
      );

      return;
    }

    if (phase === "RANDOMIZING") {
      resultSettledForKeyRef.current = null;
      setTransitionIfChanged(500);
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
          const extraTurns = prefersReducedMotion ? 0 : 5;
          const nextRotation =
            currentRotation + extraTurns * 360 + distanceToFinal;

          devLog("spinning animation started", {
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
        setTransitionIfChanged(500);

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

  const isSuspensePhase = phase === "RANDOMIZING" || phase === "SPINNING";
  const shouldPulse = !prefersReducedMotion && phase === "SPINNING";
  const showWinnerName = phase === "RESULT" && resultReason !== "SKIPPED_EMPTY";

  return (
    <section className="arcadia-surface relative overflow-hidden rounded-lg p-3 md:p-5">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[rgba(250,204,21,0.7)] to-transparent" />

      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-[var(--gold)]">
            Prize Wheel
          </p>
        </div>

        <div
          className={`rounded-full border px-3 py-1 text-xs font-black uppercase tracking-[0.16em] ${statusCopy.badge}`}
        >
          {phase === "WAITING" ? "PREPARING" : statusCopy.label}
        </div>
      </div>

      <div className="relative flex min-h-[390px] items-center justify-center md:min-h-[520px]">
        <WheelPointer />

        {statusCopy.overlay ? (
          <div className="pointer-events-none absolute top-3 z-20 rounded-full border border-[rgba(255,255,255,0.16)] bg-black/50 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-text-primary backdrop-blur">
            {statusCopy.overlay}
          </div>
        ) : null}

        <svg
          viewBox="0 0 300 300"
          role="img"
          aria-label={
            hasEntries
              ? `Prize wheel with ${entries.length} entries and pool ${formatCoins(
                  totalEntryAmount,
                )} coins`
              : "Prize wheel waiting for entries"
          }
          className="relative z-10 drop-shadow-2xl"
          style={{
            width: "clamp(320px, 80vw, 480px)",
            height: "clamp(320px, 80vw, 480px)",
          }}
        >
          <defs>
            <radialGradient id="wheelHubGlow" cx="50%" cy="50%" r="60%">
              <stop offset="0%" stopColor="rgba(250,204,21,0.22)" />
              <stop offset="55%" stopColor="rgba(17,24,39,0.95)" />
              <stop offset="100%" stopColor="rgba(8,12,20,1)" />
            </radialGradient>

            <filter id="wheelSoftGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <circle
            cx="150"
            cy="150"
            r="146"
            fill="rgba(250,204,21,0.1)"
            filter="url(#wheelSoftGlow)"
          />

          <circle
            cx="150"
            cy="150"
            r="144"
            fill="#080C14"
            stroke="#F6C547"
            strokeWidth="5"
          />

          {phase === "ENTRY_OPEN" ? (
            <circle
              cx="150"
              cy="150"
              r="144"
              fill="none"
              stroke="#4ADE80"
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={COUNTDOWN_CIRCUMFERENCE}
              strokeDashoffset={COUNTDOWN_CIRCUMFERENCE * (1 - countdownRatio)}
              transform="rotate(-90 150 150)"
            />
          ) : null}

          <circle
            cx="150"
            cy="150"
            r="136"
            fill="#0D1525"
            stroke="rgba(255,255,255,0.16)"
            strokeWidth="2"
          />

          <g
            style={{
              transform: `rotate(${rotation}deg)`,
              transformOrigin: "150px 150px",
              transition: prefersReducedMotion
                ? "none"
                : `transform ${transitionMs}ms cubic-bezier(0.15, 0, 0.1, 1)`,
            }}
          >
            {!hasEntries ? (
              <circle
                cx="150"
                cy="150"
                r="112"
                fill="#172035"
                stroke="rgba(250,204,21,0.24)"
                strokeWidth="3"
              />
            ) : entries.length === 1 ? (
              <circle
                cx="150"
                cy="150"
                r="132"
                fill={getWheelSliceColor(0)}
                opacity={entries[0]?.pending ? 0.72 : 1}
                stroke={
                  entries[0]?.id === winnerEntryId && phase === "RESULT"
                    ? "#FFFFFF"
                    : "#080C14"
                }
                strokeWidth={
                  entries[0]?.id === winnerEntryId && phase === "RESULT"
                    ? "7"
                    : "3"
                }
              />
            ) : (
              slices.map(({ entry, index, path }) => {
                const isWinner =
                  phase === "RESULT" && winnerEntryId === entry.id;

                return (
                  <path
                    key={entry.id}
                    d={path}
                    fill={getWheelSliceColor(index)}
                    opacity={entry.pending ? 0.72 : 1}
                    stroke={isWinner ? "#FFFFFF" : "#080C14"}
                    strokeWidth={isWinner ? "7" : "3"}
                  />
                );
              })
            )}
          </g>

          {!hasEntries ? (
            <>
              <text
                x="150"
                y="138"
                textAnchor="middle"
                className="fill-text-primary text-xs font-black"
              >
                Waiting
              </text>
              <text
                x="150"
                y="158"
                textAnchor="middle"
                className="fill-text-dim text-[10px]"
              >
                Pool is empty
              </text>
            </>
          ) : null}

          <circle
            cx="150"
            cy="150"
            r="61"
            fill="rgba(250,204,21,0.16)"
            stroke="rgba(250,204,21,0.44)"
            strokeWidth="2"
          />

          <circle
            cx="150"
            cy="150"
            r="58"
            fill="url(#wheelHubGlow)"
            stroke="rgba(250,204,21,0.9)"
            strokeWidth="5"
          />

          <circle
            cx="150"
            cy="150"
            r="45"
            fill="#111827"
            stroke="rgba(255,255,255,0.12)"
            strokeWidth="2"
          />

          <text
            x="150"
            y="132"
            textAnchor="middle"
            className="fill-[var(--gold)] text-[10px] font-black uppercase tracking-widest"
          >
            POOL
          </text>
          <text
            x="150"
            y="154"
            textAnchor="middle"
            className="fill-text-primary text-lg font-black"
          >
            {formatCoins(totalEntryAmount)}
          </text>
          <text
            x="150"
            y="174"
            textAnchor="middle"
            className="fill-text-secondary text-[10px]"
          >
            {entries.length} {entries.length === 1 ? "entry" : "entries"}
          </text>
        </svg>

        {shouldPulse ? (
          <>
            <div className="pointer-events-none absolute h-[86%] w-[86%] animate-pulse rounded-full border border-[rgba(250,204,21,0.18)]" />
            <div className="pointer-events-none absolute h-[72%] w-[72%] animate-pulse rounded-full border border-[rgba(232,121,249,0.12)]" />
          </>
        ) : null}

        {isSuspensePhase ? (
          <div className="pointer-events-none absolute bottom-3 z-20 rounded-full bg-black/45 px-4 py-2 text-center text-xs font-semibold text-text-secondary backdrop-blur">
            {phase === "SPINNING"
              ? "Server result locked · wheel reveal running"
              : "Randomizing round"}
          </div>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-sm text-text-secondary">
        <span>{statusCopy.helper}</span>

        {showWinnerName ? (
          <span className="font-mono font-black text-[var(--gold)]">
            {winner?.player?.username ??
              winner?.player?.fullName ??
              "Revealing"}
          </span>
        ) : null}
      </div>
    </section>
  );
}