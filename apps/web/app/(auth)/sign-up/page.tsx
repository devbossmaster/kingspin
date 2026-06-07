"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { z } from "zod";
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

const phoneCountryCodeSchema = z.literal("+251");

const ethiopianLocalPhoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, ""))
  .transform((value) => (value.startsWith("0") ? value.slice(1) : value))
  .pipe(
    z
      .string()
      .regex(
        /^[1-9]\d{8}$/,
        "Enter a valid Ethiopian phone number with 9 digits after +251.",
      ),
  );

const ethiopianPhoneSchema = z
  .object({
    countryCode: phoneCountryCodeSchema,
    localNumber: ethiopianLocalPhoneSchema,
  })
  .transform(({ countryCode, localNumber }) => `${countryCode}${localNumber}`);

const phoneFieldClass =
  "mt-2 rounded-2xl border border-blue-300/15 bg-[#081326]/90 px-4 py-4 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_14px_30px_rgba(0,0,0,0.22)] outline-none transition placeholder:text-slate-500 focus:border-sky-300/75 focus:bg-[#0b1934] focus:ring-4 focus:ring-blue-500/20";

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
    const phoneResult = ethiopianPhoneSchema.safeParse({
      countryCode: String(formData.get("phoneCountryCode") ?? ""),
      localNumber: String(formData.get("phoneLocalNumber") ?? ""),
    });
    const email = String(formData.get("email") ?? "").trim();
    const passwordValue = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");
    const callbackURL = getSafeCallbackUrl();

    if (username.length < 3) {
      setError("Username must be at least 3 characters.");
      return;
    }

    if (!/^[a-zA-Z0-9_.]+$/.test(username)) {
      setError(
        "Username can only include letters, numbers, dots, and underscores.",
      );
      return;
    }

    if (!phoneResult.success) {
      setError(phoneResult.error.issues[0]?.message ?? "Invalid phone number.");
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
      phoneNumber: phoneResult.data,
      callbackURL,
    });

    setIsSubmitting(false);

    if (result.error) {
      setError(result.error.message ?? "Could not create account.");
      return;
    }

    setSuccess("Check your email to verify your Spin Battle account.");
    router.push(`/verify-email?email=${encodeURIComponent(email)}`);
  }

  return (
  <AuthShell
      eyebrow="ተጫዋች ይፍጠሩ"
      title="አካውንትዎን ይፍጠሩ"
      subtitle="ወደ ቀጥታ ክፍሎች ከመግባትዎ በፊት የ Spin Battle የተጫዋች ፕሮፋይልዎን ይመዝገቡ።"
      footer={
        <>
          አካውንት አልዎት?{" "}
          <Link
            className="font-black underline text-lg hover:text-sky-300 transition"
            href={`/sign-in?callbackURL=${encodeURIComponent(getSafeCallbackUrl())}`}
          >
            ይግቡ
          </Link>
        </>
      }
    >
    <form onSubmit={handleSubmit} className="space-y-4">
        {error ? <FormMessage tone="error">{error}</FormMessage> : null}
        {success ? <FormMessage tone="success">{success}</FormMessage> : null}

        <label className="block text-sm font-semibold text-slate-200">
          የተጠቃሚ ስም
          <input
            className={authInputClass}
            name="username"
            autoComplete="username"
            placeholder="የተጠቃሚ ስም ይምረጡ / username"
            minLength={3}
            required
          />
        </label>

        <label className="block text-sm font-semibold text-slate-200">
          ሙሉ ስም
          <input
            className={authInputClass}
            name="fullName"
            autoComplete="name"
            placeholder="የእርስዎን ሙሉ ስም ያስገቡ / full name"
            required
          />
        </label>

        <label className="block text-sm font-semibold text-slate-200">
          የስልክ ቁጥር
          <div className="grid grid-cols-[116px_minmax(0,1fr)] gap-2">
            <select
              className={`${phoneFieldClass} cursor-pointer appearance-none`}
              name="phoneCountryCode"
              defaultValue="+251"
              aria-label="የሀገር መለያ ኮድ"
              required
            >
              <option value="+251">+251 ET</option>
            </select>
            <input
              className={phoneFieldClass}
              name="phoneLocalNumber"
              type="tel"
              autoComplete="tel-national"
              inputMode="numeric"
              placeholder="912345678"
              pattern="0?[1-9][0-9]{8}"
              maxLength={10}
              required
            />
          </div>
        </label>

        <label className="block text-sm font-semibold text-slate-200">
          ኢሜይል
          <input
            className={authInputClass}
            name="email"
            type="email"
            autoComplete="email"
            placeholder="ኢሜይልዎን ያስገቡ / email address"
            required
          />
        </label>

        <label className="block text-sm font-semibold text-slate-200">
          የይለፍ ቃል
          <input
            className={authInputClass}
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="የይለፍ ቃል ይፍጠሩ / create password"
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>

        <PasswordStrengthMeter password={password} />

        <label className="block text-sm font-semibold text-slate-200">
          የይለፍ ቃል ያረጋግጡ
          <input
            className={authInputClass}
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            placeholder="የይለፍ ቃልዎን ያረጋግጡ / confirm password"
            required
          />
        </label>

        <button
          className={authButtonClass}
          type="submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? "አካውንት በመፈጠር ላይ..." : "አካውንት ፍጠር"}
        </button>
      </form>
    </AuthShell>
  );
}
