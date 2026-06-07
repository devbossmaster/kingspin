import { AlertTriangle, Database } from "lucide-react";

export function AdminLoadingTable() {
  return (
    <div className="min-h-64 border border-white/10 bg-[#0d1821]">
      <div className="border-b border-white/10 px-4 py-3 text-xs font-black uppercase text-slate-500">
        Loading records
      </div>
      <div className="space-y-3 p-4">
        {Array.from({ length: 8 }, (_, index) => (
          <div
            key={index}
            className="grid animate-pulse gap-3 sm:grid-cols-[1.5fr_1fr_1fr_1fr_120px]"
          >
            <span className="h-4 bg-white/10" />
            <span className="h-4 bg-white/[0.07]" />
            <span className="h-4 bg-white/[0.07]" />
            <span className="h-4 bg-white/[0.07]" />
            <span className="h-4 bg-white/[0.05]" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function AdminEmptyState() {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center border border-dashed border-white/15 bg-[#0d1821] text-center">
      <Database className="h-6 w-6 text-slate-600" />
      <p className="mt-3 text-sm font-black text-slate-300">No records found</p>
    </div>
  );
}

export function AdminErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center border border-red-400/20 bg-red-400/[0.04] text-center">
      <AlertTriangle className="h-6 w-6 text-red-300" />
      <p className="mt-3 max-w-md text-sm font-bold text-red-200">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 min-h-9 border border-red-300/30 px-3 text-xs font-black text-red-200"
      >
        Retry
      </button>
    </div>
  );
}
