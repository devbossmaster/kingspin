"use client";

import {
  Activity,
  Banknote,
  CircleDollarSign,
  DoorOpen,
  RefreshCw,
  ShieldAlert,
  Ticket,
  Trophy,
  UserPlus,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  adminApi,
  isAdminRequestAbort,
  type AdminRequestOptions,
} from "../../lib/admin-api";
import {
  adminAmount,
  adminDate,
  adminRelativeDate,
  adminShortId,
  adminText,
} from "../../lib/admin-formatters";
import { AdminStatCard } from "../../components/admin/admin-stat-card";
import { AdminStatusBadge } from "../../components/admin/admin-status-badge";
import { AdminErrorState } from "../../components/admin/admin-state";

type Dashboard = Record<string, unknown>;
type LoadState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function list(value: unknown) {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

function MetricGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-xs font-black uppercase text-slate-400">{title}</h2>
        <span className="h-px flex-1 bg-white/10" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{children}</div>
    </section>
  );
}

function MetricSkeletonCards({ count = 4 }: { count?: number }) {
  return Array.from({ length: count }, (_, index) => (
    <div
      key={index}
      className="min-h-28 animate-pulse border border-white/10 bg-[#0d1821] p-4"
    >
      <div className="h-3 w-24 bg-white/10" />
      <div className="mt-6 h-7 w-32 bg-white/10" />
      <div className="mt-4 h-2 w-full bg-white/[0.06]" />
    </div>
  ));
}

function PanelError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="border border-red-400/20 bg-red-400/[0.04] p-4 text-sm text-red-200">
      <p className="font-bold">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 min-h-9 border border-red-300/30 px-3 text-xs font-black"
      >
        Retry
      </button>
    </div>
  );
}

function RecentSkeletonPanel({ title }: { title: string }) {
  return (
    <section className="border border-white/10 bg-[#0d1821]">
      <h2 className="border-b border-white/10 px-4 py-3 text-xs font-black uppercase text-slate-400">
        {title}
      </h2>
      <div className="space-y-3 p-4">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="animate-pulse">
            <div className="h-3 w-2/3 bg-white/10" />
            <div className="mt-2 h-2 w-1/2 bg-white/[0.06]" />
          </div>
        ))}
      </div>
    </section>
  );
}

