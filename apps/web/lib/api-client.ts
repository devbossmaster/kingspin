import type {
  CategorySnapshot,
  CreateDepositInput,
  CreateWithdrawalInput,
  CurrentUser,
  DepositSnapshot,
  EntryWithPlayerSnapshot,
  LatestRoundResult,
  LedgerTransactionSnapshot,
  MeWallet,
  PlaceEntryInput,
  RoomLiveSummary,
  RoomLiveState,
  WalletSnapshot,
  WithdrawalSnapshot,
  SubmitTelebirrReceiptInput,
  CreateWalletTransferInput,
  ResolveTransferRecipientInput,
  TransferRecipient,
  WalletTransferSnapshot,
} from "@kingspin/contracts";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const CSRF_MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CSRF_HEADER_NAME = "x-csrf-token";

export type CategoryListItem = CategorySnapshot & {
  isActive?: boolean;
  sortOrder?: number;
};

export type RoomListItem = RoomLiveSummary;

export type AdminRoomCommand = "activate" | "pause" | "close" | "archive";

export type WinnerFeedScope = "latest" | "week" | "month";

export type WinnerFeedItem = {
  rank: number;
  roundId: string;
  roomId: string;
  roomCode: string;
  roomName: string | null;
  roomMaxPlayers: number;
  roomGameMode: string;
  categorySlug: string;
  categoryName: string;
  roundNumber: number;
  completedAt: string | null;
  totalEntryAmount: string;
  payoutAmount: string;
  winnerUserId: string;
  winnerEntryId: string;
  winnerEntryAmount: string;
  winnerUsername: string | null;
  playerCount: number;
  entryCount: number;
};

export type WinnerFeedResponse = {
  scope: WinnerFeedScope;
  limit: number;
  generatedAt: string;
  winners: WinnerFeedItem[];
};

export type SpinBattleOnlineResponse = {
  onlinePlayers: number;
  activeRooms: number;
  generatedAt: string;
};

export type PlaceEntryResponse = {
  entry: Omit<EntryWithPlayerSnapshot, "player">;
  player: EntryWithPlayerSnapshot["player"];
  wallet: WalletSnapshot;
  currentRound: RoomLiveState["currentRound"];
  reused: boolean;
};

export type CreateDepositResponse = {
  deposit: DepositSnapshot;
  checkoutUrl?: string | null;
  instructions?: {
    depositIntentId: string;
    expectedAmount: string;
    currency: string;
    receiverName: string | null;
    receiverAccount: string | null;
    receiverShortCode: string | null;
    expiresAt: string;
  };
  reused: boolean;
};

export type SubmitTelebirrReceiptResponse = {
  deposit: DepositSnapshot;
  wallet?: WalletSnapshot;
  transaction?: LedgerTransactionSnapshot;
  reused: boolean;
};

export type CreateWithdrawalResponse = {
  withdrawal: WithdrawalSnapshot;
  wallet?: WalletSnapshot;
  transaction?: LedgerTransactionSnapshot;
  reused: boolean;
};

export type ResolveTransferRecipientResponse = {
  recipient: TransferRecipient;
};

const inFlightRequests = new Map<string, Promise<unknown>>();
let csrfTokenPromise: Promise<string> | null = null;

export async function getCsrfToken() {
  csrfTokenPromise ??= fetch(`${API_URL}/csrf`, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  })
    .then(async (response) => {
      const payload = await response.json().catch(() => null);

      if (
        !response.ok ||
        !payload ||
        typeof payload !== "object" ||
        typeof (payload as { csrfToken?: unknown }).csrfToken !== "string"
      ) {
        throw new Error("Unable to prepare a secure request token.");
      }

      return (payload as { csrfToken: string }).csrfToken;
    })
    .catch((error) => {
      csrfTokenPromise = null;
      throw error;
    });

  return csrfTokenPromise;
}

function isMutatingRequest(init?: RequestInit) {
  const method = (init?.method ?? "GET").toUpperCase();

  return CSRF_MUTATING_METHODS.has(method);
}

