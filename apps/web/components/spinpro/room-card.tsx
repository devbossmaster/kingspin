import Link from "next/link";
import type { RoomListItem } from "../../lib/api-client";
import { Badge } from "../ui/badge";

export function RoomCard({
  room,
  categorySlug,
}: {
  room: RoomListItem;
  categorySlug: string;
}) {
  return (
    <Link
      href={`/spinpro/${categorySlug}/${room.id}`}
      className="group rounded-lg border border-[var(--border)] bg-white/[0.04] p-4 transition hover:border-[var(--border-glow)] hover:bg-white/[0.07]"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-teal">{room.code}</p>
          <h3 className="mt-1 font-display text-lg font-black">
            {room.name ?? "SpinPro Room"}
          </h3>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Badge variant="success">{room.status}</Badge>
          {room.isPermanent ? <Badge variant="locked">Permanent</Badge> : null}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2 text-sm text-text-secondary">
        <div>
          <p className="text-xs text-text-dim">Max players</p>
          <p className="font-mono font-bold text-text-primary">{room.maxPlayers}</p>
        </div>
        <div>
          <p className="text-xs text-text-dim">Round</p>
          <p className="font-mono font-bold text-text-primary">
            {Math.round(room.roundDurationMs / 1000)}s
          </p>
        </div>
      </div>

      <div className="mt-5 inline-flex rounded-md bg-[var(--gold)] px-3 py-2 text-sm font-black text-[var(--bg-void)]">
        Join Room
      </div>
    </Link>
  );
}
