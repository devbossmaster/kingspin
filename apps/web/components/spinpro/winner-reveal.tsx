"use client";

import { motion, useReducedMotion } from "framer-motion";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import type { LatestRoundResult } from "@kingspin/contracts";
import { formatCoins, truncateId } from "../../lib/format";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";

const FALLBACK_REVEAL_DURATION_MS = 8_000;
const LOGO_SRC = "/logo.png";

type WinnerRevealProps = {
  isOpen: boolean;
  result: LatestRoundResult | null;
  onClose: () => void;
  durationMs?: number | null;
  roomName?: string | null;
  roomId?: string | null;
};

type ResultOutcome =
  | "winner"
  | "skipped-empty"
  | "refunded-single"
  | "cancelled";

type UnknownRecord = Record<string, unknown>;

const CONFETTI = Array.from({ length: 18 }, (_, index) => ({
  id: index,
  left: `${6 + ((index * 19) % 88)}%`,
  delay: `${(index % 6) * 0.18}s`,
  duration: `${2.4 + (index % 5) * 0.25}s`,
}));

function asRecord(value: unknown): UnknownRecord | null {
  if (typeof value !== "object" || value === null) return null;

  return value as UnknownRecord;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return null;
}

function getNoWinnerOutcome(result: LatestRoundResult | null): ResultOutcome {
  if (!result) return "cancelled";
  if (result.entries.length === 0) return "skipped-empty";
  if (result.entries.length === 1) return "refunded-single";

  return "cancelled";
}

function getOutcomeLabel(outcome: ResultOutcome) {
  switch (outcome) {
    case "winner":
      return "Champion revealed";
    case "skipped-empty":
      return "No entries";
    case "refunded-single":
      return "Entry refunded";
    case "cancelled":
      return "Round closed";
  }
}

function getRevealDurationMs(durationMs: number | null | undefined) {
  const parsed = Number(durationMs);

  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.max(1_000, parsed);
  }

  return FALLBACK_REVEAL_DURATION_MS;
}

function getRoomLabel(
  result: LatestRoundResult | null,
  fallbackRoomId?: string | null,
) {
  const resultRecord = asRecord(result);
  const roundRecord = asRecord(result?.round);

  const roomRecord =
    asRecord(roundRecord?.room) ??
    asRecord(resultRecord?.room) ??
    asRecord(roundRecord?.gameRoom) ??
    asRecord(resultRecord?.gameRoom);

  return (
    firstString(
      roomRecord?.name,
      roomRecord?.title,
      roomRecord?.code,
      roomRecord?.slug,
      roundRecord?.roomName,
      roundRecord?.roomTitle,
      roundRecord?.roomCode,
      roundRecord?.roomSlug,
      roundRecord?.roomId,
      resultRecord?.roomName,
      resultRecord?.roomTitle,
      resultRecord?.roomCode,
      resultRecord?.roomSlug,
      resultRecord?.roomId,
      fallbackRoomId,
    ) ?? "Spin Battle Room"
  );
}

function getWinnerEntryAmount(
  winnerEntry: LatestRoundResult["winnerEntry"] | null | undefined,
): string | number | null | undefined {
  return winnerEntry?.amount;
}

