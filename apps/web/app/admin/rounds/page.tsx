"use client";

import { AdminResourcePage } from "../../../components/admin/admin-resource-page";
import { AdminStatusBadge } from "../../../components/admin/admin-status-badge";
import { adminApi } from "../../../lib/admin-api";
import {
  adminAmount,
  adminDate,
  adminDuration,
  adminShortId,
  adminText,
} from "../../../lib/admin-formatters";

export default function AdminRoundsPage() {
  return (
    <AdminResourcePage
      title="Rounds"
      eyebrow="Game history"
      load={adminApi.rounds}
      statuses={[
        "OPEN",
        "LOCKED",
        "DRAWING",
        "SPINNING",
        "SETTLING",
        "COMPLETED",
        "CANCELLED",
      ]}
      columns={[
        {
          key: "roundNumber",
          label: "Round",
          render: (row) => (
            <div>
              <p className="font-mono font-black text-white">
                #{adminText(row.roundNumber)}
              </p>
              <p className="text-xs text-slate-500">{adminText(row.room)}</p>
            </div>
          ),
        },
        {
          key: "status",
          label: "Status",
          render: (row) => <AdminStatusBadge value={row.status} />,
        },
        {
          key: "totalEntryAmount",
          label: "Entry total",
          render: (row) => adminAmount(row.totalEntryAmount),
        },
        {
          key: "payoutAmount",
          label: "Payout",
          render: (row) => adminAmount(row.payoutAmount),
        },
        { key: "entryCount", label: "Entries" },
        {
          key: "winnerUserId",
          label: "Winner",
          render: (row) => adminShortId(row.winnerUserId),
        },
        {
          key: "openedAt",
          label: "Opened / completed",
          render: (row) => (
            <div>
              <p>{adminDate(row.openedAt)}</p>
              <p className="text-xs text-slate-500">
                {adminDate(row.completedAt)}
              </p>
            </div>
          ),
        },
        {
          key: "durationMs",
          label: "Duration",
          render: (row) => adminDuration(row.durationMs),
        },
        {
          key: "fairness",
          label: "Fairness",
          render: (row) => (
            <div>
              <p className="font-mono text-xs">
                {adminShortId(row.fairnessAlgorithm)}
              </p>
              <p className="mt-1 font-mono text-xs text-slate-500">
                {adminShortId(row.entriesHash)}
              </p>
              <div className="mt-1">
                <AdminStatusBadge value={row.verificationStatus} />
              </div>
            </div>
          ),
        },
        {
          key: "riskStatus",
          label: "Risk",
          render: (row) => <AdminStatusBadge value={row.riskStatus} />,
        },
      ]}
    />
  );
}
