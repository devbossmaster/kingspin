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
  "pro-10-100": "Jemaw 1",
  "pro-100-200": "Jemaw 2",
  "pro-200-350": "Jemaw 3",
  "fixed-10": "Jemaw 1",
  "fixed-20": "Jemaw 2",
  "fixed-50": "Jemaw 3",
};

function formatArenaCode(index: number) {
  return `A${String(index + 1).padStart(2, "0")}`;
}

function normalizeArenaCode(value: string | null | undefined) {
  const match = value?.trim().match(/^A\s*0*(\d+)$/i);

  if (!match) {
    return null;
  }

  return `A${Number(match[1]).toString().padStart(2, "0")}`;
}

export function getCategoryMode(category: Pick<CategoryListItem, "slug">) {
  return FIXED_SLUG_SET.has(category.slug) ? "fixed" : "pro";
}

export function getRoomMode(room: Pick<RoomListItem, "gameMode">) {
  return room.gameMode === "FIXED_EQUAL_CHANCE" ? "fixed" : "pro";
}

export function getModeTitle(mode: PlayerMode) {
  return mode === "fixed" ? "Fixed Battle" : "Flexible Battle";
}

export function getModeTag(mode: PlayerMode) {
  return mode === "fixed" ? "Fixed" : "Flexible";
}

export function getCategoryDisplayName(
  category: Pick<CategoryListItem, "slug" | "name">,
) {
  return CATEGORY_DISPLAY_NAMES[category.slug] ?? category.name;
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
  room: Pick<RoomListItem, "code" | "name">,
  index?: number,
) {
  if (typeof index === "number") {
    return formatArenaCode(index);
  }

  return (
    normalizeArenaCode(room.name) ?? normalizeArenaCode(room.code) ?? "A01"
  );
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
