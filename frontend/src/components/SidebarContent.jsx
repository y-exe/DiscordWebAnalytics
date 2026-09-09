import React, { useState, useEffect } from 'react';
import MonthSelector from './MonthSelector';
import { Hash, LayoutGrid } from 'lucide-react';
import { fetchAPI } from '@/lib/api';

export default function SidebarContent({ currentPath, queryParams, pageMode, currentId, currentMonth }) {
    const [data, setData] = useState({ channels: [] });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchSidebarData = async () => {
            try {
                const cRes = await fetchAPI("/channels");
                setData({ channels: await cRes.json() });
            } catch (e) { console.error(e); }
            finally { setLoading(false); }
        };
        fetchSidebarData();
    }, []);

    if (loading) return <div className="px-6 space-y-6 animate-pulse mt-4"><div className="h-10 bg-muted rounded-2xl w-full"></div><div className="space-y-3"><div className="h-3 bg-muted rounded w-1/3"></div><div className="h-10 bg-muted rounded-xl w-full"></div></div></div>;

    const categories = [];
    const grouped = {};
    if (Array.isArray(data.channels)) {
        data.channels.forEach((ch) => {
            const cat = ch.category || "未分類";
            if (!grouped[cat]) { grouped[cat] = []; categories.push(cat); }
            grouped[cat].push(ch);
        });
    }

    const searchParams = new URLSearchParams(queryParams);
    const channelId = searchParams.get('channel');

    const now = new Date();
    now.setDate(1);
    now.setMonth(now.getMonth() - 1);
    const prevYear = now.getFullYear();
    const prevMonth = now.getMonth() + 1;
    const monthlyBaseUrl = `/month/${prevYear}/${prevMonth}`;

    const allTimeUrl = '/all';

    const isDashboard = currentPath.includes('/month/') || currentPath === '/all';
    const dashboardBasePath = isDashboard ? currentPath.split('?')[0] : monthlyBaseUrl;

    return (
        <div className="px-6 pb-12 space-y-8 flex-1 overflow-y-auto custom-scrollbar flex flex-col">
            <div className="bg-muted p-1.5 rounded-2xl flex text-base tracking-normal border border-border shadow-inner result-number">
                <a href={monthlyBaseUrl} className={`flex-1 py-2.5 text-center rounded-xl transition-all ${pageMode === 'month' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>月間</a>
                <a href={allTimeUrl} className={`flex-1 py-2.5 text-center rounded-xl transition-all ${pageMode === 'open' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>累計</a>
            </div>

            {pageMode === 'month' && <MonthSelector currentYear={currentId} currentMonth={currentMonth} />}

            <nav className="space-y-8">
                <a href={dashboardBasePath} className={`flex items-center gap-3 px-4 py-3 text-sm rounded-2xl font-black transition-all border shadow-sm ${isDashboard && !channelId ? 'bg-primary text-primary-foreground border-primary shadow-primary/20' : 'bg-transparent text-muted-foreground border-transparent hover:bg-muted hover:text-foreground'}`}>
                    <LayoutGrid className="w-4 h-4" /> 総合
                </a>

                {categories.map(cat => (
                    <div key={cat} className="space-y-2">
                        <h3 className="text-[10px] font-black text-muted-foreground/70 uppercase tracking-[0.2em] px-4">{cat}</h3>
                        <div className="flex flex-col gap-0.5">
                            {grouped[cat].map(ch => {
                                const isActive = isDashboard && channelId === String(ch.id);
                                return (
                                    <a key={ch.id} href={`${dashboardBasePath}?channel=${ch.id}`} className={`flex items-center gap-3 px-4 py-2 text-sm rounded-xl font-bold transition-all truncate ${isActive ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`}>
                                        <Hash className={`w-3.5 h-3.5 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} /> {ch.name}
                                    </a>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </nav>

        </div>
    );
}
