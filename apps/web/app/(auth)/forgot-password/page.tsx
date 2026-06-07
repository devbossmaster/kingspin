"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import {
  AuthShell,
  FormMessage,
  authButtonClass,
  authInputClass,
} from "../../../components/auth/auth-shell";
import { requestPasswordReset } from "../../../lib/auth-client";

const NEUTRAL_SUCCESS =
  "If an account exists for that email, we sent reset instructions.";

export default function ForgotPasswordPage() {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;

    const timeout = window.setTimeout(() => {
      setCooldown((value) => Math.max(0, value - 1));
    }, 1000);

    return () => window.clearTimeout(timeout);
  }, [cooldown]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const redirectTo =
      typeof window === "undefined"
        ? "/reset-password"
        : `${window.location.origin}/reset-password`;

    const result = await requestPasswordReset({
      email,
      redirectTo,
    });

    setIsSubmitting(false);
    setCooldown(30);

    if (result.error) {
      setError(result.error.message ?? "Could not send reset instructions.");
      return;
    }

    setSuccess(NEUTRAL_SUCCESS);
  }

  return (
   <AuthShell
      eyebrow="አካውንት መልሶ ማግኛ"
      title="የይለፍ ቃልዎን ረስተዋል?"
      subtitle="ኢሜይሉ መኖር አለመኖሩን ሳያጋልጡ የይለፍ ቃል ማደሻ ሊንክ ይጠይቁ።"
      footer={
        <>
          ትዝ አለዎት?{" "}
          <Link
            className="font-bold underline text-lg text-yellow-200 hover:text-yellow-100 underline transition"
            href="/sign-in"
          >
            ይግቡ
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {error ? <FormMessage tone="error">{error}</FormMessage> : null}
        {success ? <FormMessage tone="success">{success}</FormMessage> : null}

        <label className="block text-sm font-semibold text-slate-200">
          ኢሜይል
          <input
            className={authInputClass}
            name="email"
            type="email"
            autoComplete="email"
            required
          />
        </label>

        <button
          className={authButtonClass}
          type="submit"
          disabled={isSubmitting || cooldown > 0}
        >
          {cooldown > 0
            ? `በ ${cooldown} ሰከንድ ውስጥ እንደገና ይሞክሩ`
            : isSubmitting
              ? "በመላክ ላይ..."
              : "የማደሻ ሊንክ ይላኩ"}
        </button>
      </form>
    </AuthShell>
  );
}
