"use client";

import { ChevronLeft, ChevronRight, RefreshCw, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  isAdminRequestAbort,
  type AdminPage,
  type AdminQuery,
  type AdminRecord,
  type AdminRequestOptions,
} from "../../lib/admin-api";
import { adminShortId, adminText } from "../../lib/admin-formatters";
import { Dialog } from "../ui/dialog";
import { AdminConfirmDialog } from "./admin-confirm-dialog";
import {
  AdminDataTable,
  type AdminColumn,
  type AdminRowAction,
} from "./admin-data-table";
import {
  AdminEmptyState,
  AdminErrorState,
  AdminLoadingTable,
} from "./admin-state";

const SHORTENED_DETAIL_KEYS = new Set([
  "externalReference",
  "normalizedRef",
  "providerReference",
  "rawProviderHash",
  "receiptNo",
  "submittedValue",
]);

function formatDetailValue(key: string, value: unknown) {
  if (SHORTENED_DETAIL_KEYS.has(key)) {
    return adminShortId(value);
  }

  return typeof value === "object" && value !== null
    ? JSON.stringify(value, null, 2)
    : adminText(value);
}

export type AdminAction = {
  label: string;
  title: string;
  description: string;
  confirmLabel: string;
  inputLabel?: string;
  validate?: (value: string) => string | null;
  run: (value: string) => Promise<unknown>;
};