export function WinnerReveal({
  isOpen,
  result,
  onClose,
  durationMs,
  roomName,
  roomId,
}: WinnerRevealProps) {
  const prefersReducedMotion = useReducedMotion();

  const revealDurationMs = useMemo(
    () => getRevealDurationMs(durationMs),
    [durationMs],
  );

  const [msRemaining, setMsRemaining] = useState(revealDurationMs);

  const winnerEntry = result?.winnerEntry ?? null;
  const round = result?.round ?? null;
  const roundKey = round?.id ?? "pending";

  const hasWinner = Boolean(winnerEntry);
  const outcome: ResultOutcome = hasWinner
    ? "winner"
    : getNoWinnerOutcome(result);

  const outcomeLabel = getOutcomeLabel(outcome);
  const roundLabel = `Round #${round?.roundNumber ?? "-"}`;
  const roomLabel = roomName?.trim() || getRoomLabel(result, roomId);
  const entryCount = result?.entries.length ?? 0;

  const winnerName = useMemo(() => {
    if (!winnerEntry) return outcomeLabel;

    return (
      winnerEntry.player?.username ??
      winnerEntry.player?.fullName ??
      truncateId(winnerEntry.userId, 6)
    );
  }, [outcomeLabel, winnerEntry]);

  const payoutAmount =
    outcome === "refunded-single"
      ? round?.totalEntryAmount
      : round?.payoutAmount;

  const winnerEntryAmount = getWinnerEntryAmount(winnerEntry);

  const progressRatio =
    revealDurationMs > 0
      ? Math.max(0, Math.min(1, msRemaining / revealDurationMs))
      : 0;

  const secondsRemaining = Math.max(0, Math.ceil(msRemaining / 1000));

  useEffect(() => {
    if (!isOpen) return;

    const startedAt = Date.now();

    setMsRemaining(revealDurationMs);

    const progressTimer = window.setInterval(() => {
      const elapsedMs = Date.now() - startedAt;
      setMsRemaining(Math.max(0, revealDurationMs - elapsedMs));
    }, 100);

    const closeTimer = window.setTimeout(() => {
      onClose();
    }, revealDurationMs);

    return () => {
      window.clearInterval(progressTimer);
      window.clearTimeout(closeTimer);
    };
  }, [isOpen, onClose, revealDurationMs, roundKey]);

  return (
    <Dialog
      open={isOpen}
      title={hasWinner ? "Winner revealed" : "Round result"}
      onClose={onClose}
    >
      <motion.div
        initial={
          prefersReducedMotion ? false : { opacity: 0, y: 18, scale: 0.96 }
        }
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{
          duration: prefersReducedMotion ? 0 : 0.28,
          ease: "easeOut",
        }}
        className="-m-6 relative isolate overflow-hidden rounded-lg text-white"
      >
        <div
          className="pointer-events-none absolute inset-0 -z-20 bg-[radial-gradient(circle_at_50%_-10%,rgba(250,204,21,0.34),transparent_36%),radial-gradient(circle_at_12%_24%,rgba(59,130,246,0.28),transparent_34%),radial-gradient(circle_at_90%_26%,rgba(239,68,68,0.24),transparent_30%),linear-gradient(180deg,rgba(15,23,42,0.98),rgba(2,6,23,0.98))]"
          aria-hidden="true"
        />

        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-sky-400 via-amber-300 to-red-500"
          aria-hidden="true"
        />

        {!prefersReducedMotion && hasWinner ? (
          <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
            {CONFETTI.map((piece) => (
              <span
                key={piece.id}
                className="absolute top-[-18px] h-3 w-1.5 rounded-full bg-amber-300/80 shadow-[0_0_18px_rgba(250,204,21,0.75)]"
                style={{
                  left: piece.left,
                  animationDelay: piece.delay,
                  animationDuration: piece.duration,
                  animationName: "winner-confetti-fall",
                  animationIterationCount: "infinite",
                  animationTimingFunction: "linear",
                }}
              />
            ))}
          </div>
        ) : null}

        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/[0.07] text-sm font-black text-white/70 transition hover:bg-white/[0.12] hover:text-white"
          aria-label="Close winner reveal"
        >
          ×
        </button>

        <div className="px-5 pb-5 pt-6 sm:px-6 sm:pb-6">
          <div className="mx-auto grid h-28 w-28 place-items-center rounded-full border border-amber-300/30 bg-black/30 p-2 shadow-[0_0_42px_rgba(250,204,21,0.18)] sm:h-32 sm:w-32">
            <Image
              src={LOGO_SRC}
              alt="Spin Battle"
              width={160}
              height={160}
              priority
              className="h-full w-full object-contain drop-shadow-[0_12px_24px_rgba(0,0,0,0.8)]"
            />
          </div>

          <div className="mt-5 text-center">
            <p className="text-[11px] font-black uppercase tracking-[0.28em] text-amber-300">
              {outcomeLabel}
            </p>

            <h2 className="mx-auto mt-2 max-w-[22rem] break-words font-display text-4xl font-black uppercase leading-none tracking-tight text-white drop-shadow-[0_4px_0_rgba(0,0,0,0.55)] sm:text-5xl">
              {winnerName}
            </h2>

            <p className="mx-auto mt-3 max-w-sm text-sm font-bold text-slate-300">
              {hasWinner
                ? "The wheel has spoken. The crown goes to the battle champion."
                : outcome === "refunded-single"
                  ? "Only one player joined, so the entry was safely returned."
                  : "This battle ended without a winner."}
            </p>
          </div>

          <div className="mt-5 rounded-2xl border border-amber-300/25 bg-gradient-to-br from-amber-300/18 via-orange-500/12 to-red-500/10 p-4 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-200/90">
              Payout
            </p>

            <p className="mt-1 truncate font-mono text-4xl font-black text-amber-300 drop-shadow-[0_0_18px_rgba(250,204,21,0.35)]">
              {formatCoins(payoutAmount)}
            </p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-white/10 bg-white/[0.06] px-3 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                Room
              </p>
              <p className="mt-1 truncate text-sm font-black text-white">
                {roomLabel}
              </p>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.06] px-3 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                Round
              </p>
              <p className="mt-1 truncate font-mono text-sm font-black text-white">
                {roundLabel}
              </p>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.06] px-3 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                Players
              </p>
              <p className="mt-1 font-mono text-sm font-black text-white">
                {entryCount}
              </p>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.06] px-3 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                Pool
              </p>
              <p className="mt-1 truncate font-mono text-sm font-black text-white">
                {formatCoins(round?.totalEntryAmount)}
              </p>
            </div>
          </div>

          {hasWinner ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-sky-300/15 bg-sky-400/[0.08] px-3 py-3">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-sky-200/80">
                  Winner entry
                </p>
                <p className="mt-1 truncate font-mono text-sm font-black text-sky-100">
                  {formatCoins(winnerEntryAmount)}
                </p>
              </div>

              <div className="rounded-xl border border-red-300/15 bg-red-400/[0.08] px-3 py-3">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-red-200/80">
                  Next battle
                </p>
                <p className="mt-1 font-mono text-sm font-black text-red-100">
                  {secondsRemaining}s
                </p>
              </div>
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-3">
              <div className="flex items-center justify-between gap-4">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                  Next battle
                </p>
                <p className="font-mono text-sm font-black text-white">
                  {secondsRemaining}s
                </p>
              </div>
            </div>
          )}

          <div className="mt-5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-2 rounded-full bg-gradient-to-r from-sky-400 via-amber-300 to-red-500 transition-[width] duration-100 ease-linear"
              style={{ width: `${progressRatio * 100}%` }}
            />
          </div>

          <Button onClick={onClose} className="mt-5 min-h-12 w-full text-base">
            Continue to next battle
          </Button>
        </div>

        <style jsx>{`
          @keyframes winner-confetti-fall {
            0% {
              transform: translate3d(0, -20px, 0) rotate(0deg);
              opacity: 0;
            }

            12% {
              opacity: 1;
            }

            100% {
              transform: translate3d(24px, 560px, 0) rotate(540deg);
              opacity: 0;
            }
          }
        `}</style>
      </motion.div>
    </Dialog>
  );
}