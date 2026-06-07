"use client";

import { LoaderCircle, X } from "lucide-react";
import { Dialog } from "../ui/dialog";

export function AdminConfirmDialog({
  open,
  title,
  description,
  inputLabel,
  inputValue,
  onInput,
  confirmLabel,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  inputLabel?: string;
  inputValue: string;
  onInput: (value: string) => void;
  confirmLabel: string;
  busy: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} title={title} onClose={busy ? () => undefined : onClose}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-black text-white">{title}</h2>
          <p className="mt-2 text-sm text-slate-400">{description}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label="Close"
          title="Close"
          className="grid h-9 w-9 shrink-0 place-items-center border border-white/10 text-slate-400"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {inputLabel ? (
        <label className="mt-5 block">
          <span className="text-xs font-black uppercase text-slate-400">
            {inputLabel}
          </span>
          <textarea
            value={inputValue}
            onChange={(event) => onInput(event.target.value)}
            rows={3}
            className="mt-2 w-full resize-none border border-white/15 bg-[#071018] px-3 py-2 text-sm text-white outline-none focus:border-emerald-400"
          />
        </label>
      ) : null}
      {error ? <p className="mt-3 text-sm font-bold text-red-300">{error}</p> : null}
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="min-h-10 border border-white/10 px-4 text-sm font-black text-slate-300"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="inline-flex min-h-10 items-center gap-2 bg-emerald-400 px-4 text-sm font-black text-[#071018] disabled:opacity-50"
        >
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
