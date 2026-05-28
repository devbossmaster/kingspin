"use client";

import type { EntryWithPlayerSnapshot } from "@kingspin/contracts";
import { useEffect, useMemo, useState } from "react";
import { formatCoins } from "../../lib/format";
import { WheelPointer } from "./wheel-pointer";

type SpinningWheelProps = {
  entries: EntryWithPlayerSnapshot[];
  totalEntryAmount: string;
  spinAngle: number | null | undefined;
  status: string | null | undefined;
  winnerEntryId?: string | null;
};

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

export function getWheelSliceColor(index: number) {
  return WHEEL_SLICE_COLORS[index % WHEEL_SLICE_COLORS.length] ?? "#F6C547";
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

function getWheelStatusCopy(status: string | null | undefined) {
  if (status === "OPEN") {
    return {
      label: "Accepting entries",
      helper: "Every entry changes the wheel in real time.",
      badge:
        "border-[rgba(74,222,128,0.32)] bg-[rgba(74,222,128,0.1)] text-green-go",
    };
  }

  if (status === "LOCKED") {
    return {
      label: "Entries locked",
      helper: "Final ticket ranges are being prepared.",
      badge:
        "border-[rgba(250,204,21,0.32)] bg-[rgba(250,204,21,0.1)] text-[var(--gold)]",
    };
  }

  if (status === "DRAWING") {
    return {
      label: "Drawing winner",
      helper: "The winning ticket is being resolved.",
      badge:
        "border-[rgba(96,165,250,0.32)] bg-[rgba(96,165,250,0.1)] text-blue-300",
    };
  }

  if (status === "SPINNING") {
    return {
      label: "Wheel spinning",
      helper: "Live reveal in progress.",
      badge:
        "border-[rgba(232,121,249,0.32)] bg-[rgba(232,121,249,0.1)] text-magenta",
    };
  }

  if (status === "SETTLING") {
    return {
      label: "Settling payout",
      helper: "Winner and payout are being finalized.",
      badge:
        "border-[rgba(251,146,60,0.32)] bg-[rgba(251,146,60,0.1)] text-orange-300",
    };
  }

  if (status === "COMPLETED") {
    return {
      label: "Round complete",
      helper: "Winner selected and payout settled.",
      badge:
        "border-[rgba(250,204,21,0.32)] bg-[rgba(250,204,21,0.1)] text-[var(--gold)]",
    };
  }

  return {
    label: "Waiting",
    helper: "The next round is preparing.",
    badge:
      "border-[rgba(148,163,184,0.28)] bg-[rgba(148,163,184,0.1)] text-text-secondary",
  };
}

export function SpinningWheel({
  entries,
  totalEntryAmount,
  spinAngle,
  status,
  winnerEntryId,
}: SpinningWheelProps) {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  const weights = useMemo(() => entries.map(entryWeight), [entries]);

  const total = useMemo(() => {
    return weights.reduce((sum, weight) => sum + weight, 0) || Number(totalEntryAmount);
  }, [totalEntryAmount, weights]);

  const hasEntries = entries.length > 0 && total > 0;
  const statusCopy = getWheelStatusCopy(status);

  const winner = useMemo(() => {
    return entries.find((entry) => entry.id === winnerEntryId) ?? null;
  }, [entries, winnerEntryId]);

  const slices = useMemo(() => {
    let cursor = 0;

    return entries.map((entry, index) => {
      const sliceDegrees = ((weights[index] ?? 0) / total) * 360;
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

  const spinTarget =
    typeof spinAngle === "number" && Number.isFinite(spinAngle)
      ? 1440 + (360 - spinAngle)
      : 0;

  const shouldSpin =
    status === "SPINNING" ||
    status === "SETTLING" ||
    status === "COMPLETED";

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");

    setPrefersReducedMotion(media.matches);

    const onChange = () => setPrefersReducedMotion(media.matches);
    media.addEventListener("change", onChange);

    return () => media.removeEventListener("change", onChange);
  }, []);

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
          {status ?? "NO ROUND"}
        </div>
      </div>

      <div className="relative flex min-h-[320px] items-center justify-center md:min-h-[390px]">
        <WheelPointer />

        <svg
          viewBox="0 0 300 300"
          role="img"
          aria-label={
            hasEntries
              ? `Spinning wheel with ${entries.length} entries and pool ${formatCoins(totalEntryAmount)} coins`
              : "Spinning wheel waiting for entries"
          }
          className="relative z-10 drop-shadow-2xl"
          style={{
            width: "clamp(280px, 42vw, 390px)",
            height: "clamp(280px, 42vw, 390px)",
            transform: `rotate(${spinTarget}deg)`,
            transition: prefersReducedMotion
              ? "none"
              : shouldSpin
                ? "transform 5500ms cubic-bezier(0.05, 0.8, 0.15, 1)"
                : "transform 500ms ease",
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
              stroke={entries[0]?.id === winnerEntryId ? "#FFFFFF" : "#080C14"}
              strokeWidth={entries[0]?.id === winnerEntryId ? "7" : "3"}
            />
          ) : (
            slices.map(({ entry, index, path }) => {
              const isWinner =
                status === "COMPLETED" && winnerEntryId === entry.id;

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

        {shouldSpin && !prefersReducedMotion ? (
          <div className="pointer-events-none absolute h-[86%] w-[86%] rounded-full border border-[rgba(250,204,21,0.18)] animate-pulse" />
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
            {winner?.player?.username ?? winner?.player?.fullName ?? "Pending"}
          </p>
        </div>
      </div>
    </section>
  );
}
