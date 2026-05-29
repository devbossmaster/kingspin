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
import {
  PasswordStrengthMeter,
  getPasswordStrength,
} from "../../../components/auth/password-strength";
import { signUp } from "../../../lib/auth-client";

function getSafeCallbackUrl() {
  if (typeof window === "undefined") {
    return "/spinpro";
  }

  const params = new URLSearchParams(window.location.search);
  const callbackUrl = params.get("callbackURL") ?? params.get("redirect");

  return callbackUrl?.startsWith("/") ? callbackUrl : "/spinpro";
}

export default function SignUpPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const formData = new FormData(event.currentTarget);
    const username = String(formData.get("username") ?? "").trim();
    const fullName = String(formData.get("fullName") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim();
    const passwordValue = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");
    const callbackURL = getSafeCallbackUrl();

    if (username.length < 3) {
      setError("Username must be at least 3 characters.");
      return;
    }

    if (!getPasswordStrength(passwordValue).isValid) {
      setError(
        "Password must include uppercase, number, and special character.",
      );
      return;
    }

    if (passwordValue !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);

    const result = await signUp.email({
      email,
      password: passwordValue,
      name: fullName,
      username,
      callbackURL,
    });

    setIsSubmitting(false);

    if (result.error) {
      setError(result.error.message ?? "Could not create account.");
      return;
    }

    setSuccess("Check your email to verify your SpinPro account.");
    router.push(`/verify-email?email=${encodeURIComponent(email)}`);
  }

  return (
    <AuthShell
      eyebrow="Create player"
      title="Register"
      subtitle="Create your player profile with email and password. Wallet and entry actions stay protected by your session."
      footer={
        <>
          Already have an account?{" "}
          <Link
            className="font-bold text-yellow-200 hover:text-yellow-100"
            href={`/sign-in?callbackURL=${encodeURIComponent(getSafeCallbackUrl())}`}
          >
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {error ? <FormMessage tone="error">{error}</FormMessage> : null}
        {success ? <FormMessage tone="success">{success}</FormMessage> : null}

        <label className="block text-sm font-semibold text-slate-200">
          Username
          <input
            className={authInputClass}
            name="username"
            autoComplete="username"
            minLength={3}
            required
          />
        </label>

        <label className="block text-sm font-semibold text-slate-200">
          Full name
          <input
            className={authInputClass}
            name="fullName"
            autoComplete="name"
            required
          />
        </label>

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
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>

        <PasswordStrengthMeter password={password} />

        <label className="block text-sm font-semibold text-slate-200">
          Confirm password
          <input
            className={authInputClass}
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
          />
        </label>

        <button
          className={authButtonClass}
          type="submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Creating account..." : "Create account"}
        </button>
      </form>
    </AuthShell>
  );
}
