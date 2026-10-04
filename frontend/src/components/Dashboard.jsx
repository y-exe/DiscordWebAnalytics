"use client";

import React, { useState, useEffect } from 'react';
import PageHeader, { ReportPeriodCard } from './PageHeader';
import AnalysisPanel from './charts/AnalysisPanel';
import StatsCard from './StatsCard';
import TrendChart from './charts/TrendChart';
import ActivityHeatmap from './charts/ActivityHeatmap';
import ChannelInsightSwitcher from './charts/ChannelInsightSwitcher';
import ChannelStatsCard from './charts/ChannelStatsCard';
import GrowthComparison from './charts/GrowthComparison';
import RankingList from './RankingList';
import MouseEffectCard from './MouseEffectCard';
import { fetchAPI } from '@/lib/api';
import { Card } from "@/components/ui/card";

export default function Dashboard({ year, month, channelId, userId }) {
    const [data, setData] = useState(null);
    const [isLoaded, setIsLoaded] = useState(false);
    const [focusedUserId, setFocusedUserId] = useState(null);

    useEffect(() => {
        window.__ymkw_data_ready = false;

        const fetchData = async () => {
            const params = new URLSearchParams();
            if (channelId) params.append('channel_id', channelId);

            const prevDate = new Date(year, month - 2, 1);
            const prevYear = prevDate.getFullYear();
            const prevMonth = prevDate.getMonth() + 1;

            const histParams = new URLSearchParams(params);
            const targetId = focusedUserId || (userId !== 'guest' ? userId : null);
            if (targetId) histParams.set('user_id', targetId);

            try {
                const paramsStr = params.toString();
                const histParamsStr = histParams.toString();

                const responses = await Promise.all([
                    fetchAPI(`/ranking/monthly/${year}/${month}${paramsStr ? `?${paramsStr}` : ''}`),
                    fetchAPI(`/stats/history/${year}/${month}${histParamsStr ? `?${histParamsStr}` : ''}`),
                    fetchAPI(`/stats/heatmap/${year}/${month}${paramsStr ? `?${paramsStr}` : ''}`),
                    fetchAPI(`/stats/analysis/${year}/${month}${paramsStr ? `?${paramsStr}` : ''}`),
                    fetchAPI(`/stats/analysis/${prevYear}/${prevMonth}${paramsStr ? `?${paramsStr}` : ''}`),
                    userId && userId !== 'guest' ? fetchAPI(`/stats/analysis/${year}/${month}?${paramsStr}${paramsStr ? '&' : ''}user_id=${userId}`) : Promise.resolve(null),
                    !channelId ? fetchAPI(`/stats/channels_distribution/${year}/${month}`) : Promise.resolve(null),
                    userId && userId !== 'guest' ? fetchAPI(`/users/${userId}/rank/monthly/${year}/${month}${paramsStr ? `?${paramsStr}` : ''}`) : Promise.resolve(null)
                ]);

                const [rankRes, trendRes, heatmapRes, overallRes, prevOverallRes, personalRes, pieRes, userRankRes] = responses;
                const ranking = await rankRes.json();
                const trend = await trendRes.json();

                if (!ranking || ranking.length === 0 || !trend?.chart_data || trend.chart_data.length === 0) {
                    if (channelId) {
                        window.location.href = `/no-channel?from=${encodeURIComponent(window.location.pathname + window.location.search)}`;
                        return;
                    }

                    window.location.href = `/error?code=502&msg=Empty%20Data&url=${encodeURIComponent(rankRes.url)}`;
                    return;
                }

                const heatmap = await heatmapRes.json();
                const overall = await overallRes.json();
                const prevOverall = await prevOverallRes.json();
                const personal = (personalRes && personalRes.ok) ? await personalRes.json() : null;
                const pie = (pieRes && pieRes.ok) ? await pieRes.json() : [];

                const userRank = (userRankRes && userRankRes.ok) ? await userRankRes.json() : null;
                let myData = userRank;
                if (!myData && userId && userId !== 'guest' && ranking.length > 0) {
                    const idx = ranking.findIndex(r => String(r.user_id) === String(userId));
                    if (idx !== -1) myData = { ...ranking[idx], rank: idx + 1 };
                }

                setData({ ranking, trend, heatmap, pie, overall, prevOverall, personal, myData, topUserCount: ranking[0]?.count || 0 });
            } catch (error) {
                console.error("Dashboard Load Error:", error);
                const code = error.status || (error.name === 'TypeError' ? 'NetworkError' : 'unknown');
                const urlParam = error.url ? `&url=${encodeURIComponent(error.url)}` : '';
                const msgParam = error.message ? `&msg=${encodeURIComponent(error.message)}` : '';
                window.location.href = `/error?code=${code}${urlParam}${msgParam}`;
            } finally {
                setIsLoaded(true);
                window.__ymkw_data_ready = true;
                window.dispatchEvent(new Event('app-loaded'));
            }
        };
        fetchData();
    }, [year, month, channelId, userId, focusedUserId]);

    if (!isLoaded || !data) return <div className="min-h-[80vh]"></div>;

    return (
        <MouseEffectCard className="min-h-screen pb-32">
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out space-y-8">
                <ReportPeriodCard
                    title={`${year}.${month}`}
                    subTitle="月間レポート"
                    className="fixed left-4 top-28 z-30 shadow-xs md:left-88 md:top-20"
                />
                <PageHeader title={`${year}.${month}`} subTitle="月間レポート" showPeriodCard={false} />

                <div className="flex flex-col lg:flex-row gap-8">
                    <div className="flex-1 min-w-0 space-y-6">
                        <AnalysisPanel
                            overall={data.overall}
                            personal={data.personal}
                            isPersonalAvailable={!!userId && userId !== 'guest'}
                            personalAvatar={data.myData?.avatar || data.trend?.users?.[String(userId)]?.avatar}
                        />

                        {data.myData && <StatsCard myData={data.myData} topUserCount={data.topUserCount} />}

                        <div className="w-full overflow-hidden">
                            <TrendChart
                                key={`trend-${focusedUserId}`}
                                apiData={data.trend}
                                highlightUserId={userId}
                                focusedUserId={focusedUserId}
                                onSearchUser={(id) => setFocusedUserId(id)}
                            />
                        </div>

                        <Card className="grid grid-cols-1 gap-4 rounded-2xl bg-[#f8f8f8]! p-4 xl:grid-cols-3">
                            <div className="xl:col-span-2 w-full min-w-0">
                                <ActivityHeatmap data={data.heatmap} />
                            </div>
                            <div className="xl:col-span-1 w-full min-w-0">
                                <div className="h-full">
                                    {!channelId ? (
                                        <ChannelInsightSwitcher
                                            pieData={data.pie}
                                            ranking={data.ranking}
                                            overall={data.overall}
                                            prevOverall={data.prevOverall}
                                        />
                                    ) : (
                                        <ChannelStatsCard
                                            ranking={data.ranking}
                                            overall={data.overall}
                                            prevOverall={data.prevOverall}
                                        />
                                    )}
                                </div>
                            </div>
                        </Card>

                        <GrowthComparison current={data.overall} previous={data.prevOverall} />
                    </div>

                    <div className="w-full lg:w-[320px] xl:w-[380px] shrink-0">
                        <div className="sticky top-20">
                            <RankingList data={data.ranking} highlightUserId={userId} />
                        </div>
                    </div>
                </div>
            </div>
        </MouseEffectCard>
    );
}
