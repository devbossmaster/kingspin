import { formatCoins } from "../../lib/format";

export function PoolStat({
  label,
  value,
  caption,
}: {
  label: string;
  value: string | number | null | undefined;
  caption?: string;
}) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-white/[0.04] p-4">
      <p className="text-sm text-text-secondary">{label}</p>
      <p className="mt-1 font-mono text-2xl font-black">{formatCoins(value)}</p>
      {caption ? <p className="text-sm text-text-secondary">{caption}</p> : null}
    </div>
  );
}
