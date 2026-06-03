"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useMemo, useState } from "react";
import type { LatestRoundResult } from "@kingspin/contracts";
import { formatCoins, ticketRangeLabel, truncateId } from "../../lib/format";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";

type WinnerRevealProps = {
  isOpen: boolean;
  result: LatestRoundResult | null;
  onClose: () => void;
};

type ResultOutcome =
  | "winner"
  | "skipped-empty"
  | "refunded-single"
  | "cancelled";

function CheckLine({
  label,
  value,
}: {
  label: string;
  value: boolean | null | undefined;
}) {
  const isPending = value === null || value === undefined;

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-white/[0.08] bg-white/[0.05] px-3 py-2">
      <span className="text-text-secondary">{label}</span>
      <span
        className={
          isPending
            ? "font-bold text-text-dim"
            : value
              ? "font-bold text-green-go"
              : "font-bold text-red-hot"
        }
      >
        {isPending ? "PENDING" : value ? "PASS" : "FAIL"}
      </span>
    </div>
  );
}

function ResultStat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg border border-black/10 bg-black/10 p-3">
      <p className="text-xs font-black uppercase tracking-[0.16em] opacity-65">
        {label}
      </p>
      <p
        className={`mt-1 break-all font-mono text-sm font-black ${
          highlight ? "text-[var(--bg-void)]" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function getNoWinnerOutcome(result: LatestRoundResult | null): ResultOutcome {
  if (!result) return "cancelled";
  if (result.entries.length === 0) return "skipped-empty";
  if (result.entries.length === 1) return "refunded-single";

  return "cancelled";
}

function getOutcomeCopy(outcome: ResultOutcome, roundNumber?: number | null) {
  const roundLabel = `Round #${roundNumber ?? "-"} Completed`;

  switch (outcome) {
    case "winner":
      return {
        dialogTitle: "Winner revealed",
        eyebrow: "Winner Revealed",
        title: roundLabel,
        panelLabel: "Winner",
        summary:
          "The wheel reveal is complete and the backend ledger has finalized the round result.",
        primaryValue: null,
        actionLabel: "Continue to next round",
      };

    case "skipped-empty":
      return {
        dialogTitle: "Round skipped",
        eyebrow: "Round Skipped",
        title: roundLabel,
        panelLabel: "Outcome",
        summary:
          "No players joined this round, so the backend skipped it and opened the next round.",
        primaryValue: "No entries",
        actionLabel: "Continue",
      };

    case "refunded-single":
      return {
        dialogTitle: "Entry refunded",
        eyebrow: "Entry Refunded",
        title: roundLabel,
        panelLabel: "Outcome",
        summary:
          "Only one player joined this round, so the backend refunded the entry and opened the next round.",
        primaryValue: "Refunded",
        actionLabel: "Continue",
      };

    case "cancelled":
      return {
        dialogTitle: "Round cancelled",
        eyebrow: "Round Cancelled",
        title: roundLabel,
        panelLabel: "Outcome",
        summary:
          "The backend ended this round without a winner and kept the room moving to the next round.",
        primaryValue: "No winner",
        actionLabel: "Continue",
      };
  }
}

