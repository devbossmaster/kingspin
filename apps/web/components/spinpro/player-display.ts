import type { EntryWithPlayerSnapshot } from "@kingspin/contracts";

export type DisplayEntry = EntryWithPlayerSnapshot & {
  optimisticBaseEntryId?: string | null;
  pending?: boolean;
};

export const PLAYER_SLICE_COLORS = [
  "#22c55e",
  "#ec4899",
  "#06b6d4",
  "#f97316",
  "#8b5cf6",
  "#ef4444",
  "#14b8a6",
  "#facc15",
  "#3b82f6",
  "#a855f7",
  "#10b981",
  "#fb7185",
];

function hashColorKey(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function cleanDisplayName(value: string | null | undefined) {
  const trimmed = value?.trim();

  if (!trimmed) return null;

  if (trimmed.includes("@")) {
    return trimmed.split("@")[0]?.trim() || null;
  }

  return trimmed;
}

function createdAtMs(value: string | null | undefined) {
  const parsed = Date.parse(value ?? "");

  return Number.isFinite(parsed) ? parsed : 0;
}

export function getEntryColorKey(entry: DisplayEntry, index: number) {
  return (
    entry.player?.id ??
    entry.userId ??
    entry.optimisticBaseEntryId ??
    entry.id ??
    String(index)
  );
}

export function getPaletteColor(index: number, stableKey?: string | null) {
  const colorIndex = stableKey
    ? hashColorKey(stableKey) % PLAYER_SLICE_COLORS.length
    : index % PLAYER_SLICE_COLORS.length;

  return PLAYER_SLICE_COLORS[colorIndex] ?? "#22c55e";
}

export function getEntryDisplayColor(entry: DisplayEntry, index: number) {
  return getPaletteColor(index, getEntryColorKey(entry, index));
}

export function getPlayerDisplayName(
  entry: EntryWithPlayerSnapshot | null | undefined,
  index?: number,
) {
  return (
    cleanDisplayName(entry?.player?.username) ??
    cleanDisplayName(entry?.player?.fullName) ??
    (typeof index === "number" ? `Player ${index + 1}` : "Player")
  );
}

export function sortDisplayEntries<T extends EntryWithPlayerSnapshot>(
  entries: readonly T[],
) {
  return [...entries].sort((left, right) => {
    const leftTime = createdAtMs(left.createdAt);
    const rightTime = createdAtMs(right.createdAt);

    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }

    return left.id.localeCompare(right.id);
  });
}
