import type { LucideIcon } from "lucide-react";

export function AdminStatCard({
  label,
  value,
  icon: Icon,
  tone = "green",
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone?: "green" | "blue" | "gold" | "red";
}) {
  const tones = {
    green: "border-emerald-400/20 text-emerald-300",
    blue: "border-sky-400/20 text-sky-300",
    gold: "border-amber-300/20 text-amber-200",
    red: "border-red-400/20 text-red-300",
  };
  return (
    <div
      className={`rounded-2xl border bg-[linear-gradient(145deg,#101e29,#0b151d)] p-4 shadow-[0_18px_45px_rgba(0,0,0,0.18)] ${tones[tone]}`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold uppercase text-slate-500">{label}</p>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <p className="mt-3 font-mono text-2xl font-black text-white">{value}</p>
    </div>
  );
}
