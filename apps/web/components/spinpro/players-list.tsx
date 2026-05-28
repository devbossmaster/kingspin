import type { EntryWithPlayerSnapshot } from "@kingspin/contracts";
import { formatCoins, ticketRangeLabel } from "../../lib/format";
import { getWheelSliceColor } from "./spinning-wheel";

type PlayersListProps = {
  entries: EntryWithPlayerSnapshot[];
  totalEntryAmount: string;
  winnerEntryId?: string | null;
};

export function PlayersList({
  entries,
  totalEntryAmount,
  winnerEntryId,
}: PlayersListProps) {
  return (
    <section className="arcadia-surface rounded-lg p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-black">Players</h2>
        <p className="font-mono text-sm text-text-secondary">
          {entries.length} total
        </p>
      </div>

      <div className="mt-3 max-h-[420px] space-y-2 overflow-y-auto pr-1">
        {entries.length === 0 ? (
          <p className="text-sm text-text-secondary">No entries yet.</p>
        ) : (
          entries.map((entry, index) => {
            const isWinner = winnerEntryId === entry.id;

            return (
              <div
                key={entry.id}
                className={`rounded-md border p-3 ${
                  isWinner
                    ? "border-[var(--gold)] bg-[rgba(246,197,71,0.12)]"
                    : "border-[var(--border)] bg-white/[0.04]"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: getWheelSliceColor(index) }}
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <p className="truncate font-semibold">
                        {entry.player?.username ?? `Player ${index + 1}`}
                      </p>
                      <p className="font-mono text-xs text-text-secondary">
                        Tickets {ticketRangeLabel(entry.ticketStart, entry.ticketEnd)}
                      </p>
                    </div>
                  </div>
                  <p className="font-mono font-black">{formatCoins(entry.amount)}</p>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="mt-3 flex items-center justify-between rounded-md border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2 text-sm">
        <span className="font-bold text-text-secondary">Total</span>
        <span className="font-mono font-black">
          {formatCoins(totalEntryAmount)} coins
        </span>
      </div>
    </section>
  );
}
