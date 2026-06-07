"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, BadgeDollarSign, Coins, Equal } from "lucide-react";
import type { CategoryListItem } from "../../lib/api-client";
import { GameShell } from "../../components/player/game-shell";
import { StatusPill } from "../../components/player/status-pill";
import { useCategories } from "../../hooks/use-categories";
import {
  getCategoryAmountLabel,
  getCategoryDisplayName,
  getCategoryMode,
  getCategoryRingLabel,
  isBaselinePlayerCategory,
  type PlayerMode,
  sortPlayerCategories,
} from "../../lib/game-modes";

function getModeAmountLabel(
  categories: CategoryListItem[],
  mode: PlayerMode,
) {
  const category = categories.find(
    (item) => getCategoryMode(item) === mode,
  );

  return category ? getCategoryAmountLabel(category) : "በመጫን ላይ...";
}

function getBattleAmountLabel(category: CategoryListItem) {
  return getCategoryRingLabel(category);
}

function ModeCard({
  title,
  subtitle,
  amount,
  mode,
  selected,
  onSelect,
}: {
  title: string;
  subtitle: string;
  amount: string;
  mode: PlayerMode;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = mode === "fixed" ? Equal : BadgeDollarSign;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`group relative min-w-0 overflow-hidden rounded-lg border p-3 text-left shadow-[0_20px_48px_rgba(0,0,0,0.36)] transition hover:-translate-y-0.5 hover:border-sky-300/45 hover:shadow-[0_24px_58px_rgba(14,165,233,0.16)] md:p-5 ${
        selected
          ? "border-gold/70 bg-[radial-gradient(circle_at_20%_0%,rgba(246,197,71,0.24),transparent_36%),linear-gradient(145deg,rgba(14,45,84,0.96),rgba(5,8,22,0.94)_50%,rgba(2,3,10,0.98))]"
          : "border-blue-300/15 bg-[radial-gradient(circle_at_20%_0%,rgba(37,99,235,0.22),transparent_38%),linear-gradient(145deg,rgba(7,20,44,0.92),rgba(5,8,22,0.92)_48%,rgba(2,3,10,0.96))]"
      }`}
    >
      <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full border border-white/10 bg-white/[0.04]" />
      <div className="relative z-10 flex min-h-[12.75rem] flex-col md:min-h-[15rem]">
        <div className="flex flex-col items-start gap-2 min-[440px]:flex-row min-[440px]:justify-between md:gap-3">
          <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-md border border-white/10 bg-black/25 md:h-14 md:w-14">
            <Image
              src="/logo.png"
              alt={`${title} logo`}
              fill
              sizes="56px"
              className="object-contain"
            />
          </div>
          <span className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.06] px-2.5 text-xs font-black text-gold">
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {amount}
          </span>
        </div>

        <h2 className="mt-4 font-display text-xl font-black leading-tight text-white md:mt-6 md:text-3xl">
          {title}
        </h2>
        <p
          className="mt-2 overflow-hidden text-xs font-semibold leading-5 text-zinc-400 md:text-sm md:leading-6"
          style={{
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 3,
          }}
        >
          {subtitle}
        </p>
        <span className="mt-auto inline-flex min-h-9 w-fit items-center gap-2 rounded-md bg-gold px-3 text-xs font-black text-[var(--bg-void)]">
          ወደ ውድድሮች
          <ArrowRight
            className="h-4 w-4 transition group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </span>
      </div>
    </button>
  );
}

function CategoryBattleRow({
  category,
  index,
}: {
  category: CategoryListItem;
  index: number;
}) {
  const amountLabel = getBattleAmountLabel(category);
  const artworkOffset = ["-left-7", "-left-10", "-left-12"][index % 3];

  return (
    <Link
      href={`/spinpro/${category.slug}`}
      className="group relative grid min-h-[6.5rem] grid-cols-[5.5rem_minmax(0,1fr)_4.75rem] items-center overflow-hidden rounded-lg border border-amber-300/30 bg-[linear-gradient(145deg,rgba(12,18,35,0.9),rgba(4,7,17,0.98)_58%,rgba(18,28,49,0.92))] shadow-[0_18px_46px_rgba(0,0,0,0.32)] transition hover:-translate-y-0.5 hover:border-gold/70 hover:shadow-[0_24px_56px_rgba(246,197,71,0.16)]"
    >
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_34%,rgba(246,197,71,0.2),transparent_32%),linear-gradient(90deg,rgba(255,255,255,0.08),transparent_42%)]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent"
        aria-hidden="true"
      />

      <div
        className={`relative ${artworkOffset} h-28 w-32 overflow-hidden`}
        aria-hidden="true"
      >
        <Image
          src="/logo.png"
          alt=""
          fill
          sizes="128px"
          className="object-contain object-left opacity-95 drop-shadow-[0_14px_18px_rgba(0,0,0,0.38)]"
        />
      </div>

      <div className="relative min-w-0 py-3">
        <h3 className="truncate font-display text-base font-black text-white md:text-lg">
          {getCategoryDisplayName(category)}
        </h3>
        <p className="mt-1 truncate text-xs font-bold text-zinc-400">
          ክበቦች (Rings): {amountLabel}
        </p>
      </div>

      <div className="relative flex h-full flex-col items-center justify-center gap-1.5 border-l border-white/10 px-2 text-center">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-amber-100/65 bg-[radial-gradient(circle_at_35%_28%,#fff2a8,#f6c547_48%,#b86d08)] text-amber-950 shadow-[0_0_18px_rgba(246,197,71,0.28)]">
          <Coins className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="max-w-full truncate font-mono text-xs font-black text-white">
          {amountLabel}
        </span>
      </div>
    </Link>
  );
}

