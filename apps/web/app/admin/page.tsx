"use client";

import { FormEvent, useState } from "react";
import { NavBar } from "../../components/layout/nav-bar";
import { Button } from "../../components/ui/button";
import { apiClient, type AdminRoomCommand } from "../../lib/api-client";

type AdminAction =
  | "status"
  | "start"
  | "stop"
  | "advance"
  | "activate"
  | "pause"
  | "close";

export default function AdminPage() {
  const [adminKey, setAdminKey] = useState("");
  const [roomId, setRoomId] = useState("");
  const [force, setForce] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  async function runAction(action: AdminAction) {
    setIsRunning(true);
    setError(null);
    setResult(null);

    try {
      if (!adminKey.trim()) {
        throw new Error("Admin key is required.");
      }

      if (!roomId.trim()) {
        throw new Error("Room ID is required.");
      }

      let nextResult: unknown;

      if (action === "status") {
        nextResult = await apiClient.admin.getMachineStatus(roomId, adminKey);
      } else if (action === "start") {
        nextResult = await apiClient.admin.startMachine(roomId, adminKey);
      } else if (action === "stop") {
        nextResult = await apiClient.admin.stopMachine(roomId, adminKey);
      } else if (action === "advance") {
        nextResult = await apiClient.admin.advanceOnce(roomId, adminKey, force);
      } else {
        nextResult = await apiClient.admin.updateRoomStatus(
          roomId,
          action as AdminRoomCommand,
          adminKey,
        );
      }

      setResult(nextResult);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Admin action failed.");
    } finally {
      setIsRunning(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  return (
    <main className="min-h-screen text-text-primary">
      <NavBar backHref="/spinpro" />

      <div className="mx-auto max-w-4xl px-4 py-8 md:px-8">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-gold">
          Admin Utility
        </p>
        <h1 className="mt-2 font-display text-4xl font-black">Room Machine</h1>
        <p className="mt-3 text-sm text-text-secondary">
          Enter the admin key manually for this session. The key is never stored.
        </p>

        <form onSubmit={handleSubmit} className="arcadia-surface mt-6 rounded-lg p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-semibold text-text-secondary">
              Admin key
              <input
                value={adminKey}
                onChange={(event) => setAdminKey(event.target.value)}
                type="password"
                className="mt-2 w-full rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-3 text-text-primary"
              />
            </label>

            <label className="block text-sm font-semibold text-text-secondary">
              Room ID
              <input
                value={roomId}
                onChange={(event) => setRoomId(event.target.value)}
                className="mt-2 w-full rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-3 font-mono text-text-primary"
              />
            </label>
          </div>

          <label className="mt-4 flex items-center gap-2 text-sm text-text-secondary">
            <input
              checked={force}
              onChange={(event) => setForce(event.target.checked)}
              type="checkbox"
              className="h-4 w-4 accent-[var(--gold)]"
            />
            Force advance once
          </label>

          <div className="mt-5 flex flex-wrap gap-2">
            {(["status", "start", "stop", "advance"] as const).map((action) => (
              <Button
                key={action}
                variant={action === "stop" ? "danger" : "secondary"}
                disabled={isRunning}
                onClick={() => void runAction(action)}
              >
                {action}
              </Button>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {(["activate", "pause", "close"] as const).map((action) => (
              <Button
                key={action}
                variant={action === "close" ? "danger" : "ghost"}
                disabled={isRunning}
                onClick={() => void runAction(action)}
              >
                {action} room
              </Button>
            ))}
          </div>
        </form>

        {error ? (
          <div className="mt-5 rounded-md border border-[rgba(248,113,113,0.42)] bg-[rgba(248,113,113,0.12)] px-4 py-3 text-sm text-red-hot">
            {error}
          </div>
        ) : null}

        {result ? (
          <pre className="mt-5 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4 font-mono text-xs text-text-secondary">
            {JSON.stringify(result, null, 2)}
          </pre>
        ) : null}
      </div>
    </main>
  );
}
