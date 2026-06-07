"use client";

import { CircleStop, Pause, Play } from "lucide-react";
import { AdminResourcePage } from "../../../components/admin/admin-resource-page";
import { AdminStatusBadge } from "../../../components/admin/admin-status-badge";
import { adminApi } from "../../../lib/admin-api";
import {
  adminAmount,
  adminRelativeDate,
  adminText,
} from "../../../lib/admin-formatters";

function nested(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export default function AdminRoomsPage() {
  return (
    <AdminResourcePage
      title="Rooms"
      eyebrow="Game operations"
      load={adminApi.rooms}
      statuses={["DRAFT", "ACTIVE", "PAUSED", "MAINTENANCE", "CLOSED", "ARCHIVED"]}
      columns={[
        {
          key: "code",
          label: "Room",
          render: (row) => (
            <div>
              <p className="font-black text-white">{adminText(row.code)}</p>
              <p className="truncate text-xs text-slate-500">{adminText(row.name)}</p>
            </div>
          ),
        },
        {
          key: "category",
          label: "Arena",
          render: (row) => adminText(nested(row.category).name),
        },
        {
          key: "status",
          label: "Status",
          render: (row) => <AdminStatusBadge value={row.status} />,
        },
        {
          key: "round",
          label: "Current round",
          render: (row) => {
            const round = nested(row.currentRound);
            return round.id ? (
              <div>
                <p className="font-mono text-white">#{adminText(round.roundNumber)}</p>
                <div className="mt-1"><AdminStatusBadge value={round.status} /></div>
              </div>
            ) : "-";
          },
        },
        {
          key: "players",
          label: "Players",
          render: (row) => adminText(nested(row.currentRound).playersCount, "0"),
        },
        {
          key: "pool",
          label: "Pool",
          render: (row) => adminAmount(nested(row.currentRound).poolAmount),
        },
        {
          key: "next",
          label: "Next event",
          render: (row) => {
            const value = nested(row.currentRound).locksAt;
            return <span title={adminText(value)}>{adminRelativeDate(value)}</span>;
          },
        },
        {
          key: "lastActivityAt",
          label: "Last activity",
          render: (row) => (
            <span title={adminText(row.lastActivityAt)}>
              {adminRelativeDate(row.lastActivityAt)}
            </span>
          ),
        },
      ]}
      actions={(row, open) => {
        const status = adminText(row.status);
        const isPermanent = Boolean(row.isPermanent);
        const result = [];
        if (status !== "ACTIVE") {
          result.push({
            label: "Activate room",
            icon: Play,
            onClick: () =>
              open({
                label: "Activate room",
                title: `Activate ${adminText(row.code)}`,
                description: "The room will accept normal round-machine operation.",
                confirmLabel: "Activate",
                run: () => adminApi.activateRoom(row.id),
              }),
          });
        }
        if (status === "ACTIVE" && !isPermanent) {
          result.push({
            label: "Pause room",
            icon: Pause,
            onClick: () =>
              open({
                label: "Pause room",
                title: `Pause ${adminText(row.code)}`,
                description: "The room will stop accepting new operational activity.",
                confirmLabel: "Pause",
                run: () => adminApi.pauseRoom(row.id),
              }),
          });
          result.push({
            label: "Close room",
            icon: CircleStop,
            tone: "danger" as const,
            onClick: () =>
              open({
                label: "Close room",
                title: `Close ${adminText(row.code)}`,
                description: "The room will be moved to the closed state.",
                confirmLabel: "Close",
                run: () => adminApi.closeRoom(row.id),
              }),
          });
        }
        return result;
      }}
    />
  );
}
