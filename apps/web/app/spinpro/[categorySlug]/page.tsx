"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  BadgeDollarSign,
  Clock3,
  Coins,
  Equal,
  Swords,
  UsersRound,
} from "lucide-react";
import { GameShell } from "../../../components/player/game-shell";
import type { RoomListItem } from "../../../lib/api-client";
import {
  getCategoryDisplayName,
  getCategoryMode,
  getCategoryRingLabel,
  getModeTag,
  getModeTitle,
  getRoomDisplayName,
} from "../../../lib/game-modes";
import {
  formatLockCountdown,
  getAdjustedMsUntilLock,
  getAdjustedMsUntilPhaseEnd,
  getDisplayRoundPhaseLabel,
  getPublicRoundPhase,
  getRoomPlayerCount,
} from "../../../lib/room-summary";
import { useCategories } from "../../../hooks/use-categories";
import { useRoomSummaries } from "../../../hooks/use-room-summaries";

function categoryTitle(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getPhaseClass(phase: string) {
  switch (phase) {
    case "ENTRY_OPEN":
      return "border-lime-300/35 bg-lime-400/10 text-lime-200";
    case "RANDOMIZING":
      return "border-teal-300/35 bg-teal-400/10 text-teal-200";
    case "SPINNING":
      return "border-fuchsia-300/35 bg-fuchsia-400/10 text-fuchsia-200";
    case "RESULT":
      return "border-yellow-300/35 bg-yellow-400/10 text-yellow-200";
    default:
      return "border-white/10 bg-white/[0.06] text-white/55";
  }
}

function RoomBattleCard({
  room,
  categorySlug,
  clientNowMs,
  index,
}: {
  room: RoomListItem;
  categorySlug: string;
  clientNowMs: number;
  index: number;
}) {
  // Room/ring cards: consume summary data only; routing stays on category/room ids.
  const roomHref = `/spinpro/${categorySlug}/${room.id}`;
  const currentRound = room.currentRound;

  // Room summaries: keep summary phase/countdown mapping unchanged.
  const status = currentRound?.status ?? room.status;
  const phase = getPublicRoundPhase(currentRound ?? status) ?? "PREPARING";
  const msUntilLock = getAdjustedMsUntilLock(room, clientNowMs);
  const msUntilPhaseEnd = getAdjustedMsUntilPhaseEnd(room, clientNowMs);
  const displayPhase =
    phase === "ENTRY_OPEN" && msUntilLock <= 0 ? "RANDOMIZING" : phase;
  const displayMs = phase === "ENTRY_OPEN" ? msUntilLock : msUntilPhaseEnd;
  const phaseLabel = getDisplayRoundPhaseLabel(
    currentRound ?? status,
    msUntilLock,
  );
  const playerCount = getRoomPlayerCount(room);

  return (
    <Link
      href={roomHref}
      className="group relative min-h-[7.4rem] overflow-hidden rounded-lg border border-emerald-300/45 bg-[linear-gradient(160deg,rgba(5,9,28,0.98),rgba(4,7,22,0.98)_58%,rgba(5,28,38,0.92))] p-3 shadow-[0_16px_36px_rgba(0,0,0,0.32)] transition hover:-translate-y-0.5 hover:border-lime-300/80 hover:shadow-[0_18px_42px_rgba(34,197,94,0.13)]"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-lime-300/70 to-transparent" />

      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <Swords
              className="h-5 w-5 shrink-0 text-white"
              aria-hidden="true"
            />
            <h2 className="truncate font-display text-lg font-black text-white">
              {getRoomDisplayName(room, index)}
            </h2>
          </div>
          <p className="mt-1 truncate font-mono text-[11px] font-black text-slate-400">
            Round: {currentRound?.roundNumber ?? "-"}
          </p>
        </div>

        <span
          className={`shrink-0 rounded-md border px-1.5 py-1 text-[9px] font-black uppercase leading-none ${getPhaseClass(
            displayPhase,
          )}`}
        >
          {phaseLabel}
        </span>
      </div>

      <div className="mt-3 min-w-0 space-y-1.5">
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-black text-slate-300">
          <Clock3
            className="h-3.5 w-3.5 shrink-0 text-teal-200"
            aria-hidden="true"
          />
          <span className="truncate">{formatLockCountdown(displayMs)}</span>
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-black text-slate-300">
          <UsersRound
            className="h-3.5 w-3.5 shrink-0 text-yellow-200"
            aria-hidden="true"
          />
          <span className="truncate">
            {playerCount} / {room.maxPlayers} Players
          </span>
        </div>
      </div>
    </Link>
  );
}

export default function CategoryLobbyPage() {
  // Route params: category slug drives category metadata and room summaries.
  const params = useParams<{ categorySlug: string }>();
  const categorySlug = params.categorySlug;

  // Category fetch: metadata only, no full room live-state mount on this page.
  const { categories } = useCategories();
  const [clientNowMs, setClientNowMs] = useState(() => Date.now());

  // Socket summary updates: use lightweight room summaries for list cards.
  const { roomsBySlug, loading, error } = useRoomSummaries([categorySlug]);
  const rooms = roomsBySlug[categorySlug] ?? [];

  const category = useMemo(
    () => categories.find((item) => item.slug === categorySlug) ?? null,
    [categories, categorySlug],
  );
  const mode = category ? getCategoryMode(category) : "pro";
  const ModeIcon = mode === "fixed" ? Equal : BadgeDollarSign;
  const categoryLabel = category
    ? getCategoryRingLabel(category)
    : "Loading entry";
  const title = getCategoryDisplayName(
    category ?? {
      slug: categorySlug,
      name: categoryTitle(categorySlug),
    },
  );

  useEffect(() => {
    const intervalId = setInterval(() => {
      setClientNowMs(Date.now());
    }, 1_000);

    return () => {
      clearInterval(intervalId);
    };
  }, []);

  return (
    <GameShell backHref="/spinpro">
      <div className="mx-auto w-full max-w-[24rem] px-3 py-4 md:max-w-5xl md:px-8 md:py-8">
        {/* Safe visual section: category/tier header card. */}
        <section className="relative grid min-h-[6.7rem] grid-cols-[5.35rem_minmax(0,1fr)] overflow-hidden rounded-lg border border-yellow-300/35 bg-[linear-gradient(145deg,rgba(5,9,27,0.98),rgba(4,7,22,0.98)_58%,rgba(24,20,49,0.9))] shadow-[0_20px_50px_rgba(0,0,0,0.36)]">
          <div className="relative overflow-hidden">
            <Image
              src="/logo.png"
              alt=""
              fill
              sizes="96px"
              className="object-contain p-2 drop-shadow-[0_12px_18px_rgba(0,0,0,0.4)]"
              priority
            />
          </div>

          <div className="min-w-0 p-3 pl-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-black text-white">Arena</p>
                <h1 className="mt-0.5 truncate font-display text-lg font-black text-white">
                  {title}
                </h1>
                <p className="mt-1 truncate text-[11px] font-black text-slate-400">
                  Rings: {categoryLabel}
                </p>
              </div>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-yellow-200/70 bg-[radial-gradient(circle_at_35%_28%,#fff2a8,#f6c547_48%,#b86d08)] text-amber-950 shadow-[0_0_16px_rgba(246,197,71,0.24)]">
                <Coins className="h-5 w-5" aria-hidden="true" />
              </span>
            </div>

            <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
              <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.05] px-2 py-1 text-[10px] font-black text-slate-200">
                <ModeIcon
                  className="h-3.5 w-3.5 shrink-0 text-lime-300"
                  aria-hidden="true"
                />
                <span className="truncate">{getModeTag(mode)}</span>
              </span>
              <span className="truncate text-right text-[10px] font-black uppercase tracking-[0.12em] text-yellow-200">
                {mode === "fixed" ? "Fixed interval" : "Entry range"}
              </span>
            </div>
          </div>
        </section>

        {/* Loading/empty/error states: summary fetch error. */}
        {error ? (
          <div className="mt-3 rounded-md border border-red-400/35 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200">
            {error}
          </div>
        ) : null}

        {/* Room/ring cards */}
        <section className="mt-4">
          <div className="flex items-center justify-between gap-3 px-1">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-lime-300/80">
                {getModeTitle(mode)}
              </p>
              <h2 className="mt-1 font-display text-2xl font-black text-white">
                Choose your ring
              </h2>
            </div>
            <span className="shrink-0 rounded-md border border-white/10 bg-white/[0.06] px-2 py-1 text-[10px] font-black text-white/70">
              {loading ? "Loading" : `${rooms.length} live`}
            </span>
          </div>

          {loading ? (
            /* Loading/empty/error states: room card skeletons. */
            <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
              {[0, 1, 2, 3, 4, 5].map((item) => (
                <div
                  key={item}
                  className="h-[7.4rem] animate-pulse rounded-lg border border-emerald-300/20 bg-white/[0.04]"
                />
              ))}
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
              {rooms.map((room, index) => (
                <RoomBattleCard
                  key={room.id}
                  room={room}
                  categorySlug={categorySlug}
                  clientNowMs={clientNowMs}
                  index={index}
                />
              ))}
            </div>
          )}

          {/* Loading/empty/error states: empty room summary list. */}
          {!loading && rooms.length === 0 ? (
            <div className="mt-4 rounded-lg border border-dashed border-white/15 bg-white/[0.03] px-4 py-10 text-center text-sm font-semibold text-slate-400">
              No active room is available for this category.
            </div>
          ) : null}
        </section>
      </div>
    </GameShell>
  );
}
