"use client";

import { useEffect } from "react";
import { toastGameError } from "../lib/error-toast";
import { toHumanErrorMessage } from "../lib/human-error";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const message = toHumanErrorMessage(
    error,
    "The game hit a temporary problem.",
  );

  useEffect(() => {
    toastGameError(error, "The game hit a temporary problem.");
  }, [error]);

  return (
    <main className="rocky-room flex min-h-screen items-center justify-center px-4 text-white">
      <section className="rocky-glass w-full max-w-[430px] rounded-[28px] p-6 text-center">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-[var(--gold)]">
          Game paused
        </p>
        <h1 className="mt-2 text-3xl font-black">Let us try that again</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">{message}</p>
        <button
          type="button"
          onClick={reset}
          className="mt-5 min-h-12 w-full rounded-2xl bg-indigo-500 px-4 text-sm font-black text-white shadow-[0_18px_40px_rgba(99,102,241,0.35)] transition active:scale-[0.99]"
        >
          Reload game screen
        </button>
      </section>
    </main>
  );
}
