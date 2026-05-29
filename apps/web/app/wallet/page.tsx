"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GameShell } from "../../components/player/game-shell";
import { Button } from "../../components/ui/button";
import { useSession } from "../../lib/auth-client";
import { formatCoins } from "../../lib/format";
import { useAuthStore } from "../../stores/auth-store";

export default function WalletPage() {
  const { data: session, isPending } = useSession();
  const user = useAuthStore((store) => store.user);
  const wallet = useAuthStore((store) => store.wallet);
  const fetchWallet = useAuthStore((store) => store.fetchWallet);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session?.user) return;

    void (async () => {
      const result = await fetchWallet();

      if (!result) {
        setError(
          "Wallet unavailable until the API auth bridge validates this session.",
        );
      } else {
        setError(null);
      }
    })();
  }, [fetchWallet, session?.user]);

  return (
    <GameShell backHref="/spinpro">
      <div className="mx-auto max-w-4xl px-4 py-8 md:px-8">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-gold">
          Wallet
        </p>
        <h1 className="mt-2 font-display text-4xl font-black">Main Balance</h1>

        {!isPending && !session?.user ? (
          <div className="arcadia-surface mt-6 rounded-lg p-5">
            <p className="text-text-secondary">Sign in to view your wallet.</p>
            <Link
              href="/sign-in?callbackURL=/wallet"
              className="mt-4 inline-flex rounded-md bg-[var(--gold)] px-4 py-2 font-black text-[var(--bg-void)]"
            >
              Sign In
            </Link>
          </div>
        ) : (
          <section className="arcadia-surface mt-6 rounded-lg p-6">
            <p className="text-sm text-text-secondary">
              {user?.username ?? session?.user.name ?? "Player"}
            </p>
            <p className="mt-3 font-mono text-5xl font-black text-gold">
              {formatCoins(wallet?.balanceSnapshot)}
            </p>
            <p className="mt-2 text-text-secondary">coins</p>

            {error ? (
              <div className="mt-5 rounded-md border border-[rgba(248,113,113,0.42)] bg-[rgba(248,113,113,0.12)] px-4 py-3 text-sm text-red-hot">
                {error}
              </div>
            ) : null}

            <Button className="mt-5" onClick={() => void fetchWallet()}>
              Refresh Wallet
            </Button>

            <div className="mt-6 rounded-md border border-[var(--border)] bg-white/[0.04] px-4 py-3 text-sm text-text-secondary">
              Deposits and withdrawals are coming later.
            </div>
          </section>
        )}
      </div>
    </GameShell>
  );
}
