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
import { toastGameError } from "../lib/error-toast";
import { deriveChipOptions } from "../lib/format";
import { getPublicRoundPhase } from "../lib/room-summary";
import { getGameSocket } from "../lib/socket-client";
import { useAuthStore } from "../stores/auth-store";
import { useRoomStore } from "../stores/room-store";

type LiveEntry = RoomLiveState["entries"][number];
type RoundSnapshot = NonNullable<RoomLiveState["currentRound"]>;
type RoundLiveStateRound = RoomLiveState["currentRound"];

type PendingLiveEntry = LiveEntry & {
  pending?: boolean;
  optimisticKey?: string;
  optimisticBaseEntryId?: string | null;
};

const OPEN_ROUND_MACHINE_ACTIONS = new Set([
  "STARTED_OPEN_ROUND",
  "CANCELLED_EMPTY_ROUND_AND_STARTED_NEXT",
  "CANCELLED_SINGLE_PLAYER_ROUND_AND_STARTED_NEXT",
  "CANCELLED_EMPTY_LOCKED_ROUND_AND_STARTED_NEXT",
  "CANCELLED_SINGLE_PLAYER_LOCKED_ROUND_AND_STARTED_NEXT",
  "STARTED_NEXT_ROUND_AFTER_COMPLETION",
]);

const RESULT_STATE_SYNC_BUFFER_MS = 250;
const RESULT_STATE_SYNC_RETRY_MS = 1200;
const RESULT_STATE_SYNC_MAX_ATTEMPTS = 20;

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

function isCompletedRound(round: RoundLiveStateRound | null | undefined) {
  return round?.status === "COMPLETED";
}

function isNewOpenRound(
  previousRound: RoundLiveStateRound | null | undefined,
  nextRound: RoundLiveStateRound | null | undefined,
) {
  if (!nextRound || getPublicRoundPhase(nextRound) !== "ENTRY_OPEN") {
    return false;
  }

  if (!previousRound) return true;

  return previousRound.id !== nextRound.id;
}

function calculateNetPrizeAmount(totalEntryAmount: string, platformFeeBps = 0) {
  try {
    const total = BigInt(totalEntryAmount || "0");
    const feeBps = BigInt(platformFeeBps);
    const fee = (total * feeBps) / 10_000n;

    return (total - fee).toString();
  } catch {
    return totalEntryAmount;
  }
}

