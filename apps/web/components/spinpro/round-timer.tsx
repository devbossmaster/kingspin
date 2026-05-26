"use client";

import { useEffect, useMemo, useState } from "react";

type RoundTimerProps = {
  status: string | null | undefined;
  serverNow: string;
  locksAt: string | null | undefined;
};

export function RoundTimer({ status, serverNow, locksAt }: RoundTimerProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 250);

    return () => window.clearInterval(interval);
  }, []);

  const serverOffsetMs = useMemo(() => {
    const parsedServerNow = new Date(serverNow).getTime();

    if (!Number.isFinite(parsedServerNow)) {
      return 0;
    }

    return parsedServerNow - Date.now();
  }, [serverNow]);

  const msUntilLock = useMemo(() => {
    if (status !== "OPEN" || !locksAt) {
      return 0;
    }

    const lockTimeMs = new Date(locksAt).getTime();

    if (!Number.isFinite(lockTimeMs)) {
      return 0;
    }

    const estimatedServerNowMs = nowMs + serverOffsetMs;

    return Math.max(0, lockTimeMs - estimatedServerNowMs);
  }, [locksAt, nowMs, serverOffsetMs, status]);

  const seconds = Math.ceil(msUntilLock / 1000);
  const progress = Math.max(0, Math.min(1, msUntilLock / 45_000));

  if (status !== "OPEN") {
    return (
      <div>
        <p className="mt-1 text-2xl font-bold">-</p>
        <p className="text-sm text-slate-400">Round is {status ?? "inactive"}</p>
      </div>
    );
  }

  return (
    <div>
      <p className="mt-1 text-2xl font-bold">{seconds}s</p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full rounded-full bg-yellow-400 transition-[width] duration-200"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      <p className="mt-2 text-sm text-slate-400">
        Server clock synced
      </p>
    </div>
  );
}
