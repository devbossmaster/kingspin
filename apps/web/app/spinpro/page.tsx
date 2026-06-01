"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { CategoryCard } from "../../components/player/category-card";
import { GameShell } from "../../components/player/game-shell";
import { ModeCard } from "../../components/player/mode-card";
import { SectionHeader } from "../../components/player/section-header";
import { StatusPill } from "../../components/player/status-pill";
import { useSession } from "../../lib/auth-client";
import {
  type PlayerMode,
  getCategoryMode,
  isBaselinePlayerCategory,
  sortPlayerCategories,
} from "../../lib/game-modes";
import { useCategories } from "../../hooks/use-categories";
import { useRoomSummaries } from "../../hooks/use-room-summaries";

function SpinProLobbyContent() {
  const searchParams = useSearchParams();
  const initialMode = searchParams.get("mode") === "fixed" ? "fixed" : "pro";
  const [selectedMode, setSelectedMode] = useState<PlayerMode>(initialMode);
  const { data: session } = useSession();
  const {
    categories,
    loading: categoriesLoading,
    error: categoriesError,
  } = useCategories();
  const [clientNowMs, setClientNowMs] = useState(() => Date.now());

  useEffect(() => {
    setSelectedMode(initialMode);
  }, [initialMode]);

  const playerCategories = useMemo(() => {
    const baseline = sortPlayerCategories(
      categories.filter(isBaselinePlayerCategory),
    );

    return baseline.length > 0 ? baseline : sortPlayerCategories(categories);
  }, [categories]);

  const visibleCategories = useMemo(
    () =>
      playerCategories.filter(
        (category) => getCategoryMode(category) === selectedMode,
      ),
    [playerCategories, selectedMode],
  );
  const visibleCategorySlugs = useMemo(
    () => visibleCategories.map((category) => category.slug),
    [visibleCategories],
  );
  const {
    roomsBySlug,
    loading: roomsLoading,
    error: roomsError,
  } = useRoomSummaries(visibleCategorySlugs);

  useEffect(() => {
    const intervalId = setInterval(() => {
      setClientNowMs(Date.now());
    }, 1_000);

    return () => {
      clearInterval(intervalId);
    };
  }, []);

  const error = categoriesError ?? roomsError;
  const isSignedIn = Boolean(session?.user);

  return (
    <GameShell backHref="/">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-7 px-4 py-6 md:px-8 md:py-8">
        <section className="border-b border-[var(--border)] pb-6">
          <StatusPill tone="gold">Live wheel rooms</StatusPill>
          <h1 className="mt-4 font-display text-4xl font-black tracking-normal md:text-6xl">
            Choose Pro or Fixed
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-text-secondary">
            Guests can browse every room. Sign in when you choose a category to
            enter the active permanent room.
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <ModeCard mode="pro" href="/spinpro?mode=pro" />
          <ModeCard mode="fixed" href="/spinpro?mode=fixed" />
        </section>

        <section
          id={`${selectedMode}-categories`}
          className="rounded-lg border border-[var(--border)] bg-black/10 p-4 md:p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionHeader
              eyebrow="Categories"
              title="Active permanent rooms"
            />

            <div
              className="grid rounded-md border border-[var(--border)] bg-[var(--bg-surface)] p-1"
              style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}
            >
              {(["pro", "fixed"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setSelectedMode(mode)}
                  className={`min-h-10 rounded-sm px-4 text-sm font-black transition ${
                    selectedMode === mode
                      ? "bg-[var(--gold)] text-[var(--bg-void)]"
                      : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  {mode === "pro" ? "Pro" : "Fixed"}
                </button>
              ))}
            </div>
          </div>

          {error ? (
            <div className="mt-5 rounded-md border border-[rgba(248,113,113,0.42)] bg-[rgba(248,113,113,0.12)] px-4 py-3 text-sm font-semibold text-red-hot">
              {error}
            </div>
          ) : null}

          {categoriesLoading || roomsLoading ? (
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2].map((item) => (
                <div
                  key={item}
                  className="h-[220px] animate-pulse rounded-lg border border-[var(--border)] bg-white/[0.04]"
                />
              ))}
            </div>
          ) : (
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {visibleCategories.map((category) => (
                <CategoryCard
                  key={category.slug}
                  category={category}
                  room={roomsBySlug[category.slug]?.[0] ?? null}
                  isSignedIn={isSignedIn}
                  clientNowMs={clientNowMs}
                />
              ))}
            </div>
          )}

          {!categoriesLoading &&
          !roomsLoading &&
          visibleCategories.length === 0 ? (
            <div className="mt-6 rounded-md border border-dashed border-[var(--border)] bg-white/[0.03] px-4 py-8 text-center text-sm text-text-secondary">
              No active categories are configured for this mode.
            </div>
          ) : null}
        </section>
      </div>
    </GameShell>
  );
}

export default function SpinProLobbyPage() {
  return (
    <Suspense
      fallback={
        <GameShell backHref="/">
          <div className="mx-auto max-w-7xl px-4 py-8 md:px-8">
            <div className="h-[420px] animate-pulse rounded-lg border border-[var(--border)] bg-white/[0.04]" />
          </div>
        </GameShell>
      }
    >
      <SpinProLobbyContent />
    </Suspense>
  );
}
