"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import type { LatestRoundResult } from "@kingspin/contracts";
import { formatCoins } from "../../lib/format";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { getPlayerDisplayName } from "./player-display";

const FALLBACK_REVEAL_DURATION_MS = 8_000;

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

function asRecord(value: unknown): UnknownRecord | null {
  if (typeof value !== "object" || value === null) return null;

  return value as UnknownRecord;
}

function firstFiniteNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = Number(value);

    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

function formatMultiplier(value: number) {
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2)}x`;
}

function getMultiplierLabel(result: LatestRoundResult | null) {
  const resultRecord = asRecord(result);
  const roundRecord = asRecord(result?.round);
  const multiplier = firstFiniteNumber(
    resultRecord?.multiplier,
    resultRecord?.payoutMultiplier,
    resultRecord?.winnerMultiplier,
    roundRecord?.multiplier,
    roundRecord?.payoutMultiplier,
  );

  return multiplier ? formatMultiplier(multiplier) : null;
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
      return "Winner";
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

function getPayoutAmount(
  outcome: ResultOutcome,
  round: LatestRoundResult["round"] | null,
) {
  return outcome === "refunded-single"
    ? round?.totalEntryAmount
    : round?.payoutAmount;
}

export function WinnerReveal({
  isOpen,
  result,
  onClose,
  durationMs,
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
  const winnerName = winnerEntry
    ? getPlayerDisplayName(winnerEntry)
    : outcomeLabel;
  const payoutAmount = getPayoutAmount(outcome, round);
  const multiplierLabel = getMultiplierLabel(result);

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
      panelClassName="max-w-sm overflow-hidden rounded-2xl border border-white/10 bg-slate-950 p-0 text-white shadow-2xl"
    >
      <motion.div
        initial={
          prefersReducedMotion ? false : { opacity: 0, y: 14, scale: 0.97 }
        }
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{
          duration: prefersReducedMotion ? 0 : 0.24,
          ease: "easeOut",
        }}
        className="relative isolate overflow-hidden px-5 pb-5 pt-6 text-white"
      >
        <div
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_-10%,rgba(250,204,21,0.24),transparent_42%),linear-gradient(180deg,rgba(15,23,42,0.98),rgba(2,6,23,0.98))]"
          aria-hidden="true"
        />

        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-sm font-black text-white/70 transition hover:bg-white/[0.12] hover:text-white"
          aria-label="Close winner reveal"
        >
          x
        </button>

        <div className="text-center">
          <p className="text-[11px] font-black uppercase tracking-[0.24em] text-amber-300">
            {outcomeLabel}
          </p>

          <h2 className="mx-auto mt-2 max-w-[17rem] break-words font-display text-3xl font-black uppercase leading-none text-white sm:text-4xl">
            {winnerName}
          </h2>
        </div>

        <div className="mt-5 rounded-xl border border-amber-300/25 bg-amber-300/10 p-4 text-center">
          <div className="flex items-center justify-center gap-2">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-200/90">
              Winner Gets
            </p>
            {multiplierLabel ? (
              <span className="rounded-full border border-amber-200/30 bg-amber-200/15 px-2 py-0.5 font-mono text-[10px] font-black text-amber-100">
                {multiplierLabel}
              </span>
            ) : null}
          </div>

          <p className="mt-1 truncate font-mono text-4xl font-black text-amber-300">
            {formatCoins(payoutAmount)}
          </p>
          {round && outcome === "winner" ? (
            <p className="mt-2 text-xs font-semibold text-amber-100/75">
              Pool {formatCoins(round.grossPoolAmount)} · Fee{" "}
              {formatCoins(round.platformFeeAmount)} · Net{" "}
              {formatCoins(round.netPrizeAmount)}
            </p>
          ) : null}
        </div>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between gap-3 text-xs font-black uppercase tracking-[0.14em] text-slate-300">
            <span>Next round</span>
            <span className="font-mono text-white">{secondsRemaining}s</span>
          </div>
          <div className="overflow-hidden rounded-full bg-white/10">
            <div
              className="h-2 rounded-full bg-gradient-to-r from-sky-400 via-amber-300 to-red-500 transition-[width] duration-100 ease-linear"
              style={{ width: `${progressRatio * 100}%` }}
            />
          </div>
        </div>

        <Button onClick={onClose} className="mt-5 min-h-11 w-full text-sm">
          Continue
        </Button>
      </motion.div>
    </Dialog>
  );
}
