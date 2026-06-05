import type { DepositStatus } from "@kingspin/contracts";

function titleCase(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function DepositStatusBadge({ status }: { status: DepositStatus }) {
  const positive = status === "CREDITED" || status === "CONFIRMED";
  const waiting =
    status === "PENDING" ||
    status === "VERIFYING" ||
    status === "NEEDS_MANUAL_REVIEW";

  return (
    <span
      className={`inline-flex min-h-7 items-center rounded-md border px-2 text-[11px] font-black uppercase ${
        positive
          ? "border-lime-300/35 bg-lime-400/10 text-lime-200"
          : waiting
            ? "border-yellow-300/35 bg-yellow-400/10 text-yellow-200"
            : "border-red-300/35 bg-red-500/10 text-red-200"
      }`}
    >
      {titleCase(status)}
    </span>
  );
}
