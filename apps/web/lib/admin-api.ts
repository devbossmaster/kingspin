import { requestJson } from "./api-client";

const ADMIN_GET_TIMEOUT_MS = 12_000;

export type AdminQuery = {
  page?: number;
  pageSize?: number;
  q?: string;
  status?: string;
  severity?: string;
  type?: string;
  action?: string;
  from?: string;
  to?: string;
};

export type AdminPage<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type AdminRecord = Record<string, unknown> & { id: string };

export type AdminRequestOptions = Omit<RequestInit, "method" | "body"> & {
  timeoutMs?: number;
};

function queryString(query: AdminQuery = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const value = params.toString();
  return value ? `?${value}` : "";
}

function isAbortLike(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function isAdminRequestAbort(error: unknown) {
  return isAbortLike(error);
}

async function adminGet<TResponse>(
  path: string,
  options: AdminRequestOptions = {},
) {
  const {
    timeoutMs = ADMIN_GET_TIMEOUT_MS,
    signal: callerSignal,
    ...init
  } = options;
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  if (callerSignal?.aborted) {
    abortFromCaller();
  } else {
    callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  try {
    return await requestJson<TResponse>(path, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut && !callerSignal?.aborted) {
      throw new Error("Admin request timed out. Please retry.");
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}

function adminMutation<TResponse>(path: string, init: RequestInit) {
  return requestJson<TResponse>(path, init);
}

export const adminApi = {
  dashboard: (options?: AdminRequestOptions) =>
    adminGet<Record<string, unknown>>("/admin/dashboard", options),
  dashboardSummary: (options?: AdminRequestOptions) =>
    adminGet<Record<string, unknown>>("/admin/dashboard/summary", options),
  dashboardRecent: (options?: AdminRequestOptions) =>
    adminGet<Record<string, unknown>>("/admin/dashboard/recent", options),
  rooms: (query?: AdminQuery, options?: AdminRequestOptions) =>
    adminGet<AdminPage<AdminRecord>>(
      `/admin/rooms${queryString(query)}`,
      options,
    ),
  players: (query?: AdminQuery, options?: AdminRequestOptions) =>
    adminGet<AdminPage<AdminRecord>>(
      `/admin/players${queryString(query)}`,
      options,
    ),
  entries: (query?: AdminQuery, options?: AdminRequestOptions) =>
    adminGet<AdminPage<AdminRecord>>(
      `/admin/entries${queryString(query)}`,
      options,
    ),
  rounds: (query?: AdminQuery, options?: AdminRequestOptions) =>
    adminGet<AdminPage<AdminRecord>>(
      `/admin/rounds${queryString(query)}`,
      options,
    ),
  deposits: (query?: AdminQuery, options?: AdminRequestOptions) =>
    adminGet<AdminPage<AdminRecord>>(
      `/admin/payments/deposits${queryString(query)}`,
      options,
    ),
  withdrawals: (query?: AdminQuery, options?: AdminRequestOptions) =>
    adminGet<AdminPage<AdminRecord>>(
      `/admin/payments/withdrawals${queryString(query)}`,
      options,
    ),
  risk: (query?: AdminQuery, options?: AdminRequestOptions) =>
    adminGet<AdminPage<AdminRecord>>(
      `/admin/risk${queryString(query)}`,
      options,
    ),
  audit: (query?: AdminQuery, options?: AdminRequestOptions) =>
    adminGet<AdminPage<AdminRecord>>(
      `/admin/audit${queryString(query)}`,
      options,
    ),
  health: (options?: AdminRequestOptions) =>
    adminGet<Record<string, unknown>>("/admin/health/summary", options),
  settings: (options?: AdminRequestOptions) =>
    adminGet<Record<string, unknown>>("/admin/settings", options),
  deposit: (id: string, options?: AdminRequestOptions) =>
    adminGet<Record<string, unknown>>(
      `/admin/payments/deposits/${id}`,
      options,
    ),
  withdrawal: (id: string, options?: AdminRequestOptions) =>
    adminGet<Record<string, unknown>>(
      `/admin/payments/withdrawals/${id}`,
      options,
    ),
  activateRoom: (id: string) =>
    adminMutation(`/admin/rooms/${id}/activate`, { method: "PATCH" }),
  pauseRoom: (id: string) =>
    adminMutation(`/admin/rooms/${id}/pause`, { method: "PATCH" }),
  closeRoom: (id: string) =>
    adminMutation(`/admin/rooms/${id}/close`, { method: "PATCH" }),
  suspendPlayer: (id: string) =>
    adminMutation(`/admin/users/${id}/suspend`, { method: "PATCH" }),
  restorePlayer: (id: string) =>
    adminMutation(`/admin/users/${id}/unsuspend`, { method: "PATCH" }),
  approveDeposit: (id: string, adminNote: string) =>
    adminMutation(`/admin/payments/deposits/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ adminNote }),
    }),
  rejectDeposit: (id: string, reason: string) =>
    adminMutation(`/admin/payments/deposits/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  approveWithdrawal: (id: string) =>
    adminMutation(`/admin/payments/withdrawals/${id}/approve`, {
      method: "PATCH",
    }),
  completeWithdrawal: (id: string, externalReference: string) =>
    adminMutation(`/admin/payments/withdrawals/${id}/complete`, {
      method: "POST",
      body: JSON.stringify({ externalReference }),
    }),
  rejectWithdrawal: (id: string, reason: string) =>
    adminMutation(`/admin/payments/withdrawals/${id}/reject`, {
      method: "PATCH",
      body: JSON.stringify({ reason }),
    }),
  reviewRisk: (id: string, status: string, note?: string) =>
    adminMutation(`/admin/risk/${id}/review`, {
      method: "PATCH",
      body: JSON.stringify({ status, note }),
    }),
};
