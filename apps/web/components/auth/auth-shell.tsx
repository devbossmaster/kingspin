"use client";

import { motion } from "framer-motion";
import Image from "next/image";
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
    <main className="relative min-h-screen overflow-hidden bg-[#030713] px-4 py-6 font-sans text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_28%_18%,rgba(37,99,235,0.42),transparent_28%),radial-gradient(circle_at_82%_32%,rgba(59,130,246,0.24),transparent_30%),radial-gradient(circle_at_64%_88%,rgba(14,165,233,0.18),transparent_28%),linear-gradient(145deg,#07142c_0%,#050816_42%,#02030a_100%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-70">
        <div className="absolute -left-28 top-[28%] h-px w-[145%] -rotate-[17deg] bg-[linear-gradient(90deg,transparent,rgba(59,130,246,0.85),rgba(14,165,233,0.55),transparent)]" />
        <div className="absolute -left-24 top-[36%] h-1 w-[135%] -rotate-[17deg] rounded-full bg-[linear-gradient(90deg,transparent,rgba(29,78,216,0.8),rgba(147,197,253,0.52),transparent)] blur-[1px]" />
        <div className="absolute -left-20 top-[46%] h-px w-[125%] -rotate-[17deg] bg-[linear-gradient(90deg,transparent,rgba(56,189,248,0.58),rgba(37,99,235,0.72),transparent)]" />
      </div>

      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="relative mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-[520px] flex-col items-center justify-center"
      >
        <Link href="/" className="mb-8 inline-flex justify-center">
          <Image
            src="/logo.png"
            alt="Spin Battle"
            width={260}
            height={120}
            priority
            className="h-auto w-[190px] object-contain drop-shadow-[0_18px_42px_rgba(37,99,235,0.42)] sm:w-[230px]"
          />
        </Link>

        <div className="w-full rounded-[22px] border border-blue-300/[0.12] bg-[#050917]/80 p-5 shadow-[0_24px_70px_rgba(0,0,0,0.52)] backdrop-blur-xl sm:p-7">
          <div className="mb-6 text-center">
            <p className="text-[15px] font-black uppercase tracking-[0.22em] text-blue-200/70">
              {eyebrow}
            </p>
            <h1 className="mt-2 text-2xl font-black uppercase tracking-normal text-white sm:text-3xl">
              {title}
            </h1>
            <p className="mt-3 text-sm font-semibold leading-6 text-slate-400">
              {subtitle}
            </p>
            <div className="mt-3 text-sm font-semibold text-slate-400 [&_a]:!text-sky-300 hover:[&_a]:!text-white">
              {footer}
            </div>
          </div>

          {children}
        </div>
      </motion.section>
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
      ? "border-red-400/35 bg-red-500/10 text-red-200"
      : tone === "success"
        ? "border-emerald-300/35 bg-emerald-400/10 text-emerald-100"
        : "border-sky-300/35 bg-sky-400/10 text-sky-100";

  return (
    <div
      className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${className}`}
      aria-live="polite"
    >
      {children}
    </div>
  );
}

export const authInputClass =
  "mt-2 w-full rounded-2xl border border-blue-300/15 bg-[#081326]/90 px-4 py-4 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_14px_30px_rgba(0,0,0,0.22)] outline-none transition placeholder:text-slate-500 focus:border-sky-300/75 focus:bg-[#0b1934] focus:ring-4 focus:ring-blue-500/20";

export const authButtonClass =
  "inline-flex w-full items-center justify-center rounded-full border border-blue-300/20 bg-[linear-gradient(90deg,#020617_0%,#0f2a66_34%,#2563eb_72%,#38bdf8_100%)] px-5 py-4 text-base font-black uppercase tracking-[0.08em] text-white shadow-[0_18px_36px_rgba(37,99,235,0.28)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55";
