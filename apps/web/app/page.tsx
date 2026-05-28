"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useCategories } from "../hooks/use-categories";
import { formatCoins } from "../lib/format";

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[17px] w-[17px]" fill="none">
      <circle
        cx="11"
        cy="11"
        r="7"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="m16.5 16.5 3.5 3.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[17px] w-[17px]" fill="none">
      <path
        d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13.73 21a2 2 0 0 1-3.46 0"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 10 10" className="h-[10px] w-[10px]">
      <polygon points="1,1 9,5 1,9" fill="currentColor" />
    </svg>
  );
}

function PoisonBottle({ small = false }: { small?: boolean }) {
  return (
    <svg
      width={small ? 36 : 90}
      height={small ? 52 : 130}
      viewBox="0 0 90 130"
      className="drop-shadow-2xl"
    >
      <defs>
        <linearGradient id={small ? "miniBottle" : "bigBottle"} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2d7a2a" />
          <stop offset="100%" stopColor="#1a4a18" />
        </linearGradient>
      </defs>

      <rect x="33" y="8" width="24" height="7" rx="3" fill="#4aaa30" />
      <rect x="29" y="14" width="32" height="5" rx="2" fill="#3d9028" />
      <rect
        x="22"
        y="19"
        width="46"
        height="100"
        rx="14"
        fill={`url(#${small ? "miniBottle" : "bigBottle"})`}
      />
      <rect
        x="27"
        y="25"
        width="36"
        height="88"
        rx="10"
        fill="rgba(20,80,18,0.9)"
      />
      <text
        x="45"
        y="78"
        textAnchor="middle"
        fontSize="28"
        fill="rgba(80,220,80,0.6)"
      >
        ☠
      </text>
      <ellipse
        cx="37"
        cy="60"
        rx="6"
        ry="10"
        fill="rgba(80,220,80,0.14)"
        transform="rotate(-20,37,60)"
      />
    </svg>
  );
}

