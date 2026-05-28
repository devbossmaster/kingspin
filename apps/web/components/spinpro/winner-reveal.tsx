"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useState } from "react";
import type { LatestRoundResult } from "@kingspin/contracts";
import { formatCoins, ticketRangeLabel, truncateId } from "../../lib/format";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";

type WinnerRevealProps = {
  isOpen: boolean;
  result: LatestRoundResult | null;
  onClose: () => void;
};

function CheckLine({
  label,
  value,
}: {
  label: string;
  value: boolean | null | undefined;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-white/[0.05] px-3 py-2">
      <span className="text-text-secondary">{label}</span>
      <span className={value ? "font-bold text-green-go" : "font-bold text-red-hot"}>
        {value ? "PASS" : "FAIL"}
      </span>
    </div>
  );
}

export function WinnerReveal({ isOpen, result, onClose }: WinnerRevealProps) {
  const prefersReducedMotion = useReducedMotion();
  const [copied, setCopied] = useState(false);
  const winnerEntry = result?.winnerEntry;
  const round = result?.round;
  const fairness = result?.fairness;
  const seedReveal = result?.serverSeedReveal;

  async function copySeedReveal() {
    if (!seedReveal || !navigator.clipboard) return;

    await navigator.clipboard.writeText(seedReveal);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Dialog open={isOpen} title="Winner revealed" onClose={onClose}>
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

        <p className="text-sm font-bold uppercase tracking-[0.25em] text-gold">
          Winner Revealed
        </p>

        <h2 className="mt-2 font-display text-3xl font-black">
          Round #{round?.roundNumber ?? "-"} Completed
        </h2>

        <div className="mt-5 rounded-md bg-[var(--gold)] p-5 text-[var(--bg-void)]">
          <p className="text-sm font-bold uppercase opacity-70">Winner</p>
          <p className="mt-1 break-all font-display text-lg font-black">
            {winnerEntry
              ? winnerEntry.player?.username ?? truncateId(winnerEntry.userId, 6)
              : "Loading winner..."}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="font-bold opacity-70">Entry</p>
              <p className="font-mono">{formatCoins(winnerEntry?.amount)}</p>
            </div>
            <div>
              <p className="font-bold opacity-70">Payout</p>
              <p className="font-mono">{formatCoins(round?.payoutAmount)}</p>
            </div>
            <div>
              <p className="font-bold opacity-70">Winning Ticket</p>
              <p className="font-mono">{round?.winningTicket ?? "-"}</p>
            </div>
            <div>
              <p className="font-bold opacity-70">Ticket Range</p>
              <p className="font-mono">
                {ticketRangeLabel(winnerEntry?.ticketStart, winnerEntry?.ticketEnd)}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-5 space-y-2 text-sm">
          <CheckLine label="Seed hash matches" value={fairness?.seedHashMatches} />
          <CheckLine
            label="Winning ticket matches"
            value={fairness?.winningTicketMatches}
          />
          <CheckLine
            label="Winner ticket inside range"
            value={fairness?.winnerTicketInsideRange}
          />
          <CheckLine label="Ranges cover total" value={fairness?.rangesCoverTotal} />
        </div>

        <div className="mt-5 rounded-md bg-white/[0.05] p-3 text-xs text-text-secondary">
          <div className="flex items-center justify-between gap-3">
            <p className="font-bold text-text-primary">Fairness seed reveal</p>
            <button
              type="button"
              onClick={() => void copySeedReveal()}
              disabled={!seedReveal}
              className="rounded-md border border-[var(--border)] px-2 py-1 font-bold text-gold disabled:text-text-dim"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-1 break-all font-mono">{seedReveal ?? "-"}</p>
        </div>

        <Button onClick={onClose} className="mt-5 w-full">
          Continue
        </Button>
      </motion.div>
    </Dialog>
  );
}