function ActivityPanel({
  title,
  items,
  primary,
  secondary,
  amount,
  error,
  onRetry,
}: {
  title: string;
  items: Array<Record<string, unknown>>;
  primary: (item: Record<string, unknown>) => string;
  secondary: (item: Record<string, unknown>) => string;
  amount?: (item: Record<string, unknown>) => string;
  error?: string;
  onRetry?: () => void;
}) {
  return (
    <section className="border border-white/10 bg-[#0d1821]">
      <h2 className="border-b border-white/10 px-4 py-3 text-xs font-black uppercase text-slate-400">
        {title}
      </h2>
      <div className="divide-y divide-white/[0.07]">
        {error ? (
          <div className="px-4 py-7 text-sm text-red-200">
            <p className="font-bold">{error}</p>
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="mt-3 min-h-9 border border-red-300/30 px-3 text-xs font-black"
              >
                Retry
              </button>
            ) : null}
          </div>
        ) : items.length === 0 ? (
          <p className="px-4 py-7 text-sm text-slate-500">No recent activity</p>
        ) : (
          items.map((item) => (
            <div
              key={adminText(item.id)}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-slate-200">
                  {primary(item)}
                </p>
                <p
                  className="mt-1 truncate text-xs text-slate-500"
                  title={adminDate(item.createdAt ?? item.completedAt)}
                >
                  {secondary(item)}
                </p>
              </div>
              <div className="text-right">
                {amount ? (
                  <p className="font-mono text-sm font-black text-white">
                    {amount(item)}
                  </p>
                ) : null}
                {item.status || item.severity ? (
                  <div className="mt-1">
                    <AdminStatusBadge value={item.status ?? item.severity} />
                  </div>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export default function AdminDashboardPage() {
  const [summary, setSummary] = useState<LoadState<Dashboard>>({
    data: null,
    loading: true,
    error: null,
  });
  const [recentState, setRecentState] = useState<LoadState<Dashboard>>({
    data: null,
    loading: true,
    error: null,
  });
  const [healthState, setHealthState] = useState<LoadState<Dashboard>>({
    data: null,
    loading: true,
    error: null,
  });
  const summarySequence = useRef(0);
  const recentSequence = useRef(0);
  const healthSequence = useRef(0);

  const loadSummary = useCallback(async (options?: AdminRequestOptions) => {
    const requestId = summarySequence.current + 1;
    summarySequence.current = requestId;
    setSummary((state) => ({ ...state, loading: true, error: null }));
    try {
      const data = await adminApi.dashboardSummary(options);
      if (summarySequence.current !== requestId) return;
      setSummary({ data, loading: false, error: null });
    } catch (caught) {
      if (
        summarySequence.current !== requestId ||
        isAdminRequestAbort(caught)
      ) {
        return;
      }
      setSummary((state) => ({
        ...state,
        loading: false,
        error:
          caught instanceof Error
            ? caught.message
            : "Could not load dashboard summary.",
      }));
    } finally {
      if (summarySequence.current === requestId) {
        setSummary((state) => ({ ...state, loading: false }));
      }
    }
  }, []);

  const loadRecent = useCallback(async (options?: AdminRequestOptions) => {
    const requestId = recentSequence.current + 1;
    recentSequence.current = requestId;
    setRecentState((state) => ({ ...state, loading: true, error: null }));
    try {
      const data = await adminApi.dashboardRecent(options);
      if (recentSequence.current !== requestId) return;
      setRecentState({ data, loading: false, error: null });
    } catch (caught) {
      if (recentSequence.current !== requestId || isAdminRequestAbort(caught)) {
        return;
      }
      setRecentState((state) => ({
        ...state,
        loading: false,
        error:
          caught instanceof Error
            ? caught.message
            : "Could not load recent activity.",
      }));
    } finally {
      if (recentSequence.current === requestId) {
        setRecentState((state) => ({ ...state, loading: false }));
      }
    }
  }, []);

  const loadHealth = useCallback(async (options?: AdminRequestOptions) => {
    const requestId = healthSequence.current + 1;
    healthSequence.current = requestId;
    setHealthState((state) => ({ ...state, loading: true, error: null }));
    try {
      const data = await adminApi.health(options);
      if (healthSequence.current !== requestId) return;
      setHealthState({ data, loading: false, error: null });
    } catch (caught) {
      if (healthSequence.current !== requestId || isAdminRequestAbort(caught)) {
        return;
      }
      setHealthState((state) => ({
        ...state,
        loading: false,
        error:
          caught instanceof Error ? caught.message : "Health summary failed.",
      }));
    } finally {
      if (healthSequence.current === requestId) {
        setHealthState((state) => ({ ...state, loading: false }));
      }
    }
  }, []);

  const refresh = useCallback(
    (options?: AdminRequestOptions) => {
      void loadSummary(options);
      void loadRecent(options);
      void loadHealth(options);
    },
    [loadHealth, loadRecent, loadSummary],
  );

  useEffect(() => {
    const controller = new AbortController();
    refresh({ signal: controller.signal });

    return () => {
      controller.abort();
    };
  }, [refresh]);

  const dashboard = summary.data;
  const game = record(dashboard?.game);
  const payments = record(dashboard?.payments);
  const users = record(dashboard?.users);
  const risk = record(dashboard?.risk);
  const system = record(healthState.data);
  const roundMachine = record(system.roundMachine);
  const recent = record(recentState.data);
  const recentWarnings = record(recent.warnings);
  const loading = summary.loading || recentState.loading || healthState.loading;

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase text-emerald-400">
            Operations overview
          </p>
          <h1 className="mt-1 text-2xl font-black text-white sm:text-3xl">
            Dashboard
          </h1>
        </div>
        <button
          type="button"
          onClick={() => refresh()}
          disabled={loading}
          className="inline-flex min-h-10 items-center gap-2 border border-white/10 px-3 text-sm font-black text-slate-300"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <section className="grid gap-2 border-y border-white/10 bg-[#0b151d] py-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          [
            "API",
            healthState.loading && !healthState.data ? "LOADING" : system.api,
          ],
          [
            "Database",
            healthState.loading && !healthState.data
              ? "LOADING"
              : record(system.database).status,
          ],
          [
            "Redis",
            healthState.loading && !healthState.data
              ? "LOADING"
              : record(system.redis).status,
          ],
          [
            "Round machine",
            healthState.loading && !healthState.data
              ? "LOADING"
              : roundMachine.running
                ? "OK"
                : roundMachine.enabled
                  ? "DEGRADED"
                  : "UNKNOWN",
          ],
        ].map(([label, value]) => (
          <div
            key={String(label)}
            className="flex items-center justify-between px-3"
          >
            <span className="text-xs font-black uppercase text-slate-500">
              {adminText(label)}
            </span>
            <AdminStatusBadge value={value} />
          </div>
        ))}
      </section>
      {healthState.error ? (
        <PanelError
          message={healthState.error}
          onRetry={() => void loadHealth()}
        />
      ) : null}

      {summary.error && !summary.data ? (
        <AdminErrorState
          message={summary.error}
          onRetry={() => void loadSummary()}
        />
      ) : (
        <>
          {summary.error ? (
            <PanelError
              message={summary.error}
              onRetry={() => void loadSummary()}
            />
          ) : null}
          <MetricGroup title="Game operations">
            {summary.loading && !summary.data ? (
              <MetricSkeletonCards count={8} />
            ) : (
              <>
                <AdminStatCard
                  label="Active rooms"
                  value={adminText(game.activeRooms, "0")}
                  icon={DoorOpen}
                />
                <AdminStatCard
                  label="Open rounds"
                  value={adminText(game.openRounds, "0")}
                  icon={Trophy}
                  tone="blue"
                />
                <AdminStatCard
                  label="Running phases"
                  value={adminText(game.spinningRounds, "0")}
                  icon={Activity}
                  tone="gold"
                />
                <AdminStatCard
                  label="Open pool"
                  value={adminAmount(game.openPoolAmount)}
                  icon={CircleDollarSign}
                />
                <AdminStatCard
                  label="Entries today"
                  value={adminText(game.entriesToday, "0")}
                  icon={Ticket}
                  tone="blue"
                />
                <AdminStatCard
                  label="Completed today"
                  value={adminText(game.completedRoundsToday, "0")}
                  icon={Trophy}
                />
                <AdminStatCard
                  label="Stale warnings"
                  value={
                    Number(roundMachine.staleCompletedRounds ?? 0) +
                    Number(roundMachine.staleRunningRounds ?? 0)
                  }
                  icon={ShieldAlert}
                  tone="red"
                />
                <AdminStatCard
                  label="Last machine tick"
                  value={adminRelativeDate(roundMachine.lastTickAt)}
                  icon={Activity}
                  tone="gold"
                />
              </>
            )}
          </MetricGroup>

          <MetricGroup title="Payments">
            {summary.loading && !summary.data ? (
              <MetricSkeletonCards count={7} />
            ) : (
              <>
                <AdminStatCard
                  label="Deposits pending"
                  value={adminText(payments.pendingDeposits, "0")}
                  icon={CircleDollarSign}
                  tone="gold"
                />
                <AdminStatCard
                  label="Deposits credited"
                  value={adminText(payments.creditedDepositsToday, "0")}
                  icon={CircleDollarSign}
                />
                <AdminStatCard
                  label="Deposit amount"
                  value={adminAmount(
                    payments.creditedDepositAmountToday,
                    "ETB",
                  )}
                  icon={CircleDollarSign}
                  tone="blue"
                />
                <AdminStatCard
                  label="Verification failures"
                  value={adminText(payments.failedDepositAttemptsToday, "0")}
                  icon={ShieldAlert}
                  tone="red"
                />
                <AdminStatCard
                  label="Withdrawals pending"
                  value={adminText(payments.pendingWithdrawals, "0")}
                  icon={Banknote}
                  tone="gold"
                />
                <AdminStatCard
                  label="Withdrawals completed"
                  value={adminText(payments.completedWithdrawalsToday, "0")}
                  icon={Banknote}
                />
                <AdminStatCard
                  label="Withdrawal amount"
                  value={adminAmount(payments.completedWithdrawalAmountToday)}
                  icon={Banknote}
                  tone="blue"
                />
              </>
            )}
          </MetricGroup>

          <MetricGroup title="Users and risk">
            {summary.loading && !summary.data ? (
              <MetricSkeletonCards count={8} />
            ) : (
              <>
                <AdminStatCard
                  label="Total users"
                  value={adminText(users.totalUsers, "0")}
                  icon={Users}
                  tone="blue"
                />
                <AdminStatCard
                  label="New users today"
                  value={adminText(users.newUsersToday, "0")}
                  icon={UserPlus}
                />
                <AdminStatCard
                  label="Active players today"
                  value={adminText(users.activePlayersToday, "0")}
                  icon={Users}
                />
                <AdminStatCard
                  label="Suspended users"
                  value={adminText(users.suspendedUsers, "0")}
                  icon={ShieldAlert}
                  tone="red"
                />
                <AdminStatCard
                  label="Open risk flags"
                  value={adminText(risk.openRiskEvents, "0")}
                  icon={ShieldAlert}
                  tone="gold"
                />
                <AdminStatCard
                  label="High severity"
                  value={adminText(risk.highSeverityRiskEvents, "0")}
                  icon={ShieldAlert}
                  tone="red"
                />
                <AdminStatCard
                  label="Rapid entry blocks"
                  value={adminText(risk.rapidEntryBlocksToday, "0")}
                  icon={Ticket}
                  tone="red"
                />
                <AdminStatCard
                  label="Receipt conflicts"
                  value={adminText(risk.duplicateReceiptAttemptsToday, "0")}
                  icon={CircleDollarSign}
                  tone="gold"
                />
              </>
            )}
          </MetricGroup>
        </>
      )}

      <section>
        <div className="mb-3 flex items-center gap-3">
          <h2 className="text-xs font-black uppercase text-slate-400">
            Recent activity
          </h2>
          <span className="h-px flex-1 bg-white/10" />
        </div>
        {recentState.error ? (
          <PanelError
            message={recentState.error}
            onRetry={() => void loadRecent()}
          />
        ) : null}
        {recentState.error && !recentState.data ? null : recentState.loading &&
          !recentState.data ? (
          <div className="grid gap-4 xl:grid-cols-3">
            {[
              "Deposits",
              "Withdrawals",
              "Entries",
              "Completed rounds",
              "Audit actions",
              "Open risk events",
            ].map((title) => (
              <RecentSkeletonPanel key={title} title={title} />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-3">
            <ActivityPanel
              title="Deposits"
              items={list(recent.deposits)}
              error={adminText(recentWarnings.deposits, "") || undefined}
              onRetry={() => void loadRecent()}
              primary={(item) => adminText(item.player)}
              secondary={(item) => adminRelativeDate(item.createdAt)}
              amount={(item) => adminAmount(item.amount, item.currency)}
            />
            <ActivityPanel
              title="Withdrawals"
              items={list(recent.withdrawals)}
              error={adminText(recentWarnings.withdrawals, "") || undefined}
              onRetry={() => void loadRecent()}
              primary={(item) => adminText(item.player)}
              secondary={(item) => adminRelativeDate(item.createdAt)}
              amount={(item) => adminAmount(item.amount, item.currency)}
            />
            <ActivityPanel
              title="Entries"
              items={list(recent.entries)}
              error={adminText(recentWarnings.entries, "") || undefined}
              onRetry={() => void loadRecent()}
              primary={(item) =>
                `${adminText(item.player)} · ${adminText(item.room)}`
              }
              secondary={(item) =>
                `Round #${adminText(item.roundNumber)} · ${adminRelativeDate(item.createdAt)}`
              }
              amount={(item) => adminAmount(item.amount)}
            />
            <ActivityPanel
              title="Completed rounds"
              items={list(recent.rounds)}
              error={adminText(recentWarnings.rounds, "") || undefined}
              onRetry={() => void loadRecent()}
              primary={(item) =>
                `${adminText(item.room)} · Round #${adminText(item.roundNumber)}`
              }
              secondary={(item) => adminRelativeDate(item.completedAt)}
              amount={(item) => adminAmount(item.payoutAmount)}
            />
            <ActivityPanel
              title="Audit actions"
              items={list(recent.audit)}
              error={adminText(recentWarnings.audit, "") || undefined}
              onRetry={() => void loadRecent()}
              primary={(item) => adminText(item.action).replaceAll("_", " ")}
              secondary={(item) =>
                `${adminText(item.actor)} · ${adminShortId(item.targetId)} · ${adminRelativeDate(item.createdAt)}`
              }
            />
            <ActivityPanel
              title="Open risk events"
              items={list(recent.risk)}
              error={adminText(recentWarnings.risk, "") || undefined}
              onRetry={() => void loadRecent()}
              primary={(item) => adminText(item.type).replaceAll("_", " ")}
              secondary={(item) =>
                `${adminText(item.player, "System")} · ${adminRelativeDate(item.createdAt)}`
              }
            />
          </div>
        )}
      </section>
    </div>
  );
}
