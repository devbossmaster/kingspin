"use client";

import { clsx } from "clsx";

export type PasswordStrength = {
  score: number;
  label: "Weak" | "Fair" | "Strong" | "Very Strong";
  isValid: boolean;
};

export function getPasswordStrength(password: string): PasswordStrength {
  let score = 0;

  if (password.length >= 8) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  const label =
    score <= 1
      ? "Weak"
      : score === 2
        ? "Fair"
        : score === 3
          ? "Strong"
          : "Very Strong";

  return {
    score,
    label,
    isValid: score === 4,
  };
}

export function PasswordStrengthMeter({ password }: { password: string }) {
  const strength = getPasswordStrength(password);

  return (
    <div className="space-y-2" aria-live="polite">
      <div className="grid grid-cols-4 gap-1">
        {[1, 2, 3, 4].map((step) => (
          <div
            key={step}
            className={clsx(
              "h-2 rounded-full bg-white/10 transition-colors",
              step <= strength.score &&
                (strength.score <= 1
                  ? "bg-red-400"
                  : strength.score === 2
                    ? "bg-amber-300"
                    : strength.score === 3
                      ? "bg-teal-300"
                      : "bg-emerald-300"),
            )}
          />
        ))}
      </div>
      <p className="text-xs font-semibold text-slate-300">
        Password strength: {strength.label}
      </p>
    </div>
  );
}
