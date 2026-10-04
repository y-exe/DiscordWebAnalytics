import React, { useState, useEffect, useRef } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

const COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#6366f1',
];

export default function ChannelPieChart({ data }) {
  const [shouldRender, setShouldRender] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShouldRender(true);
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  if (!data || data.length === 0) return null;

  const total = data.reduce((acc, cur) => acc + cur.value, 0);

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const d = payload[0].payload;
      return (
        <div className="bg-popover border border-border p-2.5 rounded-xl shadow-2xl backdrop-blur-md z-110">
          <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-1">{d.name}</p>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xs font-black text-popover-foreground">{d.value.toLocaleString()}</span>
            <span className="text-[9px] text-muted-foreground font-bold tracking-tight">件</span>
          </div>
          <p className="text-[9px] text-primary font-black mt-0.5">{((d.value / total) * 100).toFixed(1)}%</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="rounded-2xl bg-white p-5 h-full flex flex-col overflow-hidden">
      <div className="mb-3 w-full shrink-0 pr-28">
        <h3 className="text-base font-bold text-foreground leading-none">チャンネル分布</h3>
      </div>

      <div className="flex-1 flex flex-row items-center gap-4 min-h-0 min-w-0">
        <div
          ref={containerRef}
          className="h-full w-[50%] relative shrink-0"
        >
          {shouldRender && (
            <div className="w-full h-full relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    cx="50%"
                    cy="50%"
                    innerRadius="65%"
                    outerRadius="95%"
                    paddingAngle={3}
                    dataKey="value"
                    animationDuration={800}
                  >
                    {data.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={COLORS[index % COLORS.length]}
                        stroke="none"
                        className="hover:opacity-80 transition-opacity cursor-pointer outline-hidden"
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    content={<CustomTooltip />}
                    wrapperStyle={{ zIndex: 200 }}
                  />
                </PieChart>
              </ResponsiveContainer>

              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10">
                <span className="text-[8px] font-black text-muted-foreground tracking-tighter leading-none mb-0.5 opacity-40">合計</span>
                <span className="text-sm font-black text-foreground leading-none">{total.toLocaleString()}</span>
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 flex flex-col gap-0.5 justify-center min-w-0 pr-2 overflow-hidden h-full">
          {data.slice(0, 8).map((d, i) => (
            <div key={d.name} className="flex items-center gap-2 min-w-0 group cursor-default py-0.5">
              <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }}></div>
              <div className="flex flex-col min-w-0 flex-1 leading-tight">
                <span className="text-[8px] font-bold text-muted-foreground uppercase truncate tracking-tight group-hover:text-foreground transition-colors">{d.name}</span>
                <span className="text-[7px] font-black text-muted-foreground/30">{((d.value / total) * 100).toFixed(0)}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
