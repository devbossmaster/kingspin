"use client";

import type { CurrentUser, WalletSnapshot } from "@kingspin/contracts";
import { formatCoins } from "../../lib/format";
import { Button } from "../ui/button";

type WalletHudProps = {
  user: CurrentUser | null;
  wallet: WalletSnapshot | null;
  fallbackName?: string | null;
  loadingLabel?: string;
  error?: string | null;
  onRefresh: () => void;
};

export function WalletHUD({
  user,
  wallet,
  fallbackName,
  loadingLabel,
  error,
  onRefresh,
}: WalletHudProps) {
  return (
    <section className="rounded-lg border border-[var(--border-glow)] bg-[rgba(246,197,71,0.08)] p-5">
      <p className="text-sm font-black uppercase tracking-[0.16em] text-gold">
        Wallet
      </p>
      <h2 className="mt-2 font-mono text-3xl font-black">
        {formatCoins(wallet?.balanceSnapshot)}
      </h2>
      <p className="mt-1 text-sm text-text-secondary">
        {user?.username ?? fallbackName ?? loadingLabel ?? "Sign in required"}
      </p>

      {error ? (
        <p className="mt-3 rounded-md border border-[rgba(45,212,191,0.34)] bg-[rgba(45,212,191,0.1)] px-3 py-2 text-sm text-teal">
          {error}
        </p>
      ) : null}

      <Button className="mt-4" variant="primary" onClick={onRefresh}>
        Refresh Balance
      </Button>
    </section>
  );
}
