"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GameShell } from "../../components/player/game-shell";
import { Button } from "../../components/ui/button";
import { useSession } from "../../lib/auth-client";
import { useAuthStore } from "../../stores/auth-store";

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-white/[0.04] px-4 py-3">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-text-dim">
        {label}
      </p>
      <p className="mt-1 break-all text-text-primary">{value}</p>
    </div>
  );
}

export default function ProfilePage() {
  const { data: session, isPending } = useSession();
  const user = useAuthStore((store) => store.user);
  const fetchMe = useAuthStore((store) => store.fetchMe);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session?.user) return;

    void (async () => {
      const result = await fetchMe();

      if (!result) {
        setError(
          "Profile unavailable until the API auth bridge validates this session.",
        );
      } else {
        setError(null);
      }
    })();
  }, [fetchMe, session?.user]);

  return (
    <GameShell backHref="/spinpro">
      <div className="mx-auto max-w-4xl px-4 py-8 md:px-8">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-gold">
          Profile
        </p>
        <h1 className="mt-2 font-display text-4xl font-black">Account</h1>

        {!isPending && !session?.user ? (
          <div className="arcadia-surface mt-6 rounded-lg p-5">
            <p className="text-text-secondary">Sign in to view your profile.</p>
            <Link
              href="/sign-in?callbackURL=/profile"
              className="mt-4 inline-flex rounded-md bg-[var(--gold)] px-4 py-2 font-black text-[var(--bg-void)]"
            >
              Sign In
            </Link>
          </div>
        ) : (
          <section className="arcadia-surface mt-6 rounded-lg p-6">
            {error ? (
              <div className="mb-5 rounded-md border border-[rgba(248,113,113,0.42)] bg-[rgba(248,113,113,0.12)] px-4 py-3 text-sm text-red-hot">
                {error}
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-2">
              <ProfileRow label="Username" value={user?.username ?? "-"} />
              <ProfileRow
                label="Email"
                value={user?.email ?? session?.user.email ?? "-"}
              />
              <ProfileRow
                label="Full name"
                value={user?.fullName ?? session?.user.name ?? "-"}
              />
              <ProfileRow
                label="Email verified"
                value={String(
                  user?.emailVerified ?? session?.user.emailVerified ?? false,
                )}
              />
              <ProfileRow label="Role" value={user?.role ?? "-"} />
            </div>

            <Button className="mt-5" onClick={() => void fetchMe()}>
              Refresh Profile
            </Button>
          </section>
        )}
      </div>
    </GameShell>
  );
}
