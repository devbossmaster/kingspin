"use client";

import Link from "next/link";
import Image from "next/image";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BadgeDollarSign,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Coins,
  Clock3,
  Eye,
  Gauge,
  Gamepad2,
  Home,
  LogOut,
  Megaphone,
  Plus,
  Radio,
  Shield,
  User,
  Users,
  Wallet,
} from "lucide-react";
import { GameShell } from "../components/player/game-shell";
import { signOut, useSession } from "../lib/auth-client";
import {
  apiClient,
  type WinnerFeedItem,
  type WinnerFeedScope,
} from "../lib/api-client";
import { formatCoins, truncateId } from "../lib/format";
import { getCategoryDisplayName, getRoomDisplayName } from "../lib/game-modes";
import { getGameSocket } from "../lib/socket-client";
import { useAuthStore } from "../stores/auth-store";
import { useCategories } from "../hooks/use-categories";

const PROMO_BANNERS = [
  { image: "/banner1.png", alt: "Spin Battle rewards banner" },
  { image: "/banner2.png", alt: "Spin Battle bonus banner" },
] as const;

const SIDEBAR_ITEMS: Array<{
  label: string;
  href: string;
  icon: LucideIcon;
  active?: boolean;
}> = [
  { label: "Promotions", href: "#promotions", icon: Megaphone, active: true },
  { label: "Home", href: "/", icon: Home },
  { label: "Betting Table", href: "#live-stats", icon: BarChart3 },
  { label: "Spin Battle", href: "#games", icon: Gamepad2 },
  { label: "Rewards", href: "/wallet", icon: BadgeDollarSign },
  { label: "Fast Games", href: "#games", icon: Gauge },
  { label: "Wallet", href: "/wallet", icon: Wallet },
  { label: "Live", href: "#live-stats", icon: Radio },
];

const ADMIN_ROLES = new Set([
  "OWNER",
  "SUPER_ADMIN",
  "ADMIN",
  "SUPPORT",
  "FINANCE",
  "RISK",
  "VIEWER",
]);

const GAMES = [
  {
    name: "Spin Battle",
    image: "/spinbattlecard.png",
  },
];

const WINNER_FEED_TABS: Array<{ scope: WinnerFeedScope; label: string }> = [
  { scope: "latest", label: "Latest winners" },
  { scope: "week", label: "Top of the week" },
  { scope: "month", label: "Top of the month" },
];

function MoneyIcon() {
  return (
    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-black text-white">
      $
    </span>
  );
}

function winnerName(winner: WinnerFeedItem) {
  const username = winner.winnerUsername?.trim();

  return username ? username : `Player ${truncateId(winner.winnerUserId, 6)}`;
}

function winnerBattleLabel(winner: WinnerFeedItem) {
  const category = getCategoryDisplayName({
    slug: winner.categorySlug,
    name: winner.categoryName,
  });
  const room = getRoomDisplayName({
    code: winner.roomCode,
    name: winner.roomName,
  });

  return `${category} / ${room}`;
}

function winnerCompletedLabel(completedAt: string | null) {
  if (!completedAt) {
    return "Live";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(completedAt));
}

function formatOnlinePlayers(value: number | null) {
  if (value === null) {
    return "Live";
  }

  return new Intl.NumberFormat().format(value);
}