function devLog(message: string, details?: unknown) {
  if (process.env.NODE_ENV === "production") return;

  if (details === undefined) {
    console.log(`[room] ${message}`);
    return;
  }

  console.log(`[room] ${message}`, details);
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
  const lastRoundRef = useRef<RoundLiveStateRound | null>(null);
  const lastNonNullStateRef = useRef<RoomLiveState | null>(null);
  const transientNoRoundSinceRef = useRef<number | null>(null);
  const resultFetchTimerRef = useRef<number | null>(null);
  const resultStateRefreshTimerRef = useRef<number | null>(null);
  const walletRefreshTimerRef = useRef<number | null>(null);
  const pendingEntriesRef = useRef<Map<string, PendingLiveEntry>>(new Map());
  const pendingEntryBackupsRef = useRef<Map<string, LiveEntry | null>>(
    new Map(),
  );

  const user = useAuthStore((store) => store.user);
  const wallet = useAuthStore((store) => store.wallet);
  const fetchMe = useAuthStore((store) => store.fetchMe);
  const fetchWallet = useAuthStore((store) => store.fetchWallet);

  const setConnectionStatus = useRoomStore(
    (store) => store.setConnectionStatus,
  );
  const setChipOptions = useRoomStore((store) => store.setChipOptions);

  const visibleWallet = fastWallet ?? wallet;

  const clearResultTimer = useCallback(() => {
    if (resultFetchTimerRef.current !== null) {
      window.clearTimeout(resultFetchTimerRef.current);
      resultFetchTimerRef.current = null;
    }
  }, []);

  const clearResultStateRefreshTimer = useCallback(() => {
    if (resultStateRefreshTimerRef.current !== null) {
      window.clearTimeout(resultStateRefreshTimerRef.current);
      resultStateRefreshTimerRef.current = null;
    }
  }, []);

  const clearWalletTimer = useCallback(() => {
    if (walletRefreshTimerRef.current !== null) {
      window.clearTimeout(walletRefreshTimerRef.current);
      walletRefreshTimerRef.current = null;
    }
  }, []);

  const mergePendingEntries = useCallback((nextState: RoomLiveState) => {
    if (!nextState.currentRound || pendingEntriesRef.current.size === 0) {
      return nextState;
    }

    const pendingEntries = [...pendingEntriesRef.current.values()].filter(
      (entry) => entry.roundId === nextState.currentRound?.id,
    );

    if (pendingEntries.length === 0) {
      return nextState;
    }

    const entries = [...nextState.entries] as PendingLiveEntry[];

    for (const pendingEntry of pendingEntries) {
      const existingIndex = entries.findIndex((entry) => {
        return (
          entry.id === pendingEntry.optimisticBaseEntryId ||
          entry.id === pendingEntry.id ||
          entry.userId === pendingEntry.userId
        );
      });

      if (existingIndex >= 0) {
        entries[existingIndex] = pendingEntry;
      } else {
        entries.push(pendingEntry);
      }
    }

    return {
      ...nextState,
      entries: entries.sort(compareEntriesByCreatedAt),
    };
  }, []);

  const normalizeIncomingState = useCallback((nextState: RoomLiveState) => {
    const previousState = lastNonNullStateRef.current;
    const previousRound = previousState?.currentRound ?? null;
    const nextRound = nextState.currentRound ?? null;

    if (nextRound) {
      transientNoRoundSinceRef.current = null;
      lastNonNullStateRef.current = nextState;
      return nextState;
    }

    if (!previousState || !previousRound) {
      transientNoRoundSinceRef.current = Date.now();
      return nextState;
    }

    const elapsedMs =
      transientNoRoundSinceRef.current === null
        ? 0
        : Date.now() - transientNoRoundSinceRef.current;

    if (transientNoRoundSinceRef.current === null) {
      transientNoRoundSinceRef.current = Date.now();
    }

    if (elapsedMs < 5_000) {
      devLog("ignored transient no-round snapshot", {
        previousRoundId: previousRound.id,
        previousRoundNumber: previousRound.roundNumber,
        previousStatus: previousRound.status,
        incomingServerNow: nextState.serverNow,
      });

      return {
        ...previousState,
        serverNow: nextState.serverNow,
      };
    }

    return nextState;
  }, []);

  const applyState = useCallback(
    (nextState: RoomLiveState) => {
      const normalizedState = mergePendingEntries(
        normalizeIncomingState(nextState),
      );

      const previousRound = lastRoundRef.current;
      const nextRound = normalizedState.currentRound;

      if (
        previousRound?.status !== nextRound?.status ||
        previousRound?.phase !== nextRound?.phase
      ) {
        devLog("round phase changed", {
          from: previousRound?.status ?? null,
          to: nextRound?.status ?? null,
          publicFrom: previousRound?.phase ?? null,
          publicTo: nextRound?.phase ?? null,
          roundId: nextRound?.id ?? null,
          roundNumber: nextRound?.roundNumber ?? null,
        });
      }

      if (isNewOpenRound(previousRound, nextRound)) {
        clearResultTimer();
        clearResultStateRefreshTimer();
        clearWalletTimer();
        pendingEntriesRef.current.clear();
        pendingEntryBackupsRef.current.clear();
        setLatestResult(null);
        setFastWallet(null);
      }

      lastRoundRef.current = nextRound ?? null;

      setState(normalizedState);
      setChipOptions(
        deriveChipOptions(
          normalizedState.category.minEntryAmount,
          normalizedState.category.maxEntryAmount,
        ),
      );

      return normalizedState;
    },
    [
      clearResultTimer,
      clearResultStateRefreshTimer,
      clearWalletTimer,
      mergePendingEntries,
      normalizeIncomingState,
      setChipOptions,
    ],
  );

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

  const refreshWallet = useCallback(async () => {
    const result = await fetchWallet();

    if (result) {
      setWalletError(null);
      setFastWallet(null);
      return result;
    }

    setWalletError(
      "Wallet is taking a moment to sync. Please try again shortly.",
    );
    return null;
  }, [fetchWallet]);

  const scheduleCompletedRoundEffects = useCallback(
    (round: RoundSnapshot, delayMs = 120) => {
      clearResultTimer();
      clearWalletTimer();

      resultFetchTimerRef.current = window.setTimeout(() => {
        void fetchLatestResult();
      }, delayMs);

      walletRefreshTimerRef.current = window.setTimeout(() => {
        void refreshWallet();
      }, Math.max(delayMs, 650));

      devLog("completed round effects scheduled", {
        roundId: round.id,
        roundNumber: round.roundNumber,
        delayMs,
      });
    },
    [clearResultTimer, clearWalletTimer, fetchLatestResult, refreshWallet],
  );

  const scheduleResultStateRefresh = useCallback(
    (round: RoundSnapshot, initialAttempt = 0) => {
      if (!roomId || initialAttempt >= RESULT_STATE_SYNC_MAX_ATTEMPTS) {
        return;
      }

      const scheduleAttempt = (attempt: number) => {
        if (attempt >= RESULT_STATE_SYNC_MAX_ATTEMPTS) {
          return;
        }

        clearResultStateRefreshTimer();

        const phaseDelayMs =
          typeof round.msUntilNextRound === "number"
            ? round.msUntilNextRound
            : round.msUntilPhaseEnd;

        const delayMs =
          attempt === 0
            ? Math.max(RESULT_STATE_SYNC_BUFFER_MS, phaseDelayMs) +
              RESULT_STATE_SYNC_BUFFER_MS
            : RESULT_STATE_SYNC_RETRY_MS;

        resultStateRefreshTimerRef.current = window.setTimeout(() => {
          void (async () => {
            try {
              const nextState = await apiClient.getRoomLiveState(roomId);
              const appliedState = applyState(nextState);
              const nextRound = appliedState.currentRound;

              if (
                nextRound?.id === round.id &&
                getPublicRoundPhase(nextRound) === "RESULT"
              ) {
                scheduleAttempt(attempt + 1);
              }
            } catch {
              scheduleAttempt(attempt + 1);
            }
          })();
        }, delayMs);
      };

      scheduleAttempt(initialAttempt);
    },
    [applyState, clearResultStateRefreshTimer, roomId],
  );

  const handleRoundSnapshotSideEffects = useCallback(
    (nextState: RoomLiveState) => {
      const round = nextState.currentRound;

      if (!round) return;

      if (getPublicRoundPhase(round) === "SPINNING") {
        devLog("spinning phase active", {
          roundId: round.id,
          spinAngle: round.spinAngle,
          winnerEntryId: round.winnerEntryId,
        });
      }

      if (round.status === "SETTLING") {
        clearWalletTimer();

        walletRefreshTimerRef.current = window.setTimeout(() => {
          void refreshWallet();
        }, 900);
      }

      if (isCompletedRound(round)) {
        scheduleCompletedRoundEffects(round, 120);
      }

      if (
        getPublicRoundPhase(round) === "RESULT" &&
        typeof round.msUntilNextRound === "number"
      ) {
        scheduleResultStateRefresh(round);
      }
    },
    [
      clearWalletTimer,
      refreshWallet,
      scheduleCompletedRoundEffects,
      scheduleResultStateRefresh,
    ],
  );

  const refresh = useCallback(async () => {
    if (!roomId) return;

    try {
      setError(null);
      const nextState = await apiClient.getRoomLiveState(roomId);
      const appliedState = applyState(nextState);
      handleRoundSnapshotSideEffects(appliedState);
    } catch (caught) {
      setError(toastGameError(caught, "Failed to load room."));
    }
  }, [applyState, handleRoundSnapshotSideEffects, roomId]);

  const applyEntryPlacementResult = useCallback(
    (result: PlaceEntryResponse) => {
      for (const [key, pendingEntry] of pendingEntriesRef.current) {
        if (
          pendingEntry.roundId === result.entry.roundId &&
          pendingEntry.userId === result.entry.userId
        ) {
          pendingEntriesRef.current.delete(key);
          pendingEntryBackupsRef.current.delete(key);
        }
      }

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

        const nextState = {
          ...currentState,
          currentRound: result.currentRound ?? currentState.currentRound,
          entries,
        };

        lastRoundRef.current = nextState.currentRound ?? null;
        lastNonNullStateRef.current = nextState;

        return nextState;
      });

      setFastWallet(result.wallet);
      setWalletError(null);
    },
    [],
  );

  const addOptimisticEntry = useCallback(
    (amount: number, optimisticKey: string) => {
      if (!user) return;

      const nowIso = new Date().toISOString();

      setState((currentState) => {
        const round = currentState?.currentRound;

        if (
          !currentState ||
          !round ||
          getPublicRoundPhase(round) !== "ENTRY_OPEN"
        ) {
          return currentState;
        }

        const existingEntry =
          currentState.entries.find(
            (entry) => entry.userId === user.id || entry.player?.id === user.id,
          ) ?? null;

        pendingEntryBackupsRef.current.set(optimisticKey, existingEntry);

        const optimisticAmount = existingEntry
          ? (BigInt(existingEntry.amount) + BigInt(amount)).toString()
          : String(amount);

        const pendingEntry: PendingLiveEntry = {
          ...(existingEntry ?? {
            id: `pending:${optimisticKey}`,
            roundId: round.id,
            userId: user.id,
            ticketStart: null,
            ticketEnd: null,
            isWinner: false,
            createdAt: nowIso,
          }),
          amount: optimisticAmount,
          updatedAt: nowIso,
          player: {
            id: user.id,
            username: user.username,
            fullName: user.fullName,
          },
          pending: true,
          optimisticKey,
          optimisticBaseEntryId: existingEntry?.id ?? null,
        };

        pendingEntriesRef.current.set(optimisticKey, pendingEntry);

        const entries = existingEntry
          ? currentState.entries.map((entry) =>
              entry.id === existingEntry.id ? pendingEntry : entry,
            )
          : [...currentState.entries, pendingEntry];

        const nextTotalEntryAmount = (
          BigInt(round.totalEntryAmount ?? "0") + BigInt(amount)
        ).toString();

        const nextPlatformFeeAmount = (
          (BigInt(nextTotalEntryAmount) * BigInt(round.platformFeeBps ?? 0)) /
          10_000n
        ).toString();

        const nextNetPrizeAmount = calculateNetPrizeAmount(
          nextTotalEntryAmount,
          round.platformFeeBps ?? 0,
        );

       return {
  ...currentState,
  currentRound: {
    ...round,
    totalEntryAmount: nextTotalEntryAmount,
    grossPoolAmount: nextTotalEntryAmount,
    payoutAmount: nextNetPrizeAmount,
    platformFeeAmount: nextPlatformFeeAmount,
    netPrizeAmount: nextNetPrizeAmount,
  },
  entries: entries.sort(compareEntriesByCreatedAt),
};
      });
    },
    [user],
  );

  const removeOptimisticEntry = useCallback((optimisticKey: string) => {
    const pendingEntry = pendingEntriesRef.current.get(optimisticKey);
    const backupEntry = pendingEntryBackupsRef.current.get(optimisticKey);

    pendingEntriesRef.current.delete(optimisticKey);
    pendingEntryBackupsRef.current.delete(optimisticKey);

    if (!pendingEntry) return;

    setState((currentState) => {
      if (!currentState) return currentState;

      const amountDelta =
        BigInt(pendingEntry.amount) - BigInt(backupEntry?.amount ?? "0");

      const nextEntries = backupEntry
        ? currentState.entries.map((entry) =>
            entry.id === pendingEntry.id ||
            entry.id === pendingEntry.optimisticBaseEntryId
              ? backupEntry
              : entry,
          )
        : currentState.entries.filter((entry) => entry.id !== pendingEntry.id);

      const round = currentState.currentRound;

      if (!round) {
        return {
          ...currentState,
          entries: nextEntries.sort(compareEntriesByCreatedAt),
        };
      }

      const nextTotalEntryAmount = (
        BigInt(round.totalEntryAmount ?? "0") - amountDelta
      ).toString();

      const nextPayoutAmount = (
        BigInt(round.payoutAmount ?? "0") - amountDelta
      ).toString();

      const nextPlatformFeeAmount = (
  (BigInt(nextTotalEntryAmount) * BigInt(round.platformFeeBps ?? 0)) /
  10_000n
).toString();

const nextNetPrizeAmount = calculateNetPrizeAmount(
  nextTotalEntryAmount,
  round.platformFeeBps ?? 0,
);

      return {
        ...currentState,
     currentRound: {
  ...round,
  totalEntryAmount: nextTotalEntryAmount,
  grossPoolAmount: nextTotalEntryAmount,
  payoutAmount: nextNetPrizeAmount,
  platformFeeAmount: nextPlatformFeeAmount,
  netPrizeAmount: nextNetPrizeAmount,
},
        entries: nextEntries.sort(compareEntriesByCreatedAt),
      };
    });
  }, []);

  useEffect(() => {
    void fetchMe();
    void refreshWallet();
  }, [fetchMe, refreshWallet]);

  useEffect(() => {
    if (!roomId) return;

    const socket = getGameSocket();
    let hasConnectedOnce = socket.connected;

    const joinRoom = () => {
      devLog("room join emitted", { roomId });
      socket.emit("room:join", { roomId });
    };

    setConnectionStatus(socket.connected ? "connected" : "connecting");
    void refresh();

    const onConnect = () => {
      const isReconnect = hasConnectedOnce;
      hasConnectedOnce = true;

      devLog("socket connected", { roomId, isReconnect });
      setConnectionStatus("connected");
      joinRoom();

      if (isReconnect) {
        void refresh();
      }
    };

    const onDisconnect = () => {
      devLog("socket disconnected", { roomId });
      setConnectionStatus("disconnected");
    };

    const onRoundState = (payload: SocketRoundStateEvent) => {
      devLog("round:state received", {
        roomId: payload.roomId,
        reason: payload.reason,
      });

      if (payload.roomId !== roomId) {
        devLog("round:state ignored for different room", {
          currentRoomId: roomId,
          payloadRoomId: payload.roomId,
        });
        return;
      }

      const nextState: RoomLiveState = {
        ...payload.snapshot,
        serverNow: payload.snapshot.serverNow ?? payload.emittedAt,
      };

      devLog("round:state snapshot applied", {
        roomId,
        status: nextState.currentRound?.status ?? null,
        roundNumber: nextState.currentRound?.roundNumber ?? null,
      });

      const appliedState = applyState(nextState);
      handleRoundSnapshotSideEffects(appliedState);
    };

    const onMachineEvent = (payload: SocketMachineEvent) => {
      if (payload.roomId !== roomId) return;

      if (OPEN_ROUND_MACHINE_ACTIONS.has(payload.action)) {
        clearResultTimer();
        clearResultStateRefreshTimer();
        clearWalletTimer();
        setLatestResult(null);
        setFastWallet(null);
        void refresh();
        return;
      }

      if (
        payload.action === "SETTLED_ROUND" ||
        payload.action === "RESUMED_SETTLEMENT"
      ) {
        const currentRound = lastRoundRef.current;

        if (currentRound && currentRound.status === "COMPLETED") {
          scheduleCompletedRoundEffects(currentRound, 80);
        } else {
          void refresh();
        }
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
      joinRoom();
    } else {
      socket.connect();
    }

    return () => {
      socket.emit("room:leave", { roomId });

      clearResultTimer();
      clearResultStateRefreshTimer();
      clearWalletTimer();

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
    clearResultTimer,
    clearResultStateRefreshTimer,
    clearWalletTimer,
    handleRoundSnapshotSideEffects,
    refresh,
    roomId,
    scheduleCompletedRoundEffects,
    setConnectionStatus,
  ]);

  const deadlineRoundId = state?.currentRound?.id;
  const deadlineRoundNumber = state?.currentRound?.roundNumber;
  const deadlineRoundStatus = state?.currentRound?.status;
  const deadlineRoundPhase = state?.currentRound?.phase;
  const deadlineRoundLocksAt = state?.currentRound?.locksAt;

  const deadlineRound = useMemo(() => {
    if (!deadlineRoundId || typeof deadlineRoundNumber !== "number") {
      return null;
    }

    return {
      id: deadlineRoundId,
      roundNumber: deadlineRoundNumber,
      status: deadlineRoundStatus,
      phase: deadlineRoundPhase,
      locksAt: deadlineRoundLocksAt,
    };
  }, [
    deadlineRoundId,
    deadlineRoundNumber,
    deadlineRoundStatus,
    deadlineRoundPhase,
    deadlineRoundLocksAt,
  ]);

  useEffect(() => {
    if (
      !roomId ||
      !deadlineRound ||
      getPublicRoundPhase(deadlineRound) !== "ENTRY_OPEN" ||
      !deadlineRound.locksAt
    ) {
      return;
    }

    const locksAtMs = new Date(deadlineRound.locksAt).getTime();

    if (!Number.isFinite(locksAtMs)) {
      return;
    }

    let cancelled = false;
    let retryTimer: number | null = null;
    let attempts = 0;

    const requestAuthoritativeSync = () => {
      if (cancelled) return;

      attempts += 1;

      const socket = getGameSocket();

      devLog("deadline socket sync requested", {
        roomId,
        roundId: deadlineRound.id,
        roundNumber: deadlineRound.roundNumber,
        attempt: attempts,
      });

      if (socket.connected) {
        socket.emit("room:join", { roomId });
      } else {
        socket.connect();
      }

      if (attempts < 6) {
        retryTimer = window.setTimeout(requestAuthoritativeSync, 900);
      }
    };

    const delayMs = Math.max(0, locksAtMs - Date.now() + 250);
    const timer = window.setTimeout(requestAuthoritativeSync, delayMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);

      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [deadlineRound, roomId]);

  const placeEntry = useCallback(
    async (amount: number) => {
      if (!roomId || placingEntryRef.current) return;

      if (!visibleWallet) {
        setError(toastGameError("Please sign in to enter."));
        return;
      }

      placingEntryRef.current = true;
      setIsPlacingEntry(true);
      setError(null);

      const idempotencyKey = createIdempotencyKey(roomId);
      const clickStartedAt =
        typeof performance !== "undefined" ? performance.now() : Date.now();

      addOptimisticEntry(amount, idempotencyKey);

      try {
        const requestStartedAt =
          typeof performance !== "undefined" ? performance.now() : Date.now();
        const clickToRequestMs = requestStartedAt - clickStartedAt;

        if (process.env.NODE_ENV !== "production" && clickToRequestMs > 16) {
          console.debug("[room] entry click-to-request", {
            roomId,
            durationMs: Math.round(clickToRequestMs),
          });
        }

        const result = await apiClient.placeEntry(roomId, {
          amount,
          idempotencyKey,
        });

        applyEntryPlacementResult(result);

        if (!getGameSocket().connected) {
          void refresh();
        }
      } catch (caught) {
        removeOptimisticEntry(idempotencyKey);
        setFastWallet(null);
        setError(toastGameError(caught, "Failed to place entry."));

        if (!getGameSocket().connected) {
          void refreshWallet();
          void refresh();
        }
      } finally {
        placingEntryRef.current = false;
        setIsPlacingEntry(false);
      }
    },
    [
      addOptimisticEntry,
      applyEntryPlacementResult,
      refresh,
      refreshWallet,
      removeOptimisticEntry,
      roomId,
      visibleWallet,
    ],
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