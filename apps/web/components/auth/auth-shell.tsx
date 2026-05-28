"use client";

import { motion } from "framer-motion";
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
    <main className="min-h-screen px-4 py-8 text-text-primary">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-5xl items-center justify-center">
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="arcadia-surface grid w-full overflow-hidden rounded-lg md:grid-cols-[0.85fr_1fr]"
        >
          <div className="border-b border-[var(--border)] bg-[var(--bg-raised)]/70 p-6 md:border-b-0 md:border-r md:p-8">
            <Link
              href="/spinpro"
              className="inline-flex items-center rounded-md border border-[var(--border-glow)] px-3 py-2 text-sm font-bold text-gold transition hover:border-[var(--gold)]"
            >
              SpinPro
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
