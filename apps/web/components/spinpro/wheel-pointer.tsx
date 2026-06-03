export function WheelPointer() {
  return (
    <div
      className="pointer-events-none flex flex-col items-center"
      aria-hidden="true"
    >
      <div className="relative">
        <div className="absolute inset-0 rounded-full bg-white/30 blur-md" />

        <div className="relative flex h-10 w-10 items-center justify-center rounded-full border border-white/60 bg-white shadow-[0_0_26px_rgba(255,255,255,0.38)]">
          <div className="h-4.5 w-4.5 rounded-full bg-slate-950" />
        </div>
      </div>

      <div className="-mt-1 h-0 w-0 border-x-[14px] border-t-[24px] border-x-transparent border-t-white drop-shadow-[0_6px_12px_rgba(0,0,0,0.45)]" />
      <div className="-mt-[22px] h-0 w-0 border-x-[8px] border-t-[14px] border-x-transparent border-t-slate-950" />
    </div>
  );
}