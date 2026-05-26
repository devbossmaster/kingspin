"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DevPlayerBalance,
  LatestRoundResult,
  RoomLiveState,
  SocketMachineEvent,
} from "@kingspin/contracts";
import { apiClient } from "../lib/api-client";
import { getGameSocket } from "../lib/socket-client";
import { useRoomStore } from "../stores/room-store";

export function useRoom(roomId: string, playerKey?: string) {
  const [state, setState] = useState<RoomLiveState | null>(null);
  const [latestResult, setLatestResult] = useState<LatestRoundResult | null>(
    null,
  );
  const [devBalance, setDevBalance] = useState<DevPlayerBalance | null>(null);
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

  const refreshDevBalance = useCallback(async () => {
    if (!playerKey) return null;

    try {
      const balance = await apiClient.getDevPlayerBalance(playerKey);
      setDevBalance(balance);
      return balance;
    } catch {
      setDevBalance(null);
      return null;
    }
  }, [playerKey]);

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
    void refreshDevBalance();
  }, [refreshDevBalance]);

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
        void refreshDevBalance();
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
    refreshDevBalance,
    roomId,
    setConnectionStatus,
    showWinner,
  ]);

  const placeDevEntry = useCallback(
    async (args: { playerKey: string; amount: number }) => {
      if (!roomId) return;

      setIsPlacingEntry(true);
      setError(null);

      try {
        await apiClient.devPlaceEntry(roomId, {
          playerKey: args.playerKey,
          amount: args.amount,
          idempotencyKey: `${args.playerKey}:${roomId}:${Date.now()}`,
        });

        await refresh();
        await refreshDevBalance();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Failed to place entry.");
      } finally {
        setIsPlacingEntry(false);
      }
    },
    [refresh, refreshDevBalance, roomId],
  );

  const entriesTotal = useMemo(() => {
    return state?.entries.reduce((sum, entry) => sum + Number(entry.amount), 0) ?? 0;
  }, [state?.entries]);

  return {
    state,
    latestResult,
    devBalance,
    error,
    isPlacingEntry,
    entriesTotal,
    refresh,
    refreshDevBalance,
    fetchLatestResult,
    placeDevEntry,
  };
}
