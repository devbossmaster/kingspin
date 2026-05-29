"use client";

import Link from "next/link";
import { useEffect } from "react";
import { ChevronLeft, LogOut, Shield, Sparkles } from "lucide-react";
import { isAdminRole } from "../player/bottom-nav";
import { WalletMiniBadge } from "../player/wallet-mini-badge";
import { buttonClassName, Button } from "../ui/button";
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

  return (
    <header className="sticky top-0 z-30 w-full max-w-[100vw] overflow-hidden border-b border-[var(--border)] bg-[rgba(8,12,20,0.88)] backdrop-blur-xl">
      <div className="mx-auto flex min-h-16 w-full max-w-[100vw] flex-wrap items-center justify-between gap-3 px-4 py-3 md:max-w-7xl md:px-8">
        <div className="flex items-center gap-3">
          {backHref ? (
            <Link
              href={backHref}
              className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[var(--border)] text-text-secondary transition hover:border-[var(--border-glow)] hover:text-text-primary"
              aria-label="Back"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </Link>
          ) : null}
          <Link href="/" className="group flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-md border border-[rgba(246,197,71,0.35)] bg-[rgba(246,197,71,0.1)] text-gold">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </span>
            <span>
              <span className="block font-display text-xl font-black tracking-normal text-text-primary">
                KingSpin
              </span>
              <span className="block text-xs font-bold uppercase tracking-[0.18em] text-teal">
                SpinPro
              </span>
            </span>
          </Link>
        </div>

        <nav className="flex flex-wrap items-center gap-2" aria-label="Account">
          {isPending ? (
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[var(--border)] text-sm text-text-secondary sm:w-auto sm:px-3">
              <span className="sm:hidden" aria-hidden="true">
                ...
              </span>
              <span className="hidden sm:inline">Checking session</span>
            </span>
          ) : session?.user ? (
            <>
              <WalletMiniBadge user={user} wallet={wallet} />
              {isAdminRole(user?.role) ? (
                <Link href="/admin" className={buttonClassName("ghost")}>
                  <Shield className="mr-2 h-4 w-4" aria-hidden="true" />
                  Admin
                </Link>
              ) : null}
              <Button variant="ghost" onClick={() => void handleSignOut()}>
                <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
                Sign out
              </Button>
            </>
          ) : (
            <>
              <Link href="/sign-in" className={buttonClassName("ghost")}>
                Sign in
              </Link>
              <Link href="/sign-up" className={buttonClassName("primary")}>
                Register
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
