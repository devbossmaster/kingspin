"use client";

import { useParams } from "next/navigation";
import { ConnectionPill } from "../../../../components/layout/connection-pill";
import { NavBar } from "../../../../components/layout/nav-bar";
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
import { useRoomStore } from "../../../../stores/room-store";

export default function LiveRoomPage() {
  const params = useParams<{ categorySlug: string; roomId: string }>();
  const roomId = params.roomId;
  const roomHref = `/spinpro/${params.categorySlug}/${roomId}`;
  const { data: session, isPending } = useSession();

  const {
    state,
    latestResult,
    user,
    wallet,
    error,
    walletError,
    isPlacingEntry,
    myEntry,
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
      <main className="min-h-screen text-text-primary">
        <NavBar backHref={`/spinpro/${params.categorySlug}`} />
        <div className="mx-auto max-w-5xl px-4 py-8 md:px-8">
          <p>Loading room...</p>
          {error ? <p className="mt-3 text-red-hot">{error}</p> : null}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen text-text-primary">
      <NavBar backHref={`/spinpro/${params.categorySlug}`} />
      <ConnectionPill />

      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-5 md:px-8 lg:grid-cols-[1.45fr_0.9fr]">
        <section className="arcadia-surface rounded-lg p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
            <div>
              <p className="text-sm font-bold text-teal">{state.category.name}</p>
              <h1 className="mt-1 font-display text-3xl font-black">
                {state.room.name}
              </h1>
              <p className="mt-1 font-mono text-xs text-text-secondary">
                {state.room.code} / socket {connectionStatus}
              </p>
            </div>

            <Button variant="ghost" onClick={() => void refresh()}>
              Refresh
            </Button>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-md border border-[var(--border)] bg-white/[0.04] p-4">
              <p className="text-sm text-text-secondary">Round</p>
              <p className="mt-1 font-mono text-2xl font-black">
                #{state.currentRound?.roundNumber ?? "-"}
              </p>
              <div className="mt-2">
                <Badge variant={phaseBadgeVariant(state.currentRound?.status)}>
                  {state.currentRound?.status ?? "NO ROUND"}
                </Badge>
              </div>
            </div>

            <PoolStat
              label="Pool"
              value={state.currentRound?.totalEntryAmount}
              caption="coins"
            />

            <div className="rounded-md border border-[var(--border)] bg-white/[0.04] p-4">
              <p className="text-sm text-text-secondary">Locks In</p>
              <RoundTimer
                status={state.currentRound?.status}
                serverNow={state.serverNow}
                locksAt={state.currentRound?.locksAt}
                durationMs={state.room.roundDurationMs}
              />
            </div>
          </div>

          <RoundPhaseBanner
            status={state.currentRound?.status}
            roundNumber={state.currentRound?.roundNumber}
            totalEntryAmount={state.currentRound?.totalEntryAmount}
            winningTicket={state.currentRound?.winningTicket}
          />

          <div className="mt-5">
            <SpinningWheel
              entries={state.entries}
              totalEntryAmount={state.currentRound?.totalEntryAmount ?? "0"}
              spinAngle={state.currentRound?.spinAngle}
              status={state.currentRound?.status}
              winnerEntryId={state.currentRound?.winnerEntryId}
            />
          </div>

          <FairnessStrip
            currentRound={state.currentRound}
            latestResult={latestResult}
          />

          {error ? (
            <div className="mt-4 rounded-md border border-[rgba(248,113,113,0.42)] bg-[rgba(248,113,113,0.12)] p-3 text-sm text-red-hot">
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
            status={state.currentRound?.status}
            wallet={wallet}
            hasSession={Boolean(session?.user)}
            emailVerified={session?.user.emailVerified}
            roomHref={roomHref}
            chipOptions={chipOptions}
            selectedChip={selectedChip}
            myEntry={myEntry}
            isPlacingEntry={isPlacingEntry}
            onSelectChip={setSelectedChip}
            onPlaceEntry={(amount) => void placeEntry(amount)}
          />

          <PlayersList
            entries={state.entries}
            totalEntryAmount={state.currentRound?.totalEntryAmount ?? "0"}
            winnerEntryId={state.currentRound?.winnerEntryId}
          />

          <section className="arcadia-surface rounded-lg p-5">
            <h2 className="font-display text-lg font-black">Recent Rounds</h2>
            <div className="mt-3 space-y-2">
              {roundLog.length === 0 ? (
                <p className="text-sm text-text-secondary">No settled rounds yet.</p>
              ) : (
                roundLog.map((result) => (
                  <div
                    key={result.round.id}
                    className="rounded-md border border-[var(--border)] bg-white/[0.04] px-3 py-2 text-sm"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono">
                        Round #{result.round.roundNumber}
                      </span>
                      <span className="font-mono text-gold">
                        {formatCoins(result.round.payoutAmount)}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-text-secondary">
                      Winner{" "}
                      {result.winnerEntry?.player?.username ??
                        truncateId(result.winnerEntry?.userId, 6)}
                    </p>
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
