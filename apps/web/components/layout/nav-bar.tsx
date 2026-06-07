"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BadgeDollarSign,
  BarChart3,
  ChevronLeft,
  Coins,
  Gamepad2,
  Home,
  LogOut,
  Menu,
  Search,
  Shield,
  User,
  X,
} from "lucide-react";
import { UserDropdown } from "../player/user-dropdown";
import { signOut, useSession } from "../../lib/auth-client";
import { formatCoins } from "../../lib/format";
import { useAuthStore } from "../../stores/auth-store";

const ADMIN_ROLES = new Set([
  "OWNER",
  "SUPER_ADMIN",
  "ADMIN",
  "SUPPORT",
  "FINANCE",
  "RISK",
  "VIEWER",
]);

const DRAWER_ITEMS = [
  { href: "/", label: "ዋና ገጽ", icon: Home },
  { href: "/#live-stats", label: "የውርርድ ሰንጠረዥ", icon: BarChart3 },
  { href: "/#games", label: "Spin Battle", icon: Gamepad2 },
  { href: "/wallet", label: "ሽልማቶች", icon: BadgeDollarSign },
];

const LOGO_SRC = "/logo.png?v=4";

function isAdminRole(role: string | null | undefined) {
  return Boolean(role && ADMIN_ROLES.has(role));
}

const signInButtonClass =
  "inline-flex min-h-10 items-center justify-center rounded-xl bg-blue-600 px-4 text-xl font-black text-white shadow-[0_10px_24px_rgba(37,99,235,0.32)] transition hover:bg-blue-500 active:scale-[0.98]";

const signUpButtonClass =
  "inline-flex min-h-10 items-center justify-center rounded-xl bg-green-600 px-4 text-xl font-black text-white shadow-[0_10px_24px_rgba(22,163,74,0.32)] transition hover:bg-green-500 active:scale-[0.98]";

const mobileSignInButtonClass =
  "inline-flex h-10 min-h-10 items-center justify-center rounded-xl bg-blue-600 px-5 text-[15px] font-black text-white shadow-[0_8px_20px_rgba(37,99,235,0.3)] transition hover:bg-blue-500 active:scale-[0.98]";

const mobileSignUpButtonClass =
  "inline-flex h-10 min-h-10 items-center justify-center rounded-xl bg-green-600 px-4 text-[15px] font-black text-white shadow-[0_8px_20px_rgba(22,163,74,0.3)] transition hover:bg-green-500 active:scale-[0.98]";

const drawerPanelClass =
  "relative flex h-full w-[17.5rem] max-w-[82vw] flex-col border-r border-white/[0.06] bg-[#0b1020] px-4 py-5 shadow-[24px_0_80px_rgba(0,0,0,0.6)] transition-transform duration-300";

const drawerSectionLabelClass =
  "px-1 pb-2 pt-4 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400/80";

const drawerItemClass =
  "group flex min-h-11 items-center gap-3 rounded-xl px-3 text-[13px] font-black transition";

const drawerInactiveItemClass =
  "text-slate-400 hover:bg-white/[0.045] hover:text-white";

const drawerActiveItemClass =
  "bg-blue-600 text-white shadow-[0_12px_28px_rgba(37,99,235,0.28)]";

function BrandTitle({ small = false }: { small?: boolean }) {
  return (
    <span
      className={`block truncate font-display font-black uppercase leading-none tracking-[-0.03em] bg-gradient-to-b from-white via-sky-200 to-blue-500 bg-clip-text text-transparent drop-shadow-[0_2px_0_rgba(0,0,0,0.9)] [text-shadow:0_0_12px_rgba(59,130,246,0.75)] [-webkit-text-stroke:0.35px_rgba(2,6,23,0.85)] ${
        small ? "text-[17px]" : "text-base sm:text-lg md:text-xl"
      }`}
    >
      Spin Battle
    </span>
  );
}

