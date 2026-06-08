import { Copy, Eye, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { AdminRecord } from "../../lib/admin-api";
import { adminShortId, adminText } from "../../lib/admin-formatters";

export type AdminColumn = {
  key: string;
  label: string;
  className?: string;
  render?: (row: AdminRecord) => ReactNode;
};

export type AdminRowAction = {
  label: string;
  icon: LucideIcon;
  tone?: "default" | "danger";
  onClick: () => void;
};

export function AdminDataTable({
  rows,
  columns,
  actions,
  onDetails,
}: {
  rows: AdminRecord[];
  columns: AdminColumn[];
  actions?: (row: AdminRecord) => AdminRowAction[];
  onDetails: (row: AdminRecord) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-white/10 bg-[#0d1821] shadow-[0_20px_60px_rgba(0,0,0,0.2)]">
      <table className="w-full min-w-[900px] table-fixed border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-[#111e28]">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={`border-b border-white/10 px-3 py-3 text-[11px] font-black uppercase text-slate-500 ${column.className ?? ""}`}
              >
                {column.label}
              </th>
            ))}
            <th className="w-36 border-b border-white/10 px-3 py-3 text-right text-[11px] font-black uppercase text-slate-500">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-white/[0.06] transition last:border-b-0 hover:bg-white/[0.04]"
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`overflow-hidden px-3 py-3 text-sm text-slate-300 ${column.className ?? ""}`}
                >
                  {column.render
                    ? column.render(row)
                    : adminText(row[column.key])}
                </td>
              ))}
              <td className="px-3 py-3">
                <div className="flex justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard.writeText(row.id)}
                    aria-label={`Copy ${adminShortId(row.id)}`}
                    title="Copy ID"
                    className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 text-slate-400 hover:border-sky-400/40 hover:text-sky-300"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDetails(row)}
                    aria-label="View details"
                    title="View details"
                    className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 text-slate-400 hover:border-emerald-400/40 hover:text-emerald-300"
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                  {(actions?.(row) ?? []).map((action) => {
                    const Icon = action.icon;
                    return (
                      <button
                        key={action.label}
                        type="button"
                        onClick={action.onClick}
                        aria-label={action.label}
                        title={action.label}
                        className={`grid h-8 w-8 place-items-center rounded-lg border ${
                          action.tone === "danger"
                            ? "border-red-400/20 text-red-300 hover:bg-red-400/10"
                            : "border-white/10 text-slate-400 hover:border-amber-300/40 hover:text-amber-200"
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </button>
                    );
                  })}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