export function WinnerReveal({ isOpen, result, onClose }: WinnerRevealProps) {
  const prefersReducedMotion = useReducedMotion();
  const [copied, setCopied] = useState(false);

  const winnerEntry = result?.winnerEntry;
  const round = result?.round;
  const fairness = result?.fairness;
  const seedReveal = result?.serverSeedReveal;

  // Winner state and no-winner states derive directly from the backend result.
  const hasWinner = Boolean(winnerEntry);
  const outcome: ResultOutcome = hasWinner
    ? "winner"
    : getNoWinnerOutcome(result);
  const outcomeCopy = getOutcomeCopy(outcome, round?.roundNumber);

  const winnerName = useMemo(() => {
    if (!winnerEntry) return "Result loading...";

    return (
      winnerEntry.player?.username ??
      winnerEntry.player?.fullName ??
      truncateId(winnerEntry.userId, 6)
    );
  }, [winnerEntry]);

  // Fairness/proof section: display backend-provided checks only.
  const allFairnessPassed =
    Boolean(fairness?.seedHashMatches) &&
    Boolean(fairness?.winningTicketMatches) &&
    Boolean(fairness?.winnerTicketInsideRange) &&
    Boolean(fairness?.rangesCoverTotal);
  const fairnessBadgeLabel =
    hasWinner && allFairnessPassed
      ? "Verified"
      : !hasWinner && fairness
        ? "Logged"
        : "Checking";

  async function copySeedReveal() {
    if (!seedReveal || !navigator.clipboard) return;

    await navigator.clipboard.writeText(seedReveal);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  // Fairness/proof section: copy only result fields already exposed by backend.
  async function copyRoundProof() {
    if (!result || !navigator.clipboard) return;

    const proof = {
      roundId: result.round.id,
      roundNumber: result.round.roundNumber,
      serverSeedReveal: result.serverSeedReveal,
      serverSeedHash: result.fairness.serverSeedHash,
      winningTicket: result.round.winningTicket,
      winnerEntryId: result.round.winnerEntryId,
      payoutAmount: result.round.payoutAmount,
    };

    await navigator.clipboard.writeText(JSON.stringify(proof, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  // Modal wrapper
  return (
    <Dialog open={isOpen} title={outcomeCopy.dialogTitle} onClose={onClose}>
      <motion.div
        initial={
          prefersReducedMotion ? false : { opacity: 0, y: 18, scale: 0.98 }
        }
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{
          duration: prefersReducedMotion ? 0 : 0.28,
          ease: "easeOut",
        }}
        className="relative overflow-hidden text-text-primary"
      >
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-gold via-teal to-magenta"
          aria-hidden="true"
        />

        <div className="pointer-events-none absolute right-0 top-0 h-40 w-40 rounded-full bg-[rgba(250,204,21,0.12)] blur-3xl" />

        <div className="relative">
          {/* Winner state and skipped/refund/cancelled state header. */}
          <p className="text-sm font-black uppercase tracking-[0.25em] text-gold">
            {outcomeCopy.eyebrow}
          </p>

          <h2 className="mt-2 font-display text-3xl font-black">
            {outcomeCopy.title}
          </h2>

          <p className="mt-2 text-sm text-text-secondary">
            {outcomeCopy.summary}
          </p>

          {/* Winner state / skipped-refund-cancelled states panel. */}
          <div className="mt-5 overflow-hidden rounded-xl border border-[rgba(250,204,21,0.32)] bg-[var(--gold)] text-[var(--bg-void)] shadow-[0_18px_60px_rgba(250,204,21,0.16)]">
            <div className="border-b border-black/10 bg-black/10 px-5 py-3">
              <p className="text-xs font-black uppercase tracking-[0.22em] opacity-70">
                {outcomeCopy.panelLabel}
              </p>
              <p className="mt-1 break-all font-display text-2xl font-black">
                {hasWinner ? winnerName : outcomeCopy.primaryValue}
              </p>
            </div>

            <div className="grid gap-3 p-5 sm:grid-cols-2">
              {hasWinner ? (
                <>
                  <ResultStat
                    label="Entry"
                    value={formatCoins(winnerEntry?.amount)}
                    highlight
                  />
                  <ResultStat
                    label="Payout"
                    value={formatCoins(round?.payoutAmount)}
                    highlight
                  />
                  <ResultStat
                    label="Winning Ticket"
                    value={round?.winningTicket ?? "-"}
                    highlight
                  />
                  <ResultStat
                    label="Ticket Range"
                    value={ticketRangeLabel(
                      winnerEntry?.ticketStart,
                      winnerEntry?.ticketEnd,
                    )}
                    highlight
                  />
                </>
              ) : (
                <>
                  <ResultStat
                    label="Entries"
                    value={result?.entries.length ?? 0}
                    highlight
                  />
                  <ResultStat
                    label={
                      outcome === "refunded-single" ? "Returned" : "Payout"
                    }
                    value={
                      outcome === "refunded-single"
                        ? formatCoins(round?.totalEntryAmount)
                        : formatCoins(round?.payoutAmount)
                    }
                    highlight
                  />
                  <ResultStat
                    label="Total Pool"
                    value={formatCoins(round?.totalEntryAmount)}
                    highlight
                  />
                  <ResultStat
                    label="Winning Ticket"
                    value={round?.winningTicket ?? "-"}
                    highlight
                  />
                </>
              )}
            </div>
          </div>

          {/* Fairness/proof section */}
          <div className="mt-5 rounded-xl border border-[var(--border)] bg-white/[0.03] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-text-dim">
                  Fairness Checks
                </p>
                <p className="mt-1 text-sm text-text-secondary">
                  These checks verify the revealed seed, winning ticket, and
                  ticket ranges.
                </p>
              </div>

              <div
                className={`rounded-full border px-3 py-1 text-xs font-black uppercase tracking-[0.14em] ${
                  allFairnessPassed
                    ? "border-[rgba(74,222,128,0.32)] bg-[rgba(74,222,128,0.1)] text-green-go"
                    : "border-[rgba(148,163,184,0.28)] bg-white/[0.05] text-text-secondary"
                }`}
              >
                {fairnessBadgeLabel}
              </div>
            </div>

            <div className="mt-4 space-y-2 text-sm">
              <CheckLine
                label="Seed hash matches"
                value={fairness?.seedHashMatches}
              />
              <CheckLine
                label="Winning ticket matches"
                value={fairness?.winningTicketMatches}
              />
              <CheckLine
                label="Winner ticket inside range"
                value={fairness?.winnerTicketInsideRange}
              />
              <CheckLine
                label="Ranges cover total"
                value={fairness?.rangesCoverTotal}
              />
            </div>
          </div>

          {/* Fairness/proof section: server seed shows only after backend exposes it. */}
          <div className="mt-5 rounded-xl border border-[var(--border)] bg-white/[0.05] p-4 text-xs text-text-secondary">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-black uppercase tracking-[0.18em] text-text-primary">
                  Fairness seed reveal
                </p>
                <p className="mt-1">
                  Players can copy this seed and verify the draw.
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void copySeedReveal()}
                  disabled={!seedReveal}
                  className="rounded-md border border-[var(--border)] px-3 py-2 font-bold text-gold disabled:text-text-dim"
                >
                  {copied ? "Copied" : "Copy Seed"}
                </button>

                <button
                  type="button"
                  onClick={() => void copyRoundProof()}
                  disabled={!result}
                  className="rounded-md border border-[var(--border)] px-3 py-2 font-bold text-gold disabled:text-text-dim"
                >
                  Copy Proof
                </button>
              </div>
            </div>

            <p className="mt-3 max-h-24 overflow-auto break-all rounded-md bg-black/20 p-3 font-mono">
              {seedReveal ?? "-"}
            </p>
          </div>

          {/* Close/next action */}
          <Button onClick={onClose} className="mt-5 w-full">
            {outcomeCopy.actionLabel}
          </Button>
        </div>
      </motion.div>
    </Dialog>
  );
}
