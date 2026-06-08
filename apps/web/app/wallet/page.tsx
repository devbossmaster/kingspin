"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Clock3,
  Coins,
  ListChecks,
  ReceiptText,
  Send,
  ShieldCheck,
} from "lucide-react";
import type {
  DepositSnapshot,
  LedgerTransactionSnapshot,
  PaymentProvider,
  TransferRecipient,
  WalletTransferSnapshot,
  WithdrawalSnapshot,
} from "@kingspin/contracts";
import { DepositCard } from "../../components/payments/deposit-card";
import { GameShell } from "../../components/player/game-shell";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { useSession } from "../../lib/auth-client";
import { apiClient, type CreateDepositResponse } from "../../lib/api-client";
import { formatCoins, truncateId } from "../../lib/format";
import { useAuthStore } from "../../stores/auth-store";

type WalletTab = "deposit" | "verify" | "withdraw" | "transfer" | "history";

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
  { id: "verify", label: "Verify Receipt", icon: ReceiptText },
  { id: "withdraw", label: "Withdraw", icon: ArrowUpFromLine },
  { id: "transfer", label: "Transfer", icon: Send },
  { id: "history", label: "History", icon: ListChecks },
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

function parseDecimalAmount(value: FormDataEntryValue | null) {
  const amount = String(value ?? "").trim();

  return /^\d+(?:\.\d{1,2})?$/.test(amount) && Number(amount) > 0
    ? amount
    : null;
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

function WalletLoadingGate() {
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.045] p-5">
      <div className="h-5 w-48 animate-pulse rounded bg-white/10" />
      <div className="mt-4 h-10 w-36 animate-pulse rounded bg-white/10" />
    </section>
  );
}

function SignInGate() {
  return (
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
  );
}

function TelebirrBadge() {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-sky-300/30 bg-sky-400/10 px-3 py-1 text-xs font-black text-sky-100">
      <span className="grid h-6 w-6 place-items-center rounded-full bg-sky-400 text-[10px] text-slate-950">
        tb
      </span>
      telebirr
    </span>
  );
}

function localPhone(value?: string | null) {
  if (!value) return "";
  return value.startsWith("+251") ? `0${value.slice(4)}` : value;
}

