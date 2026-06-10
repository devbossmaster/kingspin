"use client";

import type { LatestRoundResult } from "@kingspin/contracts";

type WinnerRevealProps = {
  isOpen: boolean;
  result: LatestRoundResult | null;
  onClose: () => void;
  durationMs?: number | null;
  roomName?: string | null;
  roomId?: string | null;
};

/**
 * Deprecated.
 *
 * Winner reveal is now handled instantly inside:
 * - SpinningWheel
 * - PlayersList
 *
 * Keep this no-op component temporarily so old imports do not break builds.
 * After confirming no file imports WinnerReveal, this file can be deleted.
 */
export function WinnerReveal(_props: WinnerRevealProps) {
  return null;
}