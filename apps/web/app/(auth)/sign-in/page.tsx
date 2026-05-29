"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import {
  AuthShell,
  FormMessage,
  authButtonClass,
  authInputClass,
} from "../../../components/auth/auth-shell";
import { signIn } from "../../../lib/auth-client";

function getSafeCallbackUrl() {
  if (typeof window === "undefined") {
    return "/spinpro";
  }

  const params = new URLSearchParams(window.location.search);
  const callbackUrl = params.get("callbackURL") ?? params.get("redirect");

  return callbackUrl?.startsWith("/") ? callbackUrl : "/spinpro";
}

export default function SignInPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const callbackURL =
    typeof window === "undefined" ? "/spinpro" : getSafeCallbackUrl();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    const callbackURL = getSafeCallbackUrl();

    const result = await signIn.email({
      email,
      password,
      rememberMe: true,
      callbackURL,
    });

    setIsSubmitting(false);

    if (result.error) {
      setError(result.error.message ?? "Sign in failed.");
      return;
    }

    router.push(callbackURL);
    router.refresh();
  }

  return (
    <AuthShell
      eyebrow="Player session"
      title="Sign in"
      subtitle="Enter rooms, sync your wallet, and return to the spin you selected."
      footer={
        <>
          New here?{" "}
          <Link
            className="font-bold text-yellow-200 hover:text-yellow-100"
            href={`/sign-up?callbackURL=${encodeURIComponent(callbackURL)}`}
          >
            Create an account
          </Link>
          <span className="mx-2 text-slate-600">|</span>
          <Link
            className="font-bold text-teal-200 hover:text-teal-100"
            href="/forgot-password"
          >
            Forgot password
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {error ? <FormMessage tone="error">{error}</FormMessage> : null}

        <label className="block text-sm font-semibold text-slate-200">
          Email
          <input
            className={authInputClass}
            name="email"
            type="email"
            autoComplete="email"
            required
          />
        </label>

        <label className="block text-sm font-semibold text-slate-200">
          Password
          <input
            className={authInputClass}
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>

        <button
          className={authButtonClass}
          type="submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </AuthShell>
  );
}