export default function WalletPage() {
  const { data: session, isPending } = useSession();
  const isAuthenticated = Boolean(session?.user);

  const user = useAuthStore((store) => store.user);
  const wallet = useAuthStore((store) => store.wallet);
  const fetchWallet = useAuthStore((store) => store.fetchWallet);

  const [activeTab, setActiveTab] = useState<WalletTab>("deposit");
  const [deposits, setDeposits] = useState<DepositSnapshot[]>([]);
  const [activeDepositIntent, setActiveDepositIntent] =
    useState<CreateDepositResponse | null>(null);
  const [withdrawals, setWithdrawals] = useState<WithdrawalSnapshot[]>([]);
  const [transactions, setTransactions] = useState<LedgerTransactionSnapshot[]>(
    [],
  );
  const [transfers, setTransfers] = useState<WalletTransferSnapshot[]>([]);
  const [resolvedRecipient, setResolvedRecipient] =
    useState<TransferRecipient | null>(null);
  const [pendingTransfer, setPendingTransfer] = useState<{
    amount: number;
    note?: string;
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const refreshWallet = useCallback(async () => {
    if (!isAuthenticated) {
      return;
    }

    setIsRefreshing(true);

    try {
      const [
        depositsResult,
        withdrawalsResult,
        transactionsResult,
        transfersResult,
      ] = await Promise.all([
        apiClient.listDeposits(),
        apiClient.listWithdrawals(),
        apiClient.getMeTransactions(50),
        apiClient.listWalletTransfers(50),
        fetchWallet(),
      ]);

      setDeposits(depositsResult);
      setWithdrawals(withdrawalsResult);
      setTransactions(transactionsResult);
      setTransfers(transfersResult);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Wallet unavailable.",
      );
    } finally {
      setIsRefreshing(false);
    }
  }, [fetchWallet, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    void refreshWallet();
  }, [isAuthenticated, refreshWallet]);

  const pendingCount = useMemo(
    () =>
      deposits.filter((item) =>
        ["PENDING", "VERIFYING", "NEEDS_MANUAL_REVIEW"].includes(item.status),
      ).length +
      withdrawals.filter((item) =>
        ["PENDING_REVIEW", "APPROVED", "PROCESSING"].includes(item.status),
      ).length,
    [deposits, withdrawals],
  );

  async function handleDeposit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);

    if (!isAuthenticated) {
      setError("Sign in to create a deposit request.");
      return;
    }

    const formData = new FormData(event.currentTarget);
    const amount = parseDecimalAmount(formData.get("amount"));

    if (!amount || Number(amount) < 10 || Number(amount) > 1000) {
      setError("Deposit amount must be between 10 and 1,000 ETB.");
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await apiClient.createDeposit({
        amount,
        provider: "TELEBIRR_RECEIPT",
        currency: "ETB",
        idempotencyKey: createIdempotencyKey("deposit"),
      });
      event.currentTarget.reset();
      setActiveDepositIntent(result);
      setMessage("Deposit request created.");
      setActiveTab("verify");
      await refreshWallet();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not create deposit.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleTelebirrReceipt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);

    if (!isAuthenticated) {
      setError("Sign in to verify a receipt.");
      return;
    }

    const depositIntentId = activeDepositIntent?.deposit.id;
    const formData = new FormData(event.currentTarget);
    const receiptInput = String(formData.get("receiptInput") ?? "").trim();

    if (!depositIntentId) {
      setError("Create a deposit request first.");
      return;
    }

    if (!receiptInput) {
      setError("Paste the Telebirr receipt.");
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await apiClient.submitTelebirrReceipt(depositIntentId, {
        receiptInput,
      });

      event.currentTarget.reset();
      setActiveDepositIntent((current) =>
        current
          ? {
              ...current,
              deposit: result.deposit,
            }
          : null,
      );
      setMessage(
        result.deposit.status === "CREDITED"
          ? "Deposit credited."
          : "Receipt submitted for review.",
      );
      await Promise.all([refreshWallet(), fetchWallet()]);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not verify receipt.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleWithdrawal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);

    if (!isAuthenticated) {
      setError("Sign in to request a withdrawal.");
      return;
    }

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

    if (!amount || amount < 50 || amount > 1000) {
      setError("Withdrawal amount must be between 50 and 1,000 ETB.");
      return;
    }

    if (!destinationName || !/^09\d{8}$/.test(destinationPhone)) {
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

  async function handleResolveRecipient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    setResolvedRecipient(null);

    if (!isAuthenticated) {
      setError("Sign in to send a transfer.");
      return;
    }

    const recipient = String(
      new FormData(event.currentTarget).get("recipient") ?? "",
    ).trim();

    if (recipient.length < 3) {
      setError("Enter a username, email, or Ethiopian phone number.");
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await apiClient.resolveTransferRecipient({ recipient });
      setResolvedRecipient(result.recipient);
      setMessage("Recipient confirmed.");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Recipient was not found.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function handlePrepareTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);

    if (!isAuthenticated) {
      setError("Sign in to send a transfer.");
      return;
    }

    if (!resolvedRecipient) {
      setError("Resolve and confirm the recipient first.");
      return;
    }

    const formData = new FormData(event.currentTarget);
    const amount = parseAmount(formData.get("amount"));
    const note = String(formData.get("note") ?? "").trim();

    if (!amount || amount < 1 || amount > 1000) {
      setError("Transfer amount must be between 1 and 1,000 ETB.");
      return;
    }

    if (amount > Number(wallet?.balanceSnapshot ?? 0)) {
      setError("Insufficient wallet balance.");
      return;
    }

    setPendingTransfer({ amount, ...(note ? { note } : {}) });
  }

  async function handleConfirmTransfer() {
    if (!isAuthenticated || !resolvedRecipient || !pendingTransfer) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await apiClient.createWalletTransfer({
        recipientId: resolvedRecipient.id,
        amount: pendingTransfer.amount,
        note: pendingTransfer.note,
        idempotencyKey: createIdempotencyKey("transfer"),
      });
      setMessage("Transfer completed.");
      setPendingTransfer(null);
      setResolvedRecipient(null);
      await refreshWallet();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Transfer could not be completed.",
      );
      setPendingTransfer(null);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCancelWithdrawal(id: string) {
    setMessage(null);
    setError(null);

    if (!isAuthenticated) {
      setError("Sign in to cancel a withdrawal.");
      return;
    }

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

        {isPending ? (
          <WalletLoadingGate />
        ) : !session?.user ? (
          <SignInGate />
        ) : (
          <div className="grid gap-4">
            <section className="rounded-lg border border-yellow-300/25 bg-[linear-gradient(135deg,rgba(250,204,21,0.14),rgba(255,255,255,0.04))] p-4 shadow-[0_18px_44px_rgba(0,0,0,0.28)] md:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-bold text-slate-400">
                    {user?.username ?? session.user.name ?? "Player"}
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
              <section className="rounded-2xl border border-sky-300/20 bg-[linear-gradient(145deg,rgba(14,165,233,0.12),rgba(255,255,255,0.035))] p-4 shadow-[0_24px_60px_rgba(0,0,0,0.25)] md:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className={labelClass}>Step 1 · Amount</p>
                    <h2 className="mt-1 font-display text-xl font-black text-white">
                      Create a Telebirr deposit
                    </h2>
                    <p className="mt-2 text-sm font-semibold text-slate-400">
                      Pay between 10 and 1,000 ETB. Your registered phone is{" "}
                      <span className="text-slate-200">
                        {localPhone(user?.phoneNumber) || "not available"}
                      </span>
                      .
                    </p>
                  </div>
                  <TelebirrBadge />
                </div>
                <form
                  className="mt-4 grid gap-4 md:grid-cols-[1fr_auto]"
                  onSubmit={handleDeposit}
                >
                  <label>
                    <span className={labelClass}>Amount ETB</span>
                    <input
                      className={inputClass}
                      name="amount"
                      inputMode="decimal"
                      min="10"
                      max="1000"
                      placeholder="100.00"
                    />
                    <span className="mt-2 block text-xs font-semibold text-slate-500">
                      Min 10 ETB · Max 1,000 ETB · Balance{" "}
                      {formatCoins(wallet?.balanceSnapshot)}
                    </span>
                  </label>
                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="mt-auto"
                  >
                    {isSubmitting ? "Creating..." : "Create deposit request"}
                  </Button>
                </form>

                <div className="mt-5 grid gap-2">
                  {deposits.length === 0 ? (
                    <EmptyState label="No deposits yet." />
                  ) : (
                    deposits.map((deposit) => (
                      <DepositCard
                        key={deposit.id}
                        deposit={deposit}
                        formatAmount={formatCoins}
                      />
                    ))
                  )}
                </div>
              </section>
            ) : null}

            {activeTab === "verify" ? (
              <section className="rounded-2xl border border-sky-300/20 bg-white/[0.045] p-4 md:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className={labelClass}>Steps 2–3 · Pay and verify</p>
                    <h2 className="mt-1 font-display text-xl font-black text-white">
                      Verify your Telebirr receipt
                    </h2>
                  </div>
                  <TelebirrBadge />
                </div>

                {activeDepositIntent?.instructions ? (
                  <>
                    <div className="mt-5 grid gap-3 rounded-xl border border-sky-300/25 bg-sky-400/10 p-4 text-sm font-semibold text-slate-200 md:grid-cols-2">
                      <div>
                        <p className={labelClass}>Pay exactly</p>
                        <p className="mt-1 font-mono text-2xl font-black text-white">
                          {activeDepositIntent.instructions.expectedAmount}{" "}
                          {activeDepositIntent.instructions.currency}
                        </p>
                      </div>
                      <div>
                        <p className={labelClass}>Receiver</p>
                        <p className="mt-1 text-white">
                          {activeDepositIntent.instructions.receiverName ??
                            "Configured merchant"}
                        </p>
                        <p className="mt-1 font-mono text-xs text-slate-400">
                          {activeDepositIntent.instructions.receiverAccount ??
                            activeDepositIntent.instructions.receiverShortCode ??
                            "Merchant account"}
                        </p>
                      </div>
                      <div>
                        <p className={labelClass}>Registered phone</p>
                        <p className="mt-1 text-white">
                          {localPhone(user?.phoneNumber) || "Not provided"}
                        </p>
                      </div>
                      <div>
                        <p className={labelClass}>Expires</p>
                        <p className="mt-1 text-white">
                          {formatDate(
                            activeDepositIntent.instructions.expiresAt,
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm font-semibold text-amber-100">
                      Pay exactly this amount using Telebirr. Then paste the
                      receipt link, receipt ID, or full 127 SMS below. Wallet
                      crediting happens only after server verification.
                    </div>
                    <form
                      className="mt-4 grid gap-4"
                      onSubmit={handleTelebirrReceipt}
                    >
                      <label>
                        <span className={labelClass}>
                          Receipt URL, ID, or 127 SMS
                        </span>
                        <textarea
                          className={`${inputClass} min-h-32 resize-y`}
                          name="receiptInput"
                          placeholder="Paste the complete receipt details"
                        />
                      </label>
                      <Button type="submit" disabled={isSubmitting}>
                        {isSubmitting ? "Verifying..." : "Verify receipt"}
                      </Button>
                    </form>
                    <div className="mt-4 flex items-center justify-between rounded-xl border border-white/10 bg-black/20 p-3">
                      <span className="text-xs font-semibold text-slate-400">
                        Request {truncateId(activeDepositIntent.deposit.id, 6)}
                      </span>
                      <StatusBadge status={activeDepositIntent.deposit.status} />
                    </div>
                  </>
                ) : (
                  <EmptyState label="Create a deposit request first, then return here to verify the receipt." />
                )}
              </section>
            ) : null}

            {activeTab === "withdraw" ? (
              <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-4 md:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className={labelClass}>Manual payout</p>
                    <h2 className="mt-1 font-display text-xl font-black text-white">
                      Request a withdrawal
                    </h2>
                    <p className="mt-2 text-sm font-semibold text-slate-400">
                      Withdrawals are reviewed and paid manually by admin. No
                      fee configured.
                    </p>
                  </div>
                  <TelebirrBadge />
                </div>
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
                      min="50"
                      max="1000"
                      placeholder="500"
                    />
                    <span className="mt-2 block text-xs font-semibold text-slate-500">
                      Min 50 ETB · Max 1,000 ETB
                    </span>
                  </label>
                  <input type="hidden" name="provider" value="MANUAL" />
                  <label>
                    <span className={labelClass}>Account name</span>
                    <input
                      className={inputClass}
                      name="destinationName"
                      defaultValue={user?.fullName ?? ""}
                    />
                  </label>
                  <label>
                    <span className={labelClass}>Telebirr phone</span>
                    <input
                      className={inputClass}
                      name="destinationPhone"
                      autoComplete="tel"
                      inputMode="tel"
                      pattern="09[0-9]{8}"
                      defaultValue={localPhone(user?.phoneNumber)}
                      placeholder="09XXXXXXXX"
                    />
                  </label>
                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="md:col-span-2"
                  >
                    {isSubmitting ? "Requesting..." : "Request withdrawal"}
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
                          {withdrawal.destinationDisplay ? (
                            <p className="mt-1 font-mono text-xs text-slate-400">
                              {withdrawal.destinationDisplay}
                            </p>
                          ) : null}
                          {withdrawal.providerReference ? (
                            <p className="mt-1 text-xs text-slate-400">
                              Reference {withdrawal.providerReference}
                            </p>
                          ) : null}
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

            {activeTab === "transfer" ? (
              <section className="rounded-2xl border border-indigo-300/20 bg-[linear-gradient(145deg,rgba(99,102,241,0.12),rgba(255,255,255,0.035))] p-4 md:p-6">
                <p className={labelClass}>Ledger-safe transfer</p>
                <h2 className="mt-1 font-display text-xl font-black text-white">
                  Send funds to another player
                </h2>
                <p className="mt-2 text-sm font-semibold text-slate-400">
                  Resolve the recipient first. Transfers cannot be automatically
                  reversed.
                </p>

                <form
                  className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]"
                  onSubmit={handleResolveRecipient}
                >
                  <label>
                    <span className={labelClass}>
                      Username, email, or phone
                    </span>
                    <input
                      className={inputClass}
                      name="recipient"
                      placeholder="playername or 09XXXXXXXX"
                    />
                  </label>
                  <Button
                    type="submit"
                    variant="secondary"
                    disabled={isSubmitting}
                    className="mt-auto"
                  >
                    Resolve recipient
                  </Button>
                </form>

                {resolvedRecipient ? (
                  <div className="mt-4 rounded-xl border border-lime-300/25 bg-lime-400/10 p-4">
                    <div className="flex items-center gap-3">
                      <ShieldCheck className="h-5 w-5 text-lime-300" />
                      <div>
                        <p className="font-black text-white">
                          {resolvedRecipient.displayName}
                        </p>
                        <p className="text-xs font-semibold text-slate-400">
                          {resolvedRecipient.maskedEmail ??
                            resolvedRecipient.maskedPhone ??
                            resolvedRecipient.username}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}

                <form
                  className="mt-4 grid gap-4 md:grid-cols-2"
                  onSubmit={handlePrepareTransfer}
                >
                  <label>
                    <span className={labelClass}>Amount ETB</span>
                    <input
                      className={inputClass}
                      name="amount"
                      inputMode="numeric"
                      min="1"
                      max="1000"
                      placeholder="100"
                    />
                  </label>
                  <label>
                    <span className={labelClass}>Note (optional)</span>
                    <input
                      className={inputClass}
                      name="note"
                      maxLength={160}
                      placeholder="What is this for?"
                    />
                  </label>
                  <Button
                    type="submit"
                    disabled={!resolvedRecipient || isSubmitting}
                    className="md:col-span-2"
                  >
                    Review transfer
                  </Button>
                </form>

                <div className="mt-6 grid gap-2">
                  <h3 className="text-sm font-black text-white">
                    Transfer history
                  </h3>
                  {transfers.length === 0 ? (
                    <EmptyState label="No transfers yet." />
                  ) : (
                    transfers.map((transfer) => (
                      <div
                        key={transfer.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 p-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-black text-white">
                            {transfer.direction === "SENT" ? "To" : "From"}{" "}
                            {transfer.counterparty.displayName}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {formatDate(transfer.createdAt)}
                            {transfer.note ? ` · ${transfer.note}` : ""}
                          </p>
                        </div>
                        <p
                          className={`font-mono text-sm font-black ${
                            transfer.direction === "SENT"
                              ? "text-red-200"
                              : "text-lime-300"
                          }`}
                        >
                          {transfer.direction === "SENT" ? "-" : "+"}
                          {formatCoins(transfer.amount)}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </section>
            ) : null}

            {activeTab === "history" ? (
              <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-4 md:p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className={labelClass}>Wallet activity</p>
                    <h2 className="mt-1 font-display text-xl font-black text-white">
                      Transaction history
                    </h2>
                  </div>
                  <span className="rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1 text-xs font-black text-amber-200">
                    {pendingCount} pending
                  </span>
                </div>
                <div className="mt-4 grid gap-2">
                  {transactions.length === 0 ? (
                    <EmptyState label="No transactions yet." />
                  ) : (
                    transactions.map((transaction) => {
                      const delta = transactionDelta(transaction);

                      return (
                        <div
                          key={transaction.id}
                          className="grid gap-3 rounded-xl border border-white/10 bg-black/25 p-3 sm:grid-cols-[minmax(0,1fr)_auto]"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-black text-white">
                              {titleCase(transaction.type)}
                            </p>
                            <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
                              <Clock3 className="h-3.5 w-3.5" />
                              {formatDate(transaction.createdAt)} ·{" "}
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

      <Dialog
        open={Boolean(isAuthenticated && pendingTransfer && resolvedRecipient)}
        title="Confirm transfer"
        onClose={() => setPendingTransfer(null)}
        panelClassName="max-w-md rounded-2xl border border-indigo-300/25 bg-slate-950 p-5 shadow-2xl"
      >
        <p className={labelClass}>Confirm transfer</p>
        <h2 className="mt-2 text-2xl font-black text-white">
          Send {formatCoins(pendingTransfer?.amount ?? 0)} ETB
        </h2>
        <p className="mt-2 text-sm font-semibold text-slate-400">
          Recipient: {resolvedRecipient?.displayName}
        </p>
        <div className="mt-4 rounded-xl border border-amber-300/25 bg-amber-300/10 p-3 text-sm font-semibold text-amber-100">
          Transfers cannot be automatically reversed. Check the recipient and
          amount before continuing.
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setPendingTransfer(null)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={isSubmitting}
            onClick={() => void handleConfirmTransfer()}
          >
            {isSubmitting ? "Sending..." : "Confirm and send"}
          </Button>
        </div>
      </Dialog>
    </GameShell>
  );
}