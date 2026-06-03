"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import {
  AtSign,
  KeyRound,
  LogOut,
  ShieldCheck,
  User,
  type LucideIcon,
} from "lucide-react";
import { z } from "zod";
import { GameShell } from "../../components/player/game-shell";
import { Button } from "../../components/ui/button";
import {
  changeEmail,
  changePassword,
  revokeSessions,
  signOut,
  useSession,
} from "../../lib/auth-client";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../stores/auth-store";
import {
  PasswordStrengthMeter,
  getPasswordStrength,
} from "../../components/auth/password-strength";

const inputClass =
  "mt-2 w-full rounded-md border border-white/10 bg-white/[0.055] px-3 py-3 text-sm font-semibold text-white outline-none transition placeholder:text-slate-500 focus:border-sky-300/70 focus:ring-2 focus:ring-sky-500/20 disabled:cursor-not-allowed disabled:text-slate-500";

const labelClass =
  "text-xs font-black uppercase tracking-[0.14em] text-slate-500";

const phoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, ""))
  .transform((value) => (value.startsWith("0") ? value.slice(1) : value))
  .pipe(z.string().regex(/^[1-9]\d{8}$/, "Enter a valid phone number."));

function localPhoneFromUser(phoneNumber: string | null | undefined) {
  if (!phoneNumber) {
    return "";
  }

  return phoneNumber.startsWith("+251")
    ? phoneNumber.slice(4)
    : phoneNumber.replace(/^\+/, "");
}

function authErrorMessage(result: unknown, fallback: string) {
  if (
    result &&
    typeof result === "object" &&
    "error" in result &&
    result.error &&
    typeof result.error === "object" &&
    "message" in result.error
  ) {
    return String(result.error.message ?? fallback);
  }

  return fallback;
}

function hasAuthError(result: unknown) {
  return Boolean(
    result && typeof result === "object" && "error" in result && result.error,
  );
}

function StatusMessage({
  tone,
  children,
}: {
  tone: "success" | "error";
  children: string | null;
}) {
  if (!children) {
    return null;
  }

  return (
    <div
      className={`rounded-md border px-3 py-2 text-sm font-semibold ${
        tone === "success"
          ? "border-lime-300/35 bg-lime-400/10 text-lime-200"
          : "border-red-300/35 bg-red-500/10 text-red-200"
      }`}
    >
      {children}
    </div>
  );
}

