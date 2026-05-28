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
      eyebrow="Email verification"
      title={verified ? "Email verified" : "Verify email"}
      subtitle="Verified email is required before protected player actions can create a session."
      footer={
        <>
          {verified ? (
            <Link className="font-bold text-yellow-200 hover:text-yellow-100" href="/spinpro">
              Continue to SpinPro
            </Link>
          ) : (
            <Link className="font-bold text-yellow-200 hover:text-yellow-100" href="/sign-in">
              Sign in
            </Link>
          )}
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {error ? <FormMessage tone="error">{error}</FormMessage> : null}
        {success ? <FormMessage tone="success">{success}</FormMessage> : null}
        {isPending ? <FormMessage tone="info">Checking session...</FormMessage> : null}

        <label className="block text-sm font-semibold text-slate-200">
          Email
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
            ? "Verified"
            : cooldown > 0
              ? `Resend in ${cooldown}s`
              : isSubmitting
                ? "Sending..."
                : "Send verification email"}
        </button>
      </form>
    </AuthShell>
  );
}
