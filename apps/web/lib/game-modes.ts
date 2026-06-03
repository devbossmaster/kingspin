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
  "pro-10-100": "Arena",
  "pro-100-200": "Arena II",
  "pro-200-350": "Arena III",
  "fixed-10": "Fixed Arena",
  "fixed-20": "Fixed Arena II",
  "fixed-50": "Fixed Arena III",
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
  if (FIXED_SLUG_SET.has(slug)) return "Fixed Arena";
  if (PRO_SLUG_SET.has(slug)) return "Arena";

  const words = slug
    .split("-")
    .filter((part) => part && !/^\d+$/.test(part))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1));

  return words.length > 0 ? words.join(" ") : "Arena";
}

function getFriendlyRoomLabel(value: string | null | undefined) {
  const label = cleanLabel(value);

  if (!label) return null;

  const arenaCode = normalizeArenaCode(label);

  if (arenaCode) return arenaCode;
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
  return mode === "fixed" ? "Fixed Battle" : "Flexible Battle";
}

export function getModeTag(mode: PlayerMode) {
  return mode === "fixed" ? "Fixed" : "Flexible";
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
  room: Pick<RoomListItem, "code" | "name">,
  index?: number,
) {
  const nameLabel = getFriendlyRoomLabel(room.name);

  if (nameLabel) return nameLabel;

  if (typeof index === "number") {
    return formatArenaCode(index);
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
