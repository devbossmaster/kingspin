"use client";

import Link from "next/link";
import { useEffect } from "react";
import { buttonClassName, Button } from "../ui/button";
import { formatCoins } from "../../lib/format";
import { signOut, useSession } from "../../lib/auth-client";
import { useAuthStore } from "../../stores/auth-store";

export function NavBar({ backHref }: { backHref?: string }) {
  const { data: session, isPending, refetch } = useSession();
  const user = useAuthStore((store) => store.user);
  const wallet = useAuthStore((store) => store.wallet);
  const fetchMe = useAuthStore((store) => store.fetchMe);
  const fetchWallet = useAuthStore((store) => store.fetchWallet);
  const clear = useAuthStore((store) => store.clear);
  const sessionUserId = session?.user.id ?? null;

  useEffect(() => {
    if (!sessionUserId) {
      clear();
      return;
    }

    void fetchMe();
    void fetchWallet();
  }, [clear, fetchMe, fetchWallet, sessionUserId]);

  async function handleSignOut() {
    await signOut();
    clear();
    await refetch();
  }

  const displayName =
    user?.username ?? session?.user.name ?? session?.user.email ?? "Player";

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[rgba(8,12,20,0.88)] backdrop-blur-xl">
      <div className="mx-auto flex min-h-16 w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-8">
        <div className="flex items-center gap-3">
          {backHref ? (
            <Link
              href={backHref}
              className="rounded-md border border-[var(--border)] px-3 py-2 text-sm font-bold text-text-secondary transition hover:border-[var(--border-glow)] hover:text-text-primary"
              aria-label="Back"
            >
              &lt;
            </Link>
          ) : null}
          <Link href="/spinpro" className="group">
            <span className="block font-display text-xl font-black tracking-normal text-text-primary">
              SpinPro
            </span>
            <span className="block text-xs font-bold uppercase tracking-[0.18em] text-teal">
              Neon Arcadia
            </span>
          </Link>
        </div>

        <nav className="flex flex-wrap items-center gap-2" aria-label="Account">
          {isPending ? (
            <span className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-text-secondary">
              Checking session
            </span>
          ) : session?.user ? (
            <>
              <span className="rounded-md border border-[var(--border)] bg-[rgba(246,197,71,0.08)] px-3 py-2 text-sm text-text-primary">
                <span className="font-bold">{displayName}</span>
                <span className="ml-3 font-mono text-gold">
                  {wallet ? `${formatCoins(wallet.balanceSnapshot)} coins` : "Wallet -"}
                </span>
              </span>
              <Button variant="ghost" onClick={() => void handleSignOut()}>
                Sign Out
              </Button>
            </>
          ) : (
            <>
              <Link href="/sign-in" className={buttonClassName("ghost")}>
                Sign In
              </Link>
              <Link href="/sign-up" className={buttonClassName("primary")}>
                Sign Up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
