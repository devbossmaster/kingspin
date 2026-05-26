import type {
  CurrentUser,
  LatestRoundResult,
  MeWallet,
  PlaceEntryInput,
  RoomLiveState,
} from "@kingspin/contracts";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

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
    return requestJson(`/rooms/${roomId}/entries`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
};
