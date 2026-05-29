"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { GameShell } from "../../../components/player/game-shell";
import { SectionHeader } from "../../../components/player/section-header";
import { StatusPill } from "../../../components/player/status-pill";
import { buttonClassName } from "../../../components/ui/button";
import { apiClient, type RoomListItem } from "../../../lib/api-client";
import { useSession } from "../../../lib/auth-client";
import {
  buildPlayHref,
  getCategoryAmountLabel,
  getCategoryMode,
  getModeTag,
  getModeTitle,
} from "../../../lib/game-modes";
import { formatCoins } from "../../../lib/format";
import { useCategories } from "../../../hooks/use-categories";

export default function CategoryLobbyPage() {
  const params = useParams<{ categorySlug: string }>();
  const categorySlug = params.categorySlug;
  const { data: session } = useSession();
  const { categories } = useCategories();
  const [rooms, setRooms] = useState<RoomListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const category = useMemo(
    () => categories.find((item) => item.slug === categorySlug) ?? null,
    [categories, categorySlug],
  );
  const mode = category ? getCategoryMode(category) : "pro";
  const isSignedIn = Boolean(session?.user);

  useEffect(() => {
    let cancelled = false;

    async function loadRooms() {
      setLoading(true);
      setError(null);

      try {
        const nextRooms = await apiClient.getRoomsByCategory(categorySlug);

        if (!cancelled) {
          setRooms(nextRooms);
        }
      } catch (caught) {
        if (!cancelled) {
          setRooms([]);
          setError(
            caught instanceof Error ? caught.message : "Could not load rooms.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadRooms();

    return () => {
      cancelled = true;
    };
  }, [categorySlug]);

  return (
    <GameShell backHref="/spinpro">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8">
        <section className="border-b border-[var(--border)] pb-6">
          <StatusPill tone={mode === "fixed" ? "purple" : "lime"}>
            {category ? getModeTag(mode) : "Category"}
          </StatusPill>
          <h1 className="mt-4 font-display text-4xl font-black tracking-normal md:text-6xl">
            {category?.name ?? categorySlug}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-text-secondary">
            {category
              ? `${getModeTitle(mode)} · ${getCategoryAmountLabel(category)}`
              : "Loading category details."}
          </p>
        </section>

        {error ? (
          <div className="mt-5 rounded-md border border-[rgba(248,113,113,0.42)] bg-[rgba(248,113,113,0.12)] px-4 py-3 text-sm font-semibold text-red-hot">
            {error}
          </div>
        ) : null}

        <section className="mt-6">
          <SectionHeader eyebrow="Active room" title="Permanent room" />

          {loading ? (
            <div className="mt-5 h-[220px] animate-pulse rounded-lg border border-[var(--border)] bg-white/[0.04]" />
          ) : (
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {rooms.map((room) => {
                const roomHref = `/spinpro/${categorySlug}/${room.id}`;
                const currentRound = room.currentRound;

                return (
                  <Link
                    key={room.id}
                    href={buildPlayHref(roomHref, isSignedIn)}
                    className="group rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-5 transition hover:border-[var(--border-glow)] hover:bg-[var(--bg-raised)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-sm font-black text-teal">
                          {room.code}
                        </p>
                        <h2 className="mt-1 font-display text-2xl font-black">
                          {room.name ?? "SpinPro Room"}
                        </h2>
                      </div>
                      <StatusPill
                        tone={
                          currentRound?.status === "OPEN" ? "lime" : "muted"
                        }
                      >
                        {currentRound?.status ?? room.status}
                      </StatusPill>
                    </div>

                    <div className="mt-5 grid grid-cols-2 gap-2 text-sm">
                      <div className="rounded-md border border-[var(--border)] bg-white/[0.035] px-3 py-2">
                        <p className="text-xs font-bold uppercase tracking-[0.12em] text-text-dim">
                          Players
                        </p>
                        <p className="mt-1 font-mono font-black">
                          {currentRound?.playerCount ?? 0}/{room.maxPlayers}
                        </p>
                      </div>
                      <div className="rounded-md border border-[var(--border)] bg-white/[0.035] px-3 py-2">
                        <p className="text-xs font-bold uppercase tracking-[0.12em] text-text-dim">
                          Pool
                        </p>
                        <p className="mt-1 font-mono font-black text-gold">
                          {formatCoins(currentRound?.payoutAmount ?? "0")}
                        </p>
                      </div>
                    </div>

                    <span
                      className={`${buttonClassName("primary")} mt-5 w-full`}
                    >
                      {isSignedIn ? "Join room" : "Sign in to join"}
                      <ArrowRight
                        className="ml-2 h-4 w-4 transition group-hover:translate-x-0.5"
                        aria-hidden="true"
                      />
                    </span>
                  </Link>
                );
              })}
            </div>
          )}

          {!loading && rooms.length === 0 ? (
            <div className="mt-6 rounded-lg border border-dashed border-[var(--border)] bg-white/[0.03] px-4 py-10 text-center text-text-secondary">
              No active room is available for this category.
            </div>
          ) : null}
        </section>
      </div>
    </GameShell>
  );
}
