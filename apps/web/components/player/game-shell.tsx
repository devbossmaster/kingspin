"use client";

import type { ReactNode } from "react";
import { NavBar } from "../layout/nav-bar";

export function GameShell({
  children,
  backHref,
  className = "",
}: {
  children: ReactNode;
  backHref?: string;
  className?: string;
}) {
  return (
    <main
      className={`pb-safe-bottom-nav min-h-screen w-full max-w-[100vw] overflow-x-hidden text-text-primary md:pb-0 ${className}`}
    >
      <NavBar backHref={backHref} />
      {children}
    </main>
  );
}
