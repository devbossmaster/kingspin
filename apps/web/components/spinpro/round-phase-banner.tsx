"use client";

type RoundPhaseBannerProps = {
  status: string | null | undefined;
  roundNumber: number | null | undefined;
  totalEntryAmount: string | null | undefined;
  winnerUserId: string | null | undefined;
  winningTicket: string | null | undefined;
};

function getPhaseCopy(status: string | null | undefined) {
  switch (status) {
    case "OPEN":
      return {
        title: "Entry window is open",
        message: "Choose your chip and enter before the timer reaches zero.",
        tone: "border-emerald-400/30 bg-emerald-400/10 text-emerald-100",
      };

    case "LOCKED":
      return {
        title: "Entries locked",
        message: "No more entries. The server is assigning final ticket ranges.",
        tone: "border-yellow-400/30 bg-yellow-400/10 text-yellow-100",
      };

    case "DRAWING":
      return {
        title: "Drawing winner",
        message: "The server is calculating the winning ticket from the committed seed.",
        tone: "border-sky-400/30 bg-sky-400/10 text-sky-100",
      };

    case "SPINNING":
      return {
        title: "Wheel spinning",
        message: "The wheel animation is playing toward the server-selected winner.",
        tone: "border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-100",
      };

    case "SETTLING":
      return {
        title: "Settling payout",
        message: "Ledger payout is being finalized safely and idempotently.",
        tone: "border-orange-400/30 bg-orange-400/10 text-orange-100",
      };

    case "COMPLETED":
      return {
        title: "Round completed",
        message: "Winner selected, payout settled, and fairness proof is available.",
        tone: "border-purple-400/30 bg-purple-400/10 text-purple-100",
      };

    case "CANCELLED":
      return {
        title: "Round cancelled",
        message: "This round did not complete. Any held entries are refunded/skipped safely.",
        tone: "border-red-400/30 bg-red-400/10 text-red-100",
      };

    default:
      return {
        title: "Waiting for round",
        message: "The room machine is preparing the next round.",
        tone: "border-slate-400/20 bg-slate-400/10 text-slate-100",
      };
  }
}

export function RoundPhaseBanner({
  status,
  roundNumber,
  totalEntryAmount,
  winnerUserId,
  winningTicket,
}: RoundPhaseBannerProps) {
  const copy = getPhaseCopy(status);

  return (
    <div className={`mt-5 rounded-2xl border p-4 ${copy.tone}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] opacity-80">
            {status ?? "NO ROUND"}
          </p>
          <h2 className="mt-1 text-lg font-black">{copy.title}</h2>
          <p className="mt-1 text-sm opacity-90">{copy.message}</p>
        </div>

        <div className="rounded-xl bg-black/20 px-3 py-2 text-right text-xs">
          <p>Round #{roundNumber ?? "-"}</p>
          <p>Pool {Number(totalEntryAmount ?? "0").toLocaleString()}</p>
        </div>
      </div>

      {status === "COMPLETED" ? (
        <div className="mt-3 rounded-xl bg-black/20 p-3 text-xs">
          <p>
            Winning ticket:{" "}
            <span className="font-bold">{winningTicket ?? "-"}</span>
          </p>
          <p className="mt-1 break-all">
            Winner user: <span className="font-bold">{winnerUserId ?? "-"}</span>
          </p>
        </div>
      ) : null}
    </div>
  );
}
