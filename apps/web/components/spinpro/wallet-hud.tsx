"use client";

import { useMemo, useState } from "react";
import type { CurrentUser, WalletSnapshot } from "@kingspin/contracts";
import { formatCoins } from "../../lib/format";
import { Button } from "../ui/button";

type WalletHudProps = {
  user: CurrentUser | null;
  wallet: WalletSnapshot | null;
  fallbackName?: string | null;
  loadingLabel?: string;
  error?: string | null;
  onRefresh: () => void | Promise<void>;
};

export function WalletHUD({
  user,
  wallet,
  fallbackName,
  loadingLabel,
  error,
  onRefresh,
}: WalletHudProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const displayName = useMemo(() => {
    return user?.username ?? fallbackName ?? loadingLabel ?? "Sign in required";
  }, [fallbackName, loadingLabel, user?.username]);

  const hasWallet = Boolean(wallet);
  const isSignedIn = Boolean(user);
  const balanceLabel = formatCoins(wallet?.balanceSnapshot);

  const statusLabel = !isSignedIn
    ? "Guest"
    : hasWallet
      ? "Ready"
      : "Syncing";

  const statusClassName = !isSignedIn
    ? "border-[rgba(148,163,184,0.28)] bg-[rgba(148,163,184,0.1)] text-text-secondary"
    : hasWallet
      ? "border-[rgba(45,212,191,0.34)] bg-[rgba(45,212,191,0.1)] text-teal"
      : "border-[rgba(250,204,21,0.3)] bg-[rgba(250,204,21,0.1)] text-[var(--gold)]";

  const refreshBalance = async () => {
    if (isRefreshing) return;

    setIsRefreshing(true);

    try {
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <section className="arcadia-surface relative overflow-hidden rounded-lg p-5">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[rgba(250,204,21,0.7)] to-transparent" />

      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-[var(--gold)]">
            Wallet
          </p>
          <h2 className="mt-2 font-mono text-4xl font-black leading-none text-text-primary">
            {balanceLabel}
          </h2>
          <p className="mt-2 text-sm text-text-secondary">
            {displayName}
          </p>
        </div>

        <div
          className={`rounded-full border px-3 py-1 text-xs font-black uppercase tracking-[0.16em] ${statusClassName}`}
        >
          {statusLabel}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-md border border-[var(--border)] bg-[rgba(255,255,255,0.03)] px-3 py-2">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-text-dim">
            Type
          </p>
          <p className="mt-1 font-mono text-sm font-black text-text-primary">
            {wallet?.type ?? "MAIN"}
          </p>
        </div>

        <div className="rounded-md border border-[var(--border)] bg-[rgba(255,255,255,0.03)] px-3 py-2">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-text-dim">
            State
          </p>
          <p className="mt-1 font-mono text-sm font-black text-text-primary">
            {hasWallet ? "Live" : "Pending"}
          </p>
        </div>
      </div>

      {error ? (
        <p className="mt-3 rounded-md border border-[rgba(248,113,113,0.35)] bg-[rgba(248,113,113,0.1)] px-3 py-2 text-sm font-semibold text-red-hot">
          {error}
        </p>
      ) : null}

      <Button
        className="mt-4 w-full transition active:scale-[0.99]"
        variant="primary"
        disabled={isRefreshing}
        onClick={refreshBalance}
      >
        {isRefreshing ? "Refreshing..." : "Refresh Balance"}
      </Button>

      <p className="mt-2 text-center text-xs text-text-dim">
        Balance updates instantly after entry confirmation.
      </p>
    </section>
  );
}
