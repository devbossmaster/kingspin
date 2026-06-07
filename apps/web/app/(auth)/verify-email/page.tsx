"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import {
  AuthShell,
  FormMessage,
  authButtonClass,
  authInputClass,
} from "../../../components/auth/auth-shell";
import { sendVerificationEmail, useSession } from "../../../lib/auth-client";

export default function VerifyEmailPage() {
  const { data: session, isPending } = useSession();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const emailFromQuery = params.get("email");

    if (emailFromQuery) {
      setEmail(emailFromQuery);
    }

    const urlError = params.get("error");
    if (urlError) {
      setError("Verification link is invalid or expired.");
    }
  }, []);

  useEffect(() => {
    if (!email && session?.user.email) {
      setEmail(session.user.email);
    }
  }, [email, session?.user.email]);

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

    const result = await sendVerificationEmail({
      email,
      callbackURL: "/spinpro",
    });

    setIsSubmitting(false);
    setCooldown(30);

    if (result.error) {
      setError(result.error.message ?? "Could not send verification email.");
      return;
    }

    setSuccess("Verification email sent.");
  }

  const verified = Boolean(session?.user.emailVerified);

  return (
   <AuthShell
      eyebrow="ኢሜይል ማረጋገጫ"
      title={verified ? "ኢሜይል ተረጋግጧል" : "ኢሜይል ያረጋግጡ"}
      subtitle="የተጠበቁ የተጫዋች ተግባራት ሴሽን ከመፍጠራቸው በፊት የተረጋገጠ ኢሜይል ያስፈልጋል።"
      footer={
        <>
          {verified ? (
            <Link
              className="font-bold text-lg text-yellow-200 hover:text-yellow-100 underline transition"
              href="/spinpro"
            >
              ወደ Spin Battle ይቀጥሉ
            </Link>
          ) : (
            <Link
              className="font-bold underline  text-yellow-200 hover:text-yellow-100 underline transition"
              href="/sign-in"
            >
              ይግቡ
            </Link>
          )}
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {error ? <FormMessage tone="error">{error}</FormMessage> : null}
        {success ? <FormMessage tone="success">{success}</FormMessage> : null}
        {isPending ? (
          <FormMessage tone="info">ሴሽን በመፈተሽ ላይ...</FormMessage>
        ) : null}

        <label className="block text-sm font-semibold text-slate-200">
          ኢሜይል
          <input
            className={authInputClass}
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>

        <button
          className={authButtonClass}
          type="submit"
          disabled={isSubmitting || cooldown > 0 || verified}
        >
          {verified
            ? "ተረጋግጧል"
            : cooldown > 0
              ? `በ ${cooldown} ሰከንድ ውስጥ እንደገና ይላኩ`
              : isSubmitting
                ? "በመላክ ላይ..."
                : "የማረጋገጫ ኢሜይል ይላኩ"}
        </button>
      </form>
    </AuthShell>
  );
}
