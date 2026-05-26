"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  LatestRoundResult,
  MeWallet,
  RoomLiveState,
  SocketMachineEvent,
} from "@kingspin/contracts";
import { apiClient } from "../lib/api-client";
import { getGameSocket } from "../lib/socket-client";
import { useRoomStore } from "../stores/room-store";

function createIdempotencyKey(roomId: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `entry:${roomId}:${crypto.randomUUID()}`;
  }

  return `entry:${roomId}:${Date.now()}`;
}

export function useRoom(roomId: string) {
  const [state, setState] = useState<RoomLiveState | null>(null);
  const [latestResult, setLatestResult] = useState<LatestRoundResult | null>(
    null,
  );
  const [meWallet, setMeWallet] = useState<MeWallet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPlacingEntry, setIsPlacingEntry] = useState(false);

  const setConnectionStatus = useRoomStore((store) => store.setConnectionStatus);
  const showWinner = useRoomStore((store) => store.showWinner);

  const refresh = useCallback(async () => {
    if (!roomId) return;

    try {
      setError(null);
      const nextState = await apiClient.getRoomLiveState(roomId);
      setState(nextState);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load room.");
    }
  }, [roomId]);

  const refreshWallet = useCallback(async () => {
    try {
      const wallet = await apiClient.getMeWallet();
      setMeWallet(wallet);
      return wallet;
    } catch {
      setMeWallet(null);
      return null;
    }
  }, []);

  const fetchLatestResult = useCallback(async () => {
    if (!roomId) return null;

    try {
      const result = await apiClient.getLatestRoundResult(roomId);
      setLatestResult(result);
      return result;
    } catch {
      return null;
    }
  }, [roomId]);

  useEffect(() => {
    void refreshWallet();
  }, [refreshWallet]);

  useEffect(() => {
    if (!roomId) return;

    void refresh();

    const socket = getGameSocket();

    setConnectionStatus(socket.connected ? "connected" : "connecting");

    const onConnect = () => {
      setConnectionStatus("connected");
      socket.emit("room:join", { roomId });
    };

    const onDisconnect = () => {
      setConnectionStatus("disconnected");
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    socket.on("round:state", (payload) => {
      if (payload.roomId !== roomId) return;

      setState({
        serverNow: payload.snapshot.serverNow ?? payload.emittedAt,
        ...payload.snapshot,
      });
    });

    const onMachineEvent = (payload: SocketMachineEvent) => {
      if (payload.roomId !== roomId) return;

      if (
        payload.action === "SETTLED_ROUND" ||
        payload.action === "RESUMED_SETTLEMENT"
      ) {
        showWinner(payload);
        void fetchLatestResult();
        void refreshWallet();
      }
    };

    socket.on("round:updated", onMachineEvent);
    socket.on("round:locked", onMachineEvent);
    socket.on("round:spinning", onMachineEvent);
    socket.on("round:settled", onMachineEvent);

    if (socket.connected) {
      socket.emit("room:join", { roomId });
    }

    return () => {
      socket.emit("room:leave", { roomId });

      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("round:state");
      socket.off("round:updated", onMachineEvent);
      socket.off("round:locked", onMachineEvent);
      socket.off("round:spinning", onMachineEvent);
      socket.off("round:settled", onMachineEvent);
    };
  }, [
    fetchLatestResult,
    refresh,
    refreshWallet,
    roomId,
    setConnectionStatus,
    showWinner,
  ]);

  const placeEntry = useCallback(
    async (args: { amount: number }) => {
      if (!roomId) return;

      if (!meWallet) {
        setError("Sign in required.");
        return;
      }

      setIsPlacingEntry(true);
      setError(null);

      try {
        await apiClient.placeEntry(roomId, {
          amount: args.amount,
          idempotencyKey: createIdempotencyKey(roomId),
        });

        await refresh();
        await refreshWallet();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Failed to place entry.");
      } finally {
        setIsPlacingEntry(false);
      }
    },
    [meWallet, refresh, refreshWallet, roomId],
  );

  const entriesTotal = useMemo(() => {
    return state?.entries.reduce((sum, entry) => sum + Number(entry.amount), 0) ?? 0;
  }, [state?.entries]);

  return {
    state,
    latestResult,
    meWallet,
    error,
    isPlacingEntry,
    entriesTotal,
    refresh,
    refreshWallet,
    fetchLatestResult,
    placeEntry,
  };
}
