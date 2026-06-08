import type { CategoryListItem, RoomListItem } from "./api-client";
import { formatCoins } from "./format";

export const PRO_CATEGORY_SLUGS = [
  "pro-10-100",
  "pro-100-200",
  "pro-200-350",
] as const;

export const FIXED_CATEGORY_SLUGS = [
  "fixed-10",
  "fixed-20",
  "fixed-50",
] as const;

const PRO_SLUG_SET = new Set<string>(PRO_CATEGORY_SLUGS);
const FIXED_SLUG_SET = new Set<string>(FIXED_CATEGORY_SLUGS);

export type PlayerMode = "pro" | "fixed";

const CATEGORY_DISPLAY_NAMES: Record<string, string> = {
  "pro-10-100": "Base",
  "pro-100-200": "Palace",
  "pro-200-350": "Empire",
  "fixed-10": "Base",
  "fixed-20": "Palace",
  "fixed-50": "Empire",
};

function normalizeRoomCode(value: string | null | undefined) {
  const match = value?.trim().match(/^([CF][BPE])\s*0*(\d+)$/i);

  if (!match) {
    return null;
  }

  return `${match[1]!.toUpperCase()}${Number(match[2]!)
    .toString()
    .padStart(2, "0")}`;
}

function cleanLabel(value: string | null | undefined) {
  const trimmed = value?.trim();

  return trimmed ? trimmed : null;
}

function looksLikeRawIdentifier(value: string) {
  return (
    /^c[a-z0-9]{18,}$/i.test(value) ||
    /^[a-f0-9]{24}$/i.test(value) ||
    /^[a-z0-9]{24,}$/i.test(value)
  );
}

function looksLikeSlug(value: string) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(value);
}

function formatCategorySlug(slug: string) {
  const mapped = CATEGORY_DISPLAY_NAMES[slug];

  if (mapped) return mapped;

  const words = slug
    .split("-")
    .filter((part) => part && !/^\d+$/.test(part))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1));

  return words.length > 0 ? words.join(" ") : "Base";
}

function getFriendlyRoomLabel(value: string | null | undefined) {
  const label = cleanLabel(value);

  if (!label) return null;

  const roomCode = normalizeRoomCode(label);

  if (roomCode) return roomCode;
  if (looksLikeRawIdentifier(label) || looksLikeSlug(label)) return null;

  return label;
}

export function getCategoryMode(category: Pick<CategoryListItem, "slug">) {
  return FIXED_SLUG_SET.has(category.slug) ? "fixed" : "pro";
}

export function getRoomMode(room: Pick<RoomListItem, "gameMode">) {
  return room.gameMode === "FIXED_EQUAL_CHANCE" ? "fixed" : "pro";
}

export function getModeTitle(mode: PlayerMode) {
  return mode === "fixed" ? "Classic" : "Flex";
}

export function getModeTag(mode: PlayerMode) {
  return mode === "fixed" ? "Classic" : "Flex";
}

export function formatGameModeLabel(
  mode: PlayerMode | "FLEXIBLE_PROPORTIONAL" | "FIXED_EQUAL_CHANCE",
) {
  return mode === "fixed" || mode === "FIXED_EQUAL_CHANCE"
    ? "Classic"
    : "Flex";
}

export function formatCategoryLabel(slugOrName: string) {
  return CATEGORY_DISPLAY_NAMES[slugOrName] ?? cleanLabel(slugOrName) ?? "Base";
}

function categoryCodeFromSlug(slug: string | null | undefined) {
  if (slug?.includes("100-200") || slug === "fixed-20") return "P";
  if (slug?.includes("200-350") || slug === "fixed-50") return "E";
  return "B";
}

export function buildRoomCode(
  mode: PlayerMode | "FLEXIBLE_PROPORTIONAL" | "FIXED_EQUAL_CHANCE",
  categorySlug: string | null | undefined,
  index = 0,
) {
  const modeCode =
    mode === "fixed" || mode === "FIXED_EQUAL_CHANCE" ? "C" : "F";
  const categoryCode = categoryCodeFromSlug(categorySlug);

  return `${modeCode}${categoryCode}${String(index + 1).padStart(2, "0")}`;
}

export function getCategoryDisplayName(
  category: Pick<CategoryListItem, "slug" | "name">,
) {
  const mappedName = CATEGORY_DISPLAY_NAMES[category.slug];

  if (mappedName) return mappedName;

  const name = cleanLabel(category.name);

  if (
    name &&
    name.toLowerCase() !== category.slug.toLowerCase() &&
    !looksLikeSlug(name) &&
    !looksLikeRawIdentifier(name)
  ) {
    return name;
  }

  return formatCategorySlug(category.slug);
}

export function getCategoryRingLabel(
  category: Pick<
    CategoryListItem,
    "slug" | "minEntryAmount" | "maxEntryAmount"
  >,
) {
  if (
    getCategoryMode(category) === "fixed" ||
    Number(category.minEntryAmount) === Number(category.maxEntryAmount)
  ) {
    return formatCoins(category.minEntryAmount);
  }

  return `${formatCoins(category.minEntryAmount)}-${formatCoins(
    category.maxEntryAmount,
  )}`;
}

export function getCategoryAmountLabel(category: CategoryListItem) {
  return `${getCategoryRingLabel(category)} coins`;
}

export function getRoomDisplayName(
  room: Pick<RoomListItem, "code" | "name"> &
    Partial<Pick<RoomListItem, "gameMode" | "categorySlug">>,
  index?: number,
) {
  const storedCode = normalizeRoomCode(room.code) ?? normalizeRoomCode(room.name);

  if (storedCode) return storedCode;

  if (room.gameMode || room.categorySlug) {
    return buildRoomCode(
      room.gameMode ?? "FLEXIBLE_PROPORTIONAL",
      room.categorySlug,
      index ?? 0,
    );
  }

  const nameLabel = getFriendlyRoomLabel(room.name);

  if (nameLabel) return nameLabel;

  if (typeof index === "number") {
    return `R${String(index + 1).padStart(2, "0")}`;
  }

  return getFriendlyRoomLabel(room.code) ?? "Room";
}

export function buildPlayHref(targetHref: string, isSignedIn: boolean) {
  if (isSignedIn) {
    return targetHref;
  }

  return `/sign-in?callbackURL=${encodeURIComponent(targetHref)}`;
}

export function sortPlayerCategories(categories: CategoryListItem[]) {
  const order = new Map<string, number>(
    [...PRO_CATEGORY_SLUGS, ...FIXED_CATEGORY_SLUGS].map((slug, index) => [
      slug,
      index,
    ]),
  );

  return [...categories].sort((left, right) => {
    const leftOrder = order.get(left.slug) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = order.get(right.slug) ?? Number.MAX_SAFE_INTEGER;

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    return (left.sortOrder ?? 0) - (right.sortOrder ?? 0);
  });
}

export function isBaselinePlayerCategory(category: CategoryListItem) {
  return PRO_SLUG_SET.has(category.slug) || FIXED_SLUG_SET.has(category.slug);
}
