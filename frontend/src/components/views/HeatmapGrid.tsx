"use client";

const DOW_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

interface HeatPoint {
  dow: number;
  hour: number;
  count: number;
}

function cellColor(count: number, max: number): string {
  if (count <= 0 || max <= 0) return "bg-muted";
  const ratio = count / max;
  if (ratio > 0.66) return "bg-accent-data/90";
  if (ratio > 0.4) return "bg-accent-data/60";
  if (ratio > 0.18) return "bg-accent-data/35";
  return "bg-accent-data/15";
}

export default function HeatmapGrid({ data }: { data: HeatPoint[] }) {
  const map = new Map<string, number>();
  let max = 0;
  for (const point of data) {
    const key = `${point.dow}-${point.hour}`;
    const count = Number(point.count);
    map.set(key, count);
    if (count > max) max = count;
  }

  return (
    <div className="overflow-x-auto custom-scrollbar">
      <div className="mx-auto min-w-100 max-w-4xl">
        <div className="mb-1 flex gap-1 pl-8">
          {Array.from({ length: 24 }, (_, hour) => (
            <div
              key={hour}
              className="min-w-2 flex-1 text-center text-[9px] font-bold text-muted-foreground"
            >
              {hour % 3 === 0 ? hour : ""}
            </div>
          ))}
        </div>
        {DOW_LABELS.map((label, dow) => (
          <div key={dow} className="mb-1 flex items-center gap-1">
            <span className="w-7 shrink-0 text-[10px] font-bold text-muted-foreground">
              {label}
            </span>
            {Array.from({ length: 24 }, (_, hour) => {
              const count = map.get(`${dow}-${hour}`) ?? 0;
              return (
                <div
                  key={hour}
                  title={`${label}曜 ${hour}時: ${count.toLocaleString("ja-JP")}件`}
                  className={`aspect-square min-w-2 flex-1 rounded-[3px] transition-transform hover:scale-110 ${cellColor(count, max)}`}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
