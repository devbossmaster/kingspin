"use client";

import type { EntryWithPlayerSnapshot } from "@kingspin/contracts";

type SpinningWheelProps = {
  entries: EntryWithPlayerSnapshot[];
  totalEntryAmount: string;
  spinAngle: number | null | undefined;
  status: string | null | undefined;
};

const SLICE_COLORS = [
  "#facc15",
  "#22c55e",
  "#38bdf8",
  "#fb7185",
  "#a78bfa",
  "#f97316",
  "#14b8a6",
  "#e879f9",
  "#84cc16",
  "#60a5fa",
];

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

export function SpinningWheel({
  entries,
  totalEntryAmount,
  spinAngle,
  status,
}: SpinningWheelProps) {
  const total = Number(totalEntryAmount);

  const hasEntries = entries.length > 0 && total > 0;

  let cursor = 0;

  const rotation =
    typeof spinAngle === "number" && Number.isFinite(spinAngle)
      ? 1440 - spinAngle
      : 0;

  return (
    <div className="relative flex min-h-[320px] items-center justify-center rounded-3xl border border-white/10 bg-slate-900 p-6">
      <div className="absolute top-4 rounded-full bg-yellow-400 px-3 py-1 text-xs font-black text-slate-950 shadow-lg">
        ▼ POINTER
      </div>

      <svg
        viewBox="0 0 300 300"
        className="h-72 w-72 drop-shadow-2xl"
        style={{
          transform: `rotate(${rotation}deg)`,
          transition:
            status === "DRAWING" || status === "SETTLING" || status === "COMPLETED"
              ? "transform 5s cubic-bezier(0.12, 0.72, 0.12, 1)"
              : "transform 500ms ease",
        }}
      >
        <circle
          cx="150"
          cy="150"
          r="142"
          fill="#0f172a"
          stroke="#facc15"
          strokeWidth="8"
        />

        {!hasEntries ? (
          <>
            <circle cx="150" cy="150" r="105" fill="#1e293b" />
            <text
              x="150"
              y="145"
              textAnchor="middle"
              className="fill-slate-300 text-sm"
            >
              Waiting for entries
            </text>
            <text
              x="150"
              y="168"
              textAnchor="middle"
              className="fill-slate-500 text-xs"
            >
              Pool is empty
            </text>
          </>
        ) : entries.length === 1 ? (
          <circle
            cx="150"
            cy="150"
            r="132"
            fill={SLICE_COLORS[0]}
            stroke="#020617"
            strokeWidth="3"
          />
        ) : (
          entries.map((entry, index) => {
            const amount = Number(entry.amount);
            const sliceDegrees = (amount / total) * 360;
            const startAngle = cursor;
            const endAngle = cursor + sliceDegrees;

            cursor = endAngle;

            return (
              <path
                key={entry.id}
                d={describeSlice(150, 150, 132, startAngle, endAngle)}
                fill={SLICE_COLORS[index % SLICE_COLORS.length]}
                stroke="#020617"
                strokeWidth="3"
              />
            );
          })
        )}

        <circle cx="150" cy="150" r="48" fill="#020617" stroke="#facc15" strokeWidth="5" />

        <text
          x="150"
          y="143"
          textAnchor="middle"
          className="fill-white text-lg font-black"
        >
          {hasEntries ? entries.length : "0"}
        </text>
        <text
          x="150"
          y="165"
          textAnchor="middle"
          className="fill-slate-400 text-xs"
        >
          players
        </text>
      </svg>

      <div className="absolute bottom-4 text-center text-xs text-slate-400">
        {hasEntries
          ? `Pool ${Number(totalEntryAmount).toLocaleString()} coins`
          : "Enter before the timer ends"}
      </div>
    </div>
  );
}
