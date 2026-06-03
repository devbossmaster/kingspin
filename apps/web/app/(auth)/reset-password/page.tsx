"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
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
import { resetPassword } from "../../../lib/auth-client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get("token"));

    const urlError = params.get("error");
    if (urlError) {
      setError("Reset link is invalid or expired.");
    }
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!token) {
      setError("Reset token is missing.");
      return;
    }

    const formData = new FormData(event.currentTarget);
    const passwordValue = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");

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

    const result = await resetPassword({
      newPassword: passwordValue,
      token,
    });

    setIsSubmitting(false);

    if (result.error) {
      setError(result.error.message ?? "Could not reset password.");
      return;
    }

    setSuccess("Password updated. Redirecting to sign in.");
    window.setTimeout(() => router.push("/sign-in"), 800);
  }

  return (
    <AuthShell
      eyebrow="Secure reset"
      title="Reset password"
      subtitle="Set a new password for your Spin Battle account."
      footer={
        <>
          Back to{" "}
          <Link
            className="font-bold text-yellow-200 hover:text-yellow-100"
            href="/sign-in"
          >
            sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {error ? <FormMessage tone="error">{error}</FormMessage> : null}
        {success ? <FormMessage tone="success">{success}</FormMessage> : null}

        <label className="block text-sm font-semibold text-slate-200">
          New password
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
          {isSubmitting ? "Updating..." : "Update password"}
        </button>
      </form>
    </AuthShell>
  );
}
