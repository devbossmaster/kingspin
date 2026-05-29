import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, BadgeDollarSign, Equal, Sparkles } from "lucide-react";
import type { PlayerMode } from "../../lib/game-modes";
import { getModeTag, getModeTitle } from "../../lib/game-modes";
import { StatusPill } from "./status-pill";

const modeCopy: Record<
  PlayerMode,
  { icon: LucideIcon; tone: "lime" | "purple"; body: string; accent: string }
> = {
  pro: {
    icon: BadgeDollarSign,
    tone: "lime",
    body: "Choose your amount while the round is open. Bigger entries receive a bigger ticket range.",
    accent: "from-lime-300/20 via-transparent to-gold/10",
  },
  fixed: {
    icon: Equal,
    tone: "purple",
    body: "Pick the fixed entry room. Every accepted player has one equal chance in the spin.",
    accent: "from-magenta/20 via-transparent to-teal/10",
  },
};

export function ModeCard({ mode, href }: { mode: PlayerMode; href: string }) {
  const copy = modeCopy[mode];
  const Icon = copy.icon;

  return (
    <Link
      href={href}
      className="group relative min-h-[190px] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-5 transition hover:border-[var(--border-glow)] hover:bg-[var(--bg-raised)]"
    >
      <div
        className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${copy.accent}`}
      />
      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-md border border-white/10 bg-black/25">
            <Icon className="h-5 w-5 text-gold" aria-hidden="true" />
          </div>
          <StatusPill tone={copy.tone}>{getModeTag(mode)}</StatusPill>
        </div>

        <h3 className="mt-5 font-display text-2xl font-black">
          {getModeTitle(mode)}
        </h3>
        <p className="mt-2 text-sm leading-6 text-text-secondary">
          {copy.body}
        </p>

        <div className="mt-5 inline-flex items-center gap-2 rounded-md bg-[var(--gold)] px-3 py-2 text-sm font-black text-[var(--bg-void)]">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          Browse
          <ArrowRight
            className="h-4 w-4 transition group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </div>
      </div>
    </Link>
  );
}
