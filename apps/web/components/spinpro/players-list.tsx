"use client";

import { useMemo } from "react";
import type { EntryWithPlayerSnapshot } from "@kingspin/contracts";
import { formatCoins, ticketRangeLabel } from "../../lib/format";
import { getWheelSliceColor } from "./spinning-wheel";

type PlayersListProps = {
  entries: EntryWithPlayerSnapshot[];
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
    `Player ${index + 1}`
  );
}

export function PlayersList({
  entries,
  totalEntryAmount,
  winnerEntryId,
}: PlayersListProps) {
  const sortedEntries = useMemo(() => {
    return [...entries].sort((left, right) => {
      const rightAmount = Number(right.amount);
      const leftAmount = Number(left.amount);

      if (rightAmount !== leftAmount) {
        return rightAmount - leftAmount;
      }

      return left.id.localeCompare(right.id);
    });
  }, [entries]);

  const topEntry = sortedEntries[0] ?? null;

  return (
    <section className="arcadia-surface relative overflow-hidden rounded-lg p-5">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[rgba(250,204,21,0.65)] to-transparent" />

      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-[var(--gold)]">
            Players
          </p>
          <h2 className="mt-1 font-display text-xl font-black text-text-primary">
            Live Entries
          </h2>
          <p className="mt-1 text-sm text-text-secondary">
            {entries.length} {entries.length === 1 ? "player" : "players"} in this round
          </p>
        </div>

        <div className="rounded-full border border-[rgba(250,204,21,0.28)] bg-[rgba(250,204,21,0.1)] px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-[var(--gold)]">
          Pool {formatCoins(totalEntryAmount)}
        </div>
      </div>

      {topEntry ? (
        <div className="mt-4 rounded-md border border-[rgba(250,204,21,0.22)] bg-[rgba(250,204,21,0.07)] px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-text-dim">
                Current Top Entry
              </p>
              <p className="mt-1 truncate text-sm font-black text-text-primary">
                {playerName(topEntry, 0)}
              </p>
            </div>
            <p className="font-mono text-sm font-black text-[var(--gold)]">
              {formatCoins(topEntry.amount)}
            </p>
          </div>
        </div>
      ) : null}

      <div className="mt-4 max-h-[430px] space-y-2 overflow-y-auto pr-1">
        {sortedEntries.length === 0 ? (
          <div className="rounded-md border border-dashed border-[var(--border)] bg-white/[0.03] p-5 text-center">
            <p className="font-display text-lg font-black text-text-primary">
              No entries yet
            </p>
            <p className="mt-1 text-sm text-text-secondary">
              Be the first player to enter this round.
            </p>
          </div>
        ) : (
          sortedEntries.map((entry, index) => {
            const isWinner = winnerEntryId === entry.id;
            const chance = getEntryChance(entry.amount, totalEntryAmount);
            const displayName = playerName(entry, index);

            return (
              <div
                key={entry.id}
                className={`group rounded-md border p-3 transition ${
                  isWinner
                    ? "border-[var(--gold)] bg-[rgba(250,204,21,0.13)] shadow-[0_0_24px_rgba(250,204,21,0.12)]"
                    : "border-[var(--border)] bg-white/[0.04] hover:border-[rgba(250,204,21,0.28)] hover:bg-white/[0.06]"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className="h-3.5 w-3.5 shrink-0 rounded-full ring-2 ring-black/20"
                      style={{ backgroundColor: getWheelSliceColor(index) }}
                      aria-hidden="true"
                    />

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-black text-text-primary">
                          {displayName}
                        </p>

                        {isWinner ? (
                          <span className="rounded-full border border-[rgba(250,204,21,0.35)] bg-[rgba(250,204,21,0.12)] px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.14em] text-[var(--gold)]">
                            Winner
                          </span>
                        ) : null}
                      </div>

                      <p className="mt-1 font-mono text-xs text-text-secondary">
                        Tickets {ticketRangeLabel(entry.ticketStart, entry.ticketEnd)}
                      </p>
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="font-mono text-sm font-black text-text-primary">
                      {formatCoins(entry.amount)}
                    </p>
                    <p className="mt-1 font-mono text-xs text-text-dim">
                      {chance.toFixed(chance >= 10 ? 1 : 2)}%
                    </p>
                  </div>
                </div>

                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--bg-raised)]">
                  <div
                    className="h-full rounded-full bg-[var(--gold)] transition-[width] duration-300"
                    style={{ width: `${chance}%` }}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-md border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-text-dim">
            Total Pool
          </p>
          <p className="mt-1 font-mono text-sm font-black text-[var(--gold)]">
            {formatCoins(totalEntryAmount)} coins
          </p>
        </div>

        <div className="rounded-md border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-text-dim">
            Players
          </p>
          <p className="mt-1 font-mono text-sm font-black text-text-primary">
            {entries.length}
          </p>
        </div>
      </div>
    </section>
  );
}