export function AdminResourcePage({
  title,
  eyebrow,
  columns,
  statuses = [],
  extraFilters = [],
  load,
  actions,
}: {
  title: string;
  eyebrow: string;
  columns: AdminColumn[];
  statuses?: string[];
  extraFilters?: Array<{
    key: keyof AdminQuery;
    label: string;
    options: string[];
  }>;
  load: (
    query: AdminQuery,
    options?: AdminRequestOptions,
  ) => Promise<AdminPage<AdminRecord>>;
  actions?: (
    row: AdminRecord,
    open: (action: AdminAction) => void,
  ) => AdminRowAction[];
}) {
  const [data, setData] = useState<AdminPage<AdminRecord> | null>(null);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [extraFilterValues, setExtraFilterValues] = useState<
    Record<string, string>
  >({});
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<AdminRecord | null>(null);
  const [pendingAction, setPendingAction] = useState<AdminAction | null>(null);
  const [actionInput, setActionInput] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const pageSize = 25;

  const refresh = useCallback(
    async (options?: AdminRequestOptions) => {
      const requestId = requestSequence.current + 1;
      requestSequence.current = requestId;
      setLoading(true);
      setError(null);
      try {
        const response = await load(
          {
            page,
            pageSize,
            q,
            status,
            from,
            to,
            ...extraFilterValues,
          },
          options,
        );
        if (options?.signal?.aborted || requestSequence.current !== requestId) {
          return;
        }
        setData(response);
      } catch (caught) {
        if (requestSequence.current !== requestId) {
          return;
        }
        if (isAdminRequestAbort(caught)) {
          return;
        }
        setError(
          caught instanceof Error ? caught.message : "Could not load records.",
        );
      } finally {
        if (requestSequence.current === requestId) {
          setLoading(false);
        }
      }
    },
    [extraFilterValues, from, load, page, q, status, to],
  );

  useEffect(() => {
    const controller = new AbortController();
    void refresh({ signal: controller.signal });

    return () => {
      controller.abort();
    };
  }, [refresh]);

  useEffect(() => {
    const nextQuery = searchInput.trim();
    const timeoutId = window.setTimeout(() => {
      setPage(1);
      setQ(nextQuery);
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [searchInput]);

  function applySearch() {
    setPage(1);
    setQ(searchInput.trim());
  }

  function openAction(action: AdminAction) {
    setPendingAction(action);
    setActionInput("");
    setActionError(null);
  }

  async function confirmAction() {
    if (!pendingAction) return;
    const validation = pendingAction.validate?.(actionInput) ?? null;
    if (validation) {
      setActionError(validation);
      return;
    }

    setActionBusy(true);
    setActionError(null);
    try {
      await pendingAction.run(actionInput);
      toast.success(`${pendingAction.label} completed`);
      setPendingAction(null);
      setActionInput("");
      await refresh();
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : "Admin action failed.",
      );
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase text-emerald-400">
            {eyebrow}
          </p>
          <h1 className="mt-1 text-2xl font-black text-white sm:text-3xl">
            {title}
          </h1>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/10 px-3 text-sm font-black text-slate-300 hover:bg-white/[0.04]"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="mt-5 grid gap-2 rounded-2xl border border-white/10 bg-[#0b151d] p-3 shadow-[0_16px_40px_rgba(0,0,0,0.16)] md:grid-cols-[minmax(220px,1fr)_180px_180px_180px_160px_160px_auto]">
        <div className="flex min-w-0">
          <label className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-3 h-4 w-4 text-slate-600" />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") applySearch();
              }}
              placeholder="Search"
              className="h-10 w-full rounded-l-lg border border-white/10 bg-[#071018] pl-10 pr-3 text-sm text-white outline-none focus:border-emerald-400"
            />
          </label>
          <button
            type="button"
            onClick={applySearch}
            aria-label="Apply search"
            title="Apply search"
            className="grid h-10 w-10 place-items-center rounded-r-lg bg-emerald-400 text-[#071018]"
          >
            <Search className="h-4 w-4" />
          </button>
        </div>
        <select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
          className="h-10 rounded-lg border border-white/10 bg-[#071018] px-3 text-sm text-slate-300 outline-none focus:border-emerald-400"
        >
          <option value="">All statuses</option>
          {statuses.map((item) => (
            <option key={item} value={item}>
              {item.replaceAll("_", " ")}
            </option>
          ))}
        </select>
        {extraFilters.map((filter) => (
          <select
            key={String(filter.key)}
            value={extraFilterValues[String(filter.key)] ?? ""}
            onChange={(event) => {
              setExtraFilterValues((values) => ({
                ...values,
                [String(filter.key)]: event.target.value,
              }));
              setPage(1);
            }}
            className="h-10 rounded-lg border border-white/10 bg-[#071018] px-3 text-sm text-slate-300 outline-none focus:border-emerald-400"
          >
            <option value="">{filter.label}</option>
            {filter.options.map((item) => (
              <option key={item} value={item}>
                {item.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        ))}
        <input
          type="date"
          aria-label="From date"
          value={from}
          onChange={(event) => {
            setFrom(event.target.value);
            setPage(1);
          }}
          className="h-10 rounded-lg border border-white/10 bg-[#071018] px-3 text-sm text-slate-300 outline-none focus:border-emerald-400"
        />
        <input
          type="date"
          aria-label="To date"
          value={to}
          onChange={(event) => {
            setTo(event.target.value);
            setPage(1);
          }}
          className="h-10 rounded-lg border border-white/10 bg-[#071018] px-3 text-sm text-slate-300 outline-none focus:border-emerald-400"
        />
        <button
          type="button"
          onClick={() => {
            setSearchInput("");
            setQ("");
            setStatus("");
            setExtraFilterValues({});
            setFrom("");
            setTo("");
            setPage(1);
          }}
          aria-label="Clear filters"
          title="Clear filters"
          className="grid h-10 w-10 place-items-center rounded-lg border border-white/10 text-slate-400"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4">
        {loading && !data ? <AdminLoadingTable /> : null}
        {error ? (
          <AdminErrorState message={error} onRetry={() => void refresh()} />
        ) : null}
        {!error && !loading && data?.items.length === 0 ? (
          <AdminEmptyState />
        ) : null}
        {!error && data && data.items.length > 0 ? (
          <AdminDataTable
            rows={data.items}
            columns={columns}
            onDetails={setDetails}
            actions={actions ? (row) => actions(row, openAction) : undefined}
          />
        ) : null}
      </div>

      {data ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400">
          <p>
            {data.total.toLocaleString()} records · Page {data.page} of{" "}
            {data.totalPages}
          </p>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              disabled={page <= 1 || loading}
              aria-label="Previous page"
              title="Previous page"
              className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 disabled:opacity-35"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() =>
                setPage((value) => Math.min(data.totalPages, value + 1))
              }
              disabled={page >= data.totalPages || loading}
              aria-label="Next page"
              title="Next page"
              className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 disabled:opacity-35"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      <Dialog
        open={Boolean(details)}
        title="Record details"
        onClose={() => setDetails(null)}
        panelClassName="max-h-[88vh] max-w-2xl overflow-y-auto border border-white/15 bg-[#0d1821] p-5"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase text-emerald-400">
              Record details
            </p>
            <h2 className="mt-1 font-mono text-lg font-black text-white">
              {adminShortId(details?.id)}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setDetails(null)}
            aria-label="Close details"
            title="Close"
            className="grid h-9 w-9 place-items-center border border-white/10 text-slate-400"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <dl className="mt-5 divide-y divide-white/[0.07] border-y border-white/10">
          {details
            ? Object.entries(details).map(([key, value]) => (
                <div
                  key={key}
                  className="grid gap-1 py-3 sm:grid-cols-[180px_minmax(0,1fr)]"
                >
                  <dt className="text-xs font-black uppercase text-slate-500">
                    {key.replaceAll("_", " ")}
                  </dt>
                  <dd className="break-words font-mono text-xs leading-5 text-slate-300">
                    {formatDetailValue(key, value)}
                  </dd>
                </div>
              ))
            : null}
        </dl>
      </Dialog>

      <AdminConfirmDialog
        open={Boolean(pendingAction)}
        title={pendingAction?.title ?? ""}
        description={pendingAction?.description ?? ""}
        inputLabel={pendingAction?.inputLabel}
        inputValue={actionInput}
        onInput={setActionInput}
        confirmLabel={pendingAction?.confirmLabel ?? "Confirm"}
        busy={actionBusy}
        error={actionError}
        onClose={() => {
          if (!actionBusy) setPendingAction(null);
        }}
        onConfirm={() => void confirmAction()}
      />
    </>
  );
}
