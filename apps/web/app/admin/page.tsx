"use client";

import { useEffect, useMemo, useState } from "react";
import { GameShell } from "../../components/player/game-shell";
import { Button } from "../../components/ui/button";
import { apiClient, getCsrfToken } from "../../lib/api-client";
import { formatCoins } from "../../lib/format";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const ADMIN_ROLES = new Set([
  "OWNER",
  "SUPER_ADMIN",
  "ADMIN",
  "SUPPORT",
  "FINANCE",
  "RISK",
  "VIEWER",
]);

type LoadState = {
  dashboard: unknown;
  rooms: unknown;
  users: unknown;
  rounds: unknown;
  deposits: unknown;
  withdrawals: unknown;
  risk: unknown;
  audit: unknown;
  jobs: unknown;
};

type ActionState = {
  key: string;
  label: string;
} | null;

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, fallback = "-") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function nestedRecord(value: unknown, key: string) {
  return asRecord(asRecord(value)[key]);
}

function getRoomId(room: unknown) {
  return text(asRecord(room).id, "");
}

function getRoundRoomId(round: unknown) {
  return text(asRecord(round).roomId, "");
}

function getRoundStatus(round: unknown) {
  return text(asRecord(round).status);
}

function statusTone(status: unknown) {
  switch (String(status)) {
    case "ACTIVE":
    case "OPEN":
    case "PAID":
    case "CONFIRMED":
      return "border-[rgba(74,222,128,0.35)] bg-[rgba(74,222,128,0.1)] text-green-go";
    case "LOCKED":
    case "PROCESSING":
    case "PENDING":
    case "PENDING_REVIEW":
      return "border-[rgba(246,197,71,0.35)] bg-[rgba(246,197,71,0.1)] text-gold";
    case "CANCELLED":
    case "REJECTED":
    case "FAILED":
      return "border-[rgba(248,113,113,0.4)] bg-[rgba(248,113,113,0.1)] text-red-hot";
    default:
      return "border-[var(--border)] bg-white/[0.04] text-text-secondary";
  }
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.28)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-black uppercase tracking-[0.16em] text-[var(--gold)]">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-1 text-xs text-text-secondary">{subtitle}</p>
          ) : null}
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Pill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.12em] ${
        tone ?? "border-[var(--border)] bg-white/[0.04] text-text-secondary"
      }`}
    >
      {children}
    </span>
  );
}

function JsonTable({ rows }: { rows: unknown }) {
  const list = asArray(rows).slice(0, 8);

  if (list.length === 0) {
    return <p className="text-sm text-text-secondary">No records.</p>;
  }

  return (
    <div className="max-h-[420px] overflow-auto rounded-lg border border-[var(--border)] bg-black/20 p-3">
      <pre className="text-xs leading-relaxed text-text-secondary">
        {JSON.stringify(list, null, 2)}
      </pre>
    </div>
  );
}

async function adminPost(path: string) {
  const csrfToken = await getCsrfToken();
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "x-csrf-token": csrfToken,
    },
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String((payload as { message?: unknown }).message)
        : `Admin request failed with ${response.status}`;

    throw new Error(message);
  }

  return payload;
}

async function adminGet(path: string) {
  const response = await fetch(`${API_URL}${path}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String((payload as { message?: unknown }).message)
        : `Admin request failed with ${response.status}`;

    throw new Error(message);
  }

  return payload;
}

export default function AdminPage() {
  const [state, setState] = useState<LoadState | null>(null);
  const [me, setMe] = useState<{ role?: string } | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [lastResult, setLastResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionState, setActionState] = useState<ActionState>(null);

  const dashboard = useMemo(() => asRecord(state?.dashboard), [state]);
  const rooms = useMemo(() => asArray(state?.rooms), [state]);
  const rounds = useMemo(() => asArray(state?.rounds), [state]);

  const isAdmin = Boolean(me?.role && ADMIN_ROLES.has(me.role));

  async function loadAdmin() {
    setLoading(true);
    setError(null);

    try {
      const user = await apiClient.getMe();
      setMe(user);

      if (!user.role || !ADMIN_ROLES.has(user.role)) {
        setState(null);
        return;
      }

      const [
        dashboardResult,
        roomsResult,
        users,
        roundsResult,
        deposits,
        withdrawals,
        risk,
        audit,
        jobs,
      ] = await Promise.all([
        apiClient.admin.getDashboard(),
        apiClient.admin.getRooms(),
        apiClient.admin.getUsers(),
        apiClient.admin.getRounds(),
        apiClient.admin.getDeposits(),
        apiClient.admin.getWithdrawals(),
        apiClient.admin.getRiskEvents(),
        apiClient.admin.getAuditLogs(),
        apiClient.admin.getJobs(),
      ]);

      setState({
        dashboard: dashboardResult,
        rooms: roomsResult,
        users,
        rounds: roundsResult,
        deposits,
        withdrawals,
        risk,
        audit,
        jobs,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Admin load failed.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAdmin();
  }, []);

  async function runAction(
    label: string,
    key: string,
    action: () => Promise<unknown>,
  ) {
    setError(null);
    setNotice(null);
    setActionState({ key, label });

    try {
      const result = await action();
      setLastResult(result);
      setNotice(`${label} completed.`);
      await loadAdmin();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `${label} failed.`);
    } finally {
      setActionState(null);
    }
  }

  function selectedRoom() {
    return rooms.find((room) => getRoomId(room) === selectedRoomId) ?? null;
  }

  function selectedRoomRounds() {
    if (!selectedRoomId) return [];

    return rounds.filter((round) => getRoundRoomId(round) === selectedRoomId);
  }

  const roomForPanel = selectedRoom() ?? rooms[0] ?? null;
  const roomForPanelId = roomForPanel ? getRoomId(roomForPanel) : "";
  const visibleRounds = selectedRoomId
    ? selectedRoomRounds()
    : rounds.slice(0, 8);

  return (
    <GameShell backHref="/spinpro">
      <div className="mx-auto max-w-7xl px-4 py-8 md:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-gold">
              Admin
            </p>
            <h1 className="mt-2 font-display text-4xl font-black">
              Operations Console
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-text-secondary">
              Manage rooms, rounds, machines, payments, risk, audit and jobs.
              Actions use your authenticated admin session and remain audited.
            </p>
          </div>

          <Button variant="secondary" onClick={() => void loadAdmin()}>
            Refresh
          </Button>
        </div>

        {loading ? (
          <p className="mt-6 text-sm text-text-secondary">
            Loading admin data...
          </p>
        ) : null}

        {error ? (
          <div className="mt-5 rounded-md border border-[rgba(248,113,113,0.42)] bg-[rgba(248,113,113,0.12)] px-4 py-3 text-sm font-semibold text-red-hot">
            {error}
          </div>
        ) : null}

        {notice ? (
          <div className="mt-5 rounded-md border border-[rgba(74,222,128,0.36)] bg-[rgba(74,222,128,0.1)] px-4 py-3 text-sm font-semibold text-green-go">
            {notice}
          </div>
        ) : null}

        {!loading && !isAdmin ? (
          <div className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-5 text-sm text-text-secondary">
            Admin role required.
          </div>
        ) : null}

        {state && isAdmin ? (
          <div className="mt-6 space-y-4">
            <section className="grid gap-3 md:grid-cols-5">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-text-secondary">
                  Active rooms
                </p>
                <p className="mt-2 font-mono text-2xl font-black">
                  {String(dashboard.activeRooms ?? 0)}
                </p>
              </div>

              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-text-secondary">
                  Active rounds
                </p>
                <p className="mt-2 font-mono text-2xl font-black">
                  {String(dashboard.activeRounds ?? 0)}
                </p>
              </div>

              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-text-secondary">
                  Open pool
                </p>
                <p className="mt-2 font-mono text-2xl font-black">
                  {formatCoins(String(dashboard.totalOpenPool ?? 0))}
                </p>
              </div>

              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-text-secondary">
                  Suspicious
                </p>
                <p className="mt-2 font-mono text-2xl font-black">
                  {String(dashboard.suspiciousActivityCount ?? 0)}
                </p>
              </div>

              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-text-secondary">
                  Failed jobs
                </p>
                <p className="mt-2 font-mono text-2xl font-black">
                  {String(dashboard.failedJobCount ?? 0)}
                </p>
              </div>
            </section>

            <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
              <Section
                title="Room controls"
                subtitle="Select a room, then start/cancel rounds or control its machine."
              >
                <div className="grid gap-3">
                  {rooms.length === 0 ? (
                    <p className="text-sm text-text-secondary">
                      No rooms found.
                    </p>
                  ) : (
                    rooms.map((roomItem) => {
                      const room = asRecord(roomItem);
                      const id = text(room.id, "");
                      const selected = selectedRoomId
                        ? selectedRoomId === id
                        : roomForPanelId === id;

                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setSelectedRoomId(id)}
                          className={`rounded-xl border p-4 text-left transition ${
                            selected
                              ? "border-[rgba(246,197,71,0.72)] bg-[rgba(246,197,71,0.1)]"
                              : "border-[var(--border)] bg-white/[0.03] hover:border-[rgba(246,197,71,0.35)] hover:bg-white/[0.05]"
                          }`}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="font-display text-lg font-black">
                                {text(room.code)} · {text(room.name)}
                              </p>
                              <p className="mt-1 text-sm text-text-secondary">
                                {text(nestedRecord(room, "category").name)} ·{" "}
                                {text(nestedRecord(room, "category").slug)}
                              </p>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              <Pill tone={statusTone(room.status)}>
                                {text(room.status)}
                              </Pill>
                              <Pill>{text(room.gameMode)}</Pill>
                            </div>
                          </div>

                          <div className="mt-3 grid gap-2 text-xs text-text-secondary sm:grid-cols-4">
                            <span>ID: {id}</span>
                            <span>Max players: {text(room.maxPlayers)}</span>
                            <span>
                              Duration: {text(room.roundDurationMs)}ms
                            </span>
                            <span>
                              Rounds:{" "}
                              {text(nestedRecord(room, "_count").rounds, "0")}
                            </span>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>

                {roomForPanel ? (
                  <div className="mt-4 rounded-xl border border-[var(--border)] bg-black/20 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.16em] text-gold">
                          Selected room
                        </p>
                        <p className="mt-1 font-mono text-sm text-text-secondary">
                          {roomForPanelId}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                      <Button
                        onClick={() =>
                          void runAction(
                            "Start round",
                            `start:${roomForPanelId}`,
                            () =>
                              adminPost(
                                `/admin/rooms/${roomForPanelId}/rounds/start`,
                              ),
                          )
                        }
                        disabled={Boolean(actionState)}
                      >
                        Start Round
                      </Button>

                      <Button
                        variant="secondary"
                        onClick={() =>
                          void runAction(
                            "Cancel current round",
                            `cancel:${roomForPanelId}`,
                            () =>
                              adminPost(
                                `/admin/rooms/${roomForPanelId}/rounds/cancel-current`,
                              ),
                          )
                        }
                        disabled={Boolean(actionState)}
                      >
                        Cancel Current
                      </Button>

                      <Button
                        variant="secondary"
                        onClick={() =>
                          void runAction(
                            "Start machine",
                            `machine-start:${roomForPanelId}`,
                            () =>
                              adminPost(
                                `/admin/rooms/${roomForPanelId}/machine/start`,
                              ),
                          )
                        }
                        disabled={Boolean(actionState)}
                      >
                        Start Machine
                      </Button>

                      <Button
                        variant="secondary"
                        onClick={() =>
                          void runAction(
                            "Stop machine",
                            `machine-stop:${roomForPanelId}`,
                            () =>
                              adminPost(
                                `/admin/rooms/${roomForPanelId}/machine/stop`,
                              ),
                          )
                        }
                        disabled={Boolean(actionState)}
                      >
                        Stop Machine
                      </Button>

                      <Button
                        variant="secondary"
                        onClick={() =>
                          void runAction(
                            "Machine status",
                            `machine-status:${roomForPanelId}`,
                            () =>
                              adminGet(
                                `/admin/rooms/${roomForPanelId}/machine/status`,
                              ),
                          )
                        }
                        disabled={Boolean(actionState)}
                      >
                        Machine Status
                      </Button>

                      <Button
                        variant="secondary"
                        onClick={() =>
                          void runAction(
                            "Advance once",
                            `machine-advance:${roomForPanelId}`,
                            () =>
                              adminPost(
                                `/admin/rooms/${roomForPanelId}/machine/advance-once?force=false`,
                              ),
                          )
                        }
                        disabled={Boolean(actionState)}
                      >
                        Advance Once
                      </Button>
                    </div>
                  </div>
                ) : null}
              </Section>

              <Section
                title="Active rounds"
                subtitle="Round actions are audited and protected by admin RBAC."
              >
                <div className="space-y-3">
                  {visibleRounds.length === 0 ? (
                    <p className="text-sm text-text-secondary">
                      No active rounds found.
                    </p>
                  ) : (
                    visibleRounds.map((round) => {
                      const roundRecord = asRecord(round);
                      const id = text(roundRecord.id, "");
                      const roomId = text(roundRecord.roomId, "");
                      const status = getRoundStatus(round);

                      return (
                        <div
                          key={id}
                          className="rounded-xl border border-[var(--border)] bg-white/[0.03] p-4"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="font-display text-lg font-black">
                                Round #{text(roundRecord.roundNumber)}
                              </p>
                              <p className="mt-1 font-mono text-xs text-text-secondary">
                                {id}
                              </p>
                              <p className="mt-1 text-xs text-text-secondary">
                                Room: {roomId}
                              </p>
                            </div>

                            <Pill tone={statusTone(status)}>{status}</Pill>
                          </div>

                          <div className="mt-3 grid gap-2 text-xs text-text-secondary sm:grid-cols-2">
                            <span>Opened: {text(roundRecord.openedAt)}</span>
                            <span>Locks: {text(roundRecord.locksAt)}</span>
                            <span>
                              Pool:{" "}
                              {formatCoins(
                                String(roundRecord.totalEntryAmount ?? 0),
                              )}
                            </span>
                            <span>
                              Entries:{" "}
                              {text(nestedRecord(round, "_count").entries, "0")}
                            </span>
                          </div>

                          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                            <Button
                              variant="secondary"
                              onClick={() =>
                                void runAction(
                                  "Lock current round",
                                  `lock:${roomId}`,
                                  () =>
                                    adminPost(
                                      `/admin/rooms/${roomId}/rounds/lock-current`,
                                    ),
                                )
                              }
                              disabled={Boolean(actionState)}
                            >
                              Lock
                            </Button>

                            <Button
                              variant="secondary"
                              onClick={() =>
                                void runAction(
                                  "Draw current round",
                                  `draw:${roomId}`,
                                  () =>
                                    adminPost(
                                      `/admin/rooms/${roomId}/rounds/draw-current`,
                                    ),
                                )
                              }
                              disabled={Boolean(actionState)}
                            >
                              Draw
                            </Button>

                            <Button
                              variant="secondary"
                              onClick={() =>
                                void runAction(
                                  "Settle current round",
                                  `settle:${roomId}`,
                                  () =>
                                    adminPost(
                                      `/admin/rooms/${roomId}/rounds/settle-current`,
                                    ),
                                )
                              }
                              disabled={Boolean(actionState)}
                            >
                              Settle
                            </Button>

                            <Button
                              variant="secondary"
                              onClick={() =>
                                void runAction(
                                  "Cancel current round",
                                  `round-cancel:${roomId}`,
                                  () =>
                                    adminPost(
                                      `/admin/rooms/${roomId}/rounds/cancel-current`,
                                    ),
                                )
                              }
                              disabled={Boolean(actionState)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </Section>
            </div>

            {actionState ? (
              <div className="rounded-xl border border-[rgba(246,197,71,0.35)] bg-[rgba(246,197,71,0.1)] px-4 py-3 text-sm font-semibold text-gold">
                Running: {actionState.label}
              </div>
            ) : null}

            {lastResult ? (
              <Section title="Last action result">
                <div className="max-h-[300px] overflow-auto rounded-lg border border-[var(--border)] bg-black/20 p-3">
                  <pre className="text-xs leading-relaxed text-text-secondary">
                    {JSON.stringify(lastResult, null, 2)}
                  </pre>
                </div>
              </Section>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-3">
              <Section title="Users">
                <JsonTable rows={state.users} />
              </Section>

              <Section title="Deposits">
                <JsonTable rows={state.deposits} />
              </Section>

              <Section title="Withdrawals">
                <JsonTable rows={state.withdrawals} />
              </Section>

              <Section title="Wallet / Ledger">
                <JsonTable rows={dashboard.recentEntries ?? []} />
              </Section>

              <Section title="Fraud / Risk">
                <JsonTable rows={state.risk} />
              </Section>

              <Section title="Audit">
                <JsonTable rows={state.audit} />
              </Section>

              <Section title="Realtime / Jobs">
                <JsonTable rows={state.jobs} />
              </Section>
            </div>
          </div>
        ) : null}
      </div>
    </GameShell>
  );
}
