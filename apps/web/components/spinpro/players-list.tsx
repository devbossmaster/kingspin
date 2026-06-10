"use client";

import { useMemo } from "react";
import type { EntryWithPlayerSnapshot } from "@kingspin/contracts";
import { formatCoins } from "../../lib/format";
import {
  getEntryDisplayColor,
  getPlayerDisplayName,
  sortDisplayEntries,
} from "./player-display";

type PlayersListProps = {
  entries: (EntryWithPlayerSnapshot & { pending?: boolean })[];
  totalEntryAmount: string;
  winnerEntryId?: string | null;
};

function getEntryChance(entryAmount: string, totalEntryAmount: string) {
  const amount = Number(entryAmount);
  const total = Number(totalEntryAmount);

  if (!Number.isFinite(amount) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, (amount / total) * 100));
}

function shortChance(value: number) {
  if (value >= 10) return value.toFixed(1);
  if (value > 0) return value.toFixed(2);
  return "0";
}

function getChanceTone(index: number, isWinner: boolean) {
  if (isWinner) {
    return "border-yellow-200/70 bg-yellow-300 text-slate-950";
  }

  const tones = [
    "border-cyan-200/40 bg-cyan-400/85 text-slate-950",
    "border-emerald-200/40 bg-emerald-400/85 text-slate-950",
    "border-fuchsia-200/40 bg-fuchsia-400/85 text-white",
    "border-blue-200/40 bg-blue-500/85 text-white",
    "border-orange-200/40 bg-orange-500/85 text-white",
    "border-violet-200/40 bg-violet-500/85 text-white",
  ];

  return tones[index % tones.length] ?? tones[0];
}

