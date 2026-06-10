import type { EntryWithPlayerSnapshot } from "@kingspin/contracts";

export type DisplayEntry = EntryWithPlayerSnapshot & {
  optimisticBaseEntryId?: string | null;
  pending?: boolean;
};

/**
 * 30-color wheel/list palette.
 * Max room size is 30 players.
 */
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
  "#f43f5e",

  "#84cc16",
  "#a855f7",
  "#0ea5e9",
  "#fb923c",
  "#10b981",
  "#eab308",
  "#6366f1",
  "#fb7185",
  "#2dd4bf",
  "#c084fc",

  "#65a30d",
  "#d946ef",
  "#0284c7",
  "#ea580c",
  "#059669",
  "#ca8a04",
  "#4f46e5",
  "#dc2626",
  "#0891b2",
  "#9333ea",
];

export const PLAYER_AVATAR_GLYPHS = [
  "♞",
  "♛",
  "♜",
  "♟",
  "✦",
  "✧",
  "★",
  "◆",
  "●",
  "▲",

  "♠",
  "♥",
  "♦",
  "♣",
  "⚡",
  "☄",
  "☀",
  "☾",
  "✹",
  "✺",

  "✶",
  "✷",
  "✸",
  "✻",
  "✽",
  "✿",
  "❖",
  "⬟",
  "⬢",
  "⬣",
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
  if (Number.isFinite(index) && index >= 0) {
    return PLAYER_SLICE_COLORS[index % PLAYER_SLICE_COLORS.length] ?? "#22c55e";
  }

  const colorIndex = stableKey
    ? hashColorKey(stableKey) % PLAYER_SLICE_COLORS.length
    : 0;

  return PLAYER_SLICE_COLORS[colorIndex] ?? "#22c55e";
}

export function getEntryDisplayColor(entry: DisplayEntry, index: number) {
  return getPaletteColor(index, getEntryColorKey(entry, index));
}

export function getPlayerAvatarGlyph(index: number) {
  return PLAYER_AVATAR_GLYPHS[index % PLAYER_AVATAR_GLYPHS.length] ?? "●";
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