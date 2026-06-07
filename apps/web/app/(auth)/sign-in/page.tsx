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
    return "/";
  }

  const params = new URLSearchParams(window.location.search);
  const callbackUrl = params.get("callbackURL") ?? params.get("redirect");

  return callbackUrl?.startsWith("/") ? callbackUrl : "/";
}

export default function SignInPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const callbackURL =
    typeof window === "undefined" ? "/" : getSafeCallbackUrl();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const login = String(formData.get("login") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const callbackURL = getSafeCallbackUrl();
    const result = login.includes("@")
      ? await signIn.email({
          email: login,
          password,
          rememberMe: true,
          callbackURL,
        })
      : await signIn.username({
          username: login,
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
      eyebrow="እንኳን ደህና ተመለሱ!"
      title="ወደ አካውንትዎ ይግቡ"
      subtitle="ወደ Spin Battle አካውንትዎ ይግቡ፣ ዋሌትዎን ያገናኙ እና ወደ መረጡት ክፍል ይመለሱ።"
      footer={
        <>
          አካውንት የለዎትም?{" "}
          <Link
            className="font-black underline text-lg hover:text-sky-300 transition" 
            href={`/sign-up?callbackURL=${encodeURIComponent(callbackURL)}`}
          >
            አሁን ይመዝገቡ
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error ? <FormMessage tone="error">{error}</FormMessage> : null}

        <label className="block text-sm font-semibold text-slate-200">
          የተጠቃሚ ስም ወይም ኢሜይል
          <input
            className={authInputClass}
            name="login"
            autoComplete="username"
            placeholder="የተጠቃሚ ስምዎን ወይም ኢሜይልዎን ያስገቡ"
            required
          />
        </label>

        <label className="block text-sm font-semibold text-slate-200">
          የይለፍ ቃል
          <input
            className={authInputClass}
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="የይለፍ ቃልዎን ያስገቡ"
            required
          />
        </label>
        <div className="-mt-2 flex justify-end">
          <Link
            href="/forgot-password"
            className="text-xs font-bold text-sky-300 transition hover:text-white"
          >
            የይለፍ ቃል ረሱ?
          </Link>
        </div>

        <button
          className={authButtonClass}
          type="submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? "በመግባት ላይ..." : "ይግቡ"}
        </button>
      </form>
    </AuthShell>
  );
}
