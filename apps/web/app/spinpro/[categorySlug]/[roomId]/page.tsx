"use client";

import { useParams } from "next/navigation";
import { ConnectionPill } from "../../../../components/layout/connection-pill";
import { NavBar } from "../../../../components/layout/nav-bar";
import { BottomNav } from "../../../../components/player/bottom-nav";
import { EntryPanel } from "../../../../components/spinpro/entry-panel";
import { FairnessStrip } from "../../../../components/spinpro/fairness-strip";
import { PlayersList } from "../../../../components/spinpro/players-list";
import { PoolStat } from "../../../../components/spinpro/pool-stat";
import { RoundPhaseBanner } from "../../../../components/spinpro/round-phase-banner";
import { RoundTimer } from "../../../../components/spinpro/round-timer";
import { SpinningWheel } from "../../../../components/spinpro/spinning-wheel";
import { WalletHUD } from "../../../../components/spinpro/wallet-hud";
import { WinnerReveal } from "../../../../components/spinpro/winner-reveal";
import { Badge, phaseBadgeVariant } from "../../../../components/ui/badge";
import { Button } from "../../../../components/ui/button";
import { useRoom } from "../../../../hooks/use-room";
import { formatCoins, truncateId } from "../../../../lib/format";
import { useSession } from "../../../../lib/auth-client";
import { useAuthStore } from "../../../../stores/auth-store";
import { useRoomStore } from "../../../../stores/room-store";

