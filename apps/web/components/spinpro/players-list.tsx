"use client";

import { useMemo } from "react";
import type { EntryWithPlayerSnapshot } from "@kingspin/contracts";
import { formatCoins } from "../../lib/format";
import { getEntrySliceColor } from "./spinning-wheel";

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

function playerName(entry: EntryWithPlayerSnapshot, index: number) {
  return (
    entry.player?.username ??
    entry.player?.fullName ??
    entry.userId?.slice(0, 6) ??
    `Player ${index + 1}`
  );
}

function shortChance(value: number) {
  if (value >= 10) return value.toFixed(1);
  if (value > 0) return value.toFixed(2);
  return "0";
}

export function PlayersList({
  entries,
  totalEntryAmount,
  winnerEntryId,
}: PlayersListProps) {
  // Keep player display order stable: created time first, then id.
  const sortedEntries = useMemo(() => {
    return [...entries].sort((left, right) => {
      const leftTime = new Date(left.createdAt).getTime();
      const rightTime = new Date(right.createdAt).getTime();

      if (leftTime !== rightTime) {
        return leftTime - rightTime;
      }

      return left.id.localeCompare(right.id);
    });
  }, [entries]);

  if (sortedEntries.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/20 p-5 text-center shadow-inner backdrop-blur-md">
        <p className="text-base font-black text-white">No players yet</p>
        <p className="mt-1 text-sm font-semibold text-slate-300">
          Be the first one to join this round.
        </p>
      </div>
    );
  }

  return (
    <div className="max-h-[220px] space-y-1.5 overflow-y-auto pr-1">
      {sortedEntries.map((entry, index) => {
        const isWinner = winnerEntryId === entry.id;
        const isPending = Boolean(entry.pending);
        const chance = getEntryChance(entry.amount, totalEntryAmount);
        const displayName = playerName(entry, index);

        // Winner/current-user highlight section: this component only receives winnerEntryId.
        return (
          <div
            key={entry.id}
            className={`group relative grid grid-cols-[1fr_auto_auto] items-center gap-2 overflow-hidden rounded-2xl border px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] backdrop-blur-md transition ${
              isWinner
                ? "border-amber-300/45 bg-amber-400/[0.105] shadow-[0_0_24px_rgba(250,204,21,0.12)]"
                : isPending
                  ? "border-cyan-300/30 bg-cyan-400/[0.075]"
                  : "border-white/[0.065] bg-black/[0.18] hover:border-white/15 hover:bg-white/[0.055]"
            }`}
          >
            {/* Player row */}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-white/[0.035] via-transparent to-black/10 opacity-80" />

            {/* Avatar/name section */}
            <div className="relative flex min-w-0 items-center gap-2">
              <span
                className={`h-3 w-3 shrink-0 rounded-full ring-2 ring-black/30 shadow-[0_0_12px_rgba(255,255,255,0.12)] ${
                  isPending ? "animate-pulse" : ""
                }`}
                style={{ backgroundColor: getEntrySliceColor(entry, index) }}
                aria-hidden="true"
              />

              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-1.5">
                  <p className="truncate text-xs font-black text-white drop-shadow-[0_1px_6px_rgba(0,0,0,0.65)]">
                    {isWinner ? "👑 " : ""}
                    {displayName}
                  </p>

                  {isPending ? (
                    <span className="shrink-0 rounded-full border border-cyan-200/20 bg-cyan-400/15 px-1.5 py-0.5 text-[9px] font-black uppercase text-cyan-100">
                      Pending
                    </span>
                  ) : null}

                  {isWinner ? (
                    <span className="shrink-0 rounded-full border border-amber-100/40 bg-amber-300/90 px-1.5 py-0.5 text-[9px] font-black uppercase text-amber-950">
                      Winner
                    </span>
                  ) : null}
                </div>

                <p className="mt-0.5 font-mono text-[10px] font-bold text-slate-400">
                  #{index + 1}
                </p>
              </div>
            </div>

            {/* Amount section */}
            <div className="relative shrink-0 text-right">
              <p className="font-mono text-xs font-black text-amber-300 drop-shadow-[0_1px_6px_rgba(0,0,0,0.7)]">
                🪙 {formatCoins(entry.amount)}
              </p>
            </div>

            {/* Chance badge section */}
            <div
              className={`relative shrink-0 rounded-full border px-2 py-1 text-[10px] font-black shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] ${
                isWinner
                  ? "border-amber-100/35 bg-amber-300/90 text-amber-950"
                  : "border-emerald-100/25 bg-emerald-400/85 text-emerald-950"
              }`}
            >
              {shortChance(chance)}%
            </div>
          </div>
        );
      })}
    </div>
  );
}
