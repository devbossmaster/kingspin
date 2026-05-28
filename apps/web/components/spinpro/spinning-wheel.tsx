"use client";

import type { EntryWithPlayerSnapshot } from "@kingspin/contracts";
import { useEffect, useState } from "react";
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

export function SpinningWheel({
  entries,
  totalEntryAmount,
  spinAngle,
  status,
  winnerEntryId,
}: SpinningWheelProps) {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const weights = entries.map(entryWeight);
  const total =
    weights.reduce((sum, weight) => sum + weight, 0) || Number(totalEntryAmount);
  const hasEntries = entries.length > 0 && total > 0;
  const spinTarget =
    typeof spinAngle === "number" && Number.isFinite(spinAngle)
      ? 1440 + (360 - spinAngle)
      : 0;
  const shouldSpin =
    status === "SPINNING" ||
    status === "SETTLING" ||
    status === "COMPLETED";

  let cursor = 0;

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");

    setPrefersReducedMotion(media.matches);

    const onChange = () => setPrefersReducedMotion(media.matches);
    media.addEventListener("change", onChange);

    return () => media.removeEventListener("change", onChange);
  }, []);

  return (
    <div className="relative flex min-h-[320px] items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4 md:min-h-[380px] md:p-6">
      <WheelPointer />

      <svg
        viewBox="0 0 300 300"
        role="img"
        aria-label={
          hasEntries
            ? `Spinning wheel with ${entries.length} entries and pool ${formatCoins(totalEntryAmount)} coins`
            : "Spinning wheel waiting for entries"
        }
        className="drop-shadow-2xl"
        style={{
          width: "clamp(280px, 40vw, 380px)",
          height: "clamp(280px, 40vw, 380px)",
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
          r="142"
          fill="#0D1525"
          stroke="#F6C547"
          strokeWidth="8"
        />

        {!hasEntries ? (
          <>
            <circle cx="150" cy="150" r="105" fill="#172035" />
            <text
              x="150"
              y="145"
              textAnchor="middle"
              className="fill-text-secondary text-sm"
            >
              Waiting for entries
            </text>
            <text
              x="150"
              y="168"
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
          entries.map((entry, index) => {
            const sliceDegrees = ((weights[index] ?? 0) / total) * 360;
            const startAngle = cursor;
            const endAngle = cursor + sliceDegrees;
            const isWinner =
              status === "COMPLETED" && winnerEntryId === entry.id;

            cursor = endAngle;

            return (
              <path
                key={entry.id}
                d={describeSlice(150, 150, 132, startAngle, endAngle)}
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
          r="48"
          fill="#080C14"
          stroke="#F6C547"
          strokeWidth="5"
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

      <div className="absolute bottom-4 text-center font-mono text-xs text-text-secondary">
        {hasEntries
          ? `Pool ${formatCoins(totalEntryAmount)} coins`
          : "Pool is empty"}
      </div>
    </div>
  );
}