export default function SpinBattleRoomsPage() {
  const { categories, loading, error } = useCategories();
  const [selectedMode, setSelectedMode] = useState<PlayerMode | null>(null);

  const sortedCategories = useMemo(() => {
    const baseline = sortPlayerCategories(
      categories.filter(isBaselinePlayerCategory),
    );

    return baseline.length > 0 ? baseline : sortPlayerCategories(categories);
  }, [categories]);

  const selectedCategories = useMemo(() => {
    if (!selectedMode) {
      return [];
    }

    return sortedCategories.filter(
      (category) => getCategoryMode(category) === selectedMode,
    );
  }, [selectedMode, sortedCategories]);

  return (
    <GameShell backHref="/">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-10">
        {/* Page Hero */}
        <section>
          <div className="relative overflow-hidden rounded-lg border border-blue-300/15 bg-[radial-gradient(circle_at_28%_18%,rgba(37,99,235,0.36),transparent_34%),linear-gradient(145deg,#07142c_0%,#050816_48%,#02030a_100%)] p-5 shadow-[0_24px_62px_rgba(0,0,0,0.44)] md:p-7">
            <div className="absolute right-0 top-0 h-full w-1/2 opacity-35">
              <Image
                src="/logo.png"
                alt=""
                fill
                sizes="360px"
                className="object-contain object-right"
                priority
              />
            </div>
            <div className="relative z-10 max-w-2xl">
              <StatusPill tone="teal" className="rounded-full">
                የስፒን ባትል ክፍሎች
              </StatusPill>
              <h1 className="mt-5 font-display text-4xl font-black leading-tight text-white md:text-6xl">
                የመጫወቻ ምርጫዎን ይምረጡ።
              </h1>
              <p className="mt-4 max-w-xl text-sm font-semibold leading-6 text-zinc-400 md:text-base">
                በመጀመሪያ የጨዋታ ሁነታን ይምረጡ፣ በመቀጠል የውድድር ደረጃዎን ይወስኑ።
                ተለዋዋጭ ሁነታ ሰፊ የዕድል ክልል ሲሰጥዎት፣ ቋሚ ሁነታ ደግሞ ለሁሉም እኩል ዕድል ያረጋግጣል።
              </p>
            </div>
          </div>
        </section>

        {/* Error State */}
        {error ? (
          <div className="mt-5 rounded-xl border border-red-400/35 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200">
            {error}
          </div>
        ) : null}

        {/* Mode Cards Section */}
        <section className="mt-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-sky-300/80">
                ደረጃዎች
              </p>
              <h2 className="mt-1 font-display text-2xl font-black text-white">
                የጨዋታ ሁነታ ይምረጡ
              </h2>
            </div>
            {loading ? (
              <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-xs font-black text-zinc-400">
                በመጫን ላይ...
              </span>
            ) : null}
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 md:gap-4">
            <ModeCard
              title="ተለዋዋጭ ባትል (Flexible)"
              subtitle="የፈለጉትን መጠን ይምረጡ። ትልቅ መግቢያዎች ለዙሩ ሰፊ የቲኬት ዕድል ክልል ያስገኛሉ።"
              amount={getModeAmountLabel(sortedCategories, "pro")}
              mode="pro"
              selected={selectedMode === "pro"}
              onSelect={() => setSelectedMode("pro")}
            />
            <ModeCard
              title="ቋሚ ባትል (Fixed)"
              subtitle="በተወሰነ ቋሚ መጠን ብቻ ይግቡ። የሚሳተፍ እያንዳንዱ ተጫዋች አንድ እኩል የማሸነፍ ዕድል ይኖረዋል።"
              amount={getModeAmountLabel(sortedCategories, "fixed")}
              mode="fixed"
              selected={selectedMode === "fixed"}
              onSelect={() => setSelectedMode("fixed")}
            />
          </div>
        </section>

        {selectedMode ? (
          /* Arena Tiers Section */
          <section className="mx-auto mt-7 w-full max-w-xl">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-gold/85">
                  የተመረጠው ሁነታ
                </p>
                <h2 className="mt-1 font-display text-3xl font-black text-white">
                  ውድድሮች
                </h2>
              </div>
              <StatusPill tone={loading ? "muted" : "teal"}>
                {loading ? "በመጫን ላይ..." : `${selectedCategories.length} የቀጥታ`}
              </StatusPill>
            </div>

            {loading ? (
              <div className="mt-4 flex flex-col gap-3">
                {[0, 1, 2].map((item) => (
                  <div
                    key={item}
                    className="h-[6.5rem] animate-pulse rounded-lg border border-amber-300/20 bg-white/[0.04]"
                  />
                ))}
              </div>
            ) : (
              <div className="mt-4 flex flex-col gap-3">
                {selectedCategories.map((category, index) => (
                  <CategoryBattleRow
                    key={category.slug}
                    category={category}
                    index={index}
                  />
                ))}
              </div>
            )}
          </section>
        ) : null}
      </div>
    </GameShell>
  );
}
