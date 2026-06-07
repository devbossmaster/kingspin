"use client";

import { AdminResourcePage } from "../../../components/admin/admin-resource-page";
import { adminApi } from "../../../lib/admin-api";
import {
  adminDate,
  adminShortId,
  adminText,
} from "../../../lib/admin-formatters";

export default function AdminAuditPage() {
  return (
    <AdminResourcePage
      title="Audit Log"
      eyebrow="Read only"
      load={adminApi.audit}
      columns={[
        { key: "createdAt", label: "Time", render: (row) => adminDate(row.createdAt) },
        {
          key: "actor",
          label: "Actor",
          render: (row) => (
            <div>
              <p className="font-black text-white">{adminText(row.actor)}</p>
              <p className="text-xs text-slate-500">{adminText(row.actorEmail)}</p>
            </div>
          ),
        },
        { key: "action", label: "Action", render: (row) => adminText(row.action).replaceAll("_", " ") },
        { key: "targetType", label: "Target" },
        { key: "targetId", label: "Target ID", render: (row) => adminShortId(row.targetId) },
        {
          key: "summary",
          label: "Summary",
          render: (row) => <p className="line-clamp-2 text-xs">{adminText(row.summary)}</p>,
        },
      ]}
    />
  );
}
