"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { NavBar } from "../../components/layout/nav-bar";
import { Badge } from "../../components/ui/badge";
import { apiClient, type RoomListItem } from "../../lib/api-client";
import { formatCoins } from "../../lib/format";
import { useCategories } from "../../hooks/use-categories";

export default function SpinProLobbyPage() {
  const { categories, loading: categoriesLoading, error: categoriesError } =
    useCategories();
  const [rooms, setRooms] = useState<RoomListItem[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [isLoadingRooms, setIsLoadingRooms] = useState(false);
  const [roomsError, setRoomsError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedSlug((current) => current ?? categories[0]?.slug ?? null);
  }, [categories]);

  useEffect(() => {
    if (!selectedSlug) return;

    let cancelled = false;
    const categorySlug = selectedSlug;

    async function loadRooms() {
      setIsLoadingRooms(true);
      setRoomsError(null);

      try {
        const nextRooms = await apiClient.getRoomsByCategory(categorySlug);

        if (!cancelled) {
          setRooms(nextRooms);
        }
      } catch (loadError) {
        if (!cancelled) {
          setRooms([]);
          setRoomsError(
            loadError instanceof Error ? loadError.message : "Could not load rooms.",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingRooms(false);
        }
      }
    }

    void loadRooms();

    return () => {
      cancelled = true;
    };
  }, [selectedSlug]);

  const selectedCategory = useMemo(
    () => categories.find((category) => category.slug === selectedSlug) ?? null,
    [categories, selectedSlug],
  );

  return (
    <main className="min-h-screen text-text-primary">
      <NavBar />

      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8">
        <section className="border-b border-[var(--border)] pb-6">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-gold">
            Live wheel rooms
          </p>
          <h1 className="mt-2 font-display text-4xl font-black tracking-normal md:text-6xl">
            Pick a room. Beat the clock.
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-text-secondary">
            Server-timed rounds, wallet-backed entries, and fairness proofs after every settled spin.
          </p>
        </section>

        {categoriesError || roomsError ? (
          <div className="rounded-md border border-[rgba(248,113,113,0.42)] bg-[rgba(248,113,113,0.12)] px-4 py-3 text-sm text-red-hot">
            {categoriesError ?? roomsError}
          </div>
        ) : null}

        <section className="grid gap-6 lg:grid-cols-[260px_1fr]">
          <aside className="space-y-3">
            {categoriesLoading ? (
              <div className="rounded-md border border-[var(--border)] bg-white/[0.04] px-4 py-3 text-sm text-text-secondary">
                Loading categories
              </div>
            ) : null}

            {categories.map((category) => (
              <button
                key={category.id}
                onClick={() => setSelectedSlug(category.slug)}
                className={`w-full rounded-md border px-4 py-3 text-left transition ${
                  category.slug === selectedSlug
                    ? "border-[var(--gold)] bg-[var(--gold)] text-[var(--bg-void)] shadow-[var(--glow-gold)]"
                    : "border-[var(--border)] bg-white/[0.04] text-text-primary hover:border-[var(--border-glow)]"
                }`}
              >
                <span className="block font-display text-sm font-black">
                  {category.name}
                </span>
                <span className="mt-1 block font-mono text-xs opacity-75">
                  {formatCoins(category.minEntryAmount)}-
                  {formatCoins(category.maxEntryAmount)} coins
                </span>
              </button>
            ))}
          </aside>

          <div className="arcadia-surface min-h-[420px] rounded-lg p-4 md:p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-teal">
                  {selectedCategory?.name ?? "Rooms"}
                </p>
                <h2 className="mt-1 font-display text-2xl font-black">
                  Permanent active rooms
                </h2>
              </div>
              <p className="font-mono text-sm text-text-secondary">
                {isLoadingRooms ? "Loading" : `${rooms.length} available`}
              </p>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {rooms.map((room) => (
                <Link
                  key={room.id}
                  href={`/spinpro/${selectedSlug}/${room.id}`}
                  className="group rounded-md border border-[var(--border)] bg-white/[0.04] p-4 transition hover:border-[var(--border-glow)] hover:bg-white/[0.07]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-xs text-teal">{room.code}</p>
                      <h3 className="mt-1 font-display text-lg font-black">
                        {room.name ?? "SpinPro Room"}
                      </h3>
                    </div>
                    <Badge variant="success">{room.status}</Badge>
                  </div>
                  <div className="mt-5 grid grid-cols-2 gap-2 text-sm text-text-secondary">
                    <div>
                      <p className="text-xs text-text-dim">Max players</p>
                      <p className="font-mono font-bold text-text-primary">
                        {room.maxPlayers}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-text-dim">Round</p>
                      <p className="font-mono font-bold text-text-primary">
                        {Math.round(room.roundDurationMs / 1000)}s
                      </p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>

            {!isLoadingRooms && rooms.length === 0 ? (
              <div className="mt-8 rounded-md border border-[var(--border)] bg-white/[0.04] px-4 py-8 text-center text-sm text-text-secondary">
                No active rooms in this category.
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
