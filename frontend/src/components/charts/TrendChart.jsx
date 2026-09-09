import React, { useState, useEffect, useRef } from 'react';
import { LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Search, User } from 'lucide-react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchAPI } from '@/lib/api';

const CustomTooltip = ({ active, payload, label, users, highlightUserId, focusedUserId }) => {
    if (active && payload && payload.length) {
        const sorted = [...payload].sort((a, b) => b.value - a.value);
        const top3 = sorted.slice(0, 3);
        const myData = sorted.find(p => String(p.dataKey) === String(highlightUserId));
        const focusData = sorted.find(p => String(p.dataKey) === String(focusedUserId));

        let showList = [...top3];
        if (myData && !showList.some(p => String(p.dataKey) === String(highlightUserId))) showList.push(myData);
        if (focusData && !showList.some(p => String(p.dataKey) === String(focusedUserId))) showList.push(focusData);

        return (
            <div className="bg-popover/95 backdrop-blur-md border border-border shadow-2xl rounded-xl p-4 min-w-[240px] z-[110] text-popover-foreground">
                <p className="text-[10px] text-muted-foreground font-black mb-3 uppercase tracking-widest border-b border-border pb-2">{label}</p>
                <div className="space-y-3">
                    {showList.map((p) => {
                        const uid = p.dataKey;
                        const userInfo = users ? (users[uid] || {}) : {};
                        const name = p.name === 'total' ? '全体合計' : (userInfo.name || uid);
                        const avatar = userInfo.avatar;
                        const isMe = String(uid) === String(highlightUserId);
                        const isFocus = String(uid) === String(focusedUserId);

                        return (
                            <div key={uid} className="flex items-center justify-between gap-4">
                                <div className="flex items-center gap-2.5 overflow-hidden">
                                    {avatar ? <img src={avatar} alt="" className="w-6 h-6 flex-shrink-0 rounded-full border border-border object-cover" referrerPolicy="no-referrer" /> : <div className="w-6 h-6 rounded-full bg-muted flex-shrink-0" style={{ border: `2px solid ${p.stroke || p.fill}` }}></div>}
                                    <span className={`truncate text-xs font-bold ${isMe ? 'text-red-500' : isFocus ? 'text-blue-500' : 'text-foreground'}`}>{name}</span>
                                </div>
                                <span className="result-number font-black text-foreground text-sm">{p.value.toLocaleString()}</span>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }
    return null;
};

const TotalTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-popover/95 backdrop-blur-md border border-border shadow-2xl rounded-xl p-4 min-w-[180px] text-popover-foreground">
                <p className="text-[10px] text-muted-foreground font-black mb-2 uppercase tracking-widest">{label}</p>
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-primary"></div>
                    <span className="text-xs font-bold text-muted-foreground">合計</span>
                    <span className="result-number font-black text-foreground text-sm ml-auto">{payload[0].value.toLocaleString()}</span>
                </div>
            </div>
        );
    }
    return null;
};

const TOTAL_BAR_COLORS = ['#d9d9d9', '#b4b4b4', '#737373', '#545454'];

const getTotalBarColor = (value, maxTotal, sortedNonMaxTotals) => {
    if (value === maxTotal) return '#ff3131';
    if (sortedNonMaxTotals.length <= 1) return TOTAL_BAR_COLORS[0];

    const rank = sortedNonMaxTotals.findIndex((total) => value <= total);
    const safeRank = rank === -1 ? sortedNonMaxTotals.length - 1 : rank;
    const ratio = safeRank / (sortedNonMaxTotals.length - 1);
    const colorIndex = Math.min(
        TOTAL_BAR_COLORS.length - 1,
        Math.floor(ratio * TOTAL_BAR_COLORS.length)
    );

    return TOTAL_BAR_COLORS[colorIndex];
};

const summarizeTotalBars = (data, enabled) => {
    if (!enabled || data.length <= 50) return data;

    const groupSize = Math.max(3, Math.ceil(data.length / 50));
    const summarized = [];

    for (let i = 0; i < data.length; i += groupSize) {
        const group = data.slice(i, i + groupSize);
        const total = group.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
        const start = group[0]?.date || '';
        const end = group[group.length - 1]?.date || start;

        summarized.push({
            ...group[group.length - 1],
            date: start === end ? start : `${start}~${end}`,
            total,
        });
    }

    return summarized;
};

const summarizeIndividualLines = (data, userIds, enabled) => {
    if (!enabled || data.length <= 50) return data;

    const groupSize = Math.ceil(data.length / 50);
    const summarized = [];

    for (let i = 0; i < data.length; i += groupSize) {
        const group = data.slice(i, i + groupSize);
        const start = group[0]?.date || '';
        const end = group[group.length - 1]?.date || start;
        const merged = {
            ...group[group.length - 1],
            date: start === end ? start : `${start}~${end}`,
            total: group.reduce((sum, item) => sum + (Number(item.total) || 0), 0),
        };

        userIds.forEach((uid) => {
            merged[uid] = group.reduce((sum, item) => sum + (Number(item[uid]) || 0), 0);
        });

        summarized.push(merged);
    }

    return summarized;
};

const formatTotalDateTick = (str = '') => {
    const start = str.split('~')[0] || str;
    return start.slice(5).replace('-', '/');
};

export default function TrendChart({ apiData, highlightUserId, focusedUserId, onSearchUser, compressTotalBars = false, compressIndividualLines = false }) {
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [mode, setMode] = useState('individual');
    const [shouldRender, setShouldRender] = useState(false);
    const containerRef = useRef(null);

    useEffect(() => {
        if (!containerRef.current) return;
        const observer = new ResizeObserver(() => setShouldRender(true));
        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const delayDebounceFn = setTimeout(async () => {
            if (searchTerm.trim().length > 0) {
                try {
                    const res = await fetchAPI(`/users/search?q=${encodeURIComponent(searchTerm)}`);
                    if (res.ok) setSearchResults(await res.json());
                } catch (e) { console.error(e); }
            } else { setSearchResults([]); }
        }, 300);
        return () => clearTimeout(delayDebounceFn);
    }, [searchTerm]);

    if (!apiData || !apiData.chart_data || apiData.chart_data.length === 0) {
        return <div className="w-full h-[280px] md:h-[400px] bg-muted rounded-2xl border border-dashed border-border flex items-center justify-center text-muted-foreground font-black tracking-widest text-xs">アクティビティデータがありません</div>;
    }

    const { chart_data: rawChartData, users, top_user_id } = apiData;
    const userIdsInChart = Object.keys(users || {});

    const chart_data = rawChartData.map((dayData, idx) => {
        const patched = { ...dayData };
        userIdsInChart.forEach((uid) => {
            const hasValue = dayData[uid] != null && dayData[uid] > 0;
            const prevHasValue = idx > 0 && rawChartData[idx - 1][uid] != null && rawChartData[idx - 1][uid] > 0;
            const nextHasValue = idx < rawChartData.length - 1 && rawChartData[idx + 1][uid] != null && rawChartData[idx + 1][uid] > 0;

            if (!hasValue) {
                if (prevHasValue || nextHasValue) {
                    patched[uid] = 0;
                }
            }
        });
        return patched;
    });

    const individualChartData = summarizeIndividualLines(chart_data, userIdsInChart, compressIndividualLines);
    const totalChartData = summarizeTotalBars(chart_data, compressTotalBars);
    const totalBarValues = totalChartData.map((dayData) => Number(dayData.total) || 0);
    const maxTotal = Math.max(...totalBarValues);
    const sortedNonMaxTotals = totalBarValues
        .filter((total) => total < maxTotal)
        .sort((a, b) => a - b);

    const handleSelectUser = (u) => {
        setSearchTerm('');
        setSearchResults([]);
        if (onSearchUser) onSearchUser(u.user_id);
    };

    const chartMotion = {
        initial: {
            opacity: 0,
            y: mode === 'individual' ? -14 : 14,
            clipPath: 'inset(8% 0 8% 0)',
        },
        animate: {
            opacity: 1,
            y: 0,
            clipPath: 'inset(0% 0 0% 0)',
        },
        exit: {
            opacity: 0,
            y: mode === 'individual' ? 14 : -14,
            clipPath: 'inset(8% 0 8% 0)',
        },
    };

    return (
        <Card className="w-full shadow-sm">
            <CardHeader className="pb-4">
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
                    <div className="space-y-1">
                        <CardTitle className="text-xl font-black tracking-tight flex items-center gap-2">
                            アクティビティ推移
                        </CardTitle>
                    </div>
                    <motion.div layout className="flex w-full flex-col items-stretch gap-3 md:w-auto md:flex-row md:items-center md:gap-4">
                        <AnimatePresence initial={false}>
                            {mode === 'individual' && (
                                <motion.div
                                    key="user-search"
                                    layout
                                    initial={{ opacity: 0, height: 0, y: -8 }}
                                    animate={{ opacity: 1, height: 42, y: 0 }}
                                    exit={{ opacity: 0, height: 0, y: -8 }}
                                    transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                                    className="relative w-full shrink-0 overflow-visible md:w-48"
                                >
                                    <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-[#545454]" />
                                    <input
                                        type="text"
                                        placeholder="ユーザーを追加..."
                                        className="h-full w-full rounded-xl border-0 bg-white py-3 pl-11 pr-4 text-xs font-bold text-[#545454] outline-none transition-colors placeholder:text-[#545454]/55 focus:bg-white md:w-48"
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                    />
                                    {searchResults.length > 0 && (
                                        <div className="absolute top-full right-0 z-[110] mt-2 w-64 overflow-hidden rounded-xl border-0 bg-white text-[#545454]">
                                            {searchResults.map(u => (
                                                <button key={u.user_id} onClick={() => handleSelectUser(u)} className="w-full flex items-center gap-3 p-3 hover:bg-[#f8f8f8] text-left border-b border-[#f1f1f1] last:border-0 transition-colors">
                                                    {u.avatar ? <img src={u.avatar} alt="" className="w-8 h-8 flex-shrink-0 rounded-full object-cover" referrerPolicy="no-referrer" /> : <div className="w-8 h-8 rounded-full bg-muted flex flex-shrink-0 items-center justify-center"><User className="w-4 h-4 text-muted-foreground" /></div>}
                                                    <div className="min-w-0 flex-1">
                                                        <p className="text-xs font-black text-foreground truncate">{u.display_name}</p>
                                                        <p className="text-[10px] text-muted-foreground font-mono truncate">@{u.username}</p>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </motion.div>
                            )}
                        </AnimatePresence>
                        <LayoutGroup>
                            <motion.div layout className="flex w-full rounded-xl bg-white p-1.5 text-[10px] font-black uppercase tracking-widest md:w-auto">
                                <button onClick={() => setMode('individual')} className={`relative flex-1 rounded-lg px-5 py-2 transition-colors md:flex-none ${mode === 'individual' ? 'text-white' : 'text-[#545454] hover:bg-[#545454]/10'}`}>
                                    {mode === 'individual' && <motion.span layoutId="trend-mode-active" className="absolute inset-0 rounded-lg bg-[#545454]" transition={{ type: 'spring', bounce: 0.12, duration: 0.35 }} />}
                                    <span className="relative z-10">ユーザー別</span>
                                </button>
                                <button onClick={() => setMode('total')} className={`relative flex-1 rounded-lg px-5 py-2 transition-colors md:flex-none ${mode === 'total' ? 'text-white' : 'text-[#545454] hover:bg-[#545454]/10'}`}>
                                    {mode === 'total' && <motion.span layoutId="trend-mode-active" className="absolute inset-0 rounded-lg bg-[#545454]" transition={{ type: 'spring', bounce: 0.12, duration: 0.35 }} />}
                                    <span className="relative z-10">合計</span>
                                </button>
                            </motion.div>
                        </LayoutGroup>
                    </motion.div>
                </div>
            </CardHeader>

            <CardContent className="pt-0">
                <div ref={containerRef} className="relative h-[280px] overflow-hidden rounded-2xl bg-white p-4 md:h-[400px]" style={{ width: '100%' }}>
                    {shouldRender && (
                        <AnimatePresence mode="wait" initial={false}>
                            <motion.div
                                key={mode}
                                className="absolute inset-4"
                                variants={chartMotion}
                                initial="initial"
                                animate="animate"
                                exit="exit"
                                transition={{
                                    opacity: { duration: 0.24, ease: 'easeOut' },
                                    y: { duration: 0.24, ease: 'easeOut' },
                                    clipPath: { duration: 0.24, ease: 'easeOut' },
                                }}
                                style={{ willChange: 'opacity, transform, clip-path' }}
                            >
                                <ResponsiveContainer width="100%" height="100%">
                                    {mode === 'individual' ? (
                                <LineChart data={individualChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                    <defs>
                                        <filter id="glow-red" x="-50%" y="-50%" width="200%" height="200%">
                                            <feGaussianBlur stdDeviation="4" result="blur" />
                                            <feFlood floodColor="#ef4444" floodOpacity="0.4" result="color" />
                                            <feComposite in="color" in2="blur" operator="in" result="shadow" />
                                            <feMerge>
                                                <feMergeNode in="shadow" />
                                                <feMergeNode in="SourceGraphic" />
                                            </feMerge>
                                        </filter>
                                        <filter id="glow-blue" x="-50%" y="-50%" width="200%" height="200%">
                                            <feGaussianBlur stdDeviation="3" result="blur" />
                                            <feFlood floodColor="#3b82f6" floodOpacity="0.35" result="color" />
                                            <feComposite in="color" in2="blur" operator="in" result="shadow" />
                                            <feMerge>
                                                <feMergeNode in="shadow" />
                                                <feMergeNode in="SourceGraphic" />
                                            </feMerge>
                                        </filter>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                                    <XAxis
                                        dataKey="date"
                                        tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))', fontWeight: 800 }}
                                        tickFormatter={formatTotalDateTick}
                                        axisLine={false}
                                        tickLine={false}
                                        dy={10}
                                    />
                                    <YAxis
                                        axisLine={false}
                                        tickLine={false}
                                        tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))', fontWeight: 800 }}
                                    />
                                    <Tooltip
                                        content={<CustomTooltip users={users} highlightUserId={highlightUserId} focusedUserId={focusedUserId} />}
                                        cursor={{ stroke: 'hsl(var(--border))', strokeWidth: 2 }}
                                        isAnimationActive={false}
                                    />
                                    {userIdsInChart.map((uid) => {
                                        const isMe = String(uid) === String(highlightUserId);
                                        const isFocus = String(uid) === String(focusedUserId);
                                        const isTop = uid === top_user_id;

                                        let color = "hsl(var(--muted-foreground))"; let width = 1; let opacity = 0.3; let zIndex = 10; let filter = undefined;

                                        if (isMe) { color = "#ef4444"; width = 3; opacity = 1; zIndex = 100; filter = "url(#glow-red)"; }
                                        else if (isFocus) { color = "#3b82f6"; width = 3; opacity = 1; zIndex = 110; filter = "url(#glow-blue)"; }
                                        else if (isTop) { color = "hsl(var(--foreground))"; width = 2.5; opacity = 0.9; zIndex = 50; }
                                        else { color = "hsl(var(--muted-foreground))"; width = 1.2; opacity = 0.4; }

                                        return (
                                            <Line
                                                key={uid}
                                                type="linear"
                                                dataKey={uid}
                                                stroke={color}
                                                strokeWidth={width}
                                                strokeOpacity={opacity}
                                                dot={false}
                                                activeDot={isMe || isFocus || isTop ? { r: 6, strokeWidth: 2, stroke: 'hsl(var(--background))', fill: color } : false}
                                                isAnimationActive={false}
                                                zIndex={zIndex}
                                                filter={filter}
                                            />
                                        );
                                    })}
                                </LineChart>
                            ) : (
                                <BarChart data={totalChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                                    <XAxis
                                        dataKey="date"
                                        tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))', fontWeight: 800 }}
                                        tickFormatter={formatTotalDateTick}
                                        axisLine={false}
                                        tickLine={false}
                                        dy={10}
                                    />
                                    <YAxis
                                        axisLine={false}
                                        tickLine={false}
                                        tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))', fontWeight: 800 }}
                                    />
                                    <Tooltip content={<TotalTooltip />} cursor={{ fill: 'hsl(var(--muted))' }} isAnimationActive={false} />
                                    <Bar dataKey="total" radius={[6, 6, 0, 0]}>
                                        {totalChartData.map((entry, index) => (
                                            <Cell
                                                key={`total-bar-${entry.date || index}`}
                                                fill={getTotalBarColor(Number(entry.total) || 0, maxTotal, sortedNonMaxTotals)}
                                            />
                                        ))}
                                    </Bar>
                                </BarChart>
                                    )}
                                </ResponsiveContainer>
                            </motion.div>
                        </AnimatePresence>
                    )}
                </div>

                <div className="mt-8 flex flex-wrap gap-x-8 gap-y-4 justify-center">
                    <div className="flex items-center gap-2"><div className="w-8 h-1 rounded-full bg-red-500"></div><span className="text-[10px] font-black text-muted-foreground tracking-widest">自分</span></div>
                    <div className="flex items-center gap-2"><div className="w-8 h-1 rounded-full bg-blue-500"></div><span className="text-[10px] font-black text-muted-foreground tracking-widest">選択中</span></div>
                    <div className="flex items-center gap-2"><div className="w-8 h-1 rounded-full bg-foreground"></div><span className="text-[10px] font-black text-muted-foreground tracking-widest">1位のユーザー</span></div>
                    <div className="flex items-center gap-2"><div className="w-8 h-1 rounded-full bg-muted-foreground/40"></div><span className="text-[10px] font-black text-muted-foreground tracking-widest">その他上位100人</span></div>
                </div>
            </CardContent>
        </Card>
    );
}
