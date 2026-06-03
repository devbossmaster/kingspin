"use client";

import { toast } from "sonner";
import { toHumanErrorMessage } from "./human-error";

let lastToastKey = "";
let lastToastAt = 0;

export function toastGameError(error: unknown, fallback?: string) {
  const message = toHumanErrorMessage(error, fallback);
  const now = Date.now();

  if (message === lastToastKey && now - lastToastAt < 2_000) {
    return message;
  }

  lastToastKey = message;
  lastToastAt = now;

  toast.error(message, {
    description: "You can keep playing once this clears.",
  });

  return message;
}
