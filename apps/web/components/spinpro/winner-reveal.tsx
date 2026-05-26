"use client";

import type { LatestRoundResult } from "@kingspin/contracts";

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
    <div className="flex items-center justify-between gap-3 rounded-xl bg-white/5 px-3 py-2">
      <span className="text-slate-300">{label}</span>
      <span
        className={
          value
            ? "font-bold text-emerald-300"
            : "font-bold text-red-300"
        }
      >
        {value ? "PASS" : "FAIL"}
      </span>
    </div>
  );
}

export function WinnerReveal({ isOpen, result, onClose }: WinnerRevealProps) {
  if (!isOpen) return null;

  const winnerEntry = result?.winnerEntry;
  const round = result?.round;
  const fairness = result?.fairness;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-lg rounded-3xl border border-yellow-400/40 bg-slate-950 p-6 text-white shadow-2xl">
        <p className="text-sm font-bold uppercase tracking-[0.25em] text-yellow-300">
          Winner Revealed
        </p>

        <h2 className="mt-2 text-3xl font-black">
          Round #{round?.roundNumber ?? "-"} Completed
        </h2>

        <div className="mt-5 rounded-2xl bg-yellow-400 p-5 text-slate-950">
          <p className="text-sm font-bold uppercase opacity-70">Winner</p>
          <p className="mt-1 break-all text-lg font-black">
            {winnerEntry?.player?.username ?? winnerEntry?.userId ?? "Loading winner..."}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="font-bold opacity-70">Entry</p>
              <p>{winnerEntry?.amount ?? "-"}</p>
            </div>
            <div>
              <p className="font-bold opacity-70">Payout</p>
              <p>{round?.payoutAmount ?? "-"}</p>
            </div>
            <div>
              <p className="font-bold opacity-70">Winning Ticket</p>
              <p>{round?.winningTicket ?? "-"}</p>
            </div>
            <div>
              <p className="font-bold opacity-70">Ticket Range</p>
              <p>
                {winnerEntry?.ticketStart ?? "-"}–{winnerEntry?.ticketEnd ?? "-"}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-5 space-y-2 text-sm">
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

        <div className="mt-5 rounded-2xl bg-white/5 p-3 text-xs text-slate-400">
          <p className="font-bold text-slate-300">Fairness seed reveal</p>
          <p className="mt-1 break-all">{result?.serverSeedReveal ?? "-"}</p>
        </div>

        <button
          onClick={onClose}
          className="mt-5 w-full rounded-xl bg-yellow-400 px-5 py-3 font-black text-slate-950 hover:bg-yellow-300"
        >
          Continue
        </button>
      </div>
    </div>
  );
}


