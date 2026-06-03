"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Clock3,
  Coins,
  ListChecks,
  Trophy,
} from "lucide-react";
import type {
  DepositSnapshot,
  LedgerTransactionSnapshot,
  PaymentProvider,
  WithdrawalSnapshot,
} from "@kingspin/contracts";
import { GameShell } from "../../components/player/game-shell";
import { Button } from "../../components/ui/button";
import { useSession } from "../../lib/auth-client";
import { apiClient } from "../../lib/api-client";
import { formatCoins, truncateId } from "../../lib/format";
import { useAuthStore } from "../../stores/auth-store";

type WalletTab = "deposit" | "withdraw" | "rewards" | "transactions";

const inputClass =
  "mt-2 w-full rounded-md border border-white/10 bg-white/[0.055] px-3 py-3 text-sm font-semibold text-white outline-none transition placeholder:text-slate-500 focus:border-sky-300/70 focus:ring-2 focus:ring-sky-500/20";

const labelClass =
  "text-xs font-black uppercase tracking-[0.14em] text-slate-500";

const tabs: Array<{
  id: WalletTab;
  label: string;
  icon: typeof Coins;
}> = [
  { id: "deposit", label: "Deposit", icon: ArrowDownToLine },
  { id: "withdraw", label: "Withdrawal", icon: ArrowUpFromLine },
  { id: "rewards", label: "Rewards", icon: Trophy },
  { id: "transactions", label: "Transactions", icon: ListChecks },
];

