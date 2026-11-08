/**
 * チャンネル/メンバー テーブルの「注目フラグ」。
 * 前期間比に基づく comcom 風ラベル。
 */
export type TrendLevel = "hot" | "rising" | "notable" | "falling" | "cold" | null;

export function trendLevel(delta: number | null | undefined, current: number): TrendLevel {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return null;
  if (current < 5) return null;
  const pct = delta * 100;
  if (pct >= 80) return "hot";
  if (pct >= 25) return "rising";
  if (pct <= -40) return "cold";
  if (pct <= -15) return "falling";
  if (pct >= 10) return "notable";
  return null;
}

const LABELS: Record<Exclude<TrendLevel, null>, { text: string; className: string }> = {
  hot: { text: "超いい感じ", className: "bg-emerald-100 text-emerald-700" },
  rising: { text: "上昇中", className: "bg-sky-100 text-sky-700" },
  notable: { text: "注目", className: "bg-amber-100 text-amber-700" },
  falling: { text: "低下", className: "bg-gray-200 text-gray-600" },
  cold: { text: "急降下", className: "bg-rose-100 text-rose-700" },
};

export default function TrendTag({ level }: { level: TrendLevel }) {
  if (!level) return <span className="text-xs text-muted-foreground">—</span>;
  const { text, className } = LABELS[level];
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-black ${className}`}>
      {text}
    </span>
  );
}
