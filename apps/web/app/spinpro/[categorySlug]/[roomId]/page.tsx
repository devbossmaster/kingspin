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

const PHASE_FLOW = [
  "OPEN",
  "LOCKED",
  "DRAWING",
  "SPINNING",
  "SETTLING",
  "COMPLETED",
] as const;

function getPhaseIndex(status: string | null | undefined) {
  return PHASE_FLOW.findIndex((phase) => phase === status);
}

function phaseShortLabel(status: string) {
  switch (status) {
    case "OPEN":
      return "Open";
    case "LOCKED":
      return "Lock";
    case "DRAWING":
      return "Draw";
    case "SPINNING":
      return "Spin";
    case "SETTLING":
      return "Settle";
    case "COMPLETED":
      return "Done";
    default:
      return status;
  }
}

function phaseHeadline(status: string | null | undefined) {
  switch (status) {
    case "OPEN":
      return "Players can enter now";
    case "LOCKED":
      return "Entries are locked";
    case "DRAWING":
      return "Server is selecting the winner";
    case "SPINNING":
      return "Wheel reveal is live";
    case "SETTLING":
      return "Payout is finalizing";
    case "COMPLETED":
      return "Round completed";
    case "CANCELLED":
      return "Round skipped or refunded";
    default:
      return "Waiting for round";
  }
}

function phaseDescription(status: string | null | undefined) {
  switch (status) {
    case "OPEN":
      return "Enter before the countdown ends. Pool and player list update live.";
    case "LOCKED":
      return "No more entries. Ticket ranges are being finalized.";
    case "DRAWING":
      return "The backend is resolving the winning ticket securely.";
    case "SPINNING":
      return "The result is locked. The wheel is animating with the server spin angle.";
    case "SETTLING":
      return "The backend ledger is settling the winner payout.";
    case "COMPLETED":
      return "Winner reveal is available. A new round will start soon.";
    case "CANCELLED":
      return "No winner was drawn. Empty or single-player rounds are skipped/refunded safely.";
    default:
      return "The room is preparing the next live round.";
  }
}

function LivePhaseRail({ status }: { status: string | null | undefined }) {
  const activeIndex = getPhaseIndex(status);
  const isCancelled = status === "CANCELLED";

  if (isCancelled) {
    return (
      <div className="rounded-lg border border-[rgba(248,113,113,0.32)] bg-[rgba(248,113,113,0.08)] p-3">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-red-hot">
          Skipped / Refunded
        </p>
        <p className="mt-1 text-sm text-text-secondary">
          This round did not draw a winner. The next OPEN round will continue
          automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-black/20 p-3">
      <div className="grid grid-cols-6 gap-1">
        {PHASE_FLOW.map((phase, index) => {
          const isActive = phase === status;
          const isDone = activeIndex > index;
          const isFuture = activeIndex < index;

          return (
            <div key={phase} className="min-w-0">
              <div
                className={`h-2 rounded-full ${
                  isActive
                    ? "bg-[var(--gold)]"
                    : isDone
                      ? "bg-green-go"
                      : "bg-white/[0.12]"
                } ${
                  isActive &&
                  (status === "LOCKED" ||
                    status === "DRAWING" ||
                    status === "SPINNING" ||
                    status === "SETTLING")
                    ? "animate-pulse"
                    : ""
                }`}
              />
              <p
                className={`mt-1 truncate text-center text-[10px] font-black uppercase tracking-[0.08em] ${
                  isActive
                    ? "text-[var(--gold)]"
                    : isDone
                      ? "text-green-go"
                      : isFuture
                        ? "text-text-dim"
                        : "text-text-secondary"
                }`}
              >
                {phaseShortLabel(phase)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LivePhaseHero({
  status,
  roundNumber,
  entryCount,
  connectionStatus,
}: {
  status: string | null | undefined;
  roundNumber: number | null | undefined;
  entryCount: number;
  connectionStatus: string;
}) {
  const isActiveMotion =
    status === "LOCKED" ||
    status === "DRAWING" ||
    status === "SPINNING" ||
    status === "SETTLING";

  return (
    <section className="arcadia-surface relative overflow-hidden rounded-lg border border-[var(--border)] p-4">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[rgba(250,204,21,0.72)] to-transparent" />
      {isActiveMotion ? (
        <div className="pointer-events-none absolute right-4 top-4 h-20 w-20 rounded-full bg-[rgba(250,204,21,0.09)] blur-2xl animate-pulse" />
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-[var(--gold)]">
            Live Phase
          </p>
          <h2 className="mt-1 font-display text-2xl font-black text-text-primary">
            {phaseHeadline(status)}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-text-secondary">
            {phaseDescription(status)}
          </p>
        </div>

        <div className="grid gap-2 text-right">
          <Badge variant={phaseBadgeVariant(status)}>
            {status ?? "NO ROUND"}
          </Badge>

          <span className="rounded-full border border-[var(--border)] bg-white/[0.04] px-3 py-1 font-mono text-xs text-text-secondary">
            Socket {connectionStatus}
          </span>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_0.35fr_0.35fr]">
        <LivePhaseRail status={status} />

        <div className="rounded-lg border border-[var(--border)] bg-white/[0.04] p-3">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-text-dim">
            Round
          </p>
          <p className="mt-1 font-mono text-xl font-black text-text-primary">
            #{roundNumber ?? "-"}
          </p>
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-white/[0.04] p-3">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-text-dim">
            Entries
          </p>
          <p className="mt-1 font-mono text-xl font-black text-text-primary">
            {entryCount}
          </p>
        </div>
      </div>
    </section>
  );
}

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

  const completedFallbackWinner = currentRound?.winnerEntryId
    ? state.entries.find((entry) => entry.id === currentRound.winnerEntryId)
    : null;

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
                  {roundStatus ? "Current live round" : "Waiting for round"}
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

          <LivePhaseHero
            status={roundStatus}
            roundNumber={currentRound?.roundNumber}
            entryCount={state.entries.length}
            connectionStatus={connectionStatus}
          />

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

          {roundStatus === "COMPLETED" && !latestResult ? (
            <section className="arcadia-surface rounded-lg border border-[rgba(250,204,21,0.28)] bg-[rgba(250,204,21,0.06)] p-4">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--gold)]">
                Completed
              </p>
              <h2 className="mt-1 font-display text-xl font-black">
                Winner reveal loading
              </h2>
              <p className="mt-1 text-sm text-text-secondary">
                The round is completed. Full fairness proof is loading now.
              </p>

              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <div className="rounded-md border border-[var(--border)] bg-black/20 p-3">
                  <p className="text-xs text-text-dim">Winner</p>
                  <p className="mt-1 truncate font-mono font-black">
                    {completedFallbackWinner?.player?.username ??
                      completedFallbackWinner?.player?.fullName ??
                      (currentRound?.winnerUserId
                        ? truncateId(currentRound.winnerUserId, 6)
                        : "Pending")}
                  </p>
                </div>

                <div className="rounded-md border border-[var(--border)] bg-black/20 p-3">
                  <p className="text-xs text-text-dim">Winning Ticket</p>
                  <p className="mt-1 font-mono font-black">
                    {currentRound?.winningTicket ?? "-"}
                  </p>
                </div>

                <div className="rounded-md border border-[var(--border)] bg-black/20 p-3">
                  <p className="text-xs text-text-dim">Payout</p>
                  <p className="mt-1 font-mono font-black text-[var(--gold)]">
                    {formatCoins(currentRound?.payoutAmount)}
                  </p>
                </div>
              </div>
            </section>
          ) : null}

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