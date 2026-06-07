"use client";

import { UserCheck, UserX } from "lucide-react";
import { AdminResourcePage } from "../../../components/admin/admin-resource-page";
import { AdminStatusBadge } from "../../../components/admin/admin-status-badge";
import { adminApi } from "../../../lib/admin-api";
import {
  adminAmount,
  adminDate,
  adminText,
} from "../../../lib/admin-formatters";

export default function AdminPlayersPage() {
  return (
    <AdminResourcePage
      title="Players"
      eyebrow="Accounts"
      load={adminApi.players}
      statuses={["ACTIVE", "SUSPENDED"]}
      columns={[
        {
          key: "username",
          label: "Player",
          render: (row) => (
            <div>
              <p className="truncate font-black text-white">{adminText(row.username)}</p>
              <p className="truncate text-xs text-slate-500">{adminText(row.email)}</p>
            </div>
          ),
        },
        { key: "joinedAt", label: "Joined", render: (row) => adminDate(row.joinedAt) },
        { key: "balance", label: "Balance", render: (row) => adminAmount(row.balance) },
        { key: "entriesCount", label: "Entries" },
        {
          key: "deposits",
          label: "Deposits",
          render: (row) => (
            <div>
              <p>{adminAmount(row.depositsAmount)}</p>
              <p className="text-xs text-slate-500">{adminText(row.depositsCount, "0")} records</p>
            </div>
          ),
        },
        {
          key: "withdrawals",
          label: "Withdrawals",
          render: (row) => (
            <div>
              <p>{adminAmount(row.withdrawalsAmount)}</p>
              <p className="text-xs text-slate-500">{adminText(row.withdrawalsCount, "0")} records</p>
            </div>
          ),
        },
        {
          key: "riskStatus",
          label: "Risk",
          render: (row) => <AdminStatusBadge value={row.riskStatus} />,
        },
        {
          key: "accountStatus",
          label: "Account",
          render: (row) => <AdminStatusBadge value={row.accountStatus} />,
        },
      ]}
      actions={(row, open) =>
        row.accountStatus === "SUSPENDED"
          ? [
              {
                label: "Restore player",
                icon: UserCheck,
                onClick: () =>
                  open({
                    label: "Restore player",
                    title: `Restore ${adminText(row.username)}`,
                    description: "The player account will be allowed to authenticate again.",
                    confirmLabel: "Restore",
                    run: () => adminApi.restorePlayer(row.id),
                  }),
              },
            ]
          : [
              {
                label: "Suspend player",
                icon: UserX,
                tone: "danger",
                onClick: () =>
                  open({
                    label: "Suspend player",
                    title: `Suspend ${adminText(row.username)}`,
                    description: "The player account will be blocked from active use.",
                    confirmLabel: "Suspend",
                    run: () => adminApi.suspendPlayer(row.id),
                  }),
              },
            ]
      }
    />
  );
}
