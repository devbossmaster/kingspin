"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  Banknote,
  CircleDollarSign,
  DoorOpen,
  FileClock,
  Gauge,
  LogOut,
  Settings,
  ShieldAlert,
  Ticket,
  Trophy,
  Users,
} from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { signOut, useSession } from "../../lib/auth-client";

const ADMIN_ROLES = new Set([
  "OWNER",
  "SUPER_ADMIN",
  "ADMIN",
  "SUPPORT",
  "FINANCE",
  "RISK",
  "VIEWER",
]);

const navigation = [
  { label: "Dashboard", href: "/admin", icon: Gauge },
  { label: "Rooms", href: "/admin/rooms", icon: DoorOpen },
  { label: "Players", href: "/admin/players", icon: Users },
  { label: "Entries", href: "/admin/entries", icon: Ticket },
  { label: "Rounds", href: "/admin/rounds", icon: Trophy },
  {
    label: "Deposits",
    href: "/admin/payments/deposits",
    icon: CircleDollarSign,
  },
  {
    label: "Withdrawals",
    href: "/admin/payments/withdrawals",
    icon: Banknote,
  },
  { label: "Risk & Fraud", href: "/admin/risk", icon: ShieldAlert },
  { label: "Audit Log", href: "/admin/audit", icon: FileClock },
  { label: "System Health", href: "/admin/health", icon: Activity },
  { label: "Settings", href: "/admin/settings", icon: Settings },
];

type AdminIdentity = {
  id?: string;
  username?: string;
  fullName?: string | null;
  name?: string | null;
  email?: string;
  role?: string;
};

