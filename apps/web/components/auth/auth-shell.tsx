"use client";

import { motion } from "framer-motion";
import { CircleDollarSign, Sparkles } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

type AuthShellProps = {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
};

export function AuthShell({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
}: AuthShellProps) {
  return (
    <main className="min-h-screen bg-[linear-gradient(135deg,#080C14_0%,#111827_48%,#241337_100%)] px-4 py-8 text-text-primary">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-5xl items-center justify-center">
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="grid w-full overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-card)] shadow-[0_28px_80px_rgba(0,0,0,0.42)] md:grid-cols-[0.9fr_1fr]"
        >
          <div className="relative overflow-hidden border-b border-[var(--border)] bg-[var(--bg-raised)]/80 p-6 md:border-b-0 md:border-r md:p-8">
            <div className="pointer-events-none absolute inset-0 opacity-35 [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.045)_1px,transparent_1px)] [background-size:36px_36px]" />
            <div className="relative">
              <Link
                href="/"
                className="inline-flex items-center gap-2 rounded-md border border-[var(--border-glow)] px-3 py-2 text-sm font-bold text-gold transition hover:border-[var(--gold)]"
              >
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                KingSpin
              </Link>
              <p className="mt-8 text-xs font-black uppercase tracking-[0.18em] text-teal">
                {eyebrow}
              </p>
              <h1 className="mt-3 font-display text-3xl font-black tracking-normal text-text-primary md:text-4xl">
                {title}
              </h1>
              <p className="mt-4 max-w-sm text-sm leading-6 text-text-secondary">
                {subtitle}
              </p>

              <div className="mt-8 flex justify-center">
                <div className="relative h-44 w-44">
                  <div className="absolute inset-0 rounded-full border-[8px] border-[#21162d] bg-[conic-gradient(from_15deg,#a3e635_0_16%,#f6c547_16%_32%,#7c3aed_32%_48%,#2dd4bf_48%_64%,#f6c547_64%_82%,#e879f9_82%_100%)] shadow-[0_0_36px_rgba(246,197,71,0.25)]" />
                  <div className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[rgba(246,197,71,0.55)] bg-[var(--bg-void)]">
                    <CircleDollarSign
                      className="h-8 w-8 text-gold"
                      aria-hidden="true"
                    />
                  </div>
                  <div className="absolute left-1/2 top-0 h-0 w-0 -translate-x-1/2 border-x-[12px] border-t-[26px] border-x-transparent border-t-gold" />
                </div>
              </div>
            </div>
          </div>

          <div className="p-6 md:p-8">
            {children}
            <div className="mt-6 border-t border-[var(--border)] pt-5 text-sm text-text-secondary">
              {footer}
            </div>
          </div>
        </motion.section>
      </div>
    </main>
  );
}

export function FormMessage({
  tone,
  children,
}: {
  tone: "error" | "success" | "info";
  children: ReactNode;
}) {
  const className =
    tone === "error"
      ? "border-[rgba(248,113,113,0.42)] bg-[rgba(248,113,113,0.12)] text-red-hot"
      : tone === "success"
        ? "border-[rgba(74,222,128,0.38)] bg-[rgba(74,222,128,0.12)] text-green-go"
        : "border-[rgba(45,212,191,0.38)] bg-[rgba(45,212,191,0.12)] text-teal";

  return (
    <div
      className={`rounded-md border px-3 py-2 text-sm ${className}`}
      aria-live="polite"
    >
      {children}
    </div>
  );
}

export const authInputClass =
  "mt-2 w-full rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-3 text-sm text-text-primary outline-none transition placeholder:text-text-dim focus:border-[var(--gold)] focus-visible:ring-2 focus-visible:ring-[rgba(246,197,71,0.35)]";

export const authButtonClass =
  "inline-flex w-full items-center justify-center rounded-md border border-[var(--gold)] bg-[var(--gold)] px-4 py-3 text-sm font-black text-[var(--bg-void)] shadow-[var(--glow-gold)] transition hover:bg-[#FFD76A] disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-800 disabled:text-slate-500";
