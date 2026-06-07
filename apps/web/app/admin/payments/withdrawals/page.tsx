"use client";

import { CircleCheck, CircleX, ShieldCheck } from "lucide-react";
import { AdminResourcePage } from "../../../../components/admin/admin-resource-page";
import { AdminStatusBadge } from "../../../../components/admin/admin-status-badge";
import { adminApi } from "../../../../lib/admin-api";
import {
  adminAmount,
  adminDate,
  adminShortId,
  adminText,
} from "../../../../lib/admin-formatters";

export default function AdminWithdrawalsPage() {
  return (
    <AdminResourcePage
      title="Withdrawals"
      eyebrow="Manual payouts"
      load={adminApi.withdrawals}
      statuses={[
        "PENDING_REVIEW",
        "APPROVED",
        "PROCESSING",
        "PAID",
        "COMPLETED",
        "REJECTED",
        "FAILED",
        "CANCELLED",
      ]}
      columns={[
        {
          key: "createdAt",
          label: "Created",
          render: (row) => adminDate(row.createdAt),
        },
        {
          key: "player",
          label: "Player",
          render: (row) => (
            <div>
              <p className="font-black text-white">{adminText(row.player)}</p>
              <p className="text-xs text-slate-500">{adminText(row.email)}</p>
            </div>
          ),
        },
        {
          key: "amount",
          label: "Amount",
          render: (row) => adminAmount(row.amount, row.currency),
        },
        {
          key: "status",
          label: "Status",
          render: (row) => <AdminStatusBadge value={row.status} />,
        },
        { key: "destinationType", label: "Destination" },
        {
          key: "destination",
          label: "Masked details",
          render: (row) => (
            <p
              className="truncate font-mono text-xs"
              title={JSON.stringify(row.destination)}
            >
              {JSON.stringify(row.destination)}
            </p>
          ),
        },
        {
          key: "externalReference",
          label: "External ref",
          render: (row) => adminShortId(row.externalReference),
        },
        {
          key: "completedAt",
          label: "Completed / rejected",
          render: (row) => (
            <div>
              <p>{adminDate(row.completedAt)}</p>
              <p className="line-clamp-1 text-xs text-slate-500">
                {adminText(row.rejectionReason)}
              </p>
            </div>
          ),
        },
        {
          key: "riskStatus",
          label: "Risk",
          render: (row) => <AdminStatusBadge value={row.riskStatus} />,
        },
      ]}
      actions={(row, open) => {
        const status = adminText(row.status);
        const result = [];
        if (status === "PENDING_REVIEW") {
          result.push({
            label: "Approve withdrawal",
            icon: ShieldCheck,
            onClick: () =>
              open({
                label: "Approve withdrawal",
                title: `Approve withdrawal ${adminShortId(row.id)}`,
                description:
                  "Approve this request for a separate manual payout. No automatic Telebirr transfer will be initiated.",
                confirmLabel: "Approve",
                run: () => adminApi.approveWithdrawal(row.id),
              }),
          });
        }
        if (["APPROVED", "PROCESSING"].includes(status)) {
          result.push({
            label: "Complete withdrawal",
            icon: CircleCheck,
            onClick: () =>
              open({
                label: "Complete withdrawal",
                title: `Complete withdrawal ${adminShortId(row.id)}`,
                description:
                  "Confirm the manual payout only after Telebirr transfer completion.",
                confirmLabel: "Mark completed",
                inputLabel: "External reference",
                validate: (value) =>
                  value.trim() ? null : "External reference is required.",
                run: (value) =>
                  adminApi.completeWithdrawal(row.id, value.trim()),
              }),
          });
        }
        if (["PENDING_REVIEW", "APPROVED"].includes(status)) {
          result.push({
            label: "Reject withdrawal",
            icon: CircleX,
            tone: "danger" as const,
            onClick: () =>
              open({
                label: "Reject withdrawal",
                title: `Reject withdrawal ${adminShortId(row.id)}`,
                description:
                  "The backend will refund the reserved amount through the ledger.",
                confirmLabel: "Reject",
                inputLabel: "Rejection reason",
                validate: (value) =>
                  value.trim() ? null : "Rejection reason is required.",
                run: (value) => adminApi.rejectWithdrawal(row.id, value.trim()),
              }),
          });
        }
        return result;
      }}
    />
  );
}
