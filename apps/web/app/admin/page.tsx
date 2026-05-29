"use client";

import { useEffect, useMemo, useState } from "react";
import { GameShell } from "../../components/player/game-shell";
import { Button } from "../../components/ui/button";
import { apiClient } from "../../lib/api-client";
import { formatCoins } from "../../lib/format";

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

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4">
      <h2 className="text-sm font-black uppercase tracking-[0.16em] text-[var(--gold)]">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function JsonTable({ rows }: { rows: unknown }) {
  const list = asArray(rows).slice(0, 8);

  if (list.length === 0) {
    return <p className="text-sm text-text-secondary">No records.</p>;
  }

  return (
    <div className="overflow-auto">
      <pre className="text-xs leading-relaxed text-text-secondary">
        {JSON.stringify(list, null, 2)}
      </pre>
    </div>
  );
}

export default function AdminPage() {
  const [state, setState] = useState<LoadState | null>(null);
  const [me, setMe] = useState<{ role?: string } | null>(null);
  const [roomId, setRoomId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const dashboard = useMemo(() => asRecord(state?.dashboard), [state]);
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
        rooms,
        users,
        rounds,
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
        rooms,
        users,
        rounds,
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

  async function runRoomAction(action: "status" | "advance") {
    if (!roomId.trim()) return;
    setError(null);

    try {
      const result =
        action === "status"
          ? await apiClient.admin.getMachineStatus(roomId.trim())
          : await apiClient.admin.advanceOnce(roomId.trim());

      setState((current) =>
        current
          ? {
              ...current,
              jobs: result,
            }
          : current,
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Admin action failed.",
      );
    }
  }

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
          <div className="mt-5 rounded-md border border-[rgba(248,113,113,0.42)] bg-[rgba(248,113,113,0.12)] px-4 py-3 text-sm text-red-hot">
            {error}
          </div>
        ) : null}

        {!loading && !isAdmin ? (
          <div className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-5 text-sm text-text-secondary">
            Admin role required.
          </div>
        ) : null}

        {state && isAdmin ? (
          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <Section title="Dashboard">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>Active rooms: {String(dashboard.activeRooms ?? 0)}</div>
                <div>Active rounds: {String(dashboard.activeRounds ?? 0)}</div>
                <div>
                  Open pool: {formatCoins(String(dashboard.totalOpenPool ?? 0))}
                </div>
                <div>
                  Suspicious: {String(dashboard.suspiciousActivityCount ?? 0)}
                </div>
                <div>Failed jobs: {String(dashboard.failedJobCount ?? 0)}</div>
              </div>
            </Section>

            <Section title="Rooms">
              <JsonTable rows={state.rooms} />
            </Section>

            <Section title="Rounds">
              <JsonTable rows={state.rounds} />
            </Section>

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
              <JsonTable
                rows={state.dashboard ? dashboard.recentEntries : []}
              />
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

            <Section title="Round Machine">
              <label className="block text-sm font-semibold text-text-secondary">
                Room ID
                <input
                  value={roomId}
                  onChange={(event) => setRoomId(event.target.value)}
                  className="mt-2 w-full rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-3 font-mono text-text-primary"
                />
              </label>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => void runRoomAction("status")}
                >
                  Status
                </Button>
                <Button onClick={() => void runRoomAction("advance")}>
                  Advance
                </Button>
              </div>
            </Section>
          </div>
        ) : null}
      </div>
    </GameShell>
  );
}
