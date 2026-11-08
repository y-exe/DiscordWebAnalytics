import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";

/**
 * 前期間比バッジ。nullは前期間データなし (=→)。
 * deltaは小数 (0.042 = +4.2%)。
 */
export default function DeltaBadge({
  delta,
  className = "",
}: {
  delta: number | null;
  className?: string;
}) {
  if (delta === null || !Number.isFinite(delta)) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs font-bold text-muted-foreground ${className}`}
      >
        <ArrowRight className="h-3 w-3" aria-hidden="true" />
        --
      </span>
    );
  }
  const rounded = Math.round(delta * 1000) / 10;
  const up = rounded > 0;
  const flat = rounded === 0;
  const Icon = up ? ArrowUpRight : flat ? ArrowRight : ArrowDownRight;
  const colorClass = flat
    ? "text-muted-foreground bg-muted"
    : up
      ? "text-delta-up bg-delta-up/10"
      : "text-delta-down bg-delta-down/10";
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-black ${colorClass} ${className}`}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {Math.abs(rounded)}%
    </span>
  );
}

export function deltaRate(
  current: number | null | undefined,
  previous: number | null | undefined,
): number | null {
  if (current === null || current === undefined || previous === null || previous === undefined)
    return null;
  if (previous === 0) return current > 0 ? null : 0;
  return (current - previous) / previous;
}
