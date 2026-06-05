import type { DepositSnapshot } from "@kingspin/contracts";
import { truncateId } from "../../lib/format";
import { DepositStatusBadge } from "./deposit-status";

function titleCase(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function DepositCard({
  deposit,
  formatAmount,
}: {
  deposit: DepositSnapshot;
  formatAmount: (value: string) => string;
}) {
  return (
    <div className="grid gap-3 rounded-lg border border-white/10 bg-black/25 p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
      <div className="min-w-0">
        <p className="truncate text-sm font-black text-white">
          {titleCase(deposit.provider)} deposit
        </p>
        <p className="mt-1 text-xs font-semibold text-slate-500">
          {formatDate(deposit.createdAt)} / {truncateId(deposit.id, 5)}
        </p>
        {deposit.receiptNo ? (
          <p className="mt-1 text-xs font-semibold text-slate-500">
            Receipt {truncateId(deposit.receiptNo, 4)}
          </p>
        ) : null}
      </div>
      <DepositStatusBadge status={deposit.status} />
      <p className="font-mono text-sm font-black text-lime-300">
        +{formatAmount(deposit.amount)}
      </p>
    </div>
  );
}
