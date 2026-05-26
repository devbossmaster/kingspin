import type {
  DevPlaceEntryInput,
  DevPlayerBalance,
  LatestRoundResult,
  RoomLiveState,
} from "@kingspin/contracts";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function requestJson<TResponse>(
  path: string,
  init?: RequestInit,
): Promise<TResponse> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
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
  getRoomLiveState(roomId: string) {
    return requestJson<RoomLiveState>(`/rooms/${roomId}/live-state`);
  },

  getLatestRoundResult(roomId: string) {
    return requestJson<LatestRoundResult>(
      `/rooms/${roomId}/rounds/latest-result`,
    );
  },

  getDevPlayerBalance(playerKey: string) {
    return requestJson<DevPlayerBalance>(
      `/dev/players/${encodeURIComponent(playerKey)}/balance`,
    );
  },

  devPlaceEntry(roomId: string, input: DevPlaceEntryInput) {
    return requestJson(`/rooms/${roomId}/entries/dev-place`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
};
