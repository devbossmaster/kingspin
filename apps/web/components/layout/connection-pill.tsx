"use client";

import { useEffect, useState } from "react";
import { useRoomStore, type ConnectionStatus } from "../../stores/room-store";

const statusCopy: Record<
  ConnectionStatus,
  { label: string; tone: string; dot: string }
> = {
  connected: {
    label: "Connected",
    tone: "border-[rgba(74,222,128,0.36)] bg-[rgba(74,222,128,0.12)] text-green-go",
    dot: "bg-green-go",
  },
  connecting: {
    label: "Connecting",
    tone: "border-[rgba(246,197,71,0.36)] bg-[rgba(246,197,71,0.12)] text-gold",
    dot: "bg-gold",
  },
  disconnected: {
    label: "Disconnected",
    tone: "border-[rgba(248,113,113,0.42)] bg-[rgba(248,113,113,0.12)] text-red-hot",
    dot: "bg-red-hot",
  },
};

export function ConnectionPill() {
  const status = useRoomStore((store) => store.connectionStatus);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    setHidden(false);

    if (status !== "connected") {
      return;
    }

    const timeout = window.setTimeout(() => setHidden(true), 1800);

    return () => window.clearTimeout(timeout);
  }, [status]);

  if (hidden) {
    return null;
  }

  const copy = statusCopy[status];

  return (
    <div
      className={`fixed bottom-4 left-4 z-40 inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-bold shadow-xl backdrop-blur ${copy.tone}`}
      role="status"
      aria-live="polite"
    >
      <span className={`h-2 w-2 rounded-full ${copy.dot}`} aria-hidden="true" />
      <span>{copy.label}</span>
    </div>
  );
}
