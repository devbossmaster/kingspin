"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { formatMs } from "../../lib/format";
import { getPublicRoundPhase } from "../../lib/room-summary";

function getPhaseLabel(
  phase: string | null | undefined,
  status?: string | null,
) {
  switch (getPublicRoundPhase({ phase, status })) {
    case "ENTRY_OPEN":
      return "Open";
    case "RANDOMIZING":
      return "Drawing";
    case "SPINNING":
      return "Spinning";
    case "RESULT":
      return "Result";
    default:
      return "Waiting";
  }
}

function getPhaseTone(
  phase: string | null | undefined,
  status?: string | null,
) {
  switch (getPublicRoundPhase({ phase, status })) {
    case "ENTRY_OPEN":
      return "border-emerald-300/30 bg-emerald-300/15 text-emerald-100";
    case "RANDOMIZING":
      return "border-cyan-300/30 bg-cyan-300/15 text-cyan-100";
    case "SPINNING":
      return "border-fuchsia-300/30 bg-fuchsia-300/15 text-fuchsia-100";
    case "RESULT":
      return "border-amber-300/35 bg-amber-300/20 text-amber-100";
    default:
      return "border-white/10 bg-white/[0.06] text-slate-200";
  }
}

function PhasePill({
  phase,
  status,
}: {
  phase?: string | null;
  status?: string | null;
}) {
  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${getPhaseTone(
        phase,
        status,
      )}`}
    >
      {getPhaseLabel(phase, status)}
    </span>
  );
}

export function RockyTopBar({
  backHref,
  roomName,
  roundNumber,
  phase,
  status,
  connectionStatus,
}: {
  backHref: string;
  roomName: string;
  roundNumber?: number | null;
  phase?: string | null;
  status?: string | null;
  connectionStatus: string;
}) {
  const isConnected = connectionStatus === "connected";

  return (
    <header className="sticky top-0 z-30 -mx-3 flex h-12 items-center gap-2 border-b border-white/5 bg-black/35 px-3 text-white backdrop-blur-xl">
      <Link
        href={backHref}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-black/35 text-lg font-black text-white transition active:scale-95"
        aria-label="Back"
      >
        ←
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <h1 className="truncate text-sm font-black leading-tight text-white">
            {roomName}
          </h1>

          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              isConnected ? "bg-emerald-400" : "bg-red-400"
            }`}
            aria-hidden="true"
          />
        </div>

        <p className="truncate text-[11px] font-bold text-slate-400">
          Round #{roundNumber ?? "-"}
        </p>
      </div>

      <PhasePill phase={phase} status={status} />

      <span className="sr-only">Socket {connectionStatus}</span>
    </header>
  );
}

export function ArenaHeroCard(props: {
  categoryName: string;
  roomName: string;
  roundNumber?: number | null;
  phase: string | null | undefined;
  status?: string | null;
  playerCount: number;
  maxPlayers?: number | null;
  totalEntryAmount: string;
  platformFeeAmount: string;
  netPrizeAmount: string;
  platformFeeBps: number;
  msLeft: number;
  msUntilNextRound?: number | null;
}) {
  const {
    categoryName,
    phase,
    status,
    playerCount,
    maxPlayers,
    msLeft,
    msUntilNextRound,
  } = props;

  const publicPhase = getPublicRoundPhase({ phase, status });
  const displayedMaxPlayers = maxPlayers ?? 30;

  const statusText =
    publicPhase === "ENTRY_OPEN"
      ? `Closes ${formatMs(msLeft)}`
      : publicPhase === "RESULT" && typeof msUntilNextRound === "number"
        ? `Next ${formatMs(msUntilNextRound)}`
        : getPhaseLabel(phase, status);

  return (
    <section className="mt-2 rounded-2xl border border-white/10 bg-black/18 px-3 py-2 backdrop-blur-md">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[10px] font-black uppercase tracking-[0.18em] text-[var(--gold)]">
            {categoryName}
          </p>

          <p className="mt-0.5 text-[11px] font-bold text-slate-400">
            {playerCount}/{displayedMaxPlayers} players · {statusText}
          </p>
        </div>

        <PhasePill phase={phase} status={status} />
      </div>
    </section>
  );
}

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
      <style>{`
        .rocky-entry-cta-shine {
          animation: rockyEntryCtaShine 2.2s ease-in-out infinite;
        }

        @keyframes rockyEntryCtaShine {
          0% {
            transform: translateX(-130%) skewX(-18deg);
            opacity: 0;
          }
          18% {
            opacity: 0.45;
          }
          46% {
            opacity: 0.18;
          }
          100% {
            transform: translateX(145%) skewX(-18deg);
            opacity: 0;
          }
        }
      `}</style>

      {!isOpen ? (
        <button
          type="button"
          onClick={onOpen}
className="relative min-h-16 w-full overflow-hidden rounded-2xl border border-sky-200/50 bg-gradient-to-r from-cyan-400 via-sky-500 to-blue-700 px-4 text-center text-lg font-black text-white shadow-[0_18px_38px_rgba(14,165,233,0.36)] transition hover:brightness-110 active:scale-[0.985]"        >
          <span className="pointer-events-none absolute inset-x-4 top-1 h-5 rounded-full bg-white/30 blur-md" />

          <span className="rocky-entry-cta-shine pointer-events-none absolute inset-y-0 left-0 w-20 bg-white/35 blur-sm" />

          <span className="relative z-10 drop-shadow-[0_1px_0_rgba(255,255,255,0.35)]">
            {ctaLabel}
          </span>
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
              className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-lg font-black text-white transition active:scale-95"
              aria-label="Close entry panel"
            >
              ×
            </button>
          </div>

          <div className="max-h-[54vh] overflow-y-auto pb-2 sm:max-h-[65vh]">
            {children}
          </div>
        </div>
      )}
    </div>
  );
}