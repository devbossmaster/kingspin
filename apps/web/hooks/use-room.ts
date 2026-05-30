"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  EntryWithPlayerSnapshot,
  LatestRoundResult,
  RoomLiveState,
  SocketMachineEvent,
  SocketPresenceEvent,
  SocketRoundStateEvent,
  WalletSnapshot,
} from "@kingspin/contracts";
import { apiClient, type PlaceEntryResponse } from "../lib/api-client";
import { deriveChipOptions } from "../lib/format";
import { getGameSocket } from "../lib/socket-client";
import { useAuthStore } from "../stores/auth-store";
import { useRoomStore } from "../stores/room-store";

type LiveEntry = RoomLiveState["entries"][number];

function createIdempotencyKey(roomId: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `entry:${roomId}:${crypto.randomUUID()}`;
  }

  return `entry:${roomId}:${Date.now()}`;
}

function compareEntriesByCreatedAt(left: LiveEntry, right: LiveEntry) {
  const leftTime = new Date(left.createdAt).getTime();
  const rightTime = new Date(right.createdAt).getTime();

  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  return left.id.localeCompare(right.id);
}

export function useRoom(roomId: string) {
  const [state, setState] = useState<RoomLiveState | null>(null);
  const [latestResult, setLatestResult] = useState<LatestRoundResult | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [isPlacingEntry, setIsPlacingEntry] = useState(false);
  const [fastWallet, setFastWallet] = useState<WalletSnapshot | null>(null);
  const placingEntryRef = useRef(false);

  const user = useAuthStore((store) => store.user);
  const wallet = useAuthStore((store) => store.wallet);
  const fetchMe = useAuthStore((store) => store.fetchMe);
  const fetchWallet = useAuthStore((store) => store.fetchWallet);

  const setConnectionStatus = useRoomStore(
    (store) => store.setConnectionStatus,
  );
  const setChipOptions = useRoomStore((store) => store.setChipOptions);
  const showWinner = useRoomStore((store) => store.showWinner);
  const dismissWinner = useRoomStore((store) => store.dismissWinner);

  const visibleWallet = fastWallet ?? wallet;

  const applyState = useCallback(
    (nextState: RoomLiveState) => {
      setState(nextState);
      setChipOptions(
        deriveChipOptions(
          nextState.category.minEntryAmount,
          nextState.category.maxEntryAmount,
        ),
      );
    },
    [setChipOptions],
  );

  const applyEntryPlacementResult = useCallback(
    (result: PlaceEntryResponse) => {
      setState((currentState) => {
        if (!currentState) {
          return currentState;
        }

        const confirmedEntry: LiveEntry = {
          ...result.entry,
          player: result.player,
        };

        const entriesWithoutDuplicate = currentState.entries.filter((entry) => {
          if (entry.id === confirmedEntry.id) {
            return false;
          }

          return !(
            entry.roundId === confirmedEntry.roundId &&
            entry.userId === confirmedEntry.userId
          );
        });

        const entries = [...entriesWithoutDuplicate, confirmedEntry].sort(
          compareEntriesByCreatedAt,
        );

        return {
          ...currentState,
          currentRound: result.currentRound ?? currentState.currentRound,
          entries,
        };
      });

      setFastWallet(result.wallet);
      setWalletError(null);
    },
    [],
  );

  const refresh = useCallback(async () => {
    if (!roomId) return;

    try {
      setError(null);
      const nextState = await apiClient.getRoomLiveState(roomId);
      applyState(nextState);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Failed to load room.",
      );
    }
  }, [applyState, roomId]);

  const refreshWallet = useCallback(async () => {
    const result = await fetchWallet();

    if (result) {
      setWalletError(null);
      setFastWallet(null);
      return result;
    }

    setWalletError(
      "Wallet unavailable until the API auth bridge validates this session.",
    );
    return null;
  }, [fetchWallet]);

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
    void fetchMe();
    void refreshWallet();
  }, [fetchMe, refreshWallet]);

  useEffect(() => {
    if (!roomId) return;

    const socket = getGameSocket();
    const settlementTimers: number[] = [];

    setConnectionStatus(socket.connected ? "connected" : "connecting");

    const onConnect = () => {
      setConnectionStatus("connected");
      socket.emit("room:join", { roomId });
    };

    const onDisconnect = () => {
      setConnectionStatus("disconnected");
    };

    const onRoundState = (payload: SocketRoundStateEvent) => {
      if (payload.roomId !== roomId) return;

      applyState({
        serverNow: payload.snapshot.serverNow ?? payload.emittedAt,
        ...payload.snapshot,
      });
    };

    const onMachineEvent = (payload: SocketMachineEvent) => {
      if (payload.roomId !== roomId) return;

      if (payload.action === "STARTED_OPEN_ROUND") {
        setLatestResult(null);
        dismissWinner();
        return;
      }

      if (
        payload.action === "SETTLED_ROUND" ||
        payload.action === "RESUMED_SETTLEMENT"
      ) {
        const timeout = window.setTimeout(() => {
          void (async () => {
            const result = await fetchLatestResult();

            if (result) {
              showWinner(result);
            }

            await refreshWallet();
          })();
        }, 5500);

        settlementTimers.push(timeout);
      }
    };

    const onPresence = (payload: SocketPresenceEvent) => {
      if (payload.roomId !== roomId) return;
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("round:state", onRoundState);
    socket.on("round:updated", onMachineEvent);
    socket.on("round:locked", onMachineEvent);
    socket.on("round:spinning", onMachineEvent);
    socket.on("round:settled", onMachineEvent);
    socket.on("room:player-joined", onPresence);
    socket.on("room:player-left", onPresence);

    if (socket.connected) {
      socket.emit("room:join", { roomId });
    } else {
      void refresh();
    }

    return () => {
      socket.emit("room:leave", { roomId });
      settlementTimers.forEach((timeout) => window.clearTimeout(timeout));

      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("round:state", onRoundState);
      socket.off("round:updated", onMachineEvent);
      socket.off("round:locked", onMachineEvent);
      socket.off("round:spinning", onMachineEvent);
      socket.off("round:settled", onMachineEvent);
      socket.off("room:player-joined", onPresence);
      socket.off("room:player-left", onPresence);
    };
  }, [
    applyState,
    dismissWinner,
    fetchLatestResult,
    refresh,
    refreshWallet,
    roomId,
    setConnectionStatus,
    showWinner,
  ]);

  useEffect(() => {
    void fetchLatestResult();
  }, [fetchLatestResult]);

  const placeEntry = useCallback(
    async (amount: number) => {
      if (!roomId || placingEntryRef.current) return;

      if (!visibleWallet) {
        setError("Sign in required.");
        return;
      }

      placingEntryRef.current = true;
      setIsPlacingEntry(true);
      setError(null);

      try {
        const result = await apiClient.placeEntry(roomId, {
          amount,
          idempotencyKey: createIdempotencyKey(roomId),
        });

        applyEntryPlacementResult(result);

        void refreshWallet();

        if (!getGameSocket().connected) {
          void refresh();
        }
      } catch (caught) {
        setFastWallet(null);
        setError(
          caught instanceof Error ? caught.message : "Failed to place entry.",
        );

        void refreshWallet();

        if (!getGameSocket().connected) {
          void refresh();
        }
      } finally {
        placingEntryRef.current = false;
        setIsPlacingEntry(false);
      }
    },
    [applyEntryPlacementResult, refresh, refreshWallet, roomId, visibleWallet],
  );

  const entriesTotal = useMemo(() => {
    return (
      state?.entries.reduce((sum, entry) => sum + Number(entry.amount), 0) ?? 0
    );
  }, [state?.entries]);

  const myEntry = useMemo<EntryWithPlayerSnapshot | null>(() => {
    if (!user || !state) {
      return null;
    }

    return state.entries.find((entry) => entry.player?.id === user.id) ?? null;
  }, [state, user]);

  return {
    state,
    latestResult,
    user,
    wallet: visibleWallet,
    meWallet: user && visibleWallet ? { user, wallet: visibleWallet } : null,
    error,
    walletError,
    isPlacingEntry,
    entriesTotal,
    myEntry,
    refresh,
    refreshWallet,
    fetchLatestResult,
    placeEntry,
  };
}

