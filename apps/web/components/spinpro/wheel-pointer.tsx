export function WheelPointer() {
  return (
    <div
      className="absolute top-4 z-10 flex flex-col items-center"
      aria-hidden="true"
    >
      <div className="rounded-full border border-[var(--border-glow)] bg-[var(--gold)] px-3 py-1 font-mono text-xs font-black text-[var(--bg-void)] shadow-[var(--glow-gold)]">
        POINTER
      </div>
      <div className="h-0 w-0 border-x-[9px] border-t-[18px] border-x-transparent border-t-[var(--gold)]" />
    </div>
  );
}
