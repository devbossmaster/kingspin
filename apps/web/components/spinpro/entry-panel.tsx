"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type {
  EntryWithPlayerSnapshot,
  GameMode,
  WalletSnapshot,
} from "@kingspin/contracts";
import { formatCoins, formatMs } from "../../lib/format";
import { getPublicRoundPhase } from "../../lib/room-summary";

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
  platformFeeBps?: number | null;
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

  const disabledReason = useMemo(() => {
    if (!entriesOpen) return "Entries are closed.";
    if (!hasWallet) return "Wallet unavailable.";
    if (needsVerification) return "Verify your email first.";
    if (isFixedMode && !fixedModeAmount) {
      return "Entry amount is not configured.";
    }
    if (fixedModeAlreadyEntered) {
      return "You already joined this round.";
    }
    if (customAmountInvalid) {
      return `Use ${formatCoins(min)} to ${formatCoins(max)}.`;
    }
    if (selectedChipInvalid) {
      return `Choose ${formatCoins(min)} to ${formatCoins(max)}.`;
    }
    if (insufficientBalance) {
      return `Balance: ${formatCoins(wallet?.balanceSnapshot)}.`;
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

  const buttonLabel = isPlacingEntry
    ? "Joining..."
    : entryPending
      ? "Joining..."
      : needsVerification
        ? "Verify email"
        : !entriesOpen
          ? publicPhase === "RANDOMIZING"
            ? "Drawing winner..."
            : publicPhase === "SPINNING"
              ? "Spinning..."
              : publicPhase === "RESULT"
                ? "Next round soon"
                : "Preparing"
          : !hasWallet
            ? "Wallet unavailable"
            : insufficientBalance
              ? "Low balance"
              : myEntry
                ? isFixedMode
                  ? "You are in"
                  : `Add ${formatCoins(entryAmount)}`
                : "Enter";

  const submitEntry = () => {
    if (!canPlaceEntry) return;
    onPlaceEntry(entryAmount);
  };

  const inputValue = hasCustomAmount ? customAmount : String(entryAmount);

  return (
    <section className="relative overflow-hidden rounded-[26px] border border-blue-400/25 bg-[#050b18]/96 p-4 text-white shadow-[0_0_0_1px_rgba(96,165,250,0.08),0_22px_70px_rgba(0,0,0,0.58)]">
      <style>{`
        .entry-blue-glow {
          box-shadow:
            0 0 18px rgba(96, 165, 250, 0.32),
            inset 0 1px 0 rgba(255,255,255,0.16);
        }

        .entry-button-shine {
          animation: entryButtonShine 2.1s ease-in-out infinite;
        }

        @keyframes entryButtonShine {
          0% {
            transform: translateX(-140%) skewX(-18deg);
            opacity: 0;
          }
          18% {
            opacity: 0.5;
          }
          50% {
            opacity: 0.16;
          }
          100% {
            transform: translateX(155%) skewX(-18deg);
            opacity: 0;
          }
        }
      `}</style>

      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-blue-300/90 to-transparent" />
      <div className="pointer-events-none absolute -right-20 -top-20 h-48 w-48 rounded-full bg-blue-500/18 blur-3xl" />
      <div className="pointer-events-none absolute -left-20 bottom-8 h-44 w-44 rounded-full bg-cyan-400/10 blur-3xl" />

      <div className="relative">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="text-lg font-black leading-none text-white">
            {hasWallet ? "Add funds to start playing" : "Enter round"}
          </h2>

          <div
            className={`entry-blue-glow rounded-lg border px-2.5 py-1 font-mono text-sm font-black ${
              entriesOpen
                ? "border-blue-300/35 bg-slate-950/80 text-white"
                : "border-slate-600/60 bg-slate-900/80 text-slate-400"
            }`}
          >
            {entriesOpen ? "OPEN" : "CLOSED"}
          </div>
        </div>

        {myEntry ? (
          <div className="mb-4 rounded-2xl border border-cyan-300/25 bg-cyan-300/10 px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-black text-cyan-100">
                {entryPending ? "Joining..." : "You are in"}
              </span>

              <span className="font-mono text-sm font-black text-white">
                {formatCoins(myEntry.amount)}
              </span>
            </div>

            {!isFixedMode && entriesOpen && !entryPending ? (
              <p className="mt-1 text-xs font-semibold text-slate-400">
                You can add more while entries are open.
              </p>
            ) : null}
          </div>
        ) : null}

        <label className="block">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-xs font-bold text-slate-300">
              Entry value
            </span>

            <span className="text-xs font-black text-slate-500">
              {formatCoins(min)} - {formatCoins(max)}
            </span>
          </div>

          <div className="entry-blue-glow flex h-14 items-center rounded-full border border-blue-200/40 bg-white px-4 text-slate-950">
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
              className="h-full min-w-0 flex-1 bg-transparent font-mono text-xl font-black text-slate-950 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
            />

            <span className="ml-2 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-400 via-blue-400 to-cyan-300 text-base shadow-[0_4px_14px_rgba(59,130,246,0.35)]">
              🪙
            </span>
          </div>
        </label>

        {!isFixedMode ? (
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {visibleChipOptions.map((chip) => {
              const selected = chip === selectedChip && !hasCustomAmount;

              return (
                <button
                  key={chip}
                  type="button"
                  onClick={() => {
                    setCustomAmount("");
                    onSelectChip(chip);
                  }}
                  className={`rounded-full border px-3 py-1 text-[10px] font-black transition active:scale-95 ${
                    selected
                      ? "border-cyan-200/80 bg-gradient-to-r from-cyan-300 to-blue-400 text-slate-950 shadow-[0_0_18px_rgba(56,189,248,0.35)]"
                      : "border-blue-300/15 bg-white/[0.06] text-slate-300"
                  }`}
                >
                  <span className="mr-1">🟡</span>
                  {formatCoins(chip)}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="mt-3 rounded-full border border-blue-300/15 bg-white/[0.055] px-3 py-2 text-center text-xs font-bold text-slate-300">
            Fixed entry room
          </div>
        )}

        <div className="mt-2 flex items-center justify-center gap-1.5 text-[11px] font-black text-yellow-300">
          <span>🟡</span>
          <span>Available {formatCoins(wallet?.balanceSnapshot)}</span>
        </div>

        <div className="mt-5 flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.035] px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-yellow-300 to-orange-500 text-sm shadow-[0_0_18px_rgba(250,204,21,0.2)]">
              $
            </span>

            <span className="text-xs font-bold text-slate-400">
              Total entry
            </span>
          </div>

          <span className="font-mono text-sm font-black text-white">
            {formatCoins(entryAmount)}
          </span>
        </div>

        {customAmountInvalid ? (
          <p className="mt-2 text-center text-sm font-semibold text-red-300">
            Enter a whole amount between {formatCoins(min)} and{" "}
            {formatCoins(max)}.
          </p>
        ) : null}

        {insufficientBalance ? (
          <p className="mt-2 text-center text-sm font-semibold text-red-300">
            Your balance is too low.
          </p>
        ) : null}

        {hasSession ? (
          <>
            <button
              type="button"
              disabled={!canPlaceEntry}
              onClick={submitEntry}
              className="relative mt-4 flex min-h-14 w-full items-center justify-center overflow-hidden rounded-full border border-blue-200/50 bg-gradient-to-r from-indigo-500 via-blue-500 to-cyan-400 px-5 text-lg font-black text-white shadow-[0_18px_36px_rgba(59,130,246,0.36)] transition hover:brightness-110 active:scale-[0.985] disabled:cursor-not-allowed disabled:border-slate-600/60 disabled:bg-none disabled:bg-slate-700 disabled:text-slate-400 disabled:shadow-none"
            >
              <span className="pointer-events-none absolute inset-x-6 top-1 h-5 rounded-full bg-white/25 blur-md" />
              <span className="entry-button-shine pointer-events-none absolute inset-y-0 left-0 w-20 bg-white/35 blur-sm" />
              <span className="relative z-10">{buttonLabel}</span>
            </button>

            {disabledReason && !isPlacingEntry ? (
              <p className="mt-2 text-center text-xs font-semibold text-slate-500">
                {disabledReason}
              </p>
            ) : null}

            {isPlacingEntry ? (
              <p className="mt-2 text-center text-xs font-semibold text-cyan-300">
                Confirming entry...
              </p>
            ) : null}
          </>
        ) : (
          <Link
            href={`/sign-in?callbackURL=${encodeURIComponent(roomHref)}`}
            className="relative mt-4 flex min-h-14 w-full items-center justify-center overflow-hidden rounded-full border border-blue-200/50 bg-gradient-to-r from-indigo-500 via-blue-500 to-cyan-400 px-5 text-lg font-black text-white shadow-[0_18px_36px_rgba(59,130,246,0.36)] transition hover:brightness-110 active:scale-[0.985]"
          >
            Sign in to enter
          </Link>
        )}
      </div>
    </section>
  );
}