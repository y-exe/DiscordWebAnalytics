import React, { useState } from 'react';
import { ChevronDown, Calendar } from 'lucide-react';
import { navigate } from 'astro:transitions/client';

export default function MonthSelector({ currentYear, currentMonth, dark = false }) {
  const [isOpen, setIsOpen] = useState(false);

  const months = [];
  const now = new Date();
  const endDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const startDate = new Date(2025, 2, 1);

  let d = new Date(startDate);
  while (d <= endDate) {
    months.unshift({ year: d.getFullYear(), month: d.getMonth() + 1 });
    d.setMonth(d.getMonth() + 1);
  }

  const handleSelect = (year, month) => {
    const search = window.location.search;
    navigate(`/month/${year}/${month}${search}`);
  };

  const currentLabel = currentYear ? `${currentYear}年 ${currentMonth}月` : '期間を選択';

  return (
    <div className="relative">
      <button onClick={() => setIsOpen(!isOpen)} className={`w-full text-sm rounded-xl p-3 flex items-center justify-between transition-all shadow-sm focus:ring-2 focus:ring-ring outline-none ${dark ? 'bg-white/6 border border-white/10 text-white hover:border-white/25' : 'bg-background border border-border text-foreground hover:border-primary/50'}`}>
        <div className="flex items-center gap-2"><Calendar className={`w-4 h-4 ${dark ? 'text-white/45' : 'text-muted-foreground'}`} /><span className="font-medium">{currentLabel}</span></div>
        <ChevronDown className={`w-4 h-4 transition-transform ${dark ? 'text-white/45' : 'text-muted-foreground'} ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className={`absolute top-full left-0 w-full mt-2 rounded-xl shadow-xl z-50 max-h-60 overflow-y-auto p-1 custom-scrollbar ${dark ? 'bg-[#191b20] border border-white/10 text-white' : 'bg-popover border border-border text-popover-foreground'}`}>
            {months.length > 0 ? months.map((m) => {
              const isSelected = String(m.year) === String(currentYear) && String(m.month) === String(currentMonth);
              return (
                <button key={`${m.year}-${m.month}`} onClick={() => handleSelect(m.year, m.month)} className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between group ${isSelected ? (dark ? 'bg-white text-gray-950 font-bold' : 'bg-muted text-foreground font-bold') : (dark ? 'text-white/55 hover:bg-white/8 hover:text-white' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground')}`}>
                  <span>{m.year}年 {m.month}月</span>
                  {isSelected && <span className={`w-1.5 h-1.5 rounded-full ${dark ? 'bg-gray-950' : 'bg-primary'}`}></span>}
                </button>
              );
            }) : <div className={`p-3 text-xs text-center ${dark ? 'text-white/45' : 'text-muted-foreground'}`}>データがありません</div>}
          </div>
        </>
      )}
    </div>
  );
}
