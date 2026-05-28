"use client";

import { useState } from "react";
import type { LatestRoundResult, LiveRoundSnapshot } from "@kingspin/contracts";
import { truncateId } from "../../lib/format";
import { Badge } from "../ui/badge";

function CheckBadge({ label, value }: { label: string; value?: boolean }) {
  return (
    <Badge variant={value ? "success" : "danger"}>
      {label}: {value ? "PASS" : "FAIL"}
    </Badge>
  );
}

export function FairnessStrip({
  currentRound,
  latestResult,
}: {
  currentRound: LiveRoundSnapshot | null | undefined;
  latestResult: LatestRoundResult | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const fairness = latestResult?.fairness;
  const seedHash = latestResult?.round.serverSeedHash ?? currentRound?.serverSeedHash;
  const seedReveal = latestResult?.serverSeedReveal;

  return (
    <section className="mt-5 rounded-lg border border-[var(--border)] bg-white/[0.04] p-4">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-between gap-3 text-left"
        aria-expanded={expanded}
      >
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-teal">
            Fairness proof
          </p>
          <p className="mt-1 font-mono text-xs text-text-secondary">
            Seed hash {truncateId(seedHash, 8)}
          </p>
        </div>
        <span className="font-mono text-sm text-gold">{expanded ? "-" : "+"}</span>
      </button>

      {expanded ? (
        <div className="mt-4 space-y-3">
          {fairness ? (
            <div className="flex flex-wrap gap-2">
              <CheckBadge label="Seed" value={fairness.seedHashMatches} />
              <CheckBadge label="Ticket" value={fairness.winningTicketMatches} />
              <CheckBadge
                label="Inside range"
                value={fairness.winnerTicketInsideRange}
              />
              <CheckBadge label="Ranges" value={fairness.rangesCoverTotal} />
            </div>
          ) : (
            <p className="text-sm text-text-secondary">
              Proof checks appear after the latest completed round.
            </p>
          )}

          <div className="rounded-md bg-[var(--bg-raised)] p-3 font-mono text-xs text-text-secondary">
            <p>Server seed hash: {seedHash ?? "-"}</p>
            <p className="mt-2 break-all">
              Server seed reveal: {seedReveal ?? "Hidden until completion"}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