export function NavBar({ backHref }: { backHref?: string }) {
  const { data: session, isPending, refetch } = useSession();
  const pathname = usePathname();
  const user = useAuthStore((store) => store.user);
  const wallet = useAuthStore((store) => store.wallet);
  const fetchMe = useAuthStore((store) => store.fetchMe);
  const fetchWallet = useAuthStore((store) => store.fetchWallet);
  const clear = useAuthStore((store) => store.clear);
  const sessionUserId = session?.user.id ?? null;
  const balanceLabel = wallet ? formatCoins(wallet.balanceSnapshot) : "0";
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    if (!sessionUserId) {
      clear();
      return;
    }

    void fetchMe();
    void fetchWallet();
  }, [clear, fetchMe, fetchWallet, sessionUserId]);

  useEffect(() => {
    document.body.style.overflow = isMenuOpen ? "hidden" : "";

    return () => {
      document.body.style.overflow = "";
    };
  }, [isMenuOpen]);

  async function handleSignOut() {
    await signOut();
    clear();
    setIsMenuOpen(false);
    await refetch();
  }

  function closeMenu() {
    setIsMenuOpen(false);
  }

  return (
    <>
      <header className="sticky top-0 z-40 w-full max-w-[100vw] border-b border-white/10 bg-[rgba(4,8,18,0.9)] backdrop-blur-xl">
        <div className="mx-auto flex min-h-16 w-full max-w-[100vw] items-center justify-between gap-2 px-2 sm:px-3 md:max-w-7xl md:px-8">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3 md:gap-4">
            {backHref ? (
              <Link
                href={backHref}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-white/10 text-white/60 transition hover:bg-white/5 hover:text-white md:hidden"
                aria-label="ወደ ኋላ"
              >
                <ChevronLeft className="h-5 w-5" aria-hidden="true" />
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => setIsMenuOpen(true)}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-white/70 transition hover:bg-white/5 hover:text-white md:hidden"
                aria-label="ማውጫ ክፈት"
              >
                <Menu className="h-6 w-6" aria-hidden="true" />
              </button>
            )}

            <Link
              href="/"
              className="group flex min-w-0 shrink items-center gap-2 sm:gap-3"
            >
              <div className="relative flex h-10 w-10 shrink-0 sm:h-11 sm:w-11">
                <Image
                  src={LOGO_SRC}
                  alt="Spin Battle"
                  fill
                  sizes="44px"
                  className="object-contain p-1"
                  priority
                  unoptimized
                />
              </div>

              <span className="min-w-0">
                <BrandTitle />
                <span className="hidden text-[10px] font-bold uppercase tracking-widest text-sky-300 md:block">
                  ይጫወቱ እና ያሸንፉ
                </span>
              </span>
            </Link>

            <button
              type="button"
              className="hidden h-10 w-10 place-items-center rounded-[8px] border border-white/[0.08] bg-[#151827] text-white/70 transition hover:border-sky-400/60 hover:text-white md:grid"
              aria-label="ፈልግ"
            >
              <Search className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          <nav
            className="hidden shrink-0 items-center gap-3 md:flex"
            aria-label="Account"
          >
            {isPending ? (
              <span className="inline-flex h-9 min-w-12 animate-pulse items-center justify-center rounded-md bg-white/5 px-3 text-sm font-bold text-white/50">
                ...
              </span>
            ) : session?.user ? (
              <>
                {isAdminRole(user?.role) ? (
                  <Link
                    href="/admin"
                    className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-400 transition hover:bg-amber-500/20"
                  >
                    <Shield className="h-3.5 w-3.5" aria-hidden="true" />
                    አስተዳዳሪ
                  </Link>
                ) : null}

                <Link
                  href="/wallet"
                  className="inline-flex min-h-9 items-center gap-2 rounded-[6px] border border-yellow-400/40 bg-yellow-400/10 px-3 text-sm font-black text-yellow-300 shadow-[0_0_14px_rgba(250,204,21,0.18)] transition hover:border-yellow-300/70 hover:bg-yellow-400/15"
                >
                  <Coins className="h-4 w-4" aria-hidden="true" />
                  <span className="font-mono">{balanceLabel}</span>
                </Link>

                <UserDropdown />
              </>
            ) : (
              <>
                <Link href="/sign-in" className={`${signInButtonClass} w-36`}>
                  ይግቡ
                </Link>
                <Link href="/sign-up" className={`${signUpButtonClass} w-36`}>
                  ይመዝገቡ
                </Link>
              </>
            )}
          </nav>

          <div className="flex shrink-0 items-center gap-1.5 md:hidden">
            {isPending ? (
              <span className="h-8 w-12 animate-pulse rounded-md bg-white/5" />
            ) : session?.user ? (
              <div className="flex items-center gap-2">
                <Link
                  href="/wallet"
                  className="inline-flex h-8 max-w-24 items-center gap-1 rounded-md border border-yellow-400/35 bg-yellow-400/10 px-2 text-[11px] font-black text-yellow-300"
                  aria-label={`Wallet balance ${balanceLabel}`}
                >
                  <Coins className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate font-mono">{balanceLabel}</span>
                </Link>
                <UserDropdown />
              </div>
            ) : (
              <>
                <Link href="/sign-in" className={mobileSignInButtonClass}>
                  ይግቡ
                </Link>
                <Link
                  href="/sign-up"
                  className={`${mobileSignUpButtonClass} hidden min-[360px]:inline-flex`}
                >
                  ይመዝገቡ
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <div
        className={`fixed inset-0 z-50 transition-all duration-300 ease-in-out md:hidden ${
          isMenuOpen ? "visible opacity-100" : "invisible opacity-0"
        }`}
        aria-hidden={!isMenuOpen}
      >
        <div
          className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          onClick={closeMenu}
        />

        <div
          className={`${drawerPanelClass} ${isMenuOpen ? "translate-x-0" : "-translate-x-full"}`}
        >
          <div className="flex items-center justify-between pb-5">
            <Link
              href="/"
              onClick={closeMenu}
              className="flex min-w-0 items-center gap-3"
            >
              <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-black ring-1 ring-white/10">
                <Image
                  src={LOGO_SRC}
                  alt="Spin Battle"
                  fill
                  sizes="44px"
                  className="object-contain p-1"
                  priority
                  unoptimized
                />
              </div>

              <span className="min-w-0">
                <BrandTitle small />
                <span className="mt-1 block text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                  የተጫዋች ማውጫ
                </span>
              </span>
            </Link>

            <button
              type="button"
              onClick={closeMenu}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-slate-400 transition hover:bg-white/[0.1] hover:text-white"
              aria-label="ማውጫ ዝጋ"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <div className={drawerSectionLabelClass}>ማውጫ</div>

            <div className="flex flex-col gap-1.5">
              {DRAWER_ITEMS.map((item, index) => {
                const Icon = item.icon;
                const isActive = pathname.startsWith("/wallet")
                  ? item.label === "ሽልማቶች"
                  : pathname.startsWith("/spinpro")
                    ? item.label === "Spin Battle"
                    : index === 0;

                return (
                  <Link
                    key={`${item.label}-${index}`}
                    href={item.href}
                    onClick={closeMenu}
                    className={`${drawerItemClass} ${
                      isActive ? drawerActiveItemClass : drawerInactiveItemClass
                    }`}
                  >
                    <Icon
                      className={`h-5 w-5 shrink-0 ${
                        isActive
                          ? "text-white"
                          : "text-slate-500 group-hover:text-white"
                      }`}
                      aria-hidden="true"
                    />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>

            {isPending ? (
              <div className="mt-5 px-1 text-sm text-slate-500">በመጫን ላይ...</div>
            ) : session?.user ? (
              <>
                <div className={drawerSectionLabelClass}>አካውንት</div>

                <div className="flex flex-col gap-1.5">
                  <Link
                    href="/wallet"
                    onClick={closeMenu}
                    className={`${drawerItemClass} ${drawerInactiveItemClass}`}
                  >
                    <Coins
                      className="h-5 w-5 shrink-0 text-slate-500 group-hover:text-white"
                      aria-hidden="true"
                    />
                    <span className="truncate">ቀሪ ሂሳብ</span>
                    <span className="ml-auto max-w-20 truncate font-mono text-[12px] text-yellow-300">
                      {balanceLabel}
                    </span>
                  </Link>

                  <Link
                    href="/settings"
                    onClick={closeMenu}
                    className={`${drawerItemClass} ${drawerInactiveItemClass}`}
                  >
                    <User
                      className="h-5 w-5 shrink-0 text-slate-500 group-hover:text-white"
                      aria-hidden="true"
                    />
                    <span>ፕሮፋይል</span>
                  </Link>

                  {isAdminRole(user?.role) ? (
                    <Link
                      href="/admin"
                      onClick={closeMenu}
                      className={`${drawerItemClass} text-amber-400 hover:bg-amber-500/10`}
                    >
                      <Shield className="h-5 w-5 shrink-0" aria-hidden="true" />
                      <span>አስተዳዳሪ</span>
                    </Link>
                  ) : null}
                </div>

                <div className="mt-auto border-t border-white/[0.06] pt-4">
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="group flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-[13px] font-black text-slate-400 transition hover:bg-red-500/10 hover:text-red-300"
                  >
                    <LogOut
                      className="h-5 w-5 text-slate-500 group-hover:text-red-300"
                      aria-hidden="true"
                    />
                    ዘግተው ይውጡ
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className={drawerSectionLabelClass}>አካውንት</div>

                <div className="grid grid-cols-2 gap-2">
                  <Link
                    href="/sign-in"
                    onClick={closeMenu}
                    className="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-600 px-3 text-base font-black text-white shadow-[0_10px_24px_rgba(37,99,235,0.3)] transition hover:bg-blue-500 active:scale-[0.98]"
                  >
                    ይግቡ
                  </Link>
                  <Link
                    href="/sign-up"
                    onClick={closeMenu}
                    className="inline-flex min-h-11 items-center justify-center rounded-xl bg-green-600 px-3 text-base font-black text-white shadow-[0_10px_24px_rgba(22,163,74,0.3)] transition hover:bg-green-500 active:scale-[0.98]"
                  >
                    ይመዝገቡ
                  </Link>
                </div>

                <div className="mt-auto rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-3">
                  <div className="flex items-center gap-2 text-[13px] font-black text-slate-300">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-xs text-white">
                      ET
                    </span>
                    አማርኛ
                  </div>
                </div>
              </>
            )}
          </nav>
        </div>
      </div>
    </>
  );
}