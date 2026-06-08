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
import { adminText } from "../../../lib/admin-formatters";

export default function AdminSettingsPage() {
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
      const response = await adminApi.settings(options);
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
        caught instanceof Error ? caught.message : "Settings unavailable.",
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
  if (error) {
    return <AdminErrorState message={error} onRetry={() => void refresh()} />;
  }

  const rows = [
    ["App environment", data?.appEnvironment],
    ["Payment provider", data?.paymentProvider],
    ["Telebirr receipt verification", data?.telebirrReceiptVerificationEnabled],
    ["Deposit minimum", data?.depositMinimum],
    ["Deposit maximum", data?.depositMaximum],
    ["Withdrawal minimum", data?.withdrawalMinimum],
    ["Withdrawal maximum", data?.withdrawalMaximum],
    ["Transfer minimum", data?.transferMinimum],
    ["Transfer maximum", data?.transferMaximum],
    ["Platform service fee", data?.platformFeePercent],
    ["Platform fee basis points", data?.platformFeeBps],
    ["Entry cutoff buffer", `${adminText(data?.entryCutoffBufferMs)} ms`],
    ["Redis enabled", data?.redisEnabled],
    ["Trusted proxy headers", data?.trustedProxyHeaders],
    ["Sentry configured", data?.sentryConfigured],
    ["Local development auth", data?.localDevAuthEnabled],
    ["Round machine auto-start", data?.roundMachineAutoStart],
  ];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase text-emerald-400">
            Read only
          </p>
          <h1 className="mt-1 text-2xl font-black text-white sm:text-3xl">
            Settings
          </h1>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/10 px-3 text-sm font-black text-slate-300"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>
      <section className="mt-6 max-w-4xl overflow-hidden rounded-2xl border border-white/10 bg-[#0d1821] shadow-[0_20px_60px_rgba(0,0,0,0.2)]">
        <dl className="divide-y divide-white/[0.07]">
          {rows.map(([label, value]) => (
            <div
              key={String(label)}
              className="grid min-h-14 items-center gap-2 px-4 py-3 sm:grid-cols-[260px_minmax(0,1fr)]"
            >
              <dt className="text-xs font-black uppercase text-slate-500">
                {adminText(label)}
              </dt>
              <dd className="text-sm font-bold text-slate-200">
                {typeof value === "boolean" ? (
                  <AdminStatusBadge value={value ? "ENABLED" : "DISABLED"} />
                ) : (
                  adminText(value)
                )}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
