"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CategoryCard } from "../components/player/category-card";
import { GameShell } from "../components/player/game-shell";
import { ModeCard } from "../components/player/mode-card";
import { PromoHero } from "../components/player/promo-hero";
import { SectionHeader } from "../components/player/section-header";
import { StatusPill } from "../components/player/status-pill";
import { apiClient, type RoomListItem } from "../lib/api-client";
import { useSession } from "../lib/auth-client";
import {
  buildPlayHref,
  isBaselinePlayerCategory,
  sortPlayerCategories,
} from "../lib/game-modes";
import { useCategories } from "../hooks/use-categories";

export default function HomePage() {
  const { data: session } = useSession();
  const { categories, loading, error } = useCategories();
  const [roomsBySlug, setRoomsBySlug] = useState<
    Record<string, RoomListItem[]>
  >({});

  const isSignedIn = Boolean(session?.user);
  const playerCategories = useMemo(() => {
    const baseline = sortPlayerCategories(
      categories.filter(isBaselinePlayerCategory),
    );

    return baseline.length > 0 ? baseline : sortPlayerCategories(categories);
  }, [categories]);

  const previewCategories = useMemo(
    () => playerCategories.slice(0, 3),
    [playerCategories],
  );
  const primaryCategory = previewCategories.find(
    (category) => roomsBySlug[category.slug]?.[0],
  );
  const primaryRoom = primaryCategory
    ? roomsBySlug[primaryCategory.slug]?.[0]
    : null;
  const primaryHref = buildPlayHref(
    primaryRoom && primaryCategory
      ? `/spinpro/${primaryCategory.slug}/${primaryRoom.id}`
      : "/spinpro",
    isSignedIn,
  );

  useEffect(() => {
    let cancelled = false;

    async function loadPreviewRooms() {
      const entries = await Promise.all(
        previewCategories.map(async (category) => {
          try {
            return [
              category.slug,
              await apiClient.getRoomsByCategory(category.slug),
            ] as const;
          } catch {
            return [category.slug, []] as const;
          }
        }),
      );

      if (!cancelled) {
        setRoomsBySlug(Object.fromEntries(entries));
      }
    }

    if (previewCategories.length > 0) {
      void loadPreviewRooms();
    }

    return () => {
      cancelled = true;
    };
  }, [previewCategories]);

  return (
    <GameShell>
      <PromoHero primaryHref={primaryHref} />

      <div className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 py-8 md:px-8 md:py-10">
        {error ? (
          <div className="rounded-md border border-[rgba(248,113,113,0.42)] bg-[rgba(248,113,113,0.12)] px-4 py-3 text-sm font-semibold text-red-hot">
            {error}
          </div>
        ) : null}

        <section>
          <SectionHeader eyebrow="Choose your wheel" title="Play modes" />
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <ModeCard mode="pro" href="/spinpro?mode=pro" />
            <ModeCard mode="fixed" href="/spinpro?mode=fixed" />
          </div>
        </section>

        <section>
          <SectionHeader
            eyebrow="Live rooms"
            title="Popular categories"
            action={
              <Link
                href="/spinpro"
                className="text-sm font-black text-gold transition hover:text-[#FFD76A]"
              >
                See all
              </Link>
            }
          />

          {loading ? (
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              {[0, 1, 2].map((item) => (
                <div
                  key={item}
                  className="h-[220px] animate-pulse rounded-lg border border-[var(--border)] bg-white/[0.04]"
                />
              ))}
            </div>
          ) : (
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              {previewCategories.map((category) => (
                <CategoryCard
                  key={category.slug}
                  category={category}
                  room={roomsBySlug[category.slug]?.[0] ?? null}
                  isSignedIn={isSignedIn}
                />
              ))}
            </div>
          )}
        </section>

        <section className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-5">
            <StatusPill tone="lime">Pro</StatusPill>
            <h2 className="mt-3 font-display text-2xl font-black">
              Flexible Proportional
            </h2>
            <p className="mt-2 text-sm leading-6 text-text-secondary">
              Choose any allowed amount in the room. Your chance follows your
              confirmed ticket range for that round.
            </p>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-5">
            <StatusPill tone="purple">Fixed</StatusPill>
            <h2 className="mt-3 font-display text-2xl font-black">
              Fixed Equal Chance
            </h2>
            <p className="mt-2 text-sm leading-6 text-text-secondary">
              Enter once at the fixed amount. Accepted players share the same
              chance while the round is open.
            </p>
          </div>
        </section>
      </div>
    </GameShell>
  );
}