function SpinWheel() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cx = 80;
    const cy = 80;
    const radius = 75;

    const segments = [
      { color: "#1a5c1a", label: "2x" },
      { color: "#f5c518", label: "SPIN" },
      { color: "#22543d", label: "5x" },
      { color: "#991b1b", label: "LOSE" },
      { color: "#1e3a5f", label: "3x" },
      { color: "#4a1d96", label: "10x" },
      { color: "#7c2d12", label: "FREE" },
      { color: "#065f46", label: "1x" },
    ];

    ctx.clearRect(0, 0, 160, 160);

    const arc = (2 * Math.PI) / segments.length;

    segments.forEach((segment, index) => {
      const start = index * arc - Math.PI / 2;
      const end = start + arc;

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, start, end);
      ctx.closePath();
      ctx.fillStyle = segment.color;
      ctx.fill();

      ctx.strokeStyle = "#0d0d14";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(start + arc / 2);
      ctx.textAlign = "right";
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 11px sans-serif";
      ctx.fillText(segment.label, radius - 10, 4);
      ctx.restore();
    });

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = "#f5c518";
    ctx.lineWidth = 3;
    ctx.stroke();

    for (let i = 0; i < segments.length; i += 1) {
      const angle = i * arc - Math.PI / 2;
      ctx.beginPath();
      ctx.arc(
        cx + (radius - 12) * Math.cos(angle),
        cy + (radius - 12) * Math.sin(angle),
        4,
        0,
        2 * Math.PI,
      );
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fill();
    }
  }, []);

  return (
    <div className="absolute -right-5 top-1/2 z-20 -translate-y-1/2">
      <div className="relative h-40 w-40">
        <div className="absolute -top-1.5 left-1/2 z-30 h-0 w-0 -translate-x-1/2 border-x-[9px] border-t-[20px] border-x-transparent border-t-yellow-400" />

        <canvas
          ref={canvasRef}
          width={160}
          height={160}
          className="h-40 w-40 animate-[spin_8s_linear_infinite]"
        />

        <div className="absolute left-1/2 top-1/2 z-30 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[3px] border-yellow-400 bg-[#0d0d14]">
          <div className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const { categories, loading, error } = useCategories();

  const categoryList = categories;

  const mainCategory = categoryList[0];
  const secondCategory = categoryList[1];
  const thirdCategory = categoryList[2];

  const playHref = mainCategory ? `/spinpro/${mainCategory.slug}` : "#";

  const topGames = [
    {
      title: mainCategory?.name ?? "Poison Pal",
      subtitle: mainCategory
        ? `★ ${formatCoins(mainCategory.minEntryAmount)} min · ${mainCategory.maxPlayers} players`
        : "★ 4.8 · ↓ 4.5M+",
      href: mainCategory ? `/spinpro/${mainCategory.slug}` : "#",
    },
    {
      title: secondCategory?.name ?? "Lucky Spin",
      subtitle: secondCategory
        ? `★ ${formatCoins(secondCategory.minEntryAmount)} min · ${secondCategory.maxPlayers} players`
        : "★ 4.7 · ↓ 3.8M+",
      href: secondCategory ? `/spinpro/${secondCategory.slug}` : "#",
    },
    {
      title: thirdCategory?.name ?? "Wheel Rush",
      subtitle: thirdCategory
        ? `★ ${formatCoins(thirdCategory.minEntryAmount)} min · ${thirdCategory.maxPlayers} players`
        : "★ 4.6 · ↓ 2.9M+",
      href: thirdCategory ? `/spinpro/${thirdCategory.slug}` : "#",
    },
  ];

  return (
    <main className="min-h-screen bg-[#0d0d14] text-[#f0f0f8]">
      <style>{`
        @keyframes pulse-ring {
          0%, 100% {
            transform: scale(0.9);
            opacity: 0.4;
          }
          50% {
            transform: scale(1.1);
            opacity: 0.8;
          }
        }

        @keyframes drip-fall {
          0% {
            transform: scaleY(0);
            opacity: 1;
          }
          60% {
            transform: scaleY(1);
            opacity: 1;
          }
          100% {
            transform: translateY(14px) scaleY(0.3);
            opacity: 0;
          }
        }

        @keyframes bubble-rise {
          0% {
            transform: translateY(0);
            opacity: 0.6;
          }
          100% {
            transform: translateY(-40px);
            opacity: 0;
          }
        }
      `}</style>

      <div className="mx-auto min-h-screen w-full max-w-[390px] overflow-hidden bg-[#0d0d14] pb-8">
        {/* Top Header */}
        <header className="flex items-center justify-between px-5 pb-2.5 pt-[18px]">
          <div className="flex items-center gap-[11px]">
            <div className="flex h-[42px] w-[42px] items-center justify-center overflow-hidden rounded-full border-[2.5px] border-orange-500 bg-[#1a1a28] text-[13px] font-black text-orange-500">
              A
            </div>

            <div>
              <div className="text-[15px] font-black leading-tight text-[#f0f0f8]">
                Hello, Alice!
              </div>
              <div className="mt-0.5 text-[11px] font-semibold text-[#8888aa]">
                <span className="text-yellow-400">⚡</span> Level 4
              </div>
            </div>
          </div>

          <div className="flex gap-2.5">
            <button
              aria-label="Search"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-[#1a1a28] text-[#f0f0f8] transition hover:bg-[#242436]"
            >
              <SearchIcon />
            </button>

            <button
              aria-label="Notifications"
              className="relative flex h-9 w-9 items-center justify-center rounded-full bg-[#1a1a28] text-[#f0f0f8] transition hover:bg-[#242436]"
            >
              <BellIcon />
              <span className="absolute right-[7px] top-[7px] h-[7px] w-[7px] rounded-full border border-[#0d0d14] bg-red-500" />
            </button>
          </div>
        </header>

        {/* Hero */}
        <section className="relative mx-4 mb-[22px] mt-2 h-40 overflow-hidden rounded-[22px] bg-[#0f1a0e]">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_60%,rgba(74,222,128,0.18)_0%,transparent_65%)]" />

          <div className="absolute bottom-0 left-[22px] top-0 z-30 flex flex-col justify-center">
            <span className="mb-[9px] inline-block w-fit rounded-full bg-green-400/20 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-green-400">
              Tap to play
            </span>

            <h1 className="max-w-[170px] text-[23px] font-black leading-[1.15] text-white">
              Play Big.
              <br />
              Win Bigger.
            </h1>

            <Link
              href={playHref}
              className="mt-[13px] inline-flex w-fit rounded-full bg-white px-[18px] py-2 text-xs font-extrabold text-[#0d0d14] transition hover:scale-105"
            >
              Play Now
            </Link>
          </div>

          <SpinWheel />
        </section>

        {error ? (
          <div className="mx-5 mb-5 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-300">
            {error}
          </div>
        ) : null}

        {/* Original Play */}
        <section>
          <div className="mb-3 flex items-center justify-between px-5">
            <h2 className="text-base font-black text-[#f0f0f8]">
              Original Play
            </h2>
            <Link href="/spinpro" className="text-xs font-bold text-green-500">
              See All
            </Link>
          </div>

          <Link
            href={playHref}
            className="relative mx-5 block h-[150px] overflow-hidden rounded-[18px] bg-[linear-gradient(145deg,#152d10,#0a1e08)]"
          >
            <div className="absolute right-[30px] top-1/2 z-10 h-[110px] w-[110px] -translate-y-1/2 rounded-full bg-green-400/10" />

            <div className="absolute left-[18px] top-1/2 z-20 -translate-y-1/2">
              <div className="mb-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-[9px] py-[3px] text-[11px] font-extrabold text-white">
                <span className="text-yellow-400">★</span> 4.8
              </div>

              <h3 className="mb-1 text-xl font-black text-white">
                {mainCategory?.name ?? "Poison Pal"}
              </h3>

              <p className="text-[11px] font-semibold text-white/50">
                {mainCategory
                  ? `${formatCoins(mainCategory.minEntryAmount)}-${formatCoins(
                      mainCategory.maxEntryAmount,
                    )} coins`
                  : "Lets play"}
              </p>
            </div>

            <div className="absolute bottom-0 right-2.5 z-20">
              <div className="relative h-[150px] w-[130px]">
                <div className="absolute bottom-2.5 right-[15px] h-[100px] w-[100px] animate-[pulse-ring_2s_ease-in-out_infinite] rounded-full border-2 border-green-400/30" />

                <span className="absolute bottom-[20%] left-[25%] h-[7px] w-[7px] animate-[bubble-rise_3s_ease-in-out_infinite] rounded-full bg-green-400/50" />
                <span className="absolute bottom-[30%] left-[55%] h-[5px] w-[5px] animate-[bubble-rise_3s_ease-in-out_infinite] rounded-full bg-green-400/50 [animation-delay:1s]" />
                <span className="absolute bottom-[10%] left-[38%] h-[9px] w-[9px] animate-[bubble-rise_3s_ease-in-out_infinite] rounded-full bg-green-400/50 [animation-delay:1.8s]" />

                <div className="absolute bottom-0 right-2.5">
                  <PoisonBottle />
                </div>

                <span className="absolute bottom-[-2px] left-1/2 h-3.5 w-1.5 -translate-x-1/2 animate-[drip-fall_2.2s_ease-in_infinite] rounded-b bg-green-400" />
                <span className="absolute bottom-[-1px] left-[calc(50%+3px)] h-[9px] w-1 animate-[drip-fall_2.2s_ease-in_infinite] rounded-b bg-green-400 opacity-70 [animation-delay:1.1s]" />
              </div>
            </div>
          </Link>
        </section>

        {/* Top Racing Games */}
        <section className="mt-6">
          <div className="mb-3 flex items-center justify-between px-5">
            <h2 className="text-base font-black text-[#f0f0f8]">
              Top Racing Games
            </h2>
            <Link href="/spinpro" className="text-xs font-bold text-green-500">
              See All
            </Link>
          </div>

          <div className="flex flex-col gap-0.5 px-5">
            {loading ? (
              <div className="rounded-[13px] bg-[#14141f] p-4 text-sm text-[#8888aa]">
                Loading games...
              </div>
            ) : null}

            {topGames.map((game) => (
              <Link
                key={game.title}
                href={game.href}
                className="flex items-center gap-[13px] rounded-[13px] bg-[#14141f] px-[13px] py-[11px] transition hover:bg-[#1a1a28]"
              >
                <div className="relative h-[52px] w-[52px] shrink-0 overflow-hidden rounded-[11px]">
                  <div className="absolute inset-0 flex items-center justify-center bg-[linear-gradient(145deg,#152d10,#0a1e08)]">
                    <PoisonBottle small />
                    <span className="absolute bottom-0.5 left-1/2 h-2 w-1 -translate-x-1/2 animate-[drip-fall_2.2s_ease-in_infinite] rounded-b bg-green-400 [animation-delay:.5s]" />
                  </div>
                </div>

                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-extrabold text-[#f0f0f8]">
                    {game.title}
                  </h3>
                  <div className="mt-[3px] flex items-center gap-2">
                    <span className="text-xs font-bold text-yellow-400">
                      {game.subtitle.split("·")[0]}
                    </span>
                    <span className="truncate text-[11px] font-semibold text-[#8888aa]">
                      {game.subtitle.includes("·")
                        ? game.subtitle.split("·")[1]
                        : ""}
                    </span>
                  </div>
                </div>

                <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border border-[#2a2a3a] text-[#f0f0f8]">
                  <div className="ml-0.5">
                    <PlayIcon />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
