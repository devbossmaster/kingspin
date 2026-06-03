"use client";

import Link from "next/link";
import { useState, useRef, useEffect } from "react";
import { User, LogOut, Coins, Settings } from "lucide-react";
import { useSession } from "../../lib/auth-client";
import { useAuthStore } from "../../stores/auth-store";
import { signOut } from "../../lib/auth-client";
import { formatCoins } from "../../lib/format";

export function UserDropdown() {
  const { data: session, refetch } = useSession();
  const user = useAuthStore((store) => store.user);
  const wallet = useAuthStore((store) => store.wallet);
  const clear = useAuthStore((store) => store.clear);

  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleSignOut() {
    setIsOpen(false);
    await signOut();
    clear();
    await refetch();
  }

  // If not logged in, show standard login button
  if (!session?.user) {
    return (
      <Link
        href="/sign-in"
        className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-bold text-white transition hover:bg-white/10"
      >
        Sign in
      </Link>
    );
  }

  const displayName = user?.username ?? session.user.name ?? "User";
  const balanceLabel = wallet ? formatCoins(wallet.balanceSnapshot) : "0";
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <div className="relative shrink-0" ref={dropdownRef}>
      {/* User Avatar Button */}
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center gap-2 rounded-full border border-white/10 bg-black/40 p-1 pl-1.5 transition hover:border-white/30 hover:bg-white/5"
      >
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 bg-[linear-gradient(135deg,#38bdf8,#22c55e)] text-xs font-black text-black"
          aria-hidden="true"
        >
          {initials || "U"}
        </span>
        <span className="hidden sm:block text-xs font-bold text-white/80">
          {displayName}
        </span>
        <span className="hidden sm:flex items-center gap-1 bg-white/5 px-1.5 py-0.5 rounded-md text-[10px] font-bold text-[#F59E0B]">
          <Coins className="h-3 w-3" />
          {balanceLabel}
        </span>
      </button>

      {/* Dropdown Menu */}
      <div
        className={`absolute right-0 top-full mt-2 w-48 origin-top-right transform rounded-xl border border-white/10 bg-[#15171b] p-1.5 shadow-2xl transition-all duration-200 ${
          isOpen
            ? "visible scale-100 opacity-100"
            : "invisible scale-95 opacity-0"
        }`}
      >
        {/* User Info Header */}
        <div className="border-b border-white/5 pb-2 px-2 pt-1.5">
          <p className="text-sm font-bold text-white">{displayName}</p>
          <p className="text-[10px] text-white/50">{session.user.email}</p>
          <div className="mt-1 flex items-center gap-1.5 text-[10px] font-bold text-[#F59E0B]">
            <Coins className="h-3 w-3" />
            {balanceLabel}
          </div>
        </div>

        {/* Navigation Links */}
        <div className="mt-1 flex flex-col gap-0.5">
          <Link
            href="/profile"
            onClick={() => setIsOpen(false)}
            className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-white/70 transition hover:bg-white/5 hover:text-white"
          >
            <User className="h-4 w-4" /> Profile
          </Link>
          <Link
            href="/wallet"
            onClick={() => setIsOpen(false)}
            className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-white/70 transition hover:bg-white/5 hover:text-white"
          >
            <Coins className="h-4 w-4" /> Wallet
          </Link>
          <Link
            href="/settings"
            onClick={() => setIsOpen(false)}
            className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-white/70 transition hover:bg-white/5 hover:text-white"
          >
            <Settings className="h-4 w-4" /> Settings
          </Link>
        </div>

        {/* Sign Out Action */}
        <div className="mt-1 border-t border-white/5 pt-1">
          <button
            onClick={handleSignOut}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm font-bold text-red-400/80 transition hover:bg-red-500/10 hover:text-red-400"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
