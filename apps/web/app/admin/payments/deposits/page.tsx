"use client";

import { CircleCheck, CircleX } from "lucide-react";
import { AdminResourcePage } from "../../../../components/admin/admin-resource-page";
import { AdminStatusBadge } from "../../../../components/admin/admin-status-badge";
import { adminApi } from "../../../../lib/admin-api";
import {
  adminAmount,
  adminDate,
  adminShortId,
  adminText,
} from "../../../../lib/admin-formatters";

export default function AdminDepositsPage() {
  return (
    <AdminResourcePage
      title="Deposits"
      eyebrow="Payments"
      load={adminApi.deposits}
      statuses={["PENDING", "VERIFYING", "NEEDS_MANUAL_REVIEW", "CREDITED", "REJECTED", "FAILED", "EXPIRED"]}
      columns={[
        { key: "createdAt", label: "Created", render: (row) => adminDate(row.createdAt) },
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
        { key: "provider", label: "Provider" },
        { key: "expectedAmount", label: "Expected", render: (row) => adminAmount(row.expectedAmount, row.currency) },
        { key: "status", label: "Status", render: (row) => <AdminStatusBadge value={row.status} /> },
        {
          key: "reference",
          label: "Reference",
          render: (row) => (
            <div>
              <p className="font-mono text-xs">{adminShortId(row.receiptNo ?? row.providerReference)}</p>
              <p className="text-xs text-slate-500">{adminText(row.attemptsCount, "0")} attempts</p>
            </div>
          ),
        },
        {
          key: "verifiedAt",
          label: "Verified / credited",
          render: (row) => (
            <div>
              <p>{adminDate(row.verifiedAt)}</p>
              <p className="text-xs text-slate-500">{adminDate(row.creditedAt)}</p>
            </div>
          ),
        },
        {
          key: "reviewReason",
          label: "Review reason",
          render: (row) => (
            <p className="line-clamp-2 text-xs" title={adminText(row.reviewReason ?? row.rejectionReason)}>
              {adminText(row.reviewReason ?? row.rejectionReason)}
            </p>
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
        if (status === "NEEDS_MANUAL_REVIEW") {
          result.push({
            label: "Approve deposit",
            icon: CircleCheck,
            onClick: () =>
              open({
                label: "Approve deposit",
                title: `Approve deposit ${adminShortId(row.id)}`,
                description: "The ledger-safe backend flow will credit the verified amount.",
                confirmLabel: "Approve",
                inputLabel: "Admin note",
                validate: (value) => value.trim() ? null : "Admin note is required.",
                run: (value) => adminApi.approveDeposit(row.id, value.trim()),
              }),
          });
        }
        if (["PENDING", "VERIFYING", "NEEDS_MANUAL_REVIEW"].includes(status)) {
          result.push({
            label: "Reject deposit",
            icon: CircleX,
            tone: "danger" as const,
            onClick: () =>
              open({
                label: "Reject deposit",
                title: `Reject deposit ${adminShortId(row.id)}`,
                description: "The deposit will be rejected without direct wallet mutation.",
                confirmLabel: "Reject",
                inputLabel: "Rejection reason",
                validate: (value) => value.trim() ? null : "Rejection reason is required.",
                run: (value) => adminApi.rejectDeposit(row.id, value.trim()),
              }),
          });
        }
        return result;
      }}
    />
  );
}
