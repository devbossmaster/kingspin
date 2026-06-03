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
  const hasPassword = password.length > 0;
  const tone =
    strength.score <= 1
      ? {
          text: "text-red-400",
        }
      : strength.score === 2
        ? {
            text: "text-yellow-300",
          }
        : strength.score === 3
          ? {
              text: "text-sky-300",
            }
          : {
              text: "text-green-400",
            };

  return (
    <div aria-live="polite">
      <p
        className={clsx(
          "text-xs font-bold",
          hasPassword ? tone.text : "text-slate-400",
        )}
      >
        Password strength:{" "}
        <span className="font-black">
          {hasPassword ? strength.label : "Enter a password"}
        </span>
      </p>
    </div>
  );
}
