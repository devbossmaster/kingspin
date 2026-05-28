"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { NavBar } from "../../../components/layout/nav-bar";
import { RoomCard } from "../../../components/spinpro/room-card";
import { apiClient, type RoomListItem } from "../../../lib/api-client";
import { useCategories } from "../../../hooks/use-categories";

export default function CategoryLobbyPage() {
  const params = useParams<{ categorySlug: string }>();
  const categorySlug = params.categorySlug;
  const { categories } = useCategories();
  const [rooms, setRooms] = useState<RoomListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const category = useMemo(
    () => categories.find((item) => item.slug === categorySlug) ?? null,
    [categories, categorySlug],
  );

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
          setError(caught instanceof Error ? caught.message : "Could not load rooms.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadRooms();
    const interval = window.setInterval(() => void loadRooms(), 15_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [categorySlug]);

  return (
    <main className="min-h-screen text-text-primary">
      <NavBar backHref="/" />

      <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8">
        <Link href="/" className="text-sm font-bold text-gold">
          Back to categories
        </Link>

        <div className="mt-5 flex flex-wrap items-end justify-between gap-3 border-b border-[var(--border)] pb-5">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-teal">
              Category lobby
            </p>
            <h1 className="mt-2 font-display text-4xl font-black">
              {category?.name ?? categorySlug}
            </h1>
          </div>
          <p className="font-mono text-sm text-text-secondary">
            {loading ? "Loading" : `${rooms.length} active rooms`}
          </p>
        </div>

        {error ? (
          <div className="mt-5 rounded-md border border-[rgba(248,113,113,0.42)] bg-[rgba(248,113,113,0.12)] px-4 py-3 text-sm text-red-hot">
            {error}
          </div>
        ) : null}

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rooms.map((room) => (
            <RoomCard key={room.id} room={room} categorySlug={categorySlug} />
          ))}
        </div>

        {!loading && rooms.length === 0 ? (
          <div className="mt-8 rounded-lg border border-[var(--border)] bg-white/[0.04] px-4 py-10 text-center text-text-secondary">
            No active rooms in this category.
          </div>
        ) : null}
      </div>
    </main>
  );
}
