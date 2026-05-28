"use client";

import Link from "next/link";
import { NavBar } from "../components/layout/nav-bar";
import { Badge } from "../components/ui/badge";
import { useCategories } from "../hooks/use-categories";
import { formatCoins } from "../lib/format";

export default function HomePage() {
  const { categories, loading, error } = useCategories();

  return (
    <main className="min-h-screen text-text-primary">
      <NavBar />

      <section className="mx-auto w-full max-w-7xl px-4 py-10 md:px-8 md:py-14">
        <div className="max-w-3xl">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-gold">
            SpinPro
          </p>
          <h1 className="mt-3 font-display text-5xl font-black tracking-normal md:text-7xl">
            Server-run wheel rooms.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-text-secondary">
            Provably fair · Ledger-based payouts · Real-time
          </p>
        </div>

        {error ? (
          <div className="mt-8 rounded-md border border-[rgba(248,113,113,0.42)] bg-[rgba(248,113,113,0.12)] px-4 py-3 text-sm text-red-hot">
            {error}
          </div>
        ) : null}

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {loading ? (
            <div className="rounded-lg border border-[var(--border)] bg-white/[0.04] p-5 text-text-secondary">
              Loading categories
            </div>
          ) : null}

          {categories.map((category) => (
            <Link
              key={category.id}
              href={`/spinpro/${category.slug}`}
              className="arcadia-surface rounded-lg p-5 transition hover:border-[var(--border-glow)]"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-display text-2xl font-black">
                  {category.name}
                </h2>
                <Badge variant="open">Live</Badge>
              </div>
              <p className="mt-6 font-mono text-sm text-text-secondary">
                {formatCoins(category.minEntryAmount)}-
                {formatCoins(category.maxEntryAmount)} coins
              </p>
              <p className="mt-2 text-sm text-text-secondary">
                Max {category.maxPlayers} players ·{" "}
                {Math.round(category.roundDurationMs / 1000)}s rounds
              </p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
