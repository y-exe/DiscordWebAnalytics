import React from 'react';

const days = ['日', '月', '火', '水', '木', '金', '土'];
const hours = Array.from({ length: 24 }, (_, i) => i);

export default function ActivityHeatmap({ data }) {
  if (!data || data.length === 0) return null;

  const dataMap = {};
  let maxCount = 0;

  const sortedData = [...data].filter(d => d.count > 0).sort((a, b) => b.count - a.count);
  const top5Entries = sortedData.slice(0, 5).map(d => `${d.dow}-${d.hour}`);

  data.forEach(d => {
    if (!dataMap[d.dow]) dataMap[d.dow] = {};
    dataMap[d.dow][d.hour] = d.count;
    if (d.count > maxCount) maxCount = d.count;
  });

  const getStyle = (count, dow, hour) => {
    if (count === 0) {
      return { backgroundColor: '#ffffff', opacity: 1 };
    }

    const isTop5 = top5Entries.includes(`${dow}-${hour}`);
    if (isTop5) {
      return {
        backgroundColor: 'rgba(239, 68, 68, 1)',
        boxShadow: '0 0 10px rgba(239, 68, 68, 0.4)'
      };
    }

    const intensity = Math.max(0.15, Math.min(1, Math.log(count + 1) / Math.log(maxCount + 1)));

    return {
      backgroundColor: `rgba(var(--heatmap-color, 0, 0, 0), ${intensity})`
    };
  };

  return (
    <div className="rounded-2xl bg-white p-6 text-slate-900 dark:text-slate-100 [--heatmap-color:0,0,0] dark:[--heatmap-color:255,255,255]">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
          アクティビティヒートマップ
        </h3>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-[2px] bg-red-500 shadow-[0_0_5px_rgba(239,68,68,0.5)]"></div>
            <span className="text-[10px] font-black text-muted-foreground tracking-wider">ピーク上位5件</span>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto custom-scrollbar pb-2 pt-4">
        <div className="min-w-[600px] px-2">
          <div className="flex mb-2">
            <div className="w-8"></div>
            {hours.map(h => (
              <div key={h} className="result-number flex-1 text-[9px] font-black text-muted-foreground/50 text-center">
                {h % 2 === 0 ? h : ''}
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-[4px]">
            {days.map((day, dowIndex) => (
              <div key={day} className="flex items-center gap-[4px]">
                <span className="w-8 text-[9px] font-black text-muted-foreground uppercase tracking-tighter">{day}</span>
                {hours.map(hour => {
                  const count = dataMap[dowIndex]?.[hour] || 0;
                  const style = getStyle(count, dowIndex, hour);
                  const isTop5 = top5Entries.includes(`${dowIndex}-${hour}`);

                  const isFirstRow = dowIndex < 3;
                  const isLeftEdge = hour < 2;
                  const isRightEdge = hour > 21;

                  return (
                    <div
                      key={hour}
                      className="flex-1 aspect-square rounded-[4px] transition-all hover:scale-125 hover:z-10 relative group cursor-crosshair border border-black/5 dark:border-white/5"
                      style={style}
                    >
                      <div className={`
                        invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-all duration-200 
                        absolute pointer-events-none z-[100]
                        ${isFirstRow ? 'top-full mt-3' : 'bottom-full mb-3'}
                        ${isLeftEdge ? 'left-0 translate-x-0' : isRightEdge ? 'right-0 translate-x-0' : 'left-1/2 -translate-x-1/2'}
                      `}>
                        <div className={`${isTop5 ? 'bg-red-600 shadow-red-500/30' : 'bg-slate-900 shadow-slate-900/40'} text-white p-3 rounded-xl shadow-2xl border border-white/20 min-w-[120px] backdrop-blur-md opacity-100`}>
                          <div className={`text-[10px] ${isTop5 ? 'text-white/70' : 'text-slate-400'} font-black uppercase tracking-widest mb-1.5 border-b border-white/10 pb-1 flex justify-between items-center gap-4`}>
                            <span>{day}</span>
                            <span>{hour}:00</span>
                          </div>
                          <div className="flex items-baseline gap-1.5">
                            <span className="text-sm font-black text-white">{count.toLocaleString()}</span>
                            <span className={`text-[10px] ${isTop5 ? 'text-white/70' : 'text-slate-400'} font-bold tracking-tight`}>件</span>
                          </div>

                          <div className={`
                            absolute left-1/2 -translate-x-1/2 border-8 border-transparent
                            ${isFirstRow ? 'bottom-full border-b-current rotate-0 -mb-1' : 'top-full border-t-current rotate-0 -mt-1'}
                            ${isTop5 ? 'text-red-600' : 'text-slate-900'}
                            ${isLeftEdge ? 'left-4' : isRightEdge ? 'left-auto right-4 translate-x-0' : ''}
                          `}></div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
