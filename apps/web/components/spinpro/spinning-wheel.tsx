"use client";

import type { EntryWithPlayerSnapshot } from "@kingspin/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatCoins } from "../../lib/format";
import { WheelPointer } from "./wheel-pointer";

type SpinningWheelProps = {
  entries: EntryWithPlayerSnapshot[];
  totalEntryAmount: string;
  spinAngle: number | null | undefined;
  status: string | null | undefined;
  winnerEntryId?: string | null;
};

type WheelPhase =
  | "OPEN"
  | "LOCKED"
  | "DRAWING"
  | "SPINNING"
  | "SETTLING"
  | "COMPLETED"
  | "CANCELLED"
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

const SPIN_DURATION_MS = 7000;

export function getWheelSliceColor(index: number) {
  return WHEEL_SLICE_COLORS[index % WHEEL_SLICE_COLORS.length] ?? "#F6C547";
}

function normalizePhase(status: string | null | undefined): WheelPhase {
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
    case "OPEN":
      return {
        label: "Entries open",
        helper: "Players can enter while the countdown is running.",
        badge:
          "border-[rgba(74,222,128,0.32)] bg-[rgba(74,222,128,0.1)] text-green-go",
        overlay: null,
      };

    case "LOCKED":
      return {
        label: "Entries locked",
        helper: "Final ticket ranges are being assigned.",
        badge:
          "border-[rgba(250,204,21,0.32)] bg-[rgba(250,204,21,0.1)] text-[var(--gold)]",
        overlay: "Assigning tickets",
      };

    case "DRAWING":
      return {
        label: "Selecting winner",
        helper: "The server is resolving the winning ticket securely.",
        badge:
          "border-[rgba(96,165,250,0.32)] bg-[rgba(96,165,250,0.1)] text-blue-300",
        overlay: "Drawing winner",
      };

    case "SPINNING":
      return {
        label: "Wheel spinning",
        helper: "Live reveal in progress. The result is server-authoritative.",
        badge:
          "border-[rgba(232,121,249,0.32)] bg-[rgba(232,121,249,0.1)] text-magenta",
        overlay: "Revealing winner",
      };

    case "SETTLING":
      return {
        label: "Finalizing payout",
        helper: "The ledger payout is being settled safely.",
        badge:
          "border-[rgba(251,146,60,0.32)] bg-[rgba(251,146,60,0.1)] text-orange-300",
        overlay: "Settling payout",
      };

    case "COMPLETED":
      return {
        label: "Round complete",
        helper: "Winner selected and payout settled. Next round starts soon.",
        badge:
          "border-[rgba(250,204,21,0.32)] bg-[rgba(250,204,21,0.1)] text-[var(--gold)]",
        overlay: "Winner revealed",
      };

    case "CANCELLED":
      return {
        label: "Round skipped",
        helper: "This round was skipped or refunded. Next round is preparing.",
        badge:
          "border-[rgba(248,113,113,0.36)] bg-[rgba(248,113,113,0.1)] text-red-hot",
        overlay: "Skipped",
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

  return 360 - (spinAngle % 360);
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
  winnerEntryId,
}: SpinningWheelProps) {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [transitionMs, setTransitionMs] = useState(500);

  const previousPhaseRef = useRef<WheelPhase>("WAITING");
  const spinStartedForKeyRef = useRef<string | null>(null);

  const phase = normalizePhase(status);
  const statusCopy = getWheelStatusCopy(phase);

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
        path: describeSlice(150, 150, 132, startAngle, endAngle),
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

    if (phase === "OPEN" || phase === "WAITING" || phase === "CANCELLED") {
      spinStartedForKeyRef.current = null;
      setTransitionMs(phase === "OPEN" ? 700 : 400);
      setRotation(0);
      return;
    }

    if (phase === "LOCKED" || phase === "DRAWING") {
      setTransitionMs(500);
      return;
    }

    if (phase === "SPINNING" && finalAngle !== null) {
      if (spinStartedForKeyRef.current !== spinKey) {
        spinStartedForKeyRef.current = spinKey;

        const currentRotation = rotation;
        const currentNormalized = ((currentRotation % 360) + 360) % 360;
        const finalNormalized = ((finalAngle % 360) + 360) % 360;
        const distanceToFinal =
          (finalNormalized - currentNormalized + 360) % 360;
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

        setTransitionMs(prefersReducedMotion ? 0 : SPIN_DURATION_MS);
        setRotation(nextRotation);
      }

      return;
    }

    if (
      (phase === "SETTLING" || phase === "COMPLETED") &&
      finalAngle !== null
    ) {
      const currentTurns = Math.floor(rotation / 360);
      const minimumRotation = currentTurns * 360 + finalAngle;
      const finalRotation =
        minimumRotation < rotation ? minimumRotation + 360 : minimumRotation;

      setTransitionMs(phase === "COMPLETED" ? 500 : 900);
      setRotation(finalRotation);
    }
  }, [
    finalAngle,
    phase,
    prefersReducedMotion,
    rotation,
    spinAngle,
    spinKey,
    winnerEntryId,
  ]);

  const isSuspensePhase =
    phase === "LOCKED" || phase === "DRAWING" || phase === "SPINNING";

  const shouldPulse =
    !prefersReducedMotion &&
    (phase === "LOCKED" ||
      phase === "DRAWING" ||
      phase === "SPINNING" ||
      phase === "SETTLING");

  const showWinnerName =
    phase === "COMPLETED" || phase === "SETTLING" || phase === "SPINNING";

  return (
    <section className="arcadia-surface relative overflow-hidden rounded-lg p-4 md:p-6">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[rgba(250,204,21,0.7)] to-transparent" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[rgba(250,204,21,0.08)] blur-3xl" />

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-[var(--gold)]">
            Prize Wheel
          </p>
          <h2 className="mt-1 font-display text-xl font-black text-text-primary">
            {statusCopy.label}
          </h2>
          <p className="mt-1 text-sm text-text-secondary">
            {statusCopy.helper}
          </p>
        </div>

        <div
          className={`rounded-full border px-3 py-1 text-xs font-black uppercase tracking-[0.16em] ${statusCopy.badge}`}
        >
          {phase === "WAITING" ? "NO ROUND" : phase}
        </div>
      </div>

      <div className="relative flex min-h-[320px] items-center justify-center md:min-h-[390px]">
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
            width: "clamp(280px, 42vw, 390px)",
            height: "clamp(280px, 42vw, 390px)",
            transform: `rotate(${rotation}deg)`,
            transition: prefersReducedMotion
              ? "none"
              : `transform ${transitionMs}ms cubic-bezier(0.05, 0.8, 0.15, 1)`,
          }}
        >
          <circle
            cx="150"
            cy="150"
            r="144"
            fill="#080C14"
            stroke="#F6C547"
            strokeWidth="5"
          />

          <circle
            cx="150"
            cy="150"
            r="136"
            fill="#0D1525"
            stroke="rgba(255,255,255,0.16)"
            strokeWidth="2"
          />

          {!hasEntries ? (
            <>
              <circle
                cx="150"
                cy="150"
                r="112"
                fill="#172035"
                stroke="rgba(250,204,21,0.24)"
                strokeWidth="3"
              />
              <text
                x="150"
                y="142"
                textAnchor="middle"
                className="fill-text-primary text-sm font-black"
              >
                Waiting for entries
              </text>
              <text
                x="150"
                y="166"
                textAnchor="middle"
                className="fill-text-dim text-xs"
              >
                Pool is empty
              </text>
            </>
          ) : entries.length === 1 ? (
            <circle
              cx="150"
              cy="150"
              r="132"
              fill={getWheelSliceColor(0)}
              stroke={
                entries[0]?.id === winnerEntryId &&
                (phase === "COMPLETED" || phase === "SETTLING")
                  ? "#FFFFFF"
                  : "#080C14"
              }
              strokeWidth={
                entries[0]?.id === winnerEntryId &&
                (phase === "COMPLETED" || phase === "SETTLING")
                  ? "7"
                  : "3"
              }
            />
          ) : (
            slices.map(({ entry, index, path }) => {
              const isWinner =
                (phase === "COMPLETED" || phase === "SETTLING") &&
                winnerEntryId === entry.id;

              return (
                <path
                  key={entry.id}
                  d={path}
                  fill={getWheelSliceColor(index)}
                  stroke={isWinner ? "#FFFFFF" : "#080C14"}
                  strokeWidth={isWinner ? "7" : "3"}
                />
              );
            })
          )}

          <circle
            cx="150"
            cy="150"
            r="53"
            fill="#080C14"
            stroke="rgba(250,204,21,0.8)"
            strokeWidth="5"
          />

          <circle
            cx="150"
            cy="150"
            r="42"
            fill="#111827"
            stroke="rgba(255,255,255,0.12)"
            strokeWidth="2"
          />

          <text
            x="150"
            y="143"
            textAnchor="middle"
            className="fill-text-primary text-lg font-black"
          >
            {hasEntries ? entries.length : "0"}
          </text>
          <text
            x="150"
            y="165"
            textAnchor="middle"
            className="fill-text-secondary text-xs"
          >
            players
          </text>
        </svg>

        {shouldPulse ? (
          <>
            <div className="pointer-events-none absolute h-[86%] w-[86%] rounded-full border border-[rgba(250,204,21,0.18)] animate-pulse" />
            <div className="pointer-events-none absolute h-[72%] w-[72%] rounded-full border border-[rgba(232,121,249,0.12)] animate-pulse" />
          </>
        ) : null}

        {isSuspensePhase ? (
          <div className="pointer-events-none absolute bottom-3 z-20 rounded-full bg-black/45 px-4 py-2 text-center text-xs font-semibold text-text-secondary backdrop-blur">
            {phase === "SPINNING"
              ? "Server result locked · wheel reveal running"
              : phase === "DRAWING"
                ? "Provably fair draw in progress"
                : "Entries are closed for this round"}
          </div>
        ) : null}
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <div className="rounded-md border border-[var(--border)] bg-[rgba(255,255,255,0.03)] px-3 py-2">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-text-dim">
            Pool
          </p>
          <p className="mt-1 font-mono text-sm font-black text-[var(--gold)]">
            {formatCoins(totalEntryAmount)}
          </p>
        </div>

        <div className="rounded-md border border-[var(--border)] bg-[rgba(255,255,255,0.03)] px-3 py-2">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-text-dim">
            Entries
          </p>
          <p className="mt-1 font-mono text-sm font-black text-text-primary">
            {entries.length}
          </p>
        </div>

        <div className="rounded-md border border-[var(--border)] bg-[rgba(255,255,255,0.03)] px-3 py-2">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-text-dim">
            Winner
          </p>
          <p className="mt-1 truncate font-mono text-sm font-black text-text-primary">
            {showWinnerName
              ? (winner?.player?.username ?? winner?.player?.fullName ?? "Revealing")
              : "Pending"}
          </p>
        </div>
      </div>
    </section>
  );
}