"use client";

import { useEffect } from "react";
import { Toaster } from "sonner";
import { toastGameError } from "../../lib/error-toast";

export function GameToaster() {
  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      toastGameError(event.reason, "Something went wrong. Please try again.");
    };

    const handleWindowError = (event: ErrorEvent) => {
      toastGameError(
        event.error ?? event.message,
        "Something unexpected happened. Please try again.",
      );
    };

    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    window.addEventListener("error", handleWindowError);

    return () => {
      window.removeEventListener(
        "unhandledrejection",
        handleUnhandledRejection,
      );
      window.removeEventListener("error", handleWindowError);
    };
  }, []);

  return (
    <Toaster
      closeButton
      richColors
      position="top-center"
      theme="dark"
      toastOptions={{
        className:
          "border border-white/10 bg-slate-950 text-white shadow-[0_18px_55px_rgba(0,0,0,0.38)]",
        descriptionClassName: "text-slate-300",
      }}
    />
  );
}
