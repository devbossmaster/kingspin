"use client";

import type { ReactNode } from "react";
import { NavBar } from "../layout/nav-bar";
import { BottomNav } from "./bottom-nav";
import { useAuthStore } from "../../stores/auth-store";

export function GameShell({
  children,
  backHref,
  className = "",
}: {
  children: ReactNode;
  backHref?: string;
  className?: string;
}) {
  const user = useAuthStore((store) => store.user);

  return (
    <main
      className={`min-h-screen w-full max-w-[100vw] overflow-x-hidden pb-24 text-text-primary md:pb-0 ${className}`}
    >
      <NavBar backHref={backHref} />
      {children}
      <BottomNav role={user?.role} />
    </main>
  );
}
