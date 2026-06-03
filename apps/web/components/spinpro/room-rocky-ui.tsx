"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { formatCoins, formatMs } from "../../lib/format";
import { getPublicRoundPhase } from "../../lib/room-summary";
import { Badge, phaseBadgeVariant } from "../ui/badge";

const PLAYER_PHASES = [
  "ENTRY_OPEN",
  "RANDOMIZING",
  "SPINNING",
  "RESULT",
] as const;

function getPhaseLabel(
  phase: string | null | undefined,
  status?: string | null,
) {
  switch (getPublicRoundPhase({ phase, status })) {
    case "ENTRY_OPEN":
      return "ENTRY OPEN";
    case "RANDOMIZING":
      return "RANDOMIZING";
    case "SPINNING":
      return "SPINNING";
    case "RESULT":
      return "RESULT";
    default:
      return "WAITING";
  }
}

// Top bar
export function RockyTopBar({
  backHref,
  categoryName,
  roomName,
  roundNumber,
  phase,
  status,
  connectionStatus,
}: {
  backHref: string;
  categoryName: string;
  roomName: string;
  roundNumber?: number | null;
  phase?: string | null;
  status?: string | null;
  connectionStatus: string;
}) {
  return (
    <header className="sticky top-0 z-30 -mx-3 flex h-12 items-center gap-2 border-b border-white/5 bg-black/25 px-3 text-white backdrop-blur-xl">
      <Link
        href={backHref}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-black/35 text-lg font-black text-white"
        aria-label="Back"
      >
        ←
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <h1 className="truncate text-sm font-black leading-tight text-white">
            {roomName}
          </h1>
          <span className="shrink-0 rounded-full bg-sky-400 px-1.5 text-[9px] font-black text-white">
            ✓
          </span>
        </div>

        <p className="truncate font-mono text-[11px] font-bold text-slate-300">
          {categoryName} / #{roundNumber ?? "-"}
        </p>
      </div>

      <div className="hidden sm:block">
        <Badge variant={phaseBadgeVariant(phase ?? status)}>
          {getPhaseLabel(phase, status)}
        </Badge>
      </div>

      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-black/35 text-sm font-black text-slate-200">
        ⋮
      </div>

      <span className="sr-only">Socket {connectionStatus}</span>
    </header>
  );
}

// Arena hero card
export function ArenaHeroCard({
  categorySlug,
  roomId,
  phase,
  status,
  playerCount,
  maxPlayers,
  totalEntryAmount,
  msLeft,
  msUntilNextRound,
}: {
  categorySlug: string;
  roomId: string;
  phase: string | null | undefined;
  status?: string | null;
  playerCount: number;
  maxPlayers?: number | null;
  totalEntryAmount: string;
  msLeft: number;
  msUntilNextRound?: number | null;
}) {
  const publicPhase = getPublicRoundPhase({ phase, status });
  const activeIndex = PLAYER_PHASES.findIndex((item) => item === publicPhase);
  const timerValue =
    publicPhase === "ENTRY_OPEN"
      ? formatMs(msLeft)
      : publicPhase === "RESULT" && typeof msUntilNextRound === "number"
        ? formatMs(msUntilNextRound)
        : "-";
  const stats = [
    {
      label: "Players",
      value: `${playerCount} / ${maxPlayers ?? "-"}`,
    },
    {
      label: "Pool",
      value: formatCoins(totalEntryAmount),
    },
    {
      label: publicPhase === "RESULT" ? "Next" : "Ends",
      value: timerValue,
    },
  ];

  return (
    <section className="mt-3 rounded-[28px] border border-white/10 bg-black/20 p-3 backdrop-blur-md">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--gold)]">
            Arena
          </p>
          <p className="truncate font-mono text-xs font-black text-slate-200">
            {categorySlug.toUpperCase()} / #{roomId}
          </p>
        </div>

        <Badge variant={phaseBadgeVariant(phase ?? status)}>
          {getPhaseLabel(phase, status)}
        </Badge>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-1">
        {PLAYER_PHASES.map((item, index) => {
          const isActive = item === publicPhase;
          const isDone = activeIndex > index;

          return (
            <div key={item} className="min-w-0">
              <div
                className={`h-1.5 rounded-full ${
                  isActive
                    ? "bg-[var(--gold)]"
                    : isDone
                      ? "bg-green-go"
                      : "bg-white/15"
                } ${
                  isActive && (item === "RANDOMIZING" || item === "SPINNING")
                    ? "animate-pulse"
                    : ""
                }`}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="min-w-0 rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-center backdrop-blur"
          >
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
              {stat.label}
            </p>
            <p className="mt-0.5 truncate font-mono text-sm font-black text-white">
              {stat.value}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

// Wheel zone
// The wheel JSX is still owned by page.tsx/SpinningWheel to keep placement and reveal behavior unchanged.

// Players zone
// The players JSX is still owned by page.tsx/PlayersList to keep entry mapping unchanged.

// Entry dock
export function RoomEntryDock({
  isOpen,
  ctaLabel,
  onOpen,
  onClose,
  children,
}: {
  isOpen: boolean;
  ctaLabel: string;
  onOpen: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-[430px] px-3 pb-3">
      {!isOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="flex min-h-14 w-full items-center justify-center rounded-2xl bg-indigo-500 px-4 text-center text-lg font-black text-white shadow-[0_18px_40px_rgba(99,102,241,0.35)] transition active:scale-[0.99]"
        >
          {ctaLabel}
        </button>
      ) : (
        <div className="rocky-bottom-sheet overflow-hidden p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-slate-300">
              Entry
            </p>

            <button
              type="button"
              onClick={onClose}
              className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-lg font-black text-white transition hover:bg-white/[0.1] active:scale-95"
              aria-label="Close entry panel"
            >
              ×
            </button>
          </div>

          <div className="max-h-[52vh] overflow-y-auto pb-2 sm:max-h-[65vh]">
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
