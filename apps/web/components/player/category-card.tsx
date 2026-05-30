import Link from "next/link";
import { ArrowRight, Clock3, Coins, UsersRound } from "lucide-react";
import type { CategoryListItem, RoomListItem } from "../../lib/api-client";
import {
  buildPlayHref,
  getCategoryAmountLabel,
  getCategoryMode,
  getModeTag,
  getModeTitle,
} from "../../lib/game-modes";
import { formatCoins } from "../../lib/format";
import {
  formatLockCountdown,
  getAdjustedMsUntilLock,
  getRoomPlayerCount,
  getRoomPool,
  getRoundPhaseLabel,
  getRoundStatusTone,
} from "../../lib/room-summary";
import { StatusPill } from "./status-pill";

export function CategoryCard({
  category,
  room,
  isSignedIn,
  clientNowMs,
}: {
  category: CategoryListItem;
  room?: RoomListItem | null;
  isSignedIn: boolean;
  clientNowMs?: number;
}) {
  const mode = getCategoryMode(category);
  const roomHref = room ? `/spinpro/${category.slug}/${room.id}` : "#";
  const href = room ? buildPlayHref(roomHref, isSignedIn) : "#";
  const status = room?.currentRound?.status ?? room?.status ?? "WAITING";
  const playerCount = getRoomPlayerCount(room);
  const pool = getRoomPool(room);
  const msUntilLock = getAdjustedMsUntilLock(room, clientNowMs);
  const phaseLabel = getRoundPhaseLabel(status);
  const fixedMode = mode === "fixed";

  return (
    <Link
      href={href}
      aria-disabled={!room}
      className="group flex min-h-[220px] flex-col rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4 transition hover:border-[var(--border-glow)] hover:bg-[var(--bg-raised)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <StatusPill tone={fixedMode ? "purple" : "lime"}>
            {getModeTag(mode)}
          </StatusPill>
          <h3 className="mt-3 font-display text-xl font-black">
            {category.name}
          </h3>
          <p className="mt-1 text-sm font-semibold text-text-secondary">
            {getModeTitle(mode)}
          </p>
        </div>
        <StatusPill tone={getRoundStatusTone(status)}>{phaseLabel}</StatusPill>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-md border border-[var(--border)] bg-white/[0.035] px-3 py-2">
          <p className="flex items-center gap-1 text-xs font-bold uppercase tracking-[0.12em] text-text-dim">
            <Coins className="h-3.5 w-3.5" aria-hidden="true" />
            Entry
          </p>
          <p className="mt-1 font-mono font-black text-text-primary">
            {getCategoryAmountLabel(category)}
          </p>
        </div>
        <div className="rounded-md border border-[var(--border)] bg-white/[0.035] px-3 py-2">
          <p className="flex items-center gap-1 text-xs font-bold uppercase tracking-[0.12em] text-text-dim">
            <UsersRound className="h-3.5 w-3.5" aria-hidden="true" />
            Players
          </p>
          <p className="mt-1 font-mono font-black text-text-primary">
            {playerCount}/{room?.maxPlayers ?? category.maxPlayers}
          </p>
        </div>
      </div>

      <div className="mt-2 rounded-md border border-[var(--border)] bg-white/[0.035] px-3 py-2 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1 text-xs font-bold uppercase tracking-[0.12em] text-text-dim">
            <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
            Status
          </span>
          <span className="text-right font-mono font-black text-text-primary">
            {status === "OPEN" && msUntilLock > 0
              ? formatLockCountdown(msUntilLock)
              : phaseLabel}
          </span>
        </div>
      </div>

      <div className="mt-2 rounded-md border border-[var(--border)] bg-white/[0.035] px-3 py-2 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1 text-xs font-bold uppercase tracking-[0.12em] text-text-dim">
            <Coins className="h-3.5 w-3.5" aria-hidden="true" />
            Pool
          </span>
          <span className="font-mono font-black text-gold">
            {formatCoins(pool)} coins
          </span>
        </div>
      </div>

      <div className="mt-auto pt-4">
        <span className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-[var(--gold)] px-4 py-2 text-sm font-black text-[var(--bg-void)] transition group-hover:bg-[#FFD76A]">
          {isSignedIn ? "Join room" : "Sign in to join"}
          <ArrowRight
            className="h-4 w-4 transition group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </span>
      </div>
    </Link>
  );
}
