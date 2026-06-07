"use client";

import { CheckCircle2, CircleX } from "lucide-react";
import { AdminResourcePage } from "../../../components/admin/admin-resource-page";
import { AdminStatusBadge } from "../../../components/admin/admin-status-badge";
import { adminApi } from "../../../lib/admin-api";
import {
  adminDate,
  adminShortId,
  adminText,
} from "../../../lib/admin-formatters";

export default function AdminRiskPage() {
  return (
    <AdminResourcePage
      title="Risk & Fraud"
      eyebrow="Review queue"
      load={adminApi.risk}
      statuses={["OPEN", "REVIEWED", "DISMISSED", "ACTIONED", "RESOLVED"]}
      extraFilters={[
        {
          key: "severity",
          label: "All severities",
          options: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
        },
        {
          key: "type",
          label: "All risk types",
          options: [
            "ENTRY_RATE_LIMIT_HIT",
            "DUPLICATE_IP_BETTING",
            "SAME_DEVICE_MULTI_ACCOUNT",
            "REPEATED_WINNER_ANOMALY",
            "MULTI_ACCOUNT_PATTERN",
            "DUPLICATE_PAYMENT_RECEIPT",
            "MANY_FAILED_RECEIPTS",
            "SUSPICIOUS_WITHDRAWAL",
            "WITHDRAWAL_AFTER_NEW_DEPOSIT",
            "DEPOSIT_WEBHOOK_MISMATCH",
          ],
        },
      ]}
      columns={[
        { key: "createdAt", label: "Created", render: (row) => adminDate(row.createdAt) },
        { key: "severity", label: "Severity", render: (row) => <AdminStatusBadge value={row.severity} /> },
        { key: "score", label: "Score" },
        { key: "type", label: "Type", render: (row) => adminText(row.type).replaceAll("_", " ") },
        { key: "player", label: "Player" },
        { key: "relatedEntity", label: "Related", render: (row) => adminShortId(row.relatedEntity) },
        { key: "evidenceCount", label: "Evidence" },
        { key: "status", label: "Status", render: (row) => <AdminStatusBadge value={row.status} /> },
        {
          key: "summary",
          label: "Summary",
          render: (row) => <p className="line-clamp-2 text-xs">{adminText(row.summary)}</p>,
        },
      ]}
      actions={(row, open) =>
        row.status === "OPEN"
          ? [
              {
                label: "Mark reviewed",
                icon: CheckCircle2,
                onClick: () =>
                  open({
                    label: "Mark reviewed",
                    title: `Review risk event ${adminShortId(row.id)}`,
                    description: "The event will remain available in the audit trail.",
                    confirmLabel: "Mark reviewed",
                    inputLabel: "Review note",
                    run: (note) => adminApi.reviewRisk(row.id, "REVIEWED", note),
                  }),
              },
              {
                label: "Resolve risk event",
                icon: CheckCircle2,
                onClick: () =>
                  open({
                    label: "Resolve risk event",
                    title: `Resolve risk event ${adminShortId(row.id)}`,
                    description: "Use this when the risk item has been investigated and closed.",
                    confirmLabel: "Resolve",
                    inputLabel: "Resolution note",
                    validate: (value) =>
                      value.trim().length > 0
                        ? null
                        : "A resolution note is required.",
                    run: (note) => adminApi.reviewRisk(row.id, "RESOLVED", note),
                  }),
              },
              {
                label: "Dismiss risk event",
                icon: CircleX,
                tone: "danger",
                onClick: () =>
                  open({
                    label: "Dismiss risk event",
                    title: `Dismiss risk event ${adminShortId(row.id)}`,
                    description: "The event will be closed as dismissed and audited.",
                    confirmLabel: "Dismiss",
                    inputLabel: "Dismissal note",
                    run: (note) => adminApi.reviewRisk(row.id, "DISMISSED", note),
                  }),
              },
            ]
          : []
      }
    />
  );
}