function identityFromSessionUser(user: unknown): AdminIdentity | null {
  if (!user || typeof user !== "object") return null;

  const record = user as Record<string, unknown>;
  return {
    id: typeof record.id === "string" ? record.id : undefined,
    username:
      typeof record.username === "string" ? record.username : undefined,
    fullName:
      typeof record.fullName === "string" || record.fullName === null
        ? record.fullName
        : undefined,
    name:
      typeof record.name === "string" || record.name === null
        ? record.name
        : undefined,
    email: typeof record.email === "string" ? record.email : undefined,
    role: typeof record.role === "string" ? record.role : undefined,
  };
}

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, isPending, refetch } = useSession();
  const [identity, setIdentity] = useState<AdminIdentity | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const sessionIdentity = useMemo(
    () => identityFromSessionUser(session?.user),
    [session?.user],
  );
  const sessionUserId = sessionIdentity?.id;
  const sessionRole = sessionIdentity?.role;
  const sessionUsername = sessionIdentity?.username;
  const sessionFullName = sessionIdentity?.fullName;
  const sessionName = sessionIdentity?.name;
  const sessionEmail = sessionIdentity?.email;
  const hasSessionUser = Boolean(session?.user);
  const effectiveIdentity = identity ?? sessionIdentity;

  useEffect(() => {
    if (isPending) return;
    if (!hasSessionUser) {
      setIdentity(null);
      setAuthError(null);
      return;
    }

    if (sessionRole) {
      const nextSessionIdentity = {
        id: sessionUserId,
        username: sessionUsername,
        fullName: sessionFullName,
        name: sessionName,
        email: sessionEmail,
        role: sessionRole,
      };
      setIdentity((current) =>
        current?.id === sessionUserId ? current : nextSessionIdentity,
      );
      setAuthError(null);
    }

    void apiClient
      .getMe()
      .then((user) => {
        setIdentity(user);
        setAuthError(null);
      })
      .catch((error) => {
        setAuthError(
          error instanceof Error ? error.message : "Admin session unavailable.",
        );
      });
  }, [
    hasSessionUser,
    isPending,
    sessionEmail,
    sessionFullName,
    sessionName,
    sessionRole,
    sessionUserId,
    sessionUsername,
  ]);

  async function handleSignOut() {
    await signOut();
    await refetch();
    setIdentity(null);
    router.push("/sign-in");
  }

  if (isPending || (session?.user && !effectiveIdentity && !authError)) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#071018] text-slate-300">
        <div className="flex items-center gap-3 text-sm font-bold">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
          Loading operations workspace
        </div>
      </main>
    );
  }

  if (!session?.user) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#071018] px-4">
        <div className="w-full max-w-md border border-white/10 bg-[#0d1720] p-6">
          <h1 className="text-xl font-black text-white">Admin sign in</h1>
          <p className="mt-2 text-sm text-slate-400">
            An authenticated admin session is required.
          </p>
          <Link
            href="/sign-in?callbackURL=/admin"
            className="mt-5 inline-flex min-h-10 items-center bg-emerald-400 px-4 text-sm font-black text-[#071018]"
          >
            Sign in
          </Link>
        </div>
      </main>
    );
  }

  if (
    authError ||
    !effectiveIdentity?.role ||
    !ADMIN_ROLES.has(effectiveIdentity.role)
  ) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#071018] px-4">
        <div className="w-full max-w-md border border-red-400/25 bg-[#0d1720] p-6">
          <h1 className="text-xl font-black text-white">Access denied</h1>
          <p className="mt-2 text-sm text-slate-400">
            {authError ?? "This account does not have an admin role."}
          </p>
          <Link
            href="/"
            className="mt-5 inline-flex min-h-10 items-center border border-white/15 px-4 text-sm font-black text-white"
          >
            Return home
          </Link>
        </div>
      </main>
    );
  }

  const displayName =
    effectiveIdentity.username ||
    effectiveIdentity.fullName ||
    effectiveIdentity.name ||
    session.user.name ||
    "Admin";

  return (
    <div className="min-h-screen bg-[#071018] text-slate-100">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-white/10 bg-[#0b141c] lg:flex lg:flex-col">
        <Link href="/admin" className="flex h-20 items-center gap-3 px-5">
          <span className="relative h-11 w-11 overflow-hidden border border-white/10 bg-black">
            <Image src="/logo.png" alt="" fill sizes="44px" className="object-contain p-1" />
          </span>
          <span>
            <span className="block text-base font-black text-white">
              Spin Battle
            </span>
            <span className="block text-[11px] font-bold uppercase text-emerald-400">
              Operations
            </span>
          </span>
        </Link>

        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-4">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === "/admin"
                ? pathname === item.href
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex min-h-11 items-center gap-3 border-l-2 px-3 text-sm font-bold transition ${
                  active
                    ? "border-emerald-400 bg-emerald-400/10 text-white"
                    : "border-transparent text-slate-400 hover:bg-white/[0.04] hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-white/10 p-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-black text-white">{displayName}</p>
            <p className="truncate text-xs text-slate-500">
              {effectiveIdentity.role}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="mt-3 flex min-h-10 w-full items-center gap-2 border border-white/10 px-3 text-sm font-bold text-slate-300 hover:bg-white/[0.04]"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 border-b border-white/10 bg-[#071018]/95 px-3 py-3 backdrop-blur lg:hidden">
          <div className="mb-3 flex items-center justify-between">
            <Link href="/admin" className="font-black text-white">
              Spin Battle Ops
            </Link>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              aria-label="Sign out"
              title="Sign out"
              className="grid h-9 w-9 place-items-center border border-white/10 text-slate-300"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
          <nav className="flex gap-2 overflow-x-auto pb-1">
            {navigation.map((item) => {
              const Icon = item.icon;
              const active =
                item.href === "/admin"
                  ? pathname === item.href
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={item.label}
                  aria-label={item.label}
                  className={`grid h-10 w-10 shrink-0 place-items-center border ${
                    active
                      ? "border-emerald-400 bg-emerald-400/10 text-emerald-300"
                      : "border-white/10 text-slate-400"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </Link>
              );
            })}
          </nav>
        </header>
        <main className="mx-auto min-h-screen max-w-[1600px] px-3 py-5 sm:px-5 lg:px-8 lg:py-7">
          {children}
        </main>
      </div>
    </div>
  );
}
