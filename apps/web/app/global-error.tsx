"use client";

import { useEffect } from "react";
import { Toaster } from "sonner";
import { toastGameError } from "../lib/error-toast";
import { toHumanErrorMessage } from "../lib/human-error";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const message = toHumanErrorMessage(
    error,
    "The app hit a temporary problem.",
  );

  useEffect(() => {
    toastGameError(error, "The app hit a temporary problem.");
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-white">
          <section className="w-full max-w-[430px] rounded-[28px] border border-white/10 bg-white/[0.06] p-6 text-center shadow-[0_18px_70px_rgba(0,0,0,0.45)]">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-yellow-300">
              Spin Battle
            </p>
            <h1 className="mt-2 text-3xl font-black">We need a quick reset</h1>
            <p className="mt-3 text-sm leading-6 text-slate-300">{message}</p>
            <button
              type="button"
              onClick={reset}
              className="mt-5 min-h-12 w-full rounded-2xl bg-indigo-500 px-4 text-sm font-black text-white"
            >
              Try again
            </button>
          </section>
          <Toaster closeButton richColors position="top-center" theme="dark" />
        </main>
      </body>
    </html>
  );
}
