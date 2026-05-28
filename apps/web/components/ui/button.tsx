import { clsx } from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const variantClassName: Record<ButtonVariant, string> = {
  primary:
    "border-[var(--gold)] bg-[var(--gold)] text-[var(--bg-void)] shadow-[var(--glow-gold)] hover:bg-[#FFD76A]",
  secondary:
    "border-[rgba(45,212,191,0.45)] bg-[rgba(45,212,191,0.12)] text-teal hover:bg-[rgba(45,212,191,0.18)]",
  danger:
    "border-[rgba(248,113,113,0.55)] bg-[rgba(248,113,113,0.14)] text-red-hot hover:bg-[rgba(248,113,113,0.22)]",
  ghost:
    "border-[var(--border)] bg-transparent text-text-secondary hover:border-[var(--border-glow)] hover:text-text-primary",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  children: ReactNode;
};

export function Button({
  className,
  variant = "primary",
  type = "button",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={clsx(
        "inline-flex min-h-10 items-center justify-center rounded-md border px-4 py-2 text-sm font-black transition disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-800 disabled:text-slate-500",
        variantClassName[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function buttonClassName(variant: ButtonVariant = "primary") {
  return clsx(
    "inline-flex min-h-10 items-center justify-center rounded-md border px-4 py-2 text-sm font-black transition",
    variantClassName[variant],
  );
}