function SettingsPanel({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.045] p-4 shadow-[0_18px_44px_rgba(0,0,0,0.28)] md:p-5">
      <div className="mb-4 flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-sky-300/25 bg-sky-400/10 text-sky-200">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <h2 className="font-display text-lg font-black text-white">{title}</h2>
      </div>
      {children}
    </section>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const { data: session, isPending, refetch } = useSession();
  const user = useAuthStore((store) => store.user);
  const fetchMe = useAuthStore((store) => store.fetchMe);
  const clear = useAuthStore((store) => store.clear);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [emailMessage, setEmailMessage] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [isProfileSaving, setIsProfileSaving] = useState(false);
  const [isEmailSaving, setIsEmailSaving] = useState(false);
  const [isPasswordSaving, setIsPasswordSaving] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);

  useEffect(() => {
    if (session?.user) {
      void fetchMe();
    }
  }, [fetchMe, session?.user]);

  const account = useMemo(
    () => ({
      username: user?.username ?? "-",
      email: user?.email ?? session?.user.email ?? "",
      fullName: user?.fullName ?? session?.user.name ?? "",
      phoneLocal: localPhoneFromUser(user?.phoneNumber),
    }),
    [session?.user.email, session?.user.name, user],
  );

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileError(null);
    setProfileMessage(null);

    const formData = new FormData(event.currentTarget);
    const fullName = String(formData.get("fullName") ?? "").trim();
    const phoneResult = phoneSchema.safeParse(
      String(formData.get("phoneLocalNumber") ?? ""),
    );

    if (!fullName) {
      setProfileError("Full name is required.");
      return;
    }

    if (!phoneResult.success) {
      setProfileError(
        phoneResult.error.issues[0]?.message ?? "Invalid phone number.",
      );
      return;
    }

    setIsProfileSaving(true);

    try {
      await apiClient.updateMe({
        fullName,
        phoneNumber: `+251${phoneResult.data}`,
      });
      await fetchMe();
      setProfileMessage("Profile updated.");
    } catch (caught) {
      setProfileError(
        caught instanceof Error ? caught.message : "Could not update profile.",
      );
    } finally {
      setIsProfileSaving(false);
    }
  }

  async function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEmailError(null);
    setEmailMessage(null);

    const formData = new FormData(event.currentTarget);
    const newEmail = String(formData.get("newEmail") ?? "").trim();

    if (!newEmail) {
      setEmailError("New email is required.");
      return;
    }

    setIsEmailSaving(true);

    const result = await changeEmail({
      newEmail,
      callbackURL: "/settings",
    });

    setIsEmailSaving(false);

    if (hasAuthError(result)) {
      setEmailError(
        authErrorMessage(result, "Could not request email change."),
      );
      return;
    }

    setEmailMessage("Confirmation sent.");
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError(null);
    setPasswordMessage(null);

    const formData = new FormData(event.currentTarget);
    const currentPassword = String(formData.get("currentPassword") ?? "");
    const passwordValue = String(formData.get("newPassword") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");

    if (!getPasswordStrength(passwordValue).isValid) {
      setPasswordError(
        "Password must include uppercase, number, and special character.",
      );
      return;
    }

    if (passwordValue !== confirmPassword) {
      setPasswordError("Passwords do not match.");
      return;
    }

    setIsPasswordSaving(true);

    const result = await changePassword({
      currentPassword,
      newPassword: passwordValue,
      revokeOtherSessions: true,
    });

    setIsPasswordSaving(false);

    if (hasAuthError(result)) {
      setPasswordError(authErrorMessage(result, "Could not update password."));
      return;
    }

    setNewPassword("");
    event.currentTarget.reset();
    setPasswordMessage("Password updated.");
  }

  async function handleRevokeSessions() {
    setSessionError(null);
    setIsRevoking(true);

    const result = await revokeSessions();

    if (hasAuthError(result)) {
      setIsRevoking(false);
      setSessionError(authErrorMessage(result, "Could not log out sessions."));
      return;
    }

    await signOut();
    clear();
    await refetch();
    router.push("/sign-in");
  }

  return (
    <GameShell backHref="/spinpro">
      <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-gold">
              Settings
            </p>
            <h1 className="mt-2 font-display text-3xl font-black text-white md:text-4xl">
              Account Security
            </h1>
          </div>
          <Link
            href="/wallet"
            className="inline-flex min-h-10 items-center justify-center rounded-md border border-white/10 bg-white/[0.06] px-4 text-sm font-black text-white transition hover:bg-white/[0.1]"
          >
            Wallet
          </Link>
        </div>

        {!isPending && !session?.user ? (
          <section className="rounded-lg border border-white/10 bg-white/[0.045] p-5">
            <p className="text-sm font-semibold text-slate-400">
              Sign in to manage account settings.
            </p>
            <Link
              href="/sign-in?callbackURL=/settings"
              className="mt-4 inline-flex min-h-10 items-center rounded-md bg-[var(--gold)] px-4 text-sm font-black text-[var(--bg-void)]"
            >
              Sign In
            </Link>
          </section>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <SettingsPanel icon={User} title="Profile">
              <form className="grid gap-4" onSubmit={handleProfileSubmit}>
                <label>
                  <span className={labelClass}>Username</span>
                  <input
                    className={inputClass}
                    value={account.username}
                    disabled
                    readOnly
                  />
                </label>
                <label>
                  <span className={labelClass}>Full Name</span>
                  <input
                    className={inputClass}
                    name="fullName"
                    defaultValue={account.fullName}
                    autoComplete="name"
                  />
                </label>
                <label>
                  <span className={labelClass}>Phone Number</span>
                  <div className="mt-2 grid grid-cols-[5rem_minmax(0,1fr)] gap-2">
                    <input
                      className={inputClass.replace("mt-2 ", "")}
                      value="+251"
                      disabled
                      readOnly
                    />
                    <input
                      className={inputClass.replace("mt-2 ", "")}
                      name="phoneLocalNumber"
                      defaultValue={account.phoneLocal}
                      inputMode="numeric"
                      autoComplete="tel"
                    />
                  </div>
                </label>
                <StatusMessage tone="success">{profileMessage}</StatusMessage>
                <StatusMessage tone="error">{profileError}</StatusMessage>
                <Button type="submit" disabled={isProfileSaving}>
                  {isProfileSaving ? "Saving..." : "Save Profile"}
                </Button>
              </form>
            </SettingsPanel>

            <SettingsPanel icon={AtSign} title="Email">
              <form className="grid gap-4" onSubmit={handleEmailSubmit}>
                <label>
                  <span className={labelClass}>Current Email</span>
                  <input
                    className={inputClass}
                    value={account.email}
                    disabled
                    readOnly
                  />
                </label>
                <label>
                  <span className={labelClass}>New Email</span>
                  <input
                    className={inputClass}
                    name="newEmail"
                    type="email"
                    autoComplete="email"
                  />
                </label>
                <StatusMessage tone="success">{emailMessage}</StatusMessage>
                <StatusMessage tone="error">{emailError}</StatusMessage>
                <Button type="submit" disabled={isEmailSaving}>
                  {isEmailSaving ? "Sending..." : "Send Confirmation"}
                </Button>
              </form>
            </SettingsPanel>

            <SettingsPanel icon={KeyRound} title="Password">
              <form className="grid gap-4" onSubmit={handlePasswordSubmit}>
                <label>
                  <span className={labelClass}>Old Password</span>
                  <input
                    className={inputClass}
                    name="currentPassword"
                    type="password"
                    autoComplete="current-password"
                  />
                </label>
                <label>
                  <span className={labelClass}>New Password</span>
                  <input
                    className={inputClass}
                    name="newPassword"
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                  />
                </label>
                <PasswordStrengthMeter password={newPassword} />
                <label>
                  <span className={labelClass}>Confirm Password</span>
                  <input
                    className={inputClass}
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                  />
                </label>
                <StatusMessage tone="success">{passwordMessage}</StatusMessage>
                <StatusMessage tone="error">{passwordError}</StatusMessage>
                <Button type="submit" disabled={isPasswordSaving}>
                  {isPasswordSaving ? "Updating..." : "Update Password"}
                </Button>
              </form>
            </SettingsPanel>

            <SettingsPanel icon={ShieldCheck} title="Sessions">
              <div className="grid gap-4">
                <div className="rounded-md border border-white/10 bg-black/25 px-3 py-3">
                  <p className="text-sm font-black text-white">
                    {user?.username ?? session?.user.name ?? "Player"}
                  </p>
                  <p className="mt-1 break-all text-xs font-semibold text-slate-500">
                    {account.email}
                  </p>
                </div>
                <StatusMessage tone="error">{sessionError}</StatusMessage>
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => void handleRevokeSessions()}
                  disabled={isRevoking}
                  className="gap-2"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  {isRevoking ? "Logging out..." : "Log Out All Sessions"}
                </Button>
              </div>
            </SettingsPanel>
          </div>
        )}
      </div>
    </GameShell>
  );
}
