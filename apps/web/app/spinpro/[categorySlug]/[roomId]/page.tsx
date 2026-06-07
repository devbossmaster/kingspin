"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { ConnectionPill } from "../../../../components/layout/connection-pill";
import { EntryPanel } from "../../../../components/spinpro/entry-panel";
import { FairnessStrip } from "../../../../components/spinpro/fairness-strip";
import { PlayersList } from "../../../../components/spinpro/players-list";
import {
  ArenaHeroCard,
  RockyTopBar,
  RoomEntryDock,
} from "../../../../components/spinpro/room-rocky-ui";
import { SpinningWheel } from "../../../../components/spinpro/spinning-wheel";
import { WinnerReveal } from "../../../../components/spinpro/winner-reveal";
import { useCountdown } from "../../../../hooks/use-countdown";
import { useRoom } from "../../../../hooks/use-room";
import { useSession } from "../../../../lib/auth-client";
import { formatCoins } from "../../../../lib/format";
import {
  getCategoryDisplayName,
  getRoomDisplayName,
} from "../../../../lib/game-modes";
import { getPublicRoundPhase } from "../../../../lib/room-summary";
import { useRoomStore } from "../../../../stores/room-store";

export default function LiveRoomPage() {
  const params = useParams<{ categorySlug: string; roomId: string }>();
  const roomId = params.roomId;
  const roomHref = `/spinpro/${params.categorySlug}/${roomId}`;

  const { data: session } = useSession();

  const {
    state,
    latestResult,
    wallet,
    error,
    isPlacingEntry,
    myEntry,
    placeEntry,
  } = useRoom(roomId);

  const selectedChip = useRoomStore((store) => store.selectedChip);
  const setSelectedChip = useRoomStore((store) => store.setSelectedChip);
  const chipOptions = useRoomStore((store) => store.chipOptions);
  const connectionStatus = useRoomStore((store) => store.connectionStatus);
  const isWinnerRevealOpen = useRoomStore((store) => store.isWinnerRevealOpen);
  const dismissWinner = useRoomStore((store) => store.dismissWinner);

  const [isEntrySheetOpen, setIsEntrySheetOpen] = useState(false);

  const currentRound = state?.currentRound;
  const roundStatus = currentRound?.status;
  const roundPhase = currentRound?.phase ?? null;
  const publicPhase = getPublicRoundPhase(currentRound);

  const { msLeft } = useCountdown({
    locksAt: currentRound?.locksAt,
    serverNow: state?.serverNow ?? new Date().toISOString(),
    enabled: publicPhase === "ENTRY_OPEN",
  });

  if (!state) {
    return (
      <main className="rocky-room min-h-screen text-white">
        <ConnectionPill />

        <div className="mx-auto flex min-h-screen w-full max-w-[430px] items-center px-4">
          <section className="rocky-glass relative w-full overflow-hidden rounded-[28px] p-6">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[rgba(250,204,21,0.65)] to-transparent" />

            <p className="text-xs font-black uppercase tracking-[0.22em] text-[var(--gold)]">
              Loading Room
            </p>
            <h1 className="mt-2 text-3xl font-black text-white">
              Preparing live table...
            </h1>
            <p className="mt-2 text-sm text-slate-300">
              Connecting to the room and loading the latest backend state.
            </p>

            {error ? (
              <div className="mt-4 rounded-2xl border border-red-400/40 bg-red-500/10 p-3 text-sm font-semibold text-red-200">
                {error}
              </div>
            ) : null}
          </section>
        </div>
      </main>
    );
  }

  const totalEntryAmount = currentRound?.totalEntryAmount ?? "0";
  const categoryName = getCategoryDisplayName(state.category);
  const roomName = getRoomDisplayName(state.room);
  const maxPlayers = state.room.maxPlayers ?? state.category.maxPlayers ?? 30;

  const visibleWinnerEntryId =
    publicPhase === "RESULT" && currentRound?.resultReason === "WINNER"
      ? currentRound?.winnerEntryId
      : null;

  const isEntryOpen = publicPhase === "ENTRY_OPEN";
  const isRoundFull = state.entries.length >= maxPlayers;
  const parsedFixedEntryAmount = Number(state.room.fixedEntryAmount ?? 0);
  const fixedEntryAmount =
    state.room.gameMode === "FIXED_EQUAL_CHANCE" &&
    Number.isSafeInteger(parsedFixedEntryAmount) &&
    parsedFixedEntryAmount > 0
      ? parsedFixedEntryAmount
      : null;

  const bottomCtaLabel = !session?.user
    ? "Sign in to enter"
    : !isEntryOpen
      ? publicPhase === "RESULT"
        ? "Next round soon"
        : "Entries closed"
      : isRoundFull
        ? "The round is full"
        : myEntry
          ? `Your entry ${formatCoins(myEntry.amount)}`
          : `Enter ${formatCoins(fixedEntryAmount ?? selectedChip)}`;

  return (
    <main className="rocky-room min-h-screen overflow-x-hidden pb-28 text-white">
      <ConnectionPill />

      <div className="mx-auto w-full max-w-[430px] px-3">
        <section className="min-h-screen pb-4">
          <RockyTopBar
            backHref={`/spinpro/${params.categorySlug}`}
            roomName={roomName}
            roundNumber={currentRound?.roundNumber}
            phase={roundPhase}
            status={roundStatus}
            connectionStatus={connectionStatus}
          />

          <ArenaHeroCard
            categoryName={categoryName}
            roomName={roomName}
            roundNumber={currentRound?.roundNumber}
            phase={roundPhase}
            status={roundStatus}
            playerCount={state.entries.length}
            maxPlayers={maxPlayers}
            totalEntryAmount={totalEntryAmount}
            msLeft={msLeft}
            msUntilNextRound={currentRound?.msUntilNextRound}
          />

          <section className="relative -mx-2 mt-2 flex min-h-[320px] items-center justify-center overflow-visible md:min-h-[410px]">
            <SpinningWheel
              entries={state.entries}
              totalEntryAmount={totalEntryAmount}
              spinAngle={currentRound?.spinAngle}
              status={roundStatus}
              phase={roundPhase}
              resultReason={currentRound?.resultReason}
              winnerEntryId={visibleWinnerEntryId}
              locksAt={currentRound?.locksAt}
              serverNow={state.serverNow}
              durationMs={state.room.roundDurationMs}
            />
          </section>

          <section className="rocky-glass mt-3 overflow-hidden rounded-[24px] p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-sm font-black text-white">
                {state.entries.length} / {maxPlayers} Players
              </p>

              <p className="font-mono text-xs font-black text-[var(--gold)]">
                {formatCoins(totalEntryAmount)}
              </p>
            </div>

            <PlayersList
              entries={state.entries}
              totalEntryAmount={totalEntryAmount}
              winnerEntryId={visibleWinnerEntryId}
            />
          </section>

          <FairnessStrip
            currentRound={currentRound}
            latestResult={latestResult}
          />

          {error ? (
            <div className="mt-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-3 text-sm font-semibold text-red-200">
              {error}
            </div>
          ) : null}
        </section>
      </div>

      <RoomEntryDock
        isOpen={isEntrySheetOpen}
        ctaLabel={bottomCtaLabel}
        onOpen={() => setIsEntrySheetOpen(true)}
        onClose={() => setIsEntrySheetOpen(false)}
      >
        <EntryPanel
          status={roundStatus}
          phase={roundPhase}
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
          onPlaceEntry={(amount) => {
            void placeEntry(amount);
            setIsEntrySheetOpen(false);
          }}
        />
      </RoomEntryDock>

      <WinnerReveal
        isOpen={isWinnerRevealOpen}
        result={latestResult}
        durationMs={currentRound?.msUntilNextRound}
        onClose={dismissWinner}
      />
    </main>
  );
}
