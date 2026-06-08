export function WheelPointer() {
  return (
    <div
      className="pointer-events-none flex flex-col items-center drop-shadow-[0_6px_10px_rgba(0,0,0,0.36)]"
      aria-hidden="true"
    >
      <div className="relative flex h-3.5 w-3.5 items-center justify-center rounded-full border border-amber-100/70 bg-[linear-gradient(145deg,#fff7bf,#facc15_58%,#b45309)] shadow-[0_0_10px_rgba(250,204,21,0.18)]">
        <div className="h-1 w-1 rounded-full bg-slate-950/90" />
      </div>

      <div className="-mt-0.5 h-0 w-0 border-x-[6px] border-t-[11px] border-x-transparent border-t-amber-200" />
      <div className="-mt-[10px] h-0 w-0 border-x-[3px] border-t-[6px] border-x-transparent border-t-slate-950/90" />
    </div>
  );
}