export function PlayersList({
  entries,
  totalEntryAmount,
  winnerEntryId,
}: PlayersListProps) {
  const sortedEntries = useMemo(() => {
    return sortDisplayEntries(entries);
  }, [entries]);

  const totalChance = useMemo(() => {
    return sortedEntries.reduce(
      (sum, entry) => sum + getEntryChance(entry.amount, totalEntryAmount),
      0,
    );
  }, [sortedEntries, totalEntryAmount]);

  const myEntry = sortedEntries.find((entry) => Boolean(entry.pending));
  const firstEntry = sortedEntries[0] ?? null;
  const footerEntry = myEntry ?? firstEntry;
  const footerChance = footerEntry
    ? getEntryChance(footerEntry.amount, totalEntryAmount)
    : 0;

  if (sortedEntries.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/20 p-5 text-center backdrop-blur-md">
        <p className="text-base font-black text-white">No players yet</p>
        <p className="mt-1 text-sm font-semibold text-slate-300">
          Be the first one to join.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[26px] border border-white/10 bg-slate-950/70 shadow-[0_18px_45px_rgba(0,0,0,0.45)] backdrop-blur-md">
      <style>{`
        .player-row-in {
          animation: playerRowIn 220ms ease-out both;
        }

        .winner-row-card {
          animation: winnerRowCard 700ms cubic-bezier(0.16, 1.2, 0.26, 1) both;
        }

        .winner-row-card::before {
          content: "";
          position: absolute;
          inset: -1px;
          border-radius: 1rem;
          pointer-events: none;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(250, 204, 21, 0.28),
            transparent
          );
          opacity: 0;
          animation: winnerRowShine 1.1s ease-out 1;
        }

        .winner-dot-pulse {
          animation: winnerDotPulse 900ms ease-in-out infinite;
        }

        @keyframes playerRowIn {
          from {
            opacity: 0;
            transform: translate3d(0, 6px, 0) scale(0.99);
          }
          to {
            opacity: 1;
            transform: translate3d(0, 0, 0) scale(1);
          }
        }

        @keyframes winnerRowCard {
          0% {
            opacity: 0.84;
            transform: translate3d(0, 8px, 0) scale(0.96);
            box-shadow: 0 0 0 rgba(250, 204, 21, 0);
          }
          45% {
            opacity: 1;
            transform: translate3d(0, -2px, 0) scale(1.025);
            box-shadow: 0 0 34px rgba(250, 204, 21, 0.24);
          }
          100% {
            opacity: 1;
            transform: translate3d(0, 0, 0) scale(1);
            box-shadow: 0 0 20px rgba(250, 204, 21, 0.15);
          }
        }

        @keyframes winnerRowShine {
          0% {
            opacity: 0;
            transform: translateX(-80%);
          }
          22% {
            opacity: 1;
          }
          100% {
            opacity: 0;
            transform: translateX(80%);
          }
        }

        @keyframes winnerDotPulse {
          0%,
          100% {
            transform: scale(1);
            box-shadow: 0 0 0 rgba(250, 204, 21, 0);
          }
          50% {
            transform: scale(1.18);
            box-shadow: 0 0 18px rgba(250, 204, 21, 0.42);
          }
        }
      `}</style>

      <div className="flex items-center justify-between gap-3 border-b border-white/8 px-3 py-2.5">
        <p className="text-sm font-black text-white">
          {sortedEntries.length} / 30 Players
        </p>

        <p className="font-mono text-xs font-black text-slate-400">
          {shortChance(totalChance)}%
        </p>
      </div>

      <div className="max-h-[245px] space-y-1 overflow-y-auto px-2 py-2">
        {sortedEntries.map((entry, index) => {
          const isWinner = winnerEntryId === entry.id;
          const isPending = Boolean(entry.pending);
          const chance = getEntryChance(entry.amount, totalEntryAmount);
          const displayName = getPlayerDisplayName(entry, index);
          const color = getEntryDisplayColor(entry, index);

          return (
            <div
              key={entry.id}
              className={`player-row-in relative grid grid-cols-[1fr_auto_auto] items-center gap-2 overflow-hidden rounded-2xl border px-2.5 py-2 backdrop-blur-md transition ${
                isWinner
                  ? "winner-row-card border-yellow-300/70 bg-gradient-to-r from-yellow-300/[0.20] via-yellow-300/[0.10] to-black/[0.2]"
                  : isPending
                    ? "border-cyan-300/35 bg-cyan-300/[0.08]"
                    : "border-white/[0.06] bg-black/[0.16]"
              }`}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/10 text-[10px] font-black text-white ring-2 ring-black/30 ${
                    isWinner
                      ? "winner-dot-pulse ring-yellow-200/50"
                      : isPending
                        ? "animate-pulse"
                        : ""
                  }`}
                  style={{ backgroundColor: color }}
                  aria-hidden="true"
                >
                  {isWinner ? "♛" : index + 1}
                </span>

                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <p className="truncate text-[13px] font-black leading-none text-white">
                      {displayName}
                    </p>

                    {isWinner ? (
                      <span className="shrink-0 rounded-full bg-yellow-300 px-1.5 py-0.5 text-[8px] font-black uppercase text-slate-950 shadow-[0_0_14px_rgba(250,204,21,0.28)]">
                        Winner
                      </span>
                    ) : null}

                    {isPending ? (
                      <span className="shrink-0 rounded-full border border-cyan-200/25 bg-cyan-300/15 px-1.5 py-0.5 text-[8px] font-black uppercase text-cyan-100">
                        Joining
                      </span>
                    ) : null}
                  </div>

                  <p
                    className={`mt-1 font-mono text-[10px] font-bold ${
                      isWinner ? "text-yellow-100/80" : "text-slate-500"
                    }`}
                  >
                    #{index + 1} · {formatCoins(entry.amount)}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 font-mono text-[11px] font-black text-yellow-300">
                <span className="text-[10px]">🪙</span>
                {formatCoins(entry.amount)}
              </div>

              <div
                className={`shrink-0 rounded-full border px-2.5 py-1 text-center font-mono text-[10px] font-black ${getChanceTone(
                  index,
                  isWinner,
                )}`}
              >
                {shortChance(chance)}%
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 border-t border-white/8 bg-black/30">
        <div className="px-4 py-3 text-center">
          <p className="font-mono text-lg font-black text-white">
            {footerEntry ? formatCoins(footerEntry.amount) : "0"}
          </p>
          <p className="mt-0.5 text-[10px] font-black text-slate-500">
            Your entry
          </p>
        </div>

        <div className="border-l border-white/8 px-4 py-3 text-center">
          <p className="font-mono text-lg font-black text-white">
            {shortChance(footerChance)}%
          </p>
          <p className="mt-0.5 text-[10px] font-black text-slate-500">
            Your chance
          </p>
        </div>
      </div>
    </div>
  );
}