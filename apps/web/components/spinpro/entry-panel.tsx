"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type {
  EntryWithPlayerSnapshot,
  GameMode,
  WalletSnapshot,
} from "@kingspin/contracts";
import { formatCoins } from "../../lib/format";
import { getPublicRoundPhase } from "../../lib/room-summary";
import { buttonClassName } from "../ui/button";

type EntryPanelProps = {
  status: string | null | undefined;
  phase?: string | null | undefined;
  wallet: WalletSnapshot | null;
  hasSession: boolean;
  emailVerified?: boolean;
  roomHref: string;
  chipOptions: number[];
  selectedChip: number;
  gameMode?: GameMode | null;
  fixedEntryAmount?: string | null;
  myEntry: (EntryWithPlayerSnapshot & { pending?: boolean }) | null;
  isPlacingEntry: boolean;
  onSelectChip: (amount: number) => void;
  onPlaceEntry: (amount: number) => void;
};

export function EntryPanel({
  status,
  phase,
  wallet,
  hasSession,
  emailVerified,
  roomHref,
  chipOptions,
  selectedChip,
  gameMode,
  fixedEntryAmount,
  myEntry,
  isPlacingEntry,
  onSelectChip,
  onPlaceEntry,
}: EntryPanelProps) {
  // Game mode and amount rules: fixed mode resolves to one exact amount.
  const isFixedMode = gameMode === "FIXED_EQUAL_CHANCE";
  const parsedFixedAmount = Number(fixedEntryAmount ?? 0);

  const fixedModeAmount =
    isFixedMode &&
    Number.isSafeInteger(parsedFixedAmount) &&
    parsedFixedAmount > 0
      ? parsedFixedAmount
      : null;

  const visibleChipOptions = fixedModeAmount ? [fixedModeAmount] : chipOptions;
  const min = visibleChipOptions[0] ?? 1;
  const max = visibleChipOptions[visibleChipOptions.length - 1] ?? min;

  // Flexible amount input is only active outside fixed mode.
  const [customAmount, setCustomAmount] = useState("");

  const customAmountText = customAmount.trim();
  const hasCustomAmount = !isFixedMode && customAmountText.length > 0;
  const parsedCustomAmount = Number(customAmountText);

  const boundedCustomAmount = useMemo(() => {
    if (!hasCustomAmount) return null;
    if (!Number.isInteger(parsedCustomAmount)) return null;
    if (parsedCustomAmount < min || parsedCustomAmount > max) return null;

    return parsedCustomAmount;
  }, [hasCustomAmount, max, min, parsedCustomAmount]);

  const entryAmount = fixedModeAmount ?? boundedCustomAmount ?? selectedChip;
  const walletBalance = Number(wallet?.balanceSnapshot ?? 0);

  // Entry availability and wallet guards.
  const publicPhase = getPublicRoundPhase({ phase, status });
  const entriesOpen = publicPhase === "ENTRY_OPEN";
  const needsVerification = hasSession && emailVerified === false;
  const customAmountInvalid = hasCustomAmount && boundedCustomAmount === null;
  const selectedChipInvalid =
    !isFixedMode &&
    !hasCustomAmount &&
    (!Number.isInteger(selectedChip) ||
      selectedChip < min ||
      selectedChip > max);
  const hasWallet = Boolean(wallet);
  const hasEnoughBalance = hasWallet && walletBalance >= entryAmount;
  const insufficientBalance = hasWallet && !hasEnoughBalance;
  const fixedModeAlreadyEntered = isFixedMode && Boolean(myEntry);
  const entryPending = Boolean(myEntry?.pending);

  // User-facing disabled reasons mirror the submit guard below.
  const disabledReason = useMemo(() => {
    if (!entriesOpen) return "Entries are closed for this phase.";
    if (!hasWallet) return "Wallet is unavailable.";
    if (needsVerification) return "Verify your email before entering.";
    if (isFixedMode && !fixedModeAmount) {
      return "Fixed entry amount is not configured.";
    }
    if (fixedModeAlreadyEntered) {
      return "Fixed mode allows one entry per round.";
    }
    if (customAmountInvalid) {
      return `Enter a whole amount between ${formatCoins(min)} and ${formatCoins(max)}.`;
    }
    if (selectedChipInvalid) {
      return `Choose an amount between ${formatCoins(min)} and ${formatCoins(max)}.`;
    }
    if (insufficientBalance) {
      return `Not enough balance. You have ${formatCoins(wallet?.balanceSnapshot)} coins.`;
    }

    return null;
  }, [
    customAmountInvalid,
    entriesOpen,
    fixedModeAlreadyEntered,
    fixedModeAmount,
    hasWallet,
    insufficientBalance,
    isFixedMode,
    max,
    min,
    needsVerification,
    selectedChipInvalid,
    wallet?.balanceSnapshot,
  ]);

  const canPlaceEntry =
    hasSession &&
    entriesOpen &&
    hasWallet &&
    !needsVerification &&
    (!isFixedMode || Boolean(fixedModeAmount)) &&
    !fixedModeAlreadyEntered &&
    !customAmountInvalid &&
    !selectedChipInvalid &&
    !insufficientBalance &&
    !isPlacingEntry;

  // Button copy follows placement state without changing submit rules.
  const buttonLabel = isPlacingEntry
    ? "Submitting..."
    : entryPending
      ? "Pending..."
      : needsVerification
        ? "Verify email first"
        : !entriesOpen
          ? publicPhase === "RANDOMIZING"
            ? "Randomizing"
            : publicPhase === "SPINNING"
              ? "Wheel spinning"
              : publicPhase === "RESULT"
                ? "Next round soon"
                : "Preparing"
          : !hasWallet
            ? "Wallet unavailable"
            : insufficientBalance
              ? "Insufficient balance"
              : myEntry
                ? isFixedMode
                  ? "You are in"
                  : `Add ${formatCoins(entryAmount)}`
                : `Enter`;

  // Final submit guard; onPlaceEntry always receives the resolved amount.
  const submitEntry = () => {
    if (!canPlaceEntry) return;
    onPlaceEntry(entryAmount);
  };

  const inputValue = hasCustomAmount ? customAmount : String(entryAmount);

  return (
    <section className="relative overflow-hidden rounded-[26px] border border-indigo-300/30 bg-slate-950/95 p-4 text-white shadow-[0_18px_60px_rgba(79,70,229,0.22)]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-indigo-300/80 to-transparent" />
      <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-indigo-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-12 -left-10 h-32 w-32 rounded-full bg-cyan-400/10 blur-3xl" />

      <div className="relative">
        {/* Header/status section: safe visual styling zone. */}
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black leading-tight text-white">
              Add funds to start playing
            </h2>
            <p className="mt-1 text-sm font-semibold text-slate-400">
              {isFixedMode
                ? "One fixed entry per round."
                : "Choose your entry amount before the timer ends."}
            </p>
          </div>

          <div
            className={`shrink-0 rounded-xl px-3 py-1 text-xs font-black uppercase ${
              entriesOpen
                ? "bg-emerald-400 text-emerald-950"
                : "bg-slate-700 text-slate-300"
            }`}
          >
            {entriesOpen ? "Open" : "Closed"}
          </div>
        </div>

        {/* Existing entry summary: fixed mode prevents increase/top-up copy. */}
        {myEntry ? (
          <div className="mb-4 rounded-2xl border border-cyan-300/25 bg-cyan-400/10 px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-black text-cyan-200">
                {entryPending ? "Pending..." : "You are in"}
              </span>
              <span className="font-mono text-sm font-black text-white">
                🪙 {formatCoins(myEntry.amount)}
              </span>
            </div>

            {entriesOpen ? (
              <p className="mt-1 text-xs font-semibold text-slate-400">
                {isFixedMode
                  ? "Fixed mode allows one entry per round."
                  : entryPending
                    ? "Confirming with the server now."
                    : "You can still add more while the round is open."}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Entry value control: fixed mode stays disabled and exact. */}
        <label className="block">
          <span className="text-sm font-black text-slate-300">Entry value</span>

          <div className="mt-2 flex h-16 items-center rounded-2xl bg-white px-4 text-slate-950 shadow-inner">
            <span className="mr-2 text-xl">🪙</span>

            <input
              type="number"
              inputMode="numeric"
              min={min}
              max={max}
              step={1}
              value={inputValue}
              disabled={isFixedMode}
              onChange={(event) => {
                setCustomAmount(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitEntry();
                }
              }}
              placeholder={`${formatCoins(min)}-${formatCoins(max)}`}
              className="h-full min-w-0 flex-1 bg-transparent font-mono text-2xl font-black text-slate-950 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
            />
          </div>
        </label>

        {/* Chip controls: fixed mode is disabled; flexible mode keeps chip/top-up behavior. */}
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {visibleChipOptions.map((chip) => {
            const selected = chip === selectedChip && !hasCustomAmount;

            return (
              <button
                key={chip}
                type="button"
                disabled={isFixedMode}
                onClick={() => {
                  setCustomAmount("");
                  onSelectChip(chip);
                }}
                className={`min-h-10 rounded-2xl border px-4 text-sm font-black transition active:scale-95 disabled:cursor-not-allowed ${
                  selected
                    ? "border-indigo-200 bg-indigo-500 text-white shadow-[0_0_22px_rgba(99,102,241,0.42)]"
                    : "border-white/10 bg-white/[0.06] text-slate-200 hover:bg-white/[0.1]"
                }`}
              >
                {formatCoins(chip)}
              </button>
            );
          })}
        </div>

        {/* Wallet balance display: keep wallet balance visible. */}
        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.045] px-3 py-2">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-bold text-slate-400">Available</span>
            <span className="font-mono font-black text-amber-300">
              🪙 {formatCoins(wallet?.balanceSnapshot)}
            </span>
          </div>
        </div>

        {/* Validation and backend state messages. */}
        {customAmountInvalid ? (
          <p className="mt-2 text-center text-sm font-semibold text-red-300">
            Enter a whole amount between {formatCoins(min)} and{" "}
            {formatCoins(max)}.
          </p>
        ) : null}

        {insufficientBalance ? (
          <p className="mt-2 text-center text-sm font-semibold text-red-300">
            Your balance is too low for this entry amount.
          </p>
        ) : null}

        {/* Submit/sign-in actions. */}
        {hasSession ? (
          <>
            <button
              type="button"
              disabled={!canPlaceEntry}
              onClick={submitEntry}
              className="mt-4 flex min-h-16 w-full items-center justify-center rounded-2xl bg-indigo-500 px-5 text-xl font-black text-white shadow-[0_18px_40px_rgba(99,102,241,0.35)] transition hover:bg-indigo-400 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400 disabled:shadow-none"
            >
              {buttonLabel}
            </button>

            {disabledReason && !isPlacingEntry ? (
              <p className="mt-2 text-center text-xs font-semibold text-slate-500">
                {disabledReason}
              </p>
            ) : null}

            {isPlacingEntry ? (
              <p className="mt-2 text-center text-xs font-semibold text-amber-300">
                Submitting...
              </p>
            ) : null}
          </>
        ) : (
          <Link
            href={`/sign-in?callbackURL=${encodeURIComponent(roomHref)}`}
            className={`${buttonClassName("primary")} mt-4 flex min-h-16 w-full items-center justify-center rounded-2xl text-xl font-black transition active:scale-[0.99]`}
          >
            Sign in to enter
          </Link>
        )}
      </div>
    </section>
  );
}
