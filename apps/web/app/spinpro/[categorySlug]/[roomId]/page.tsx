"use client";

import { useParams } from "next/navigation";
import { RoundPhaseBanner } from "../../../../components/spinpro/round-phase-banner";
import { RoundTimer } from "../../../../components/spinpro/round-timer";
import { SpinningWheel } from "../../../../components/spinpro/spinning-wheel";
import { WinnerReveal } from "../../../../components/spinpro/winner-reveal";
import { useRoom } from "../../../../hooks/use-room";
import { useRoomStore } from "../../../../stores/room-store";

function formatAmount(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "0";
  return Number(value).toLocaleString();
}

export default function LiveRoomPage() {
  const params = useParams<{ categorySlug: string; roomId: string }>();
  const roomId = params.roomId;

  const {
    state,
    latestResult,
    meWallet,
    error,
    isPlacingEntry,
    placeEntry,
    refresh,
    refreshWallet,
  } = useRoom(roomId);

  const selectedChip = useRoomStore((store) => store.selectedChip);
  const setSelectedChip = useRoomStore((store) => store.setSelectedChip);
  const connectionStatus = useRoomStore((store) => store.connectionStatus);
  const isWinnerRevealOpen = useRoomStore((store) => store.isWinnerRevealOpen);
  const dismissWinner = useRoomStore((store) => store.dismissWinner);

  if (!state) {
    return (
      <main className="min-h-screen bg-slate-950 p-6 text-white">
        <div className="mx-auto max-w-5xl">
          <p>Loading room...</p>
          {error ? <p className="mt-3 text-red-400">{error}</p> : null}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-white md:p-8">
      <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[1.4fr_0.9fr]">
        <section className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-sky-300">{state.category.name}</p>
              <h1 className="text-2xl font-bold">{state.room.name}</h1>
              <p className="text-sm text-slate-400">
                Room {state.room.code} · Socket {connectionStatus}
              </p>
            </div>

            <button
              onClick={() => void refresh()}
              className="rounded-xl bg-white/10 px-4 py-2 text-sm hover:bg-white/20"
            >
              Refresh
            </button>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl bg-slate-900 p-4">
              <p className="text-sm text-slate-400">Round</p>
              <p className="mt-1 text-2xl font-bold">
                #{state.currentRound?.roundNumber ?? "-"}
              </p>
              <p className="text-sm text-slate-400">
                {state.currentRound?.status ?? "NO ROUND"}
              </p>
            </div>

            <div className="rounded-2xl bg-slate-900 p-4">
              <p className="text-sm text-slate-400">Pool</p>
              <p className="mt-1 text-2xl font-bold">
                {formatAmount(state.currentRound?.totalEntryAmount)}
              </p>
              <p className="text-sm text-slate-400">coins</p>
            </div>

            <div className="rounded-2xl bg-slate-900 p-4">
              <p className="text-sm text-slate-400">Locks In</p>
              <RoundTimer
                status={state.currentRound?.status}
                serverNow={state.serverNow}
                locksAt={state.currentRound?.locksAt}
              />
            </div>
          </div>

          <RoundPhaseBanner
            status={state.currentRound?.status}
            roundNumber={state.currentRound?.roundNumber}
            totalEntryAmount={state.currentRound?.totalEntryAmount}
            winnerUserId={state.currentRound?.winnerUserId}
            winningTicket={state.currentRound?.winningTicket}
          />

          <div className="mt-6">
            <SpinningWheel
              entries={state.entries}
              totalEntryAmount={state.currentRound?.totalEntryAmount ?? "0"}
              spinAngle={state.currentRound?.spinAngle}
              status={state.currentRound?.status}
            />
          </div>

          {error ? (
            <div className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
              {error}
            </div>
          ) : null}
        </section>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-yellow-400/20 bg-yellow-400/10 p-5">
            <p className="text-sm font-bold uppercase tracking-wide text-yellow-200">
              Wallet
            </p>
            <h2 className="mt-2 text-3xl font-black">
              {formatAmount(meWallet?.wallet.balanceSnapshot)}
            </h2>
            <p className="mt-1 text-sm text-yellow-100/80">
              {meWallet?.user.username ?? "Sign in required"}
            </p>
            <button
              onClick={() => void refreshWallet()}
              className="mt-4 rounded-xl bg-yellow-400 px-4 py-2 text-sm font-bold text-slate-950"
            >
              Refresh Balance
            </button>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h2 className="text-lg font-bold">Place Entry</h2>

            <div className="mt-4 grid grid-cols-3 gap-2">
              {[1000, 2000, 5000].map((chip) => (
                <button
                  key={chip}
                  onClick={() => setSelectedChip(chip)}
                  className={
                    chip === selectedChip
                      ? "rounded-xl bg-yellow-400 px-3 py-2 font-bold text-slate-950"
                      : "rounded-xl bg-white/10 px-3 py-2 hover:bg-white/20"
                  }
                >
                  {chip}
                </button>
              ))}
            </div>

            <button
              disabled={
                isPlacingEntry ||
                state.currentRound?.status !== "OPEN" ||
                !meWallet
              }
              onClick={() => void placeEntry({ amount: selectedChip })}
              className="mt-4 w-full rounded-xl bg-emerald-500 px-4 py-3 font-bold text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              {meWallet
                ? isPlacingEntry
                  ? "Placing..."
                  : `Enter ${selectedChip}`
                : "Sign in required"}
            </button>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h2 className="text-lg font-bold">Players</h2>
            <div className="mt-3 space-y-2">
              {state.entries.length === 0 ? (
                <p className="text-sm text-slate-400">No entries yet.</p>
              ) : (
                state.entries.map((entry) => (
                  <div key={entry.id} className="rounded-xl bg-slate-900 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold">
                          {entry.player?.username ?? entry.userId}
                        </p>
                        <p className="text-xs text-slate-400">
                          Tickets {entry.ticketStart ?? "-"}–
                          {entry.ticketEnd ?? "-"}
                        </p>
                      </div>
                      <p className="font-bold">{formatAmount(entry.amount)}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </aside>
      </div>

      <WinnerReveal
        isOpen={isWinnerRevealOpen}
        result={latestResult}
        onClose={dismissWinner}
      />
    </main>
  );
}
