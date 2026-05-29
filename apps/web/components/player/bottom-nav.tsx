"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Shield, Sparkles, UserRound, WalletCards } from "lucide-react";
import { clsx } from "clsx";

const ADMIN_ROLES = new Set([
  "OWNER",
  "SUPER_ADMIN",
  "ADMIN",
  "SUPPORT",
  "FINANCE",
  "RISK",
  "VIEWER",
]);

export function isAdminRole(role: string | null | undefined) {
  return Boolean(role && ADMIN_ROLES.has(role));
}

export function BottomNav({ role }: { role?: string | null }) {
  const pathname = usePathname();
  const items = [
    { href: "/", label: "Home", icon: Home },
    { href: "/spinpro", label: "Play", icon: Sparkles },
    { href: "/wallet", label: "Wallet", icon: WalletCards },
    { href: "/profile", label: "Profile", icon: UserRound },
  ];

  if (isAdminRole(role)) {
    items.push({ href: "/admin", label: "Admin", icon: Shield });
  }

  return (
    <nav
      aria-label="Mobile"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[rgba(8,12,20,0.94)] px-2 pb-[calc(env(safe-area-inset-bottom)+0.35rem)] pt-2 shadow-[0_-12px_32px_rgba(0,0,0,0.35)] backdrop-blur-xl md:hidden"
    >
      <div
        className="mx-auto grid max-w-md gap-1"
        style={{
          gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`,
        }}
      >
        {items.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "flex min-h-12 flex-col items-center justify-center gap-1 rounded-md px-2 text-[11px] font-black transition",
                active
                  ? "bg-[rgba(246,197,71,0.14)] text-gold"
                  : "text-text-secondary hover:bg-white/[0.05] hover:text-text-primary",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