function createIdempotencyKey(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}:${crypto.randomUUID()}`;
  }

  return `${prefix}:${Date.now()}`;
}

function parseAmount(value: FormDataEntryValue | null) {
  const amount = Number(value);

  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function transactionDelta(transaction: LedgerTransactionSnapshot) {
  return transaction.entries.reduce((total, entry) => {
    const amount = Number(entry.amount);

    return entry.direction === "CREDIT" ? total + amount : total - amount;
  }, 0);
}

function StatusBadge({ status }: { status: string }) {
  const positive =
    status === "CONFIRMED" || status === "PAID" || status === "APPROVED";
  const waiting =
    status === "PENDING" ||
    status === "PENDING_REVIEW" ||
    status === "PROCESSING";

  return (
    <span
      className={`inline-flex min-h-7 items-center rounded-md border px-2 text-[11px] font-black uppercase ${
        positive
          ? "border-lime-300/35 bg-lime-400/10 text-lime-200"
          : waiting
            ? "border-yellow-300/35 bg-yellow-400/10 text-yellow-200"
            : "border-red-300/35 bg-red-500/10 text-red-200"
      }`}
    >
      {titleCase(status)}
    </span>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.03] px-4 py-8 text-center text-sm font-semibold text-slate-500">
      {label}
    </div>
  );
}

export default function WalletPage() {
  const { data: session, isPending } = useSession();
  const user = useAuthStore((store) => store.user);
  const wallet = useAuthStore((store) => store.wallet);
  const fetchWallet = useAuthStore((store) => store.fetchWallet);
  const [activeTab, setActiveTab] = useState<WalletTab>("deposit");
  const [deposits, setDeposits] = useState<DepositSnapshot[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalSnapshot[]>([]);
  const [transactions, setTransactions] = useState<LedgerTransactionSnapshot[]>(
    [],
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const refreshWallet = useCallback(async () => {
    if (!session?.user) {
      return;
    }

    setIsRefreshing(true);

    try {
      const [depositsResult, withdrawalsResult, transactionsResult] =
        await Promise.all([
          apiClient.listDeposits(),
          apiClient.listWithdrawals(),
          apiClient.getMeTransactions(50),
          fetchWallet(),
        ]);

      setDeposits(depositsResult);
      setWithdrawals(withdrawalsResult);
      setTransactions(transactionsResult);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Wallet unavailable.",
      );
    } finally {
      setIsRefreshing(false);
    }
  }, [fetchWallet, session?.user]);

  useEffect(() => {
    void refreshWallet();
  }, [refreshWallet]);

  const latestRewards = useMemo(
    () =>
      transactions.filter(
        (transaction) =>
          transaction.type === "ROUND_PAYOUT" ||
          transaction.type === "ENTRY_REFUND" ||
          transaction.type === "ADMIN_CREDIT",
      ),
    [transactions],
  );

  async function handleDeposit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);

    const formData = new FormData(event.currentTarget);
    const amount = parseAmount(formData.get("amount"));
    const provider = String(
      formData.get("provider") ?? "MANUAL",
    ) as PaymentProvider;

    if (!amount) {
      setError("Enter a valid deposit amount.");
      return;
    }

    setIsSubmitting(true);

    try {
      await apiClient.createDeposit({
        amount,
        provider,
        currency: "COIN",
        idempotencyKey: createIdempotencyKey("deposit"),
      });
      event.currentTarget.reset();
      setMessage("Deposit request created.");
      await refreshWallet();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not create deposit.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleWithdrawal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);

    const formData = new FormData(event.currentTarget);
    const amount = parseAmount(formData.get("amount"));
    const destinationName = String(
      formData.get("destinationName") ?? "",
    ).trim();
    const destinationPhone = String(
      formData.get("destinationPhone") ?? "",
    ).trim();
    const provider = String(
      formData.get("provider") ?? "MANUAL",
    ) as PaymentProvider;

    if (!amount) {
      setError("Enter a valid withdrawal amount.");
      return;
    }

    if (!destinationName || !destinationPhone) {
      setError("Destination name and phone are required.");
      return;
    }

    setIsSubmitting(true);

    try {
      await apiClient.requestWithdrawal({
        amount,
        provider,
        currency: "COIN",
        destination: {
          name: destinationName,
          phoneNumber: destinationPhone,
        },
        idempotencyKey: createIdempotencyKey("withdrawal"),
      });
      event.currentTarget.reset();
      setMessage("Withdrawal request created.");
      await refreshWallet();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not request withdrawal.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCancelWithdrawal(id: string) {
    setMessage(null);
    setError(null);

    try {
      await apiClient.cancelWithdrawal(id);
      setMessage("Withdrawal cancelled.");
      await refreshWallet();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not cancel withdrawal.",
      );
    }
  }

  return (
    <GameShell backHref="/spinpro">
      <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-gold">
              Wallet
            </p>
            <h1 className="mt-2 font-display text-3xl font-black text-white md:text-4xl">
              Main Balance
            </h1>
          </div>
          <Link
            href="/settings"
            className="inline-flex min-h-10 items-center justify-center rounded-md border border-white/10 bg-white/[0.06] px-4 text-sm font-black text-white transition hover:bg-white/[0.1]"
          >
            Settings
          </Link>
        </div>

        {!isPending && !session?.user ? (
          <section className="rounded-lg border border-white/10 bg-white/[0.045] p-5">
            <p className="text-sm font-semibold text-slate-400">
              Sign in to view your wallet.
            </p>
            <Link
              href="/sign-in?callbackURL=/wallet"
              className="mt-4 inline-flex min-h-10 items-center rounded-md bg-[var(--gold)] px-4 text-sm font-black text-[var(--bg-void)]"
            >
              Sign In
            </Link>
          </section>
        ) : (
          <div className="grid gap-4">
            <section className="rounded-lg border border-yellow-300/25 bg-[linear-gradient(135deg,rgba(250,204,21,0.14),rgba(255,255,255,0.04))] p-4 shadow-[0_18px_44px_rgba(0,0,0,0.28)] md:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-bold text-slate-400">
                    {user?.username ?? session?.user.name ?? "Player"}
                  </p>
                  <p className="mt-2 font-mono text-4xl font-black text-gold md:text-5xl">
                    {formatCoins(wallet?.balanceSnapshot)}
                  </p>
                  <p className="mt-1 text-xs font-black uppercase tracking-[0.16em] text-slate-500">
                    Coins
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void refreshWallet()}
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </Button>
              </div>
            </section>

            <div className="flex overflow-x-auto rounded-lg border border-white/10 bg-white/[0.04] p-1">
              {tabs.map((tab) => {
                const Icon = tab.icon;

                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-md px-4 text-xs font-black transition ${
                      activeTab === tab.id
                        ? "bg-white/15 text-white"
                        : "text-slate-500 hover:bg-white/[0.06] hover:text-slate-200"
                    }`}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {message ? (
              <div className="rounded-md border border-lime-300/35 bg-lime-400/10 px-3 py-2 text-sm font-semibold text-lime-200">
                {message}
              </div>
            ) : null}
            {error ? (
              <div className="rounded-md border border-red-300/35 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-200">
                {error}
              </div>
            ) : null}

            {activeTab === "deposit" ? (
              <section className="rounded-lg border border-white/10 bg-white/[0.045] p-4 md:p-5">
                <h2 className="font-display text-lg font-black text-white">
                  Deposit Funds
                </h2>
                <form
                  className="mt-4 grid gap-4 md:grid-cols-[1fr_12rem_auto]"
                  onSubmit={handleDeposit}
                >
                  <label>
                    <span className={labelClass}>Amount</span>
                    <input
                      className={inputClass}
                      name="amount"
                      inputMode="numeric"
                      placeholder="1000"
                    />
                  </label>
                  <label>
                    <span className={labelClass}>Provider</span>
                    <select
                      className={inputClass}
                      name="provider"
                      defaultValue="MANUAL"
                    >
                      <option value="MANUAL">Manual</option>
                      <option value="MOCK">Mock</option>
                    </select>
                  </label>
                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="mt-auto"
                  >
                    {isSubmitting ? "Creating..." : "Create Deposit"}
                  </Button>
                </form>

                <div className="mt-5 grid gap-2">
                  {deposits.length === 0 ? (
                    <EmptyState label="No deposits yet." />
                  ) : (
                    deposits.map((deposit) => (
                      <div
                        key={deposit.id}
                        className="grid gap-3 rounded-lg border border-white/10 bg-black/25 p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-black text-white">
                            {titleCase(deposit.provider)} deposit
                          </p>
                          <p className="mt-1 text-xs font-semibold text-slate-500">
                            {formatDate(deposit.createdAt)} /{" "}
                            {truncateId(deposit.id, 5)}
                          </p>
                        </div>
                        <StatusBadge status={deposit.status} />
                        <p className="font-mono text-sm font-black text-lime-300">
                          +{formatCoins(deposit.amount)}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </section>
            ) : null}

            {activeTab === "withdraw" ? (
              <section className="rounded-lg border border-white/10 bg-white/[0.045] p-4 md:p-5">
                <h2 className="font-display text-lg font-black text-white">
                  Request Withdrawal
                </h2>
                <form
                  className="mt-4 grid gap-4 md:grid-cols-2"
                  onSubmit={handleWithdrawal}
                >
                  <label>
                    <span className={labelClass}>Amount</span>
                    <input
                      className={inputClass}
                      name="amount"
                      inputMode="numeric"
                      placeholder="500"
                    />
                  </label>
                  <label>
                    <span className={labelClass}>Provider</span>
                    <select
                      className={inputClass}
                      name="provider"
                      defaultValue="MANUAL"
                    >
                      <option value="MANUAL">Manual</option>
                      <option value="MOCK">Mock</option>
                    </select>
                  </label>
                  <label>
                    <span className={labelClass}>Destination Name</span>
                    <input className={inputClass} name="destinationName" />
                  </label>
                  <label>
                    <span className={labelClass}>Destination Phone</span>
                    <input
                      className={inputClass}
                      name="destinationPhone"
                      autoComplete="tel"
                    />
                  </label>
                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="md:col-span-2"
                  >
                    {isSubmitting ? "Requesting..." : "Request Withdrawal"}
                  </Button>
                </form>

                <div className="mt-5 grid gap-2">
                  {withdrawals.length === 0 ? (
                    <EmptyState label="No withdrawals yet." />
                  ) : (
                    withdrawals.map((withdrawal) => (
                      <div
                        key={withdrawal.id}
                        className="grid gap-3 rounded-lg border border-white/10 bg-black/25 p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-black text-white">
                            {titleCase(withdrawal.provider)} withdrawal
                          </p>
                          <p className="mt-1 text-xs font-semibold text-slate-500">
                            {formatDate(withdrawal.requestedAt)} /{" "}
                            {truncateId(withdrawal.id, 5)}
                          </p>
                        </div>
                        <StatusBadge status={withdrawal.status} />
                        <div className="flex items-center gap-3">
                          <p className="font-mono text-sm font-black text-red-200">
                            -{formatCoins(withdrawal.amount)}
                          </p>
                          {withdrawal.status === "PENDING_REVIEW" ? (
                            <button
                              type="button"
                              onClick={() =>
                                void handleCancelWithdrawal(withdrawal.id)
                              }
                              className="rounded-md border border-red-300/30 px-2 py-1 text-xs font-black text-red-200 transition hover:bg-red-500/10"
                            >
                              Cancel
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>
            ) : null}

            {activeTab === "rewards" ? (
              <section className="rounded-lg border border-white/10 bg-white/[0.045] p-4 md:p-5">
                <h2 className="font-display text-lg font-black text-white">
                  Rewards
                </h2>
                <div className="mt-4 grid gap-2">
                  {latestRewards.length === 0 ? (
                    <EmptyState label="No rewards yet." />
                  ) : (
                    latestRewards.map((transaction) => {
                      const delta = transactionDelta(transaction);

                      return (
                        <div
                          key={transaction.id}
                          className="grid gap-3 rounded-lg border border-white/10 bg-black/25 p-3 sm:grid-cols-[minmax(0,1fr)_auto]"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-black text-white">
                              {titleCase(transaction.type)}
                            </p>
                            <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
                              <Clock3
                                className="h-3.5 w-3.5"
                                aria-hidden="true"
                              />
                              {formatDate(transaction.createdAt)}
                            </p>
                          </div>
                          <p
                            className={`font-mono text-sm font-black ${
                              delta >= 0 ? "text-lime-300" : "text-red-200"
                            }`}
                          >
                            {delta >= 0 ? "+" : "-"}
                            {formatCoins(Math.abs(delta))}
                          </p>
                        </div>
                      );
                    })
                  )}
                </div>
              </section>
            ) : null}

            {activeTab === "transactions" ? (
              <section className="rounded-lg border border-white/10 bg-white/[0.045] p-4 md:p-5">
                <h2 className="font-display text-lg font-black text-white">
                  Transactions
                </h2>
                <div className="mt-4 grid gap-2">
                  {transactions.length === 0 ? (
                    <EmptyState label="No transactions yet." />
                  ) : (
                    transactions.map((transaction) => {
                      const delta = transactionDelta(transaction);

                      return (
                        <div
                          key={transaction.id}
                          className="grid gap-3 rounded-lg border border-white/10 bg-black/25 p-3 sm:grid-cols-[minmax(0,1fr)_auto]"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-black text-white">
                              {titleCase(transaction.type)}
                            </p>
                            <p className="mt-1 text-xs font-semibold text-slate-500">
                              {formatDate(transaction.createdAt)} /{" "}
                              {truncateId(transaction.id, 5)}
                            </p>
                          </div>
                          <p
                            className={`font-mono text-sm font-black ${
                              delta >= 0 ? "text-lime-300" : "text-red-200"
                            }`}
                          >
                            {delta >= 0 ? "+" : "-"}
                            {formatCoins(Math.abs(delta))}
                          </p>
                        </div>
                      );
                    })
                  )}
                </div>
              </section>
            ) : null}
          </div>
        )}
      </div>
    </GameShell>
  );
}
