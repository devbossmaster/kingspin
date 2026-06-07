"use client";

import { Check, Copy, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { LatestRoundResult, LiveRoundSnapshot } from "@kingspin/contracts";
import { verifyCompletedFairness } from "../../lib/fairness-verifier";
import { truncateId } from "../../lib/format";
import { Badge } from "../ui/badge";

function CheckBadge({ label, value }: { label: string; value?: boolean }) {
  return (
    <Badge variant={value ? "success" : "danger"}>
      {label}: {value ? "PASS" : "FAIL"}
    </Badge>
  );
}

function ProofValue({
  label,
  value,
  hiddenText,
  copied,
  onCopy,
}: {
  label: string;
  value: string | null | undefined;
  hiddenText?: string;
  copied: string | null;
  onCopy: (label: string, value: string) => void;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
        {label}
      </p>
      <div className="mt-1 flex items-start gap-2">
        <p className="min-w-0 flex-1 break-all font-mono text-xs leading-5 text-slate-300">
          {value ?? hiddenText ?? "-"}
        </p>
        {value ? (
          <button
            type="button"
            onClick={() => onCopy(label, value)}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/10 text-slate-400 transition hover:border-teal/40 hover:text-teal"
            aria-label={`Copy ${label}`}
            title={`Copy ${label}`}
          >
            {copied === label ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
        ) : null}
      </div>
    </div>
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
  const [copied, setCopied] = useState<string | null>(null);
  const [verification, setVerification] = useState<
    "idle" | "checking" | "passed" | "failed"
  >("idle");
  const fairness = latestResult?.fairness;
  const seedHash =
    currentRound?.serverSeedHash ?? latestResult?.round.serverSeedHash;
  const algorithm =
    currentRound?.fairnessAlgorithm ?? fairness?.algorithm ?? null;
  const seedReveal = latestResult?.serverSeedReveal;

  async function copyValue(label: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1_500);
  }

  async function verifyProof() {
    if (!latestResult) return;
    setVerification("checking");

    try {
      const result = await verifyCompletedFairness(latestResult);
      setVerification(result.verified ? "passed" : "failed");
    } catch {
      setVerification("failed");
    }
  }

  return (
    <section className="mt-3 rounded-2xl border border-teal/20 bg-teal/[0.05] p-4">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-between gap-3 text-left"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-teal/10 text-teal">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-teal">
              Provably fair
            </p>
            <p className="mt-1 font-mono text-xs text-text-secondary">
              Seed hash {truncateId(seedHash, 8)}
            </p>
          </div>
        </div>
        <span className="font-mono text-sm text-gold">
          {expanded ? "-" : "+"}
        </span>
      </button>

      {expanded ? (
        <div className="mt-4 space-y-3">
          <ProofValue
            label="Algorithm"
            value={algorithm}
            copied={copied}
            onCopy={copyValue}
          />
          <ProofValue
            label="Seed hash"
            value={seedHash}
            copied={copied}
            onCopy={copyValue}
          />
          <ProofValue
            label="Current entries hash"
            value={currentRound?.entriesHash}
            hiddenText="Committed when entries lock"
            copied={copied}
            onCopy={copyValue}
          />

          {fairness ? (
            <>
              <div className="border-t border-white/10 pt-3">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                  Latest completed round
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <CheckBadge label="Seed" value={fairness.seedHashMatches} />
                <CheckBadge
                  label="Entries"
                  value={fairness.entriesHashMatches}
                />
                <CheckBadge label="Draw" value={fairness.drawHashMatches} />
                <CheckBadge
                  label="Ticket"
                  value={fairness.winningTicketMatches}
                />
                <CheckBadge
                  label="Range"
                  value={fairness.winnerTicketInsideRange}
                />
              </div>
              <ProofValue
                label="Server seed"
                value={seedReveal}
                hiddenText="Hidden until completion"
                copied={copied}
                onCopy={copyValue}
              />
              <ProofValue
                label="Entries hash"
                value={fairness.entriesHash}
                copied={copied}
                onCopy={copyValue}
              />
              <ProofValue
                label="Winning ticket"
                value={fairness.winningTicket}
                copied={copied}
                onCopy={copyValue}
              />
              <button
                type="button"
                onClick={() => void verifyProof()}
                disabled={!seedReveal || verification === "checking"}
                className="min-h-11 w-full rounded-xl bg-teal px-4 text-sm font-black text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {verification === "checking"
                  ? "Verifying..."
                  : verification === "passed"
                    ? "Verified independently"
                    : verification === "failed"
                      ? "Verification failed"
                      : "Verify completed result"}
              </button>
            </>
          ) : (
            <p className="text-sm text-text-secondary">
              The seed stays hidden while the round is active. Full proof checks
              appear after completion.
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
