"use client";

import type { DNAResult } from "@/services/designDNA";

interface Props {
  dnaResult: DNAResult | null;
  loading: boolean;
}

export function DNAProximityBadge({ dnaResult, loading }: Props) {
  if (loading) {
    return (
      <div className="mt-3 flex items-center gap-2 text-stone-400 text-xs font-mono">
        <span className="inline-block w-3 h-3 border-2 border-stone-500 border-t-transparent rounded-full animate-spin" />
        DNA scan running…
      </div>
    );
  }

  if (!dnaResult) return null;

  const { classification, winnerCount } = dnaResult;

  const config: Record<
    DNAResult["classification"],
    { dot: string; text: string; border: string; bg: string }
  > = {
    WINNER_ZONE: {
      dot: "bg-emerald-400",
      text: "DNA: Visually close to your best sellers",
      border: "border-emerald-700",
      bg: "bg-emerald-950/40",
    },
    NEUTRAL: {
      dot: "bg-stone-400",
      text: "DNA: Insufficient signal yet",
      border: "border-stone-700",
      bg: "bg-stone-900/40",
    },
    DEATH_ROW_ZONE: {
      dot: "bg-red-400",
      text: "DNA: Visually close to your 0-sale kills",
      border: "border-red-900",
      bg: "bg-red-950/40",
    },
    BUILDING: {
      dot: "bg-amber-400",
      text: `DNA: Building library (${winnerCount} / 3 minimum winners)`,
      border: "border-amber-800",
      bg: "bg-amber-950/40",
    },
  };

  const { dot, text, border, bg } = config[classification];

  return (
    <div
      className={`mt-3 flex items-center gap-2 px-3 py-2 rounded border ${border} ${bg} text-xs font-mono`}
    >
      <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
      <span className="text-stone-300">{text}</span>
    </div>
  );
}
