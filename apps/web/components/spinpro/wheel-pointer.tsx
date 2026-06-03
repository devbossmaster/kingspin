export function WheelPointer() {
  return (
    <div
      className="pointer-events-none flex flex-col items-center drop-shadow-[0_8px_14px_rgba(0,0,0,0.42)]"
      aria-hidden="true"
    >
      <div className="relative flex h-5 w-5 items-center justify-center rounded-full border border-amber-100/80 bg-[linear-gradient(145deg,#fff7bf,#facc15_58%,#b45309)] shadow-[0_0_16px_rgba(250,204,21,0.28)]">
        <div className="h-2 w-2 rounded-full bg-slate-950/90" />
      </div>

      <div className="-mt-0.5 h-0 w-0 border-x-[9px] border-t-[18px] border-x-transparent border-t-amber-200" />
      <div className="-mt-[16px] h-0 w-0 border-x-[5px] border-t-[10px] border-x-transparent border-t-slate-950/90" />
    </div>
  );
}
