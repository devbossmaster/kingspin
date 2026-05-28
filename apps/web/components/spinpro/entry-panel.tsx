"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { EntryWithPlayerSnapshot, WalletSnapshot } from "@kingspin/contracts";
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
  myEntry,
  isPlacingEntry,
  onSelectChip,
  onPlaceEntry,
}: EntryPanelProps) {
  const min = chipOptions[0] ?? 1;
  const max = chipOptions[chipOptions.length - 1] ?? min;
  const [customAmount, setCustomAmount] = useState("");
  const parsedCustomAmount = Number(customAmount);
  const boundedCustomAmount = useMemo(() => {
    if (!Number.isInteger(parsedCustomAmount)) return null;
    if (parsedCustomAmount < min || parsedCustomAmount > max) return null;
    return parsedCustomAmount;
  }, [max, min, parsedCustomAmount]);
  const entryAmount = boundedCustomAmount ?? selectedChip;
  const entriesOpen = status === "OPEN";
  const needsVerification = hasSession && emailVerified === false;

  return (
    <section className="arcadia-surface rounded-lg p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-black">Place Entry</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Balance {formatCoins(wallet?.balanceSnapshot)} coins
          </p>
        </div>
      </div>

      {myEntry ? (
        <div className="mt-3 rounded-md border border-[rgba(45,212,191,0.34)] bg-[rgba(45,212,191,0.1)] px-3 py-2 text-sm font-bold text-teal">
          You&apos;re in - {formatCoins(myEntry.amount)} coins
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {chipOptions.map((chip) => (
          <Chip
            key={chip}
            amount={chip}
            selected={chip === selectedChip && customAmount.length === 0}
            onSelect={(amount) => {
              setCustomAmount("");
              onSelectChip(amount);
            }}
          />
        ))}
      </div>

      <label className="mt-4 block text-sm font-semibold text-text-secondary">
        Custom amount
        <input
          type="number"
          min={min}
          max={max}
          step={1}
          value={customAmount}
          onChange={(event) => setCustomAmount(event.target.value)}
          placeholder={`${formatCoins(min)}-${formatCoins(max)}`}
          className="mt-2 w-full rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-3 font-mono text-sm text-text-primary outline-none placeholder:text-text-dim focus:border-[var(--gold)]"
        />
      </label>

      {customAmount.length > 0 && boundedCustomAmount === null ? (
        <p className="mt-2 text-sm text-red-hot">
          Enter a whole amount between {formatCoins(min)} and {formatCoins(max)}.
        </p>
      ) : null}

      {hasSession ? (
        <Button
          className="mt-4 w-full"
          disabled={
            !entriesOpen ||
            !wallet ||
            needsVerification ||
            isPlacingEntry ||
            (customAmount.length > 0 && boundedCustomAmount === null)
          }
          onClick={() => onPlaceEntry(entryAmount)}
        >
          {isPlacingEntry
            ? "Placing..."
            : needsVerification
              ? "Verify email first"
            : !entriesOpen
              ? "Entries closed"
              : wallet
                ? `Enter ${formatCoins(entryAmount)}`
                : "Wallet unavailable"}
        </Button>
      ) : (
        <Link
          href={`/sign-in?callbackURL=${encodeURIComponent(roomHref)}`}
          className={`${buttonClassName("primary")} mt-4 w-full`}
        >
          Sign in to enter
        </Link>
      )}
    </section>
  );
}
