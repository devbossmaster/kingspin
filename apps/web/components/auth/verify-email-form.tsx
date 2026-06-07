"use client";

import { CheckCircle2, KeyRound, MailCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  ClipboardEvent,
  FormEvent,
  KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  EMAIL_OTP_LENGTH,
  EMAIL_OTP_RESEND_COOLDOWN_SECONDS,
  PENDING_CALLBACK_KEY,
  PENDING_EMAIL_KEY,
  PENDING_SENT_AT_KEY,
  maskEmail,
  normalizeOtp,
  remainingCooldownSeconds,
  safeRelativeCallback,
} from "../../lib/email-otp";
import { emailOtp, useSession } from "../../lib/auth-client";
import {
  AuthShell,
  FormMessage,
  authButtonClass,
  authInputClass,
} from "./auth-shell";

const emptyCode = Array.from({ length: EMAIL_OTP_LENGTH }, () => "");

function isUsableEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function VerifyEmailForm() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [email, setEmail] = useState("");
  const [callbackURL, setCallbackURL] = useState("/spinpro");
  const [digits, setDigits] = useState(emptyCode);
  const [cooldown, setCooldown] = useState(0);
  const [isEditingEmail, setIsEditingEmail] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const storedEmail = window.sessionStorage.getItem(PENDING_EMAIL_KEY);
    const legacyEmail = params.get("email");
    const storedCallback = window.sessionStorage.getItem(PENDING_CALLBACK_KEY);
    const callback = safeRelativeCallback(
      storedCallback ?? params.get("callbackURL"),
    );
    const sentAt = Number(
      window.sessionStorage.getItem(PENDING_SENT_AT_KEY) ?? "0",
    );

    setEmail(storedEmail ?? legacyEmail ?? "");
    setCallbackURL(callback);
    setCooldown(
      Number.isFinite(sentAt) && sentAt > 0
        ? remainingCooldownSeconds(sentAt)
        : 0,
    );

    if (params.get("notice") === "unverified") {
      setNotice("Please verify your email to continue.");
    }
  }, []);

  useEffect(() => {
    if (!email && session?.user.email) {
      setEmail(session.user.email);
    }
  }, [email, session?.user.email]);

  useEffect(() => {
    if (cooldown <= 0) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setCooldown((value) => Math.max(0, value - 1));
    }, 1000);

    return () => window.clearTimeout(timeout);
  }, [cooldown]);

  function setCodeFrom(index: number, rawValue: string) {
    const incoming = normalizeOtp(rawValue);

    if (!incoming) {
      setDigits((current) =>
        current.map((digit, digitIndex) =>
          digitIndex === index ? "" : digit,
        ),
      );
      return;
    }

    setDigits((current) => {
      const next = [...current];

      for (
        let offset = 0;
        offset < incoming.length && index + offset < EMAIL_OTP_LENGTH;
        offset += 1
      ) {
        next[index + offset] = incoming[offset] ?? "";
      }

      return next;
    });

    const nextIndex = Math.min(
      index + incoming.length,
      EMAIL_OTP_LENGTH - 1,
    );
    inputRefs.current[nextIndex]?.focus();
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>, index: number) {
    event.preventDefault();
    setCodeFrom(index, event.clipboardData.getData("text"));
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
    index: number,
  ) {
    if (event.key !== "Backspace" || digits[index]) {
      return;
    }

    const previousIndex = Math.max(0, index - 1);
    setDigits((current) =>
      current.map((digit, digitIndex) =>
        digitIndex === previousIndex ? "" : digit,
      ),
    );
    inputRefs.current[previousIndex]?.focus();
  }

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const otp = digits.join("");
    const normalizedEmail = email.trim().toLowerCase();

    if (!isUsableEmail(normalizedEmail) || otp.length !== EMAIL_OTP_LENGTH) {
      setError("Enter your email and the complete 6-digit code.");
      return;
    }

    setError(null);
    setSuccess(null);
    setIsVerifying(true);

    const result = await emailOtp.verifyEmail({
      email: normalizedEmail,
      otp,
    });

    setIsVerifying(false);

    if (result.error) {
      setDigits(emptyCode);
      inputRefs.current[0]?.focus();
      setError("Invalid or expired code");
      return;
    }

    window.sessionStorage.removeItem(PENDING_EMAIL_KEY);
    window.sessionStorage.removeItem(PENDING_CALLBACK_KEY);
    window.sessionStorage.removeItem(PENDING_SENT_AT_KEY);
    setSuccess("Email verified");

    window.setTimeout(() => {
      const params = new URLSearchParams({
        verified: "1",
        callbackURL,
      });

      router.push(`/sign-in?${params.toString()}`);
      router.refresh();
    }, 900);
  }

  async function handleResend() {
    const normalizedEmail = email.trim().toLowerCase();

    if (!isUsableEmail(normalizedEmail)) {
      setError("Enter a valid email address.");
      setIsEditingEmail(true);
      return;
    }

    setError(null);
    setSuccess(null);
    setIsResending(true);

    await emailOtp.sendVerificationOtp({
      email: normalizedEmail,
      type: "email-verification",
    });

    const sentAt = Date.now();

    window.sessionStorage.setItem(PENDING_EMAIL_KEY, normalizedEmail);
    window.sessionStorage.setItem(PENDING_SENT_AT_KEY, String(sentAt));
    setEmail(normalizedEmail);
    setCooldown(EMAIL_OTP_RESEND_COOLDOWN_SECONDS);
    setIsResending(false);
    setSuccess("If the email is valid, a new code was sent.");
  }

  const codeComplete = digits.every(Boolean);
  const verified = Boolean(session?.user.emailVerified);

  return (
    <AuthShell
      eyebrow="Secure account verification"
      title="Verify your email"
      subtitle="Enter the 6-digit code we sent to your email"
      footer={
        verified ? (
          <a className="font-bold underline" href={callbackURL}>
            Continue to Spin Battle
          </a>
        ) : (
          <span>Codes expire after 10 minutes.</span>
        )
      }
    >
      <form onSubmit={handleVerify} className="space-y-6">
        {notice ? <FormMessage tone="info">{notice}</FormMessage> : null}
        {error ? <FormMessage tone="error">{error}</FormMessage> : null}
        {success ? <FormMessage tone="success">{success}</FormMessage> : null}
        {isPending ? (
          <FormMessage tone="info">Checking your account...</FormMessage>
        ) : null}

        <div className="rounded-2xl border border-sky-300/15 bg-sky-400/[0.06] p-4">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-emerald-300/20 bg-emerald-400/10 text-emerald-200">
              <MailCheck className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">
                Code sent to
              </p>
              <p className="mt-1 truncate font-mono text-sm font-bold text-white">
                {email ? maskEmail(email) : "Enter your email below"}
              </p>
            </div>
            {email ? (
              <button
                type="button"
                onClick={() => setIsEditingEmail((value) => !value)}
                className="text-xs font-black text-sky-300 transition hover:text-white"
              >
                Change
              </button>
            ) : null}
          </div>
        </div>

        {!email || isEditingEmail ? (
          <label className="block text-sm font-semibold text-slate-200">
            Email address
            <input
              className={authInputClass}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
            />
          </label>
        ) : null}

        <fieldset>
          <legend className="mb-3 flex items-center gap-2 text-sm font-black text-slate-200">
            <KeyRound className="h-4 w-4 text-emerald-300" aria-hidden="true" />
            Verification code
          </legend>
          <div className="grid grid-cols-6 gap-2 sm:gap-3">
            {digits.map((digit, index) => (
              <input
                key={index}
                ref={(element) => {
                  inputRefs.current[index] = element;
                }}
                className="aspect-square min-w-0 rounded-xl border border-blue-300/20 bg-[#081326] text-center font-mono text-xl font-black text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_12px_26px_rgba(0,0,0,0.24)] outline-none transition focus:border-emerald-300/75 focus:ring-4 focus:ring-emerald-400/15 sm:text-2xl"
                type="text"
                inputMode="numeric"
                autoComplete={index === 0 ? "one-time-code" : "off"}
                pattern="[0-9]*"
                maxLength={index === 0 ? EMAIL_OTP_LENGTH : 1}
                value={digit}
                aria-label={`Verification code digit ${index + 1}`}
                onChange={(event) => setCodeFrom(index, event.target.value)}
                onPaste={(event) => handlePaste(event, index)}
                onKeyDown={(event) => handleKeyDown(event, index)}
                autoFocus={index === 0}
              />
            ))}
          </div>
        </fieldset>

        <button
          className={authButtonClass}
          type="submit"
          disabled={
            !codeComplete ||
            !isUsableEmail(email.trim()) ||
            isVerifying ||
            verified
          }
        >
          {verified ? (
            <>
              <CheckCircle2 className="mr-2 h-5 w-5" aria-hidden="true" />
              Email verified
            </>
          ) : isVerifying ? (
            "Verifying..."
          ) : (
            "Verify"
          )}
        </button>

        {!verified ? (
          <div className="text-center">
            <p className="text-sm font-semibold text-slate-500">
              Did not receive the code?
            </p>
            <button
              type="button"
              onClick={() => void handleResend()}
              disabled={cooldown > 0 || isResending}
              className="mt-2 text-sm font-black text-sky-300 transition hover:text-white disabled:cursor-not-allowed disabled:text-slate-600"
            >
              {isResending
                ? "Sending..."
                : cooldown > 0
                  ? `Resend code in ${cooldown}s`
                  : "Resend code"}
            </button>
          </div>
        ) : null}
      </form>
    </AuthShell>
  );
}
