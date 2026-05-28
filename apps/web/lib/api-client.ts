import type {
  CategorySnapshot,
  CurrentUser,
  LatestRoundResult,
  MeWallet,
  PlaceEntryInput,
  RoomSnapshot,
  RoomLiveState,
} from "@kingspin/contracts";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type CategoryListItem = CategorySnapshot & {
  isActive?: boolean;
  sortOrder?: number;
};

export type RoomListItem = Omit<RoomSnapshot, "name"> & {
  name: string | null;
};
export type AdminRoomCommand =
  | "activate"
  | "pause"
  | "close"
  | "archive";

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

export const apiClient = {
  getCategories() {
    return requestJson<CategoryListItem[]>("/categories");
  },

  getRoomsByCategory(categorySlug: string) {
    const params = new URLSearchParams({ categorySlug });

    return requestJson<RoomListItem[]>(`/rooms?${params.toString()}`);
  },

  getMe() {
    return requestJson<CurrentUser>("/me");
  },

  getMeWallet() {
    return requestJson<MeWallet>("/me/wallet");
  },

  getRoomLiveState(roomId: string) {
    return requestJson<RoomLiveState>(`/rooms/${roomId}/live-state`);
  },

  getLatestRoundResult(roomId: string) {
    return requestJson<LatestRoundResult>(
      `/rooms/${roomId}/rounds/latest-result`,
    );
  },

  placeEntry(roomId: string, input: PlaceEntryInput) {
    const body: PlaceEntryInput = input.idempotencyKey
      ? { amount: input.amount, idempotencyKey: input.idempotencyKey }
      : { amount: input.amount };

    return requestJson(`/rooms/${roomId}/entries`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  admin: {
    startMachine(roomId: string, adminKey: string) {
      return requestJson(`/admin/rooms/${roomId}/machine/start`, {
        method: "POST",
        headers: { "x-admin-dev-key": adminKey },
      });
    },

    stopMachine(roomId: string, adminKey: string) {
      return requestJson(`/admin/rooms/${roomId}/machine/stop`, {
        method: "POST",
        headers: { "x-admin-dev-key": adminKey },
      });
    },

    getMachineStatus(roomId: string, adminKey: string) {
      return requestJson(`/admin/rooms/${roomId}/machine/status`, {
        headers: { "x-admin-dev-key": adminKey },
      });
    },

    advanceOnce(roomId: string, adminKey: string, force = false) {
      const params = new URLSearchParams({ force: String(force) });

      return requestJson(
        `/admin/rooms/${roomId}/machine/advance-once?${params.toString()}`,
        {
          method: "POST",
          headers: { "x-admin-dev-key": adminKey },
        },
      );
    },

    createRoom(input: unknown, adminKey: string) {
      return requestJson("/admin/rooms", {
        method: "POST",
        headers: { "x-admin-dev-key": adminKey },
        body: JSON.stringify(input),
      });
    },

    updateRoomStatus(roomId: string, command: AdminRoomCommand, adminKey: string) {
      return requestJson(`/admin/rooms/${roomId}/${command}`, {
        method: "PATCH",
        headers: { "x-admin-dev-key": adminKey },
      });
    },
  },
};
