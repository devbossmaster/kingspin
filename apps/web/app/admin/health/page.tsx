"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AdminErrorState,
  AdminLoadingTable,
} from "../../../components/admin/admin-state";
import { AdminStatusBadge } from "../../../components/admin/admin-status-badge";
import {
  adminApi,
  isAdminRequestAbort,
  type AdminRequestOptions,
} from "../../../lib/admin-api";
import {
  adminDate,
  adminRelativeDate,
  adminText,
} from "../../../lib/admin-formatters";

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export default function AdminHealthPage() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const refresh = useCallback(async (options?: AdminRequestOptions) => {
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    setLoading(true);
    setError(null);
    try {
      const response = await adminApi.health(options);
      if (requestSequence.current !== requestId) return;
      setData(response);
    } catch (caught) {
      if (
        requestSequence.current !== requestId ||
        isAdminRequestAbort(caught)
      ) {
        return;
      }
      setError(
        caught instanceof Error ? caught.message : "Health check failed.",
      );
    } finally {
      if (requestSequence.current === requestId) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh({ signal: controller.signal });

    return () => {
      controller.abort();
    };
  }, [refresh]);

  if (!data && loading) return <AdminLoadingTable />;
  if (error)
    return <AdminErrorState message={error} onRetry={() => void refresh()} />;

  const database = record(data?.database);
  const redis = record(data?.redis);
  const machine = record(data?.roundMachine);
  const deployment = record(data?.deployment);
  const checklist = Array.isArray(deployment.checklist)
    ? deployment.checklist
    : [];
  const stale =
    Number(machine.staleCompletedRounds ?? 0) +
    Number(machine.staleRunningRounds ?? 0);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase text-emerald-400">
            Infrastructure
          </p>
          <h1 className="mt-1 text-2xl font-black text-white sm:text-3xl">
            System Health
          </h1>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="inline-flex min-h-10 items-center gap-2 border border-white/10 px-3 text-sm font-black text-slate-300"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["API", data?.api, `Environment: ${adminText(data?.appEnvironment)}`],
          [
            "Database",
            database.status,
            `${adminText(database.latencyMs, "0")} ms`,
          ],
          [
            "Redis",
            redis.status,
            redis.enabled
              ? `${adminText(redis.latencyMs, "-")} ms`
              : "Disabled",
          ],
          [
            "Round machine",
            machine.running ? "OK" : machine.enabled ? "DEGRADED" : "UNKNOWN",
            adminText(machine.startupMode),
          ],
        ].map(([label, status, detail]) => (
          <section
            key={String(label)}
            className="border border-white/10 bg-[#0d1821] p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xs font-black uppercase text-slate-500">
                {adminText(label)}
              </h2>
              <AdminStatusBadge value={status} />
            </div>
            <p className="mt-4 font-mono text-sm text-slate-300">
              {adminText(detail)}
            </p>
          </section>
        ))}
      </div>

      <section className="mt-6 border border-white/10 bg-[#0d1821]">
        <h2 className="border-b border-white/10 px-4 py-3 text-xs font-black uppercase text-slate-400">
          Round machine
        </h2>
        <dl className="grid sm:grid-cols-2 xl:grid-cols-4">
          {[
            [
              "Last tick",
              `${adminRelativeDate(machine.lastTickAt)} · ${adminDate(machine.lastTickAt)}`,
            ],
            ["Next tick", adminDate(machine.nextTickAt)],
            ["Active rooms", machine.activeRooms],
            ["Running permanent", machine.runningPermanentRooms],
            ["Stale warnings", stale],
            ["Instance", machine.instanceId],
            ["Process", machine.pid],
            ["Sampled", adminDate(data?.sampledAt)],
          ].map(([label, value]) => (
            <div
              key={String(label)}
              className="border-b border-r border-white/[0.07] p-4"
            >
              <dt className="text-xs font-black uppercase text-slate-500">
                {adminText(label)}
              </dt>
              <dd className="mt-2 break-words font-mono text-sm text-slate-200">
                {adminText(value)}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-6 border border-amber-300/20 bg-amber-300/[0.04] p-4">
        <h2 className="text-xs font-black uppercase text-amber-200">
          Deployment checklist
        </h2>
        <ul className="mt-3 grid gap-2 text-sm text-slate-300 md:grid-cols-2">
          {checklist.map((item) => (
            <li
              key={String(item)}
              className="border-l-2 border-amber-300/40 pl-3"
            >
              {adminText(item)}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