export default function LiveRoomPage() {
  const params = useParams<{ categorySlug: string; roomId: string }>();
  const roomId = params.roomId;
  const roomHref = `/spinpro/${params.categorySlug}/${roomId}`;
  const { data: session, isPending } = useSession();
  const authUser = useAuthStore((store) => store.user);

  const {
    state,
    latestResult,
    user,
    wallet,
    error,
    walletError,
    isPlacingEntry,
    myEntry,
    entriesTotal,
    placeEntry,
    refresh,
    refreshWallet,
  } = useRoom(roomId);

  const selectedChip = useRoomStore((store) => store.selectedChip);
  const setSelectedChip = useRoomStore((store) => store.setSelectedChip);
  const chipOptions = useRoomStore((store) => store.chipOptions);
  const connectionStatus = useRoomStore((store) => store.connectionStatus);
  const isWinnerRevealOpen = useRoomStore((store) => store.isWinnerRevealOpen);
  const dismissWinner = useRoomStore((store) => store.dismissWinner);
  const roundLog = useRoomStore((store) => store.roundLog);

  if (!state) {
    return (
      <main className="min-h-screen pb-24 text-text-primary md:pb-0">
        <NavBar backHref={`/spinpro/${params.categorySlug}`} />
        <ConnectionPill />

        <div className="mx-auto max-w-5xl px-4 py-8 md:px-8">
          <section className="arcadia-surface relative overflow-hidden rounded-lg p-6">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[rgba(250,204,21,0.65)] to-transparent" />

            <p className="text-xs font-black uppercase tracking-[0.22em] text-[var(--gold)]">
              Loading Room
            </p>
            <h1 className="mt-2 font-display text-3xl font-black">
              Preparing live table...
            </h1>
            <p className="mt-2 text-sm text-text-secondary">
              Connecting to the room and loading the latest round state.
            </p>

            {error ? (
              <div className="mt-4 rounded-md border border-[rgba(248,113,113,0.42)] bg-[rgba(248,113,113,0.12)] p-3 text-sm font-semibold text-red-hot">
                {error}
              </div>
            ) : null}
          </section>
        </div>
        <BottomNav role={authUser?.role} />
      </main>
    );
  }

  const currentRound = state.currentRound;
  const roundStatus = currentRound?.status;
  const totalEntryAmount = currentRound?.totalEntryAmount ?? "0";
  const isFixedMode = state.room.gameMode === "FIXED_EQUAL_CHANCE";
  const modeLabel = isFixedMode
    ? "Fixed Bet · Equal Chance"
    : "Pro Mode · Flexible Proportional";

  return (
    <main className="min-h-screen pb-24 text-text-primary md:pb-0">
      <NavBar backHref={`/spinpro/${params.categorySlug}`} />
      <ConnectionPill />

      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-5 md:px-8 lg:grid-cols-[1.45fr_0.9fr]">
        <section className="space-y-4">
          <section className="arcadia-surface relative overflow-hidden rounded-lg p-5">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[rgba(250,204,21,0.75)] to-transparent" />

            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--border)] pb-4">
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-[0.22em] text-[var(--gold)]">
                  {state.category.name}
                </p>

                <h1 className="mt-1 truncate font-display text-3xl font-black md:text-4xl">
                  {state.room.name}
                </h1>

                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                  <span className="rounded-full border border-[var(--border)] bg-white/[0.04] px-3 py-1 font-mono">
                    {state.room.code}
                  </span>

                  <span className="rounded-full border border-[var(--border)] bg-white/[0.04] px-3 py-1 font-mono">
                    Socket {connectionStatus}
                  </span>

                  <Badge variant={phaseBadgeVariant(roundStatus)}>
                    {roundStatus ?? "NO ROUND"}
                  </Badge>

                  <span className="rounded-full border border-[var(--border)] bg-white/[0.04] px-3 py-1 font-mono">
                    {modeLabel}
                  </span>
                </div>
              </div>

              <Button
                className="transition active:scale-[0.99]"
                variant="ghost"
                onClick={() => void refresh()}
              >
                Refresh Room
              </Button>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <div className="rounded-md border border-[var(--border)] bg-white/[0.04] p-4">
                <p className="text-sm text-text-secondary">Round</p>
                <p className="mt-1 font-mono text-2xl font-black">
                  #{currentRound?.roundNumber ?? "-"}
                </p>
                <p className="mt-2 text-xs text-text-dim">
                  {roundStatus ? "Current active round" : "Waiting for round"}
                </p>
              </div>

              <PoolStat label="Pool" value={totalEntryAmount} caption="coins" />

              <div className="rounded-md border border-[var(--border)] bg-white/[0.04] p-4">
                <p className="text-sm text-text-secondary">My Entry</p>
                <p className="mt-1 font-mono text-2xl font-black">
                  {formatCoins(myEntry?.amount)}
                </p>
                <p className="mt-2 text-xs text-text-dim">
                  {myEntry
                    ? isFixedMode
                      ? "You are in this equal-chance round"
                      : "Confirmed proportional ticket range"
                    : "Not entered yet"}
                </p>
              </div>
            </div>
          </section>

          <RoundTimer
            status={roundStatus}
            serverNow={state.serverNow}
            locksAt={currentRound?.locksAt}
            durationMs={state.room.roundDurationMs}
          />

          <RoundPhaseBanner
            status={roundStatus}
            roundNumber={currentRound?.roundNumber}
            totalEntryAmount={totalEntryAmount}
            winningTicket={currentRound?.winningTicket}
          />

          <SpinningWheel
            entries={state.entries}
            totalEntryAmount={totalEntryAmount}
            spinAngle={currentRound?.spinAngle}
            status={roundStatus}
            winnerEntryId={currentRound?.winnerEntryId}
          />

          <FairnessStrip
            currentRound={currentRound}
            latestResult={latestResult}
          />

          {error ? (
            <div className="rounded-md border border-[rgba(248,113,113,0.42)] bg-[rgba(248,113,113,0.12)] p-3 text-sm font-semibold text-red-hot">
              {error}
            </div>
          ) : null}
        </section>

        <aside className="space-y-4">
          <WalletHUD
            user={user}
            wallet={wallet}
            fallbackName={session?.user.name}
            loadingLabel={isPending ? "Checking session" : "Sign in required"}
            error={session?.user ? walletError : null}
            onRefresh={() => void refreshWallet()}
          />

          <EntryPanel
            status={roundStatus}
            wallet={wallet}
            hasSession={Boolean(session?.user)}
            emailVerified={session?.user.emailVerified}
            roomHref={roomHref}
            chipOptions={chipOptions}
            selectedChip={selectedChip}
            gameMode={state.room.gameMode}
            fixedEntryAmount={state.room.fixedEntryAmount}
            myEntry={myEntry}
            isPlacingEntry={isPlacingEntry}
            onSelectChip={setSelectedChip}
            onPlaceEntry={(amount) => void placeEntry(amount)}
          />

          <PlayersList
            entries={state.entries}
            totalEntryAmount={totalEntryAmount}
            winnerEntryId={currentRound?.winnerEntryId}
          />

          <section className="arcadia-surface relative overflow-hidden rounded-lg p-5">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[rgba(250,204,21,0.55)] to-transparent" />

            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-[var(--gold)]">
                  History
                </p>
                <h2 className="mt-1 font-display text-xl font-black">
                  Recent Rounds
                </h2>
              </div>

              <div className="rounded-full border border-[var(--border)] bg-white/[0.04] px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-text-secondary">
                {roundLog.length} shown
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {roundLog.length === 0 ? (
                <div className="rounded-md border border-dashed border-[var(--border)] bg-white/[0.03] p-4 text-center">
                  <p className="text-sm font-semibold text-text-primary">
                    No settled rounds yet
                  </p>
                  <p className="mt-1 text-xs text-text-secondary">
                    Completed rounds will appear here.
                  </p>
                </div>
              ) : (
                roundLog.map((result) => (
                  <div
                    key={result.round.id}
                    className="rounded-md border border-[var(--border)] bg-white/[0.04] px-3 py-2 text-sm transition hover:border-[rgba(250,204,21,0.28)] hover:bg-white/[0.06]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono font-black">
                        Round #{result.round.roundNumber}
                      </span>
                      <span className="font-mono font-black text-[var(--gold)]">
                        {formatCoins(result.round.payoutAmount)}
                      </span>
                    </div>

                    <p className="mt-1 truncate text-text-secondary">
                      Winner{" "}
                      <span className="font-semibold text-text-primary">
                        {result.winnerEntry?.player?.username ??
                          truncateId(result.winnerEntry?.userId, 6)}
                      </span>
                    </p>
                  </div>
                ))
              )}
            </div>

            <div className="mt-4 rounded-md border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-bold text-text-secondary">
                  Visible pool
                </span>
                <span className="font-mono font-black text-[var(--gold)]">
                  {formatCoins(entriesTotal)} coins
                </span>
              </div>
            </div>
          </section>
        </aside>
      </div>

      <WinnerReveal
        isOpen={isWinnerRevealOpen}
        result={latestResult}
        onClose={dismissWinner}
      />
      <BottomNav role={user?.role ?? authUser?.role} />
    </main>
  );
}
