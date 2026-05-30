import type {
  CategorySnapshot,
  CurrentUser,
  EntryWithPlayerSnapshot,
  LatestRoundResult,
  MeWallet,
  PlaceEntryInput,
  RoomSnapshot,
  RoomLiveState,
  WalletSnapshot,
} from "@kingspin/contracts";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type CategoryListItem = CategorySnapshot & {
  isActive?: boolean;
  sortOrder?: number;
};

export type RoomListItem = Omit<RoomSnapshot, "name"> & {
  name: string | null;
  serverNow?: string;
  receivedAtMs?: number;
  currentRound?: {
    id: string;
    roundNumber?: number;
    status: string;
    locksAt?: string | null;
    msUntilLock?: number;
    playerCount: number;
    entryCount?: number;
    totalEntryAmount: string;
    payoutAmount: string;
    totalPool?: string;
  } | null;
};

export type AdminRoomCommand = "activate" | "pause" | "close" | "archive";

export type PlaceEntryResponse = {
  entry: Omit<EntryWithPlayerSnapshot, "player">;
  player: EntryWithPlayerSnapshot["player"];
  wallet: WalletSnapshot;
  currentRound: RoomLiveState["currentRound"];
  reused: boolean;
};

const inFlightRequests = new Map<string, Promise<unknown>>();

async function requestJson<TResponse>(
  path: string,
  init?: RequestInit,
): Promise<TResponse> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String(payload.message)
        : `Request failed with ${response.status}`;

    throw new Error(message);
  }

  return payload as TResponse;
}

function requestJsonDeduped<TResponse>(
  key: string,
  path: string,
  init?: RequestInit,
): Promise<TResponse> {
  const existing = inFlightRequests.get(key);

  if (existing) {
    return existing as Promise<TResponse>;
  }

  const request = requestJson<TResponse>(path, init).finally(() => {
    inFlightRequests.delete(key);
  });

  inFlightRequests.set(key, request);

  return request;
}

export const apiClient = {
  getCategories() {
    return requestJson<CategoryListItem[]>("/categories");
  },

  getRoomsByCategory(categorySlug: string) {
    const params = new URLSearchParams({ categorySlug });

    return requestJson<RoomListItem[]>(`/rooms?${params.toString()}`).then(
      (rooms) => {
        const receivedAtMs = Date.now();

        return rooms.map((room) => ({ ...room, receivedAtMs }));
      },
    );
  },

  getMe() {
    return requestJsonDeduped<CurrentUser>("me", "/me");
  },

  getMeWallet() {
    return requestJsonDeduped<MeWallet>("me-wallet", "/me/wallet");
  },

  getRoomLiveState(roomId: string) {
    return requestJsonDeduped<RoomLiveState>(
      `room-live-state:${roomId}`,
      `/rooms/${roomId}/live-state`,
    );
  },

  getLatestRoundResult(roomId: string) {
    return requestJsonDeduped<LatestRoundResult>(
      `latest-round-result:${roomId}`,
      `/rooms/${roomId}/rounds/latest-result`,
    );
  },

  placeEntry(roomId: string, input: PlaceEntryInput) {
    const body: PlaceEntryInput = input.idempotencyKey
      ? { amount: input.amount, idempotencyKey: input.idempotencyKey }
      : { amount: input.amount };

    return requestJson<PlaceEntryResponse>(`/rooms/${roomId}/entries`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  admin: {
    getDashboard() {
      return requestJson("/admin/dashboard");
    },

    getUsers(search?: string) {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      const query = params.toString();

      return requestJson(`/admin/users${query ? `?${query}` : ""}`);
    },

    getRooms() {
      return requestJson("/admin/rooms");
    },

    getRounds() {
      return requestJson("/admin/rounds");
    },

    getLedger() {
      return requestJson("/admin/ledger");
    },

    getDeposits() {
      return requestJson("/admin/payments/deposits");
    },

    approveDeposit(id: string) {
      return requestJson(`/admin/payments/deposits/${id}/approve`, {
        method: "PATCH",
      });
    },

    getWithdrawals() {
      return requestJson("/admin/payments/withdrawals");
    },

    approveWithdrawal(id: string) {
      return requestJson(`/admin/payments/withdrawals/${id}/approve`, {
        method: "PATCH",
      });
    },

    rejectWithdrawal(id: string, reason: string) {
      return requestJson(`/admin/payments/withdrawals/${id}/reject`, {
        method: "PATCH",
        body: JSON.stringify({ reason }),
      });
    },

    getRiskEvents() {
      return requestJson("/admin/risk");
    },

    reviewRiskEvent(id: string, status: string) {
      return requestJson(`/admin/risk/${id}/review`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
    },

    getAuditLogs() {
      return requestJson("/admin/audit");
    },

    getJobs() {
      return requestJson("/admin/jobs");
    },

    startMachine(roomId: string) {
      return requestJson(`/admin/rooms/${roomId}/machine/start`, {
        method: "POST",
      });
    },

    stopMachine(roomId: string) {
      return requestJson(`/admin/rooms/${roomId}/machine/stop`, {
        method: "POST",
      });
    },

    getMachineStatus(roomId: string) {
      return requestJson(`/admin/rooms/${roomId}/machine/status`);
    },

    advanceOnce(roomId: string, force = false) {
      const params = new URLSearchParams({ force: String(force) });

      return requestJson(
        `/admin/rooms/${roomId}/machine/advance-once?${params.toString()}`,
        {
          method: "POST",
        },
      );
    },

    createRoom(input: unknown) {
      return requestJson("/admin/rooms", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },

    updateRoomStatus(roomId: string, command: AdminRoomCommand) {
      return requestJson(`/admin/rooms/${roomId}/${command}`, {
        method: "PATCH",
      });
    },
  },
};
