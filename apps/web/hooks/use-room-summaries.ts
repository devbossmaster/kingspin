"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SocketCategoryStateEvent } from "@kingspin/contracts";
import { apiClient, type RoomListItem } from "../lib/api-client";
import { getGameSocket } from "../lib/socket-client";

type RoomsBySlug = Record<string, RoomListItem[]>;

function normalizeRooms(rooms: RoomListItem[]) {
  const receivedAtMs = Date.now();

  return rooms.map((room) => ({ ...room, receivedAtMs }));
}

export function useRoomSummaries(categorySlugs: string[]) {
  const normalizedSlugs = useMemo(
    () =>
      Array.from(
        new Set(
          categorySlugs
            .map((slug) => slug.trim())
            .filter((slug) => slug.length > 0),
        ),
      ),
    [categorySlugs],
  );
  const slugKey = normalizedSlugs.join("|");
  const [roomsBySlug, setRoomsBySlug] = useState<RoomsBySlug>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    async (showLoading = false) => {
      if (normalizedSlugs.length === 0) {
        setRoomsBySlug({});
        setLoading(false);
        return;
      }

      if (showLoading) {
        setLoading(true);
      }

      let nextError: string | null = null;
      const entries = await Promise.all(
        normalizedSlugs.map(async (categorySlug) => {
          try {
            const rooms = await apiClient.getRoomsByCategory(categorySlug);
            return [categorySlug, normalizeRooms(rooms)] as const;
          } catch (caught) {
            nextError =
              caught instanceof Error
                ? caught.message
                : "Could not load rooms.";
            return [categorySlug, []] as const;
          }
        }),
      );

      setRoomsBySlug((current) => ({
        ...current,
        ...Object.fromEntries(entries),
      }));
      setError(nextError);
      setLoading(false);
    },
    [slugKey],
  );

  useEffect(() => {
    let cancelled = false;

    setLoading(normalizedSlugs.length > 0);
    void refresh(true).finally(() => {
      if (!cancelled) {
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [refresh, slugKey]);

  useEffect(() => {
    if (normalizedSlugs.length === 0) {
      return;
    }

    const socket = getGameSocket();

    const joinCategories = () => {
      for (const categorySlug of normalizedSlugs) {
        socket.emit("category:join", { categorySlug });
      }
    };

    const onConnect = () => {
      joinCategories();
      void refresh(false);
    };

    const onCategoryState = (payload: SocketCategoryStateEvent) => {
      if (!normalizedSlugs.includes(payload.categorySlug)) {
        return;
      }

      setRoomsBySlug((current) => ({
        ...current,
        [payload.categorySlug]: normalizeRooms(payload.rooms),
      }));
      setError(null);
      setLoading(false);
    };

    socket.on("connect", onConnect);
    socket.on("category:state", onCategoryState);

    if (socket.connected) {
      joinCategories();
    } else {
      socket.connect();
    }

    return () => {
      for (const categorySlug of normalizedSlugs) {
        socket.emit("category:leave", { categorySlug });
      }

      socket.off("connect", onConnect);
      socket.off("category:state", onCategoryState);
    };
  }, [refresh, slugKey]);

  return {
    roomsBySlug,
    loading,
    error,
    refresh,
  };
}
