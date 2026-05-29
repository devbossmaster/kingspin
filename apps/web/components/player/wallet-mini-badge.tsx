"use client";

import Link from "next/link";
import { Coins, UserRound } from "lucide-react";
import type { CurrentUser, WalletSnapshot } from "@kingspin/contracts";
import { formatCoins } from "../../lib/format";

export function WalletMiniBadge({
  user,
  wallet,
}: {
  user: CurrentUser | null;
  wallet: WalletSnapshot | null;
}) {
  if (!user) {
    return null;
  }

  return (
    <Link
      href="/wallet"
      className="inline-flex min-h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-white/[0.04] px-3 py-2 text-sm text-text-primary transition hover:border-[var(--border-glow)]"
    >
      <UserRound className="h-4 w-4 text-teal" aria-hidden="true" />
      <span className="hidden max-w-28 truncate font-bold sm:inline">
        {user.username}
      </span>
      <span className="inline-flex items-center gap-1 font-mono font-black text-gold">
        <Coins className="h-4 w-4" aria-hidden="true" />
        {wallet ? formatCoins(wallet.balanceSnapshot) : "-"}
      </span>
    </Link>
  );
}
