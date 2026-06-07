import { afterEach, describe, expect, it, vi } from "vitest";
import { adminApi } from "./admin-api";

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("adminApi", () => {
  it("keeps identical GET requests independent when one caller aborts", async () => {
    const requests: Array<{
      signal: AbortSignal;
      resolve: (response: Response) => void;
      reject: (error: unknown) => void;
    }> = [];
    const fetchMock = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          const signal = init?.signal;

          if (!signal) {
            reject(new Error("Expected an abort signal."));
            return;
          }

          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
          requests.push({ signal, resolve, reject });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const firstController = new AbortController();
    const secondController = new AbortController();

    const first = adminApi.rooms(
      { page: 1, pageSize: 25 },
      { signal: firstController.signal },
    );
    const second = adminApi.rooms(
      { page: 1, pageSize: 25 },
      { signal: secondController.signal },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    firstController.abort();
    requests[1]?.resolve(
      jsonResponse({
        items: [],
        page: 1,
        pageSize: 25,
        total: 0,
        totalPages: 1,
      }),
    );

    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(second).resolves.toMatchObject({ page: 1, total: 0 });
    expect(requests[1]?.signal.aborted).toBe(false);
  });

  it("turns a GET timeout into a visible retryable error", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          }),
      ),
    );

    const request = adminApi.health({ timeoutMs: 25 });
    const rejection = expect(request).rejects.toThrow(
      "Admin request timed out. Please retry.",
    );

    await vi.advanceTimersByTimeAsync(25);
    await rejection;
  });

  it("keeps credentials on GETs and sends CSRF on mutations without retrying", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "csrf-token" }))
      .mockResolvedValueOnce(jsonResponse({ id: "room-1" }));
    vi.stubGlobal("fetch", fetchMock);

    await adminApi.rooms();
    await adminApi.pauseRoom("room-1");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      credentials: "include",
      cache: "no-store",
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://localhost:4000/csrf");
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      method: "PATCH",
      credentials: "include",
      cache: "no-store",
    });

    const mutationHeaders = new Headers(fetchMock.mock.calls[2]?.[1]?.headers);
    expect(mutationHeaders.get("x-csrf-token")).toBe("csrf-token");
  });
});
