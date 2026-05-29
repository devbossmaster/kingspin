"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type {
  EntryWithPlayerSnapshot,
  WalletSnapshot,
} from "@kingspin/contracts";
import { formatCoins } from "../../lib/format";
import { Button, buttonClassName } from "../ui/button";
import { Chip } from "../ui/chip";

type EntryPanelProps = {
  status: string | null | undefined;
  wallet: WalletSnapshot | null;
  hasSession: boolean;
  emailVerified?: boolean;
  roomHref: string;
  chipOptions: number[];
  selectedChip: number;
  gameMode?: string | null;
  fixedEntryAmount?: string | null;
  myEntry: EntryWithPlayerSnapshot | null;
  isPlacingEntry: boolean;
  onSelectChip: (amount: number) => void;
  onPlaceEntry: (amount: number) => void;
};

export function EntryPanel({
  status,
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

  const entriesOpen = status === "OPEN";
  const needsVerification = hasSession && emailVerified === false;
  const customAmountInvalid = hasCustomAmount && boundedCustomAmount === null;
  const hasWallet = Boolean(wallet);
  const hasEnoughBalance = hasWallet && walletBalance >= entryAmount;
  const insufficientBalance = hasWallet && !hasEnoughBalance;
  const fixedModeAlreadyEntered = isFixedMode && Boolean(myEntry);

  const disabledReason = useMemo(() => {
    if (!entriesOpen) return "Entries are currently closed.";
    if (!hasWallet) return "Wallet is unavailable.";
    if (needsVerification) return "Verify your email before entering.";
    if (isFixedMode && !fixedModeAmount) {
      return "Fixed entry amount is not configured.";
    }
    if (fixedModeAlreadyEntered)
      return "Fixed mode allows one entry per round.";
    if (customAmountInvalid) {
      return `Enter a whole amount between ${formatCoins(min)} and ${formatCoins(max)}.`;
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
    !insufficientBalance &&
    !isPlacingEntry;

  const buttonLabel = isPlacingEntry
    ? "Confirming entry..."
    : needsVerification
      ? "Verify email first"
      : !entriesOpen
        ? "Entries closed"
        : !hasWallet
          ? "Wallet unavailable"
          : insufficientBalance
            ? "Insufficient balance"
            : myEntry
              ? isFixedMode
                ? "You are in"
                : `Add ${formatCoins(entryAmount)} more`
              : `Enter ${formatCoins(entryAmount)}`;

  const submitEntry = () => {
    if (!canPlaceEntry) return;
    onPlaceEntry(entryAmount);
  };

  return (
    <section className="arcadia-surface relative overflow-hidden rounded-lg p-5">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[rgba(250,204,21,0.7)] to-transparent" />

      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.24em] text-[var(--gold)]">
            Entry Desk
          </p>
          <h2 className="mt-1 font-display text-xl font-black">Place Entry</h2>
          <p className="mt-1 text-sm text-text-secondary">
            {isFixedMode
              ? "One fixed entry gives every accepted player the same chance."
              : "Choose an amount while open. Bigger amount, bigger ticket range."}
          </p>
        </div>

        <div className="rounded-full border border-[rgba(250,204,21,0.24)] bg-[rgba(250,204,21,0.08)] px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-[var(--gold)]">
          {entriesOpen ? "Open" : "Closed"}
        </div>
      </div>

      {myEntry ? (
        <div className="mt-4 rounded-md border border-[rgba(45,212,191,0.34)] bg-[rgba(45,212,191,0.1)] px-3 py-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="font-bold text-teal">You&apos;re in</span>
            <span className="font-mono font-black text-text-primary">
              {formatCoins(myEntry.amount)} coins
            </span>
          </div>
          {entriesOpen ? (
            <p className="mt-1 text-xs text-text-secondary">
              {isFixedMode
                ? "Fixed mode allows one entry per round."
                : "You can still add more while the round is open."}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 rounded-md border border-[var(--border)] bg-[rgba(255,255,255,0.03)] p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-bold uppercase tracking-[0.18em] text-text-dim">
            {isFixedMode ? "Fixed entry" : "Selected"}
          </span>
          <span className="font-mono text-lg font-black text-[var(--gold)]">
            {formatCoins(entryAmount)}
          </span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {visibleChipOptions.map((chip) => (
          <Chip
            key={chip}
            amount={chip}
            selected={chip === selectedChip && !hasCustomAmount}
            onSelect={(amount) => {
              setCustomAmount("");
              onSelectChip(amount);
            }}
          />
        ))}
      </div>

      {!isFixedMode ? (
        <label className="mt-4 block text-sm font-semibold text-text-secondary">
          Custom amount
          <input
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            step={1}
            value={customAmount}
            onChange={(event) => setCustomAmount(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitEntry();
              }
            }}
            placeholder={`${formatCoins(min)}-${formatCoins(max)}`}
            className="mt-2 w-full rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-3 font-mono text-sm text-text-primary outline-none transition placeholder:text-text-dim focus:border-[var(--gold)] focus:ring-2 focus:ring-[rgba(250,204,21,0.15)]"
          />
        </label>
      ) : null}

      {customAmountInvalid ? (
        <p className="mt-2 text-sm font-semibold text-red-hot">
          Enter a whole amount between {formatCoins(min)} and {formatCoins(max)}
          .
        </p>
      ) : null}

      {insufficientBalance ? (
        <p className="mt-2 text-sm font-semibold text-red-hot">
          Your balance is too low for this entry amount.
        </p>
      ) : null}

      {hasSession ? (
        <>
          <Button
            className="mt-4 w-full transition active:scale-[0.99]"
            disabled={!canPlaceEntry}
            onClick={submitEntry}
          >
            {buttonLabel}
          </Button>

          {disabledReason && !isPlacingEntry ? (
            <p className="mt-2 text-center text-xs text-text-dim">
              {disabledReason}
            </p>
          ) : null}

          {isPlacingEntry ? (
            <p className="mt-2 text-center text-xs font-semibold text-[var(--gold)]">
              Locking your entry securely...
            </p>
          ) : null}
        </>
      ) : (
        <Link
          href={`/sign-in?callbackURL=${encodeURIComponent(roomHref)}`}
          className={`${buttonClassName("primary")} mt-4 w-full transition active:scale-[0.99]`}
        >
          Sign in to enter
        </Link>
      )}
    </section>
  );
}
