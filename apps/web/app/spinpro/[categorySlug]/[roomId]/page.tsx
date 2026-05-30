"use client";

import type {
  EntryWithPlayerSnapshot,
  LatestRoundResult,
  LiveRoundSnapshot,
} from "@kingspin/contracts";
import { useParams } from "next/navigation";
import { ConnectionPill } from "../../../../components/layout/connection-pill";
import { NavBar } from "../../../../components/layout/nav-bar";
import { BottomNav } from "../../../../components/player/bottom-nav";
import { EntryPanel } from "../../../../components/spinpro/entry-panel";
import { FairnessStrip } from "../../../../components/spinpro/fairness-strip";
import { PlayersList } from "../../../../components/spinpro/players-list";
import { SpinningWheel } from "../../../../components/spinpro/spinning-wheel";
import { WalletHUD } from "../../../../components/spinpro/wallet-hud";
import { WinnerReveal } from "../../../../components/spinpro/winner-reveal";
import { Badge, phaseBadgeVariant } from "../../../../components/ui/badge";
import { useCountdown } from "../../../../hooks/use-countdown";
import { useRoom } from "../../../../hooks/use-room";
import { useSession } from "../../../../lib/auth-client";
import { formatCoins, formatMs, truncateId } from "../../../../lib/format";
import { useAuthStore } from "../../../../stores/auth-store";
import { useRoomStore } from "../../../../stores/room-store";

const PLAYER_PHASES = [
  "ENTRY OPEN",
  "LOCKED / DRAW",
  "SPINNING",
  "RESULT",
] as const;

type PlayerPhase = (typeof PLAYER_PHASES)[number] | "SKIPPED / REFUNDED" | "WAITING";

function getPlayerPhase(status: string | null | undefined): PlayerPhase {
  switch (status) {
    case "OPEN":
      return "ENTRY OPEN";
    case "LOCKED":
    case "DRAWING":
      return "LOCKED / DRAW";
    case "SPINNING":
      return "SPINNING";
    case "SETTLING":
    case "COMPLETED":
      return "RESULT";
    case "CANCELLED":
      return "SKIPPED / REFUNDED";
    default:
      return "WAITING";
  }
}

function getPhaseCopy(status: string | null | undefined, msLeft: number) {
  if (status === "OPEN") {
    return {
      title: "ENTRY OPEN",
      message:
        msLeft > 0 && msLeft <= 2_000
          ? "Final seconds / locking soon. Entries are still open."
          : "Entries open. Join before the countdown ends.",
      badge: msLeft > 0 && msLeft <= 2_000 ? "Final seconds" : "Entries open",
      tone: "border-[rgba(74,222,128,0.34)] bg-[rgba(74,222,128,0.08)]",
      bar: "bg-[var(--green-go)]",
    };
  }

  if (status === "LOCKED") {
    return {
      title: "LOCKED / DRAW",
      message: "Entries locked. Assigning tickets.",
      badge: "Locked",
      tone: "border-[rgba(250,204,21,0.36)] bg-[rgba(250,204,21,0.08)]",
      bar: "bg-[var(--gold)]",
    };
  }

  if (status === "DRAWING") {
    return {
      title: "LOCKED / DRAW",
      message: "Selecting winner securely.",
      badge: "Drawing",
      tone: "border-[rgba(96,165,250,0.34)] bg-[rgba(96,165,250,0.08)]",
      bar: "bg-blue-300",
    };
  }

  if (status === "SPINNING") {
    return {
      title: "SPINNING",
      message: "Wheel spinning. Revealing result.",
      badge: "Spinning",
      tone: "border-[rgba(232,121,249,0.34)] bg-[rgba(232,121,249,0.08)]",
      bar: "bg-[var(--magenta)]",
    };
  }

  if (status === "SETTLING") {
    return {
      title: "RESULT",
      message: "Finalizing payout.",
      badge: "Settling",
      tone: "border-[rgba(45,212,191,0.34)] bg-[rgba(45,212,191,0.08)]",
      bar: "bg-teal",
    };
  }

  if (status === "COMPLETED") {
    return {
      title: "RESULT",
      message: "Winner revealed. Next round soon.",
      badge: "Complete",
      tone: "border-[rgba(250,204,21,0.38)] bg-[rgba(250,204,21,0.08)]",
      bar: "bg-[var(--gold)]",
    };
  }

  if (status === "CANCELLED") {
    return {
      title: "SKIPPED / REFUNDED",
      message: "Round skipped/refunded. Next round soon.",
      badge: "Skipped",
      tone: "border-[rgba(248,113,113,0.36)] bg-[rgba(248,113,113,0.08)]",
      bar: "bg-[var(--red-hot)]",
    };
  }

  return {
    title: "WAITING",
    message: "The next round is preparing.",
    badge: "Waiting",
    tone: "border-[var(--border)] bg-white/[0.04]",
    bar: "bg-white/[0.35]",
  };
}

function PhaseStepper({ status }: { status: string | null | undefined }) {
  const playerPhase = getPlayerPhase(status);
  const activeIndex = PLAYER_PHASES.findIndex((phase) => phase === playerPhase);

  if (playerPhase === "SKIPPED / REFUNDED") {
    return (
      <div className="rounded-md border border-[rgba(248,113,113,0.26)] bg-black/20 px-3 py-2 text-xs font-semibold text-text-secondary">
        No winner was drawn for this round.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-4 gap-1">
      {PLAYER_PHASES.map((phase, index) => {
        const isActive = phase === playerPhase;
        const isDone = activeIndex > index;

        return (
          <div key={phase} className="min-w-0">
            <div
              className={`h-1.5 rounded-full ${
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
              className={`mt-1 truncate text-center text-[10px] font-black uppercase ${
                isActive
                  ? "text-[var(--gold)]"
                  : isDone
                    ? "text-green-go"
                    : "text-text-dim"
              }`}
            >
              {phase}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function MainPhasePanel({
  status,
  roundNumber,
  serverNow,
  locksAt,
  durationMs,
  entryCount,
  totalEntryAmount,
}: {
  status: string | null | undefined;
  roundNumber: number | null | undefined;
  serverNow: string;
  locksAt: string | null | undefined;
  durationMs: number;
  entryCount: number;
  totalEntryAmount: string;
}) {
  const { msLeft } = useCountdown({
    locksAt,
    serverNow,
    enabled: status === "OPEN",
  });
  const copy = getPhaseCopy(status, msLeft);
  const remainingRatio =
    status === "OPEN" && durationMs > 0
      ? Math.max(0, Math.min(1, msLeft / durationMs))
      : status
        ? 1
        : 0;

  return (
    <section
      className={`arcadia-surface relative overflow-hidden rounded-lg border p-4 ${copy.tone}`}
      aria-live="polite"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[rgba(250,204,21,0.64)] to-transparent" />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-[var(--gold)]">
            Round #{roundNumber ?? "-"}
          </p>
          <h2 className="mt-1 font-display text-2xl font-black text-text-primary">
            {copy.title}
          </h2>
          <p className="mt-1 text-sm text-text-secondary">{copy.message}</p>
        </div>

        <div className="grid gap-2 text-right">
          <Badge variant={phaseBadgeVariant(status)}>{copy.badge}</Badge>
          {status === "OPEN" ? (
            <p className="font-mono text-2xl font-black text-text-primary">
              {formatMs(msLeft)}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--bg-raised)]">
        <div
          className={`h-full rounded-full ${copy.bar} transition-[width] duration-300`}
          style={{ width: `${remainingRatio * 100}%` }}
        />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_0.32fr_0.32fr]">
        <PhaseStepper status={status} />

        <div className="rounded-md border border-[var(--border)] bg-black/20 px-3 py-2">
          <p className="text-xs font-bold uppercase text-text-dim">Pool</p>
          <p className="mt-1 font-mono text-sm font-black text-[var(--gold)]">
            {formatCoins(totalEntryAmount)}
          </p>
        </div>

        <div className="rounded-md border border-[var(--border)] bg-black/20 px-3 py-2">
          <p className="text-xs font-bold uppercase text-text-dim">Entries</p>
          <p className="mt-1 font-mono text-sm font-black text-text-primary">
            {entryCount}
          </p>
        </div>
      </div>
    </section>
  );
}

function winnerName(entry: EntryWithPlayerSnapshot | null | undefined, userId?: string | null) {
  return (
    entry?.player?.username ??
    entry?.player?.fullName ??
    (entry?.userId ? truncateId(entry.userId, 6) : userId ? truncateId(userId, 6) : "Pending")
  );
}

function RoundResultPanel({
  currentRound,
  winnerEntry,
  latestResult,
}: {
  currentRound: LiveRoundSnapshot;
  winnerEntry: EntryWithPlayerSnapshot | null;
  latestResult: LatestRoundResult | null;
}) {
  if (
    currentRound.status !== "SETTLING" &&
    currentRound.status !== "COMPLETED"
  ) {
    return null;
  }

  const isCompleted = currentRound.status === "COMPLETED";

  return (
    <section className="arcadia-surface relative overflow-hidden rounded-lg border border-[rgba(45,212,191,0.28)] bg-[rgba(45,212,191,0.06)] p-4">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-teal to-transparent" />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-teal">
            {isCompleted ? "Winner Revealed" : "Finalizing Payout"}
          </p>
          <h2 className="mt-1 font-display text-xl font-black text-text-primary">
            {isCompleted ? "Result is final" : "Result locked"}
          </h2>
          <p className="mt-1 text-sm text-text-secondary">
            {isCompleted
              ? "Payout finalized. Fairness proof is available as it loads."
              : "The backend ledger is settling the payout safely."}
          </p>
        </div>

        <Badge variant="settled">
          {isCompleted
            ? latestResult
              ? "Proof ready"
              : "Proof loading"
            : "Settling"}
        </Badge>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <div className="rounded-md border border-[var(--border)] bg-black/20 p-3">
          <p className="text-xs font-bold uppercase text-text-dim">Winner</p>
          <p className="mt-1 truncate font-mono text-sm font-black text-text-primary">
            {winnerName(winnerEntry, currentRound.winnerUserId)}
          </p>
        </div>

        <div className="rounded-md border border-[var(--border)] bg-black/20 p-3">
          <p className="text-xs font-bold uppercase text-text-dim">Ticket</p>
          <p className="mt-1 font-mono text-sm font-black text-[var(--gold)]">
            {currentRound.winningTicket ?? "-"}
          </p>
        </div>

        <div className="rounded-md border border-[var(--border)] bg-black/20 p-3">
          <p className="text-xs font-bold uppercase text-text-dim">Payout</p>
          <p className="mt-1 font-mono text-sm font-black text-[var(--gold)]">
            {formatCoins(currentRound.payoutAmount)}
          </p>
        </div>

        <div className="rounded-md border border-[var(--border)] bg-black/20 p-3">
          <p className="text-xs font-bold uppercase text-text-dim">Round</p>
          <p className="mt-1 font-mono text-sm font-black text-text-primary">
            #{currentRound.roundNumber}
          </p>
        </div>
      </div>
    </section>
  );
}

function HeaderStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-[120px] rounded-md border border-[var(--border)] bg-white/[0.04] px-3 py-2">
      <p className="text-xs font-bold uppercase text-text-dim">{label}</p>
      <p className="mt-1 truncate font-mono text-sm font-black text-text-primary">
        {value}
      </p>
    </div>
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
    placeEntry,
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
              Connecting to the room and loading the latest backend state.
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
    ? "Fixed Bet / Equal Chance"
    : "Pro Mode / Flexible";

  const visibleWinnerEntryId =
    roundStatus === "SETTLING" || roundStatus === "COMPLETED"
      ? currentRound?.winnerEntryId
      : null;

  const completedFallbackWinner = currentRound?.winnerEntryId
    ? (state.entries.find((entry) => entry.id === currentRound.winnerEntryId) ??
      null)
    : null;

  return (
    <main className="min-h-screen pb-24 text-text-primary md:pb-0">
      <NavBar backHref={`/spinpro/${params.categorySlug}`} />
      <ConnectionPill />

      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-5 md:px-8 lg:grid-cols-[1.45fr_0.9fr]">
        <section className="space-y-4">
          <section className="arcadia-surface relative overflow-hidden rounded-lg p-5">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[rgba(250,204,21,0.75)] to-transparent" />

            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-[0.22em] text-[var(--gold)]">
                  {state.category.name}
                </p>
                <h1 className="mt-1 truncate font-display text-3xl font-black md:text-4xl">
                  {state.room.name}
                </h1>

                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                  <span className="rounded-md border border-[var(--border)] bg-white/[0.04] px-2 py-1 font-mono">
                    {state.room.code}
                  </span>
                  <span className="rounded-md border border-[var(--border)] bg-white/[0.04] px-2 py-1 font-mono">
                    Socket {connectionStatus}
                  </span>
                  <Badge variant={phaseBadgeVariant(roundStatus)}>
                    {getPlayerPhase(roundStatus)}
                  </Badge>
                  <span className="rounded-md border border-[var(--border)] bg-white/[0.04] px-2 py-1 font-mono">
                    {modeLabel}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <HeaderStat
                label="Round"
                value={`#${currentRound?.roundNumber ?? "-"}`}
              />
              <HeaderStat label="Pool" value={formatCoins(totalEntryAmount)} />
              <HeaderStat
                label="My Entry"
                value={formatCoins(myEntry?.amount)}
              />
            </div>
          </section>

          <MainPhasePanel
            status={roundStatus}
            roundNumber={currentRound?.roundNumber}
            serverNow={state.serverNow}
            locksAt={currentRound?.locksAt}
            durationMs={state.room.roundDurationMs}
            entryCount={state.entries.length}
            totalEntryAmount={totalEntryAmount}
          />

          <SpinningWheel
            entries={state.entries}
            totalEntryAmount={totalEntryAmount}
            spinAngle={currentRound?.spinAngle}
            status={roundStatus}
            winnerEntryId={visibleWinnerEntryId}
          />

          {currentRound ? (
            <RoundResultPanel
              currentRound={currentRound}
              winnerEntry={completedFallbackWinner}
              latestResult={latestResult}
            />
          ) : null}

          {roundStatus === "COMPLETED" ? (
            <FairnessStrip
              currentRound={currentRound}
              latestResult={latestResult}
            />
          ) : null}

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
            winnerEntryId={visibleWinnerEntryId}
          />

          <details className="arcadia-surface relative overflow-hidden rounded-lg p-4">
            <summary className="cursor-pointer list-none text-sm font-black uppercase tracking-[0.18em] text-text-secondary">
              Recent rounds ({roundLog.length})
            </summary>

            <div className="mt-3 space-y-2">
              {roundLog.length === 0 ? (
                <p className="rounded-md border border-dashed border-[var(--border)] bg-white/[0.03] p-4 text-sm text-text-secondary">
                  Completed rounds will appear here.
                </p>
              ) : (
                roundLog.map((result) => (
                  <div
                    key={result.round.id}
                    className="rounded-md border border-[var(--border)] bg-white/[0.04] px-3 py-2 text-sm"
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
          </details>
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
