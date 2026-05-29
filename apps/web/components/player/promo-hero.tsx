import Link from "next/link";
import { ArrowRight, Crown, Sparkles } from "lucide-react";
import { buttonClassName } from "../ui/button";

export function PromoHero({
  primaryHref,
  secondaryHref = "/spinpro",
}: {
  primaryHref: string;
  secondaryHref?: string;
}) {
  return (
    <section className="relative w-full max-w-[100vw] overflow-hidden border-b border-[var(--border)] bg-[linear-gradient(135deg,#0b101b_0%,#111827_42%,#25153a_100%)]">
      <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.045)_1px,transparent_1px)] [background-size:42px_42px]" />
      <div className="mx-auto grid min-h-[520px] w-full max-w-[100vw] items-center gap-8 px-4 pb-12 pt-10 md:max-w-7xl md:grid-cols-[1fr_0.9fr] md:px-8 md:pb-16 md:pt-14">
        <div className="relative z-10 min-w-0 max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-md border border-[rgba(163,230,53,0.35)] bg-[rgba(163,230,53,0.1)] px-3 py-2 text-xs font-black uppercase tracking-[0.16em] text-lime-300">
            <Crown className="h-4 w-4" aria-hidden="true" />
            KingSpin presents SpinPro
          </div>

          <h1 className="mt-6 font-display text-5xl font-black leading-[1.02] tracking-normal text-white md:text-7xl">
            SpinPro
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-text-secondary md:text-lg">
            Pick Pro for flexible ticket ranges or Fixed for equal-chance rooms.
            Browse as a guest, sign in when you are ready to enter.
          </p>

          <div className="mt-7 flex flex-wrap gap-3">
            <Link href={primaryHref} className={buttonClassName("primary")}>
              <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />
              Play now
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </Link>
            <Link href={secondaryHref} className={buttonClassName("ghost")}>
              View rooms
            </Link>
          </div>
        </div>

        <div className="relative z-10 mx-auto h-[320px] w-full min-w-0 max-w-full overflow-hidden rounded-lg md:h-[410px] md:max-w-[420px]">
          <div className="absolute inset-0 rounded-lg border border-[rgba(246,197,71,0.32)] bg-black/20 shadow-[0_30px_80px_rgba(0,0,0,0.42)]" />
          <div className="absolute left-1/2 top-1/2 h-[250px] w-[250px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[10px] border-[#21162d] bg-[conic-gradient(from_20deg,#a3e635_0_12%,#f6c547_12%_25%,#7c3aed_25%_38%,#2dd4bf_38%_50%,#f6c547_50%_62%,#111827_62%_75%,#a3e635_75%_88%,#e879f9_88%_100%)] shadow-[0_0_48px_rgba(246,197,71,0.32)] md:h-[330px] md:w-[330px]" />
          <div className="absolute left-1/2 top-1/2 h-[92px] w-[92px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[rgba(246,197,71,0.6)] bg-[var(--bg-void)] shadow-[0_0_22px_rgba(0,0,0,0.45)]" />
          <div className="absolute left-1/2 top-4 h-0 w-0 -translate-x-1/2 border-x-[18px] border-t-[36px] border-x-transparent border-t-gold drop-shadow-[0_0_12px_rgba(246,197,71,0.5)] md:top-6" />
          <div className="absolute bottom-5 left-4 rounded-md border border-[rgba(45,212,191,0.35)] bg-[rgba(8,12,20,0.78)] px-3 py-2 backdrop-blur md:bottom-7 md:left-7">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-teal">
              Pro
            </p>
            <p className="mt-1 font-mono text-sm font-black">10-350</p>
          </div>
          <div className="absolute right-4 top-5 rounded-md border border-[rgba(232,121,249,0.35)] bg-[rgba(8,12,20,0.78)] px-3 py-2 backdrop-blur md:right-7 md:top-7">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-magenta">
              Fixed
            </p>
            <p className="mt-1 font-mono text-sm font-black">10/20/50</p>
          </div>
        </div>
      </div>
    </section>
  );
}
