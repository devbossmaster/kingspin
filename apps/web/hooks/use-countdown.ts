"use client";

import { useEffect, useMemo, useState } from "react";

export function useCountdown({
  locksAt,
  serverNow,
  enabled = true,
}: {
  locksAt: string | null | undefined;
  serverNow: string | null | undefined;
  enabled?: boolean;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 250);

    return () => window.clearInterval(interval);
  }, []);

  const serverOffsetMs = useMemo(() => {
    if (!serverNow) {
      return 0;
    }

    const parsedServerNow = new Date(serverNow).getTime();

    return Number.isFinite(parsedServerNow) ? parsedServerNow - Date.now() : 0;
  }, [serverNow]);

  const msLeft = useMemo(() => {
    if (!enabled || !locksAt) {
      return 0;
    }

    const lockTimeMs = new Date(locksAt).getTime();

    if (!Number.isFinite(lockTimeMs)) {
      return 0;
    }

    return Math.max(0, lockTimeMs - (nowMs + serverOffsetMs));
  }, [enabled, locksAt, nowMs, serverOffsetMs]);

  return { msLeft, serverOffsetMs };
}