function HomeSidebar({
  expanded,
  hasSession,
  isAdmin,
  isPending,
  balanceLabel,
  onToggle,
  onSignOut,
}: {
  expanded: boolean;
  hasSession: boolean;
  isAdmin: boolean;
  isPending: boolean;
  balanceLabel: string;
  onToggle: () => void;
  onSignOut: () => void;
}) {
  return (
    <aside
      className={`sticky top-20 hidden h-[calc(100vh-6rem)] shrink-0 flex-col rounded-[14px] border border-[#1b2646] bg-[linear-gradient(180deg,#07112b_0%,#050716_36%,#03040d_100%)] p-3 shadow-[0_22px_54px_rgba(0,0,0,0.52)] transition-[width] duration-300 md:flex ${
        expanded ? "w-[19.25rem]" : "w-20"
      }`}
      aria-label="Home navigation"
    >
      <div
        className={`flex items-center pb-4 ${expanded ? "justify-between" : "justify-center"}`}
      >
        <Link
          href="/"
          className={`flex min-w-0 items-center gap-3 ${
            expanded ? "" : "justify-center"
          }`}
          title={expanded ? undefined : "Spin Battle"}
        >
          <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-black ring-1 ring-white/10">
            <Image
              src="/logo.png"
              alt="Spin Battle"
              fill
              sizes="44px"
              className="object-contain p-1"
            />
          </div>
          {expanded ? (
            <span className="min-w-0">
              <span className="block truncate font-display text-lg font-black leading-none text-white">
                Spin Battle
              </span>
              <span className="mt-1 block text-[10px] font-black uppercase tracking-[0.16em] text-[#9AF421]">
                Play & win
              </span>
            </span>
          ) : null}
        </Link>

        {expanded ? (
          <button
            type="button"
            onClick={onToggle}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-white/10 text-white/60 transition hover:bg-white/15 hover:text-white"
            aria-label="Collapse sidebar"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {!expanded ? (
        <button
          type="button"
          onClick={onToggle}
          className="mb-3 grid h-10 w-full place-items-center rounded-[10px] bg-white/10 text-white/60 transition hover:bg-white/15 hover:text-white"
          aria-label="Expand sidebar"
        >
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </button>
      ) : null}

      <nav className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-0.5">
        {SIDEBAR_ITEMS.map((item) => {
          const Icon = item.icon;

          return (
            <Link
              key={item.label}
              href={item.href}
              className={`group flex min-h-12 items-center gap-3 rounded-[10px] text-base font-black transition ${
                item.active
                  ? "bg-[#9AF421] text-black shadow-[0_12px_26px_rgba(154,244,33,0.22)]"
                  : "bg-[#202845]/85 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] hover:bg-[#2a355c]"
              } ${expanded ? "justify-start px-4" : "justify-center px-0"}`}
              title={expanded ? undefined : item.label}
            >
              <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span
                className={`min-w-0 truncate transition ${
                  expanded ? "opacity-100" : "sr-only opacity-0"
                }`}
              >
                {item.label}
              </span>
            </Link>
          );
        })}

        <div className="my-2 border-t border-white/10" />

        {isPending ? (
          <div className="rounded-[10px] bg-white/[0.06] px-4 py-3 text-sm font-black text-white/45">
            {expanded ? "Loading..." : "..."}
          </div>
        ) : hasSession ? (
          <>
            <Link
              href="/wallet"
              className={`flex min-h-12 items-center rounded-[10px] border border-yellow-400/45 bg-yellow-400/10 text-sm font-black text-yellow-300 shadow-[inset_0_1px_0_rgba(250,204,21,0.12)] ${
                expanded ? "justify-between gap-3 px-4" : "justify-center px-0"
              }`}
              title={expanded ? undefined : `Balance ${balanceLabel}`}
            >
              <span className="inline-flex min-w-0 items-center gap-2">
                <Coins className="h-5 w-5 shrink-0" aria-hidden="true" />
                {expanded ? <span>Balance</span> : null}
              </span>
              {expanded ? (
                <span className="font-mono">{balanceLabel}</span>
              ) : null}
            </Link>
            <Link
              href="/settings"
              className={`flex min-h-12 items-center gap-3 rounded-[10px] bg-[#202845]/85 text-base font-black text-white transition hover:bg-[#2a355c] ${
                expanded ? "justify-start px-4" : "justify-center px-0"
              }`}
              title={expanded ? undefined : "Profile"}
            >
              <User className="h-5 w-5 shrink-0" aria-hidden="true" />
              {expanded ? <span>Profile</span> : null}
            </Link>
            {isAdmin ? (
              <Link
                href="/admin"
                className={`flex min-h-12 items-center gap-3 rounded-[10px] bg-amber-500/10 text-base font-black text-amber-400 transition hover:bg-amber-500/15 ${
                  expanded ? "justify-start px-4" : "justify-center px-0"
                }`}
                title={expanded ? undefined : "Admin"}
              >
                <Shield className="h-5 w-5 shrink-0" aria-hidden="true" />
                {expanded ? <span>Admin</span> : null}
              </Link>
            ) : null}
            <button
              type="button"
              onClick={onSignOut}
              className={`flex min-h-12 items-center gap-3 rounded-[10px] text-base font-medium text-red-400/90 transition hover:bg-red-500/10 hover:text-red-300 ${
                expanded ? "justify-start px-4" : "justify-center px-0"
              }`}
              title={expanded ? undefined : "Sign out"}
            >
              <LogOut className="h-5 w-5 shrink-0" aria-hidden="true" />
              {expanded ? <span>Sign out</span> : null}
            </button>
          </>
        ) : (
          <div
            className={`grid gap-2 ${expanded ? "grid-cols-2" : "grid-cols-1"}`}
          >
            <Link
              href="/sign-in"
              className="inline-flex min-h-11 items-center justify-center rounded-[10px] bg-blue-900 px-3 text-xs font-black text-white"
              title={expanded ? undefined : "Log In"}
            >
              {expanded ? "Log In" : "In"}
            </Link>
            <Link
              href="/sign-up"
              className="inline-flex min-h-11 items-center justify-center rounded-[10px] bg-blue-900 px-3 text-xs font-black text-white"
              title={expanded ? undefined : "Sign Up"}
            >
              {expanded ? "Sign Up" : "Up"}
            </Link>
          </div>
        )}
      </nav>

      <div
        className={`mt-3 flex min-h-11 items-center gap-2 rounded-[10px] border border-white/10 bg-white/[0.05] px-3 text-sm font-black text-white/80 ${
          expanded ? "" : "justify-center px-0"
        }`}
        title={expanded ? undefined : "Amharic"}
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 bg-black/60 text-sm font-medium text-white">
          ET
        </span>
        {expanded ? <span>Amharic</span> : null}
      </div>
    </aside>
  );
}

export default function SpinBattleHomePage() {
  const { data: session, isPending, refetch } = useSession();
  const { categories } = useCategories();
  const user = useAuthStore((store) => store.user);
  const wallet = useAuthStore((store) => store.wallet);
  const clear = useAuthStore((store) => store.clear);
  const [bannerSlideIndex, setBannerSlideIndex] = useState(0);
  const [isBannerTransitionEnabled, setIsBannerTransitionEnabled] =
    useState(true);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true);
  const [winnerScope, setWinnerScope] = useState<WinnerFeedScope>("latest");
  const [winnerFeed, setWinnerFeed] = useState<WinnerFeedItem[]>([]);
  const [isWinnerFeedLoading, setIsWinnerFeedLoading] = useState(false);
  const [winnerFeedError, setWinnerFeedError] = useState<string | null>(null);
  const [onlinePlayers, setOnlinePlayers] = useState<number | null>(null);
  const activeBannerIndex = bannerSlideIndex % PROMO_BANNERS.length;
  const carouselSlides = [...PROMO_BANNERS, PROMO_BANNERS[0]];
  const balanceLabel = wallet ? formatCoins(wallet.balanceSnapshot) : "0";
  const onlinePlayersLabel = formatOnlinePlayers(onlinePlayers);
  const categorySlugKey = useMemo(
    () =>
      categories
        .map((category) => category.slug)
        .sort()
        .join("|"),
    [categories],
  );
  const gameHref = !session?.user
    ? `/sign-in?callbackURL=${encodeURIComponent("/spinpro")}`
    : session.user.emailVerified === false
      ? `/verify-email?email=${encodeURIComponent(session.user.email)}`
      : "/spinpro";

  useEffect(() => {
    const bannerTimer = window.setInterval(() => {
      setIsBannerTransitionEnabled(true);
      setBannerSlideIndex((currentIndex) => currentIndex + 1);
    }, 4000);

    return () => window.clearInterval(bannerTimer);
  }, []);

  const refreshWinnerFeed = useCallback(
    async (showLoading = false) => {
      if (showLoading) {
        setIsWinnerFeedLoading(true);
      }

      try {
        const feed = await apiClient.getWinnerFeed(winnerScope, 30);

        setWinnerFeed(feed.winners);
        setWinnerFeedError(null);
      } catch (caught) {
        setWinnerFeedError(
          caught instanceof Error ? caught.message : "Could not load winners.",
        );
      } finally {
        setIsWinnerFeedLoading(false);
      }
    },
    [winnerScope],
  );

  const refreshOnlinePlayers = useCallback(async () => {
    try {
      const presence = await apiClient.getSpinBattleOnline();

      setOnlinePlayers(presence.onlinePlayers);
    } catch {
      setOnlinePlayers((current) => current);
    }
  }, []);

  useEffect(() => {
    void refreshWinnerFeed(true);

    const intervalId = window.setInterval(() => {
      void refreshWinnerFeed(false);
    }, 5_000);

    return () => window.clearInterval(intervalId);
  }, [refreshWinnerFeed]);

  useEffect(() => {
    void refreshOnlinePlayers();

    const intervalId = window.setInterval(() => {
      void refreshOnlinePlayers();
    }, 5_000);

    return () => window.clearInterval(intervalId);
  }, [refreshOnlinePlayers]);

  useEffect(() => {
    const socket = getGameSocket();
    const updateOnlinePlayers = (payload: { onlinePlayers: number }) => {
      setOnlinePlayers(payload.onlinePlayers);
    };

    socket.on("spin-battle:online", updateOnlinePlayers);

    if (!socket.connected) {
      socket.connect();
    }

    return () => {
      socket.off("spin-battle:online", updateOnlinePlayers);
    };
  }, []);

  useEffect(() => {
    if (!categorySlugKey) {
      return;
    }

    const categorySlugs = categorySlugKey.split("|").filter(Boolean);
    const socket = getGameSocket();
    const refresh = () => void refreshWinnerFeed(false);

    const joinCategories = () => {
      for (const categorySlug of categorySlugs) {
        socket.emit("category:join", { categorySlug });
      }
    };

    socket.on("connect", joinCategories);
    socket.on("category:state", refresh);
    socket.on("round:settled", refresh);

    if (socket.connected) {
      joinCategories();
    } else {
      socket.connect();
    }

    return () => {
      for (const categorySlug of categorySlugs) {
        socket.emit("category:leave", { categorySlug });
      }

      socket.off("connect", joinCategories);
      socket.off("category:state", refresh);
      socket.off("round:settled", refresh);
    };
  }, [categorySlugKey, refreshWinnerFeed]);

  function handleBannerTransitionEnd() {
    if (bannerSlideIndex !== PROMO_BANNERS.length) {
      return;
    }

    setIsBannerTransitionEnabled(false);
    setBannerSlideIndex(0);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setIsBannerTransitionEnabled(true));
    });
  }

  async function handleSignOut() {
    await signOut();
    clear();
    await refetch();
  }

  return (
    <GameShell>
      <div className="mx-auto flex min-h-[calc(100vh-var(--safe-bottom-padding)-4rem)] w-full max-w-[1260px] gap-5 px-3 py-4 md:px-5 md:py-6 lg:px-8">
        <HomeSidebar
          expanded={isSidebarExpanded}
          hasSession={Boolean(session?.user)}
          isAdmin={Boolean(user?.role && ADMIN_ROLES.has(user.role))}
          isPending={isPending}
          balanceLabel={balanceLabel}
          onToggle={() => setIsSidebarExpanded((current) => !current)}
          onSignOut={() => void handleSignOut()}
        />

        <main className="min-w-0 flex-1">
          <div className="mx-auto flex w-full max-w-md flex-col pb-8 md:max-w-[960px]">
            {/* ── 1. Promotional Banner ── */}
            <div
              id="promotions"
              className="relative mb-6 overflow-hidden rounded-2xl bg-black shadow-[0_18px_40px_rgba(0,0,0,0.36)] md:rounded-[18px]"
            >
              <div
                className={`flex ${
                  isBannerTransitionEnabled
                    ? "transition-transform duration-700 ease-out"
                    : ""
                }`}
                style={{ transform: `translateX(-${bannerSlideIndex * 100}%)` }}
                onTransitionEnd={handleBannerTransitionEnd}
              >
                {carouselSlides.map((banner, index) => (
                  <div
                    key={`${banner.image}-${index}`}
                    className="relative aspect-video w-full flex-shrink-0 lg:aspect-[21/8]"
                  >
                    <Image
                      src={banner.image}
                      alt={banner.alt}
                      fill
                      priority={index === 0}
                      sizes="(min-width: 768px) 672px, calc(100vw - 24px)"
                      className="object-cover"
                      draggable={false}
                    />
                  </div>
                ))}
              </div>

              <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center gap-2">
                {PROMO_BANNERS.map((banner, index) => (
                  <span
                    key={banner.image}
                    className={`h-2 rounded-full transition-all duration-300 ${
                      index === activeBannerIndex
                        ? "w-7 bg-white"
                        : "w-2 bg-white/35"
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* ── 2. Games Section Header ── */}
            <div id="games" className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-white">
                Play spin battle games
              </h2>
              <span className="text-xs font-semibold text-yellow-400/80 cursor-pointer hover:text-yellow-400">
                See all
              </span>
            </div>

            {/* ── 3. Game Cards Grid ── */}
            <div className="grid grid-cols-[minmax(0,11.5rem)] gap-3 sm:grid-cols-[minmax(0,14rem)]">
              {GAMES.map((game) => (
                <Link
                  key={game.name}
                  href={isPending ? "#" : gameHref}
                  aria-disabled={isPending}
                  className={`group relative h-56 overflow-hidden rounded-lg border border-[#f6c547]/50 bg-black shadow-[0_16px_34px_rgba(0,0,0,0.4)] transition hover:scale-[1.02] hover:shadow-[0_18px_42px_rgba(0,0,0,0.54)] sm:h-[17rem] ${isPending ? "pointer-events-none opacity-70" : ""}`}
                >
                  <div
                    className="absolute inset-0 bg-cover bg-center transition duration-300 group-hover:scale-105"
                    style={{
                      backgroundImage: `url(${game.image})`,
                      backgroundPosition: "center 62%",
                    }}
                  />
                  <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/60 to-transparent" />
                  <div className="relative z-10 flex justify-center p-2.5">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1 text-[10px] font-black uppercase tracking-normal text-white shadow-[0_8px_18px_rgba(0,0,0,0.35)] backdrop-blur">
                      <Users
                        className="h-3 w-3 text-emerald-300"
                        aria-hidden="true"
                      />
                      {onlinePlayersLabel} online
                    </span>
                  </div>
                </Link>
              ))}
            </div>

            {/* ── 4. Winners Table ── */}
            <section id="live-stats" className="mt-8">
              <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="font-display text-2xl font-black text-white">
                    Winners
                  </h2>
                  <p className="mt-1 text-xs font-bold text-zinc-500">
                    Realtime winner feed, 15 players per room.
                  </p>
                </div>
                <div className="flex overflow-x-auto rounded-lg border border-white/10 bg-white/[0.04] p-1">
                  {WINNER_FEED_TABS.map((tab) => (
                    <button
                      key={tab.scope}
                      type="button"
                      onClick={() => setWinnerScope(tab.scope)}
                      className={`min-h-9 shrink-0 rounded-md px-4 text-xs font-black transition ${
                        winnerScope === tab.scope
                          ? "bg-white/15 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                          : "text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border border-white/10 bg-black/35 p-2 shadow-[0_20px_44px_rgba(0,0,0,0.32)]">
                <div className="mb-2 flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2">
                  <span className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-lime-300">
                    <Radio className="h-3.5 w-3.5" aria-hidden="true" />
                    Live
                  </span>
                  <span className="text-xs font-bold text-zinc-500">
                    {isWinnerFeedLoading ? "Refreshing..." : "Fast 5s sync"}
                  </span>
                </div>

                <div className="hidden grid-cols-[minmax(0,1.35fr)_minmax(0,1.45fr)_minmax(0,0.75fr)_minmax(0,0.8fr)_minmax(0,0.9fr)] gap-4 border-b border-white/10 px-3 py-3 text-xs font-bold text-zinc-500 md:grid">
                  <span>Winner</span>
                  <span>Battle</span>
                  <span>Players</span>
                  <span>Round</span>
                  <span>Payout</span>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] border-b border-white/10 px-3 py-3 text-xs font-bold text-zinc-500 md:hidden">
                  <span>Winner</span>
                  <span>Payout</span>
                </div>

                <div className="flex flex-col gap-1.5">
                  {winnerFeed.map((winner) => {
                    const roomHref = `/spinpro/${winner.categorySlug}/${winner.roomId}`;
                    const isTopWinner =
                      winner.rank <= 3 && winnerScope !== "latest";

                    return (
                      <div key={winner.roundId}>
                        <div
                          className={`hidden min-h-14 grid-cols-[minmax(0,1.35fr)_minmax(0,1.45fr)_minmax(0,0.75fr)_minmax(0,0.8fr)_minmax(0,0.9fr)] items-center gap-4 rounded-lg px-3 py-2 text-sm font-bold md:grid ${
                            isTopWinner ? "bg-white/[0.14]" : "bg-white/[0.055]"
                          }`}
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <Image
                              src="/logo.png"
                              alt=""
                              width={40}
                              height={40}
                              className="h-10 w-10 shrink-0 rounded-md bg-black object-contain p-1"
                            />
                            <div className="min-w-0">
                              <p className="truncate text-xs text-zinc-500">
                                #{winner.rank} winner
                              </p>
                              <p className="truncate text-white">
                                {winnerName(winner)}
                              </p>
                            </div>
                          </div>
                          <Link
                            href={roomHref}
                            className="inline-flex min-w-0 items-center gap-2 text-zinc-200 transition hover:text-white"
                          >
                            <Eye
                              className="h-4 w-4 shrink-0 text-sky-300"
                              aria-hidden="true"
                            />
                            <span className="truncate">
                              {winnerBattleLabel(winner)}
                            </span>
                          </Link>
                          <span className="inline-flex items-center gap-1.5 text-zinc-100">
                            <Users
                              className="h-4 w-4 text-yellow-200"
                              aria-hidden="true"
                            />
                            {winner.playerCount}/{winner.roomMaxPlayers}
                          </span>
                          <span className="inline-flex items-center gap-1.5 text-zinc-100">
                            <Clock3
                              className="h-4 w-4 text-teal-200"
                              aria-hidden="true"
                            />
                            #{winner.roundNumber}
                          </span>
                          <span className="inline-flex items-center gap-2 text-lime-400">
                            <MoneyIcon />
                            {formatCoins(winner.payoutAmount)}
                          </span>
                        </div>

                        <div
                          className={`rounded-xl p-3 md:hidden ${
                            isTopWinner ? "bg-white/[0.14]" : "bg-white/[0.055]"
                          }`}
                        >
                          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                            <div className="flex min-w-0 items-center gap-3">
                              <Image
                                src="/logo.png"
                                alt=""
                                width={44}
                                height={44}
                                className="h-11 w-11 shrink-0 rounded-md bg-black object-contain p-1"
                              />
                              <div className="min-w-0">
                                <p className="truncate text-xs font-bold text-zinc-500">
                                  #{winner.rank} /{" "}
                                  {winnerCompletedLabel(winner.completedAt)}
                                </p>
                                <p className="truncate text-sm font-black text-white">
                                  {winnerName(winner)}
                                </p>
                                <p className="mt-0.5 truncate text-[11px] font-bold text-zinc-500">
                                  {winnerBattleLabel(winner)} /{" "}
                                  {winner.playerCount}/{winner.roomMaxPlayers}{" "}
                                  players
                                </p>
                              </div>
                            </div>
                            <span className="inline-flex items-center gap-1 text-xs font-black text-lime-400">
                              <MoneyIcon />
                              {formatCoins(winner.payoutAmount)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {!isWinnerFeedLoading && winnerFeed.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-8 text-center text-sm font-semibold text-zinc-500">
                      {winnerFeedError ??
                        "No winners yet. Completed rounds will appear here in realtime."}
                    </div>
                  ) : null}
                </div>
              </div>
            </section>

            {/* ── 5. FAB ── */}
            <button
              type="button"
              aria-label="Add"
              className="fixed bottom-[calc(var(--safe-bottom-padding)+0.75rem)] right-4 z-50 flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-[#242424] text-white shadow-[0_16px_34px_rgba(0,0,0,0.55)] transition hover:scale-105 hover:bg-[#2f2f2f] active:scale-95 md:bottom-6 md:right-6"
            >
              <Plus className="h-8 w-8" strokeWidth={3} />
            </button>
          </div>
        </main>
      </div>
    </GameShell>
  );
}
