"use client";

import { AdminResourcePage } from "../../../components/admin/admin-resource-page";
import { AdminStatusBadge } from "../../../components/admin/admin-status-badge";
import { adminApi } from "../../../lib/admin-api";
import {
  adminAmount,
  adminDate,
  adminText,
} from "../../../lib/admin-formatters";

export default function AdminEntriesPage() {
  return (
    <AdminResourcePage
      title="Entries"
      eyebrow="Read only"
      load={adminApi.entries}
      statuses={["WINNER", "NON_WINNER"]}
      columns={[
        { key: "createdAt", label: "Created", render: (row) => adminDate(row.createdAt) },
        { key: "player", label: "Player", render: (row) => <span className="font-black text-white">{adminText(row.player)}</span> },
        { key: "room", label: "Room" },
        { key: "roundNumber", label: "Round", render: (row) => `#${adminText(row.roundNumber)}` },
        { key: "amount", label: "Amount", render: (row) => adminAmount(row.amount) },
        {
          key: "tickets",
          label: "Ticket range",
          render: (row) =>
            row.ticketStart && row.ticketEnd
              ? `${adminText(row.ticketStart)} - ${adminText(row.ticketEnd)}`
              : "-",
        },
        {
          key: "status",
          label: "Round status",
          render: (row) => <AdminStatusBadge value={row.status} />,
        },
        {
          key: "isWinner",
          label: "Result",
          render: (row) => <AdminStatusBadge value={row.isWinner ? "WINNER" : "NON_WINNER"} />,
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
