import { clsx } from "clsx";
import { formatCoins } from "../../lib/format";

export function Chip({
  amount,
  selected,
  onSelect,
}: {
  amount: number;
  selected: boolean;
  onSelect: (amount: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(amount)}
      aria-pressed={selected}
      className={clsx(
        "min-h-10 rounded-md border px-3 py-2 font-mono text-sm font-bold transition",
        selected
          ? "border-[var(--gold)] bg-[var(--gold)] text-[var(--bg-void)] shadow-[var(--glow-gold)]"
          : "border-[var(--border)] bg-white/[0.04] text-text-secondary hover:border-[var(--border-glow)] hover:text-text-primary",
      )}
    >
      {formatCoins(amount)}
    </button>
  );
}
