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

export function getCategoryMode(category: Pick<CategoryListItem, "slug">) {
  return FIXED_SLUG_SET.has(category.slug) ? "fixed" : "pro";
}

export function getRoomMode(room: Pick<RoomListItem, "gameMode">) {
  return room.gameMode === "FIXED_EQUAL_CHANCE" ? "fixed" : "pro";
}

export function getModeTitle(mode: PlayerMode) {
  return mode === "fixed" ? "Fixed Wheel" : "Pro Wheel";
}

export function getModeTag(mode: PlayerMode) {
  return mode === "fixed" ? "Equal chance" : "Flexible proportional";
}

export function getCategoryAmountLabel(category: CategoryListItem) {
  if (getCategoryMode(category) === "fixed") {
    return `${formatCoins(category.minEntryAmount)} coins`;
  }

  return `${formatCoins(category.minEntryAmount)}-${formatCoins(
    category.maxEntryAmount,
  )} coins`;
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