export async function requestJson<TResponse>(
  path: string,
  init?: RequestInit,
): Promise<TResponse> {
  const headers = new Headers(init?.headers);

  headers.set("Content-Type", "application/json");

  if (isMutatingRequest(init)) {
    headers.set(CSRF_HEADER_NAME, await getCsrfToken());
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers,
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

    return requestJson<RoomListItem[]>(`/rooms/live?${params.toString()}`).then(
      (rooms) => {
        const receivedAtMs = Date.now();

        return rooms.map((room) => ({ ...room, receivedAtMs }));
      },
    );
  },

  getWinnerFeed(scope: WinnerFeedScope, limit = 15) {
    const params = new URLSearchParams({
      scope,
      limit: String(Math.min(15, Math.max(1, Math.floor(limit)))),
    });

    return requestJson<WinnerFeedResponse>(
      `/rooms/winners?${params.toString()}`,
    );
  },

  getSpinBattleOnline() {
    return requestJson<SpinBattleOnlineResponse>("/rooms/online");
  },

  getMe() {
    return requestJsonDeduped<CurrentUser>("me", "/me");
  },

  updateMe(input: { fullName?: string; phoneNumber?: string }) {
    return requestJson<CurrentUser>("/me", {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },

  getMeWallet() {
    return requestJsonDeduped<MeWallet>("me-wallet", "/me/wallet");
  },

  getMeTransactions(take = 50) {
    const params = new URLSearchParams({
      take: String(Math.min(100, Math.max(1, Math.floor(take)))),
    });

    return requestJson<LedgerTransactionSnapshot[]>(
      `/me/transactions?${params.toString()}`,
    );
  },

  createDeposit(input: CreateDepositInput) {
    return requestJson<CreateDepositResponse>("/payments/deposits", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  listDeposits() {
    return requestJson<DepositSnapshot[]>("/payments/deposits");
  },

  getDepositStatus(id: string) {
    return requestJson<DepositSnapshot>(`/payments/deposits/${id}`);
  },

  submitTelebirrReceipt(id: string, input: SubmitTelebirrReceiptInput) {
    return requestJson<SubmitTelebirrReceiptResponse>(
      `/payments/deposits/${id}/telebirr-receipt`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  },

  requestWithdrawal(input: CreateWithdrawalInput) {
    return requestJson<CreateWithdrawalResponse>("/payments/withdrawals", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  listWithdrawals() {
    return requestJson<WithdrawalSnapshot[]>("/payments/withdrawals");
  },

  cancelWithdrawal(id: string) {
    return requestJson<CreateWithdrawalResponse>(
      `/payments/withdrawals/${id}/cancel`,
      {
        method: "PATCH",
      },
    );
  },

  resolveTransferRecipient(input: ResolveTransferRecipientInput) {
    return requestJson<ResolveTransferRecipientResponse>(
      "/wallet/transfers/resolve-recipient",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  },

  createWalletTransfer(input: CreateWalletTransferInput) {
    return requestJson<WalletTransferSnapshot>("/wallet/transfers", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  listWalletTransfers(take = 50) {
    const params = new URLSearchParams({
      take: String(Math.min(100, Math.max(1, Math.floor(take)))),
    });

    return requestJson<WalletTransferSnapshot[]>(
      `/wallet/transfers?${params.toString()}`,
    );
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

    approveDeposit(id: string, adminNote: string) {
      return requestJson(`/admin/payments/deposits/${id}/approve`, {
        method: "POST",
        body: JSON.stringify({ adminNote }),
      });
    },

    rejectDeposit(id: string, reason: string) {
      return requestJson(`/admin/payments/deposits/${id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason }),
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

    completeWithdrawal(id: string, externalReference: string) {
      return requestJson(`/admin/payments/withdrawals/${id}/complete`, {
        method: "POST",
        body: JSON.stringify({ externalReference }),
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
