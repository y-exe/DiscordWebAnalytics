import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Users, BarChart3, MessageCircle, Zap } from 'lucide-react';

export default function ChannelStatsCard({ ranking, overall, prevOverall }) {
    if (!ranking || !overall) return null;

    const uniqueUsers = overall.unique_users ?? ranking.length;
    const totalMsgs = overall.total;
    const share = ((totalMsgs / (prevOverall?.total || 1)) * 100).toFixed(1);
    const avgMsgs = uniqueUsers > 0 ? (totalMsgs / uniqueUsers).toFixed(1) : 0;

    const intensity = parseFloat(avgMsgs) > 30 ? "高アクティブ" : parseFloat(avgMsgs) > 10 ? "安定" : "穏やか";
    const intensityColor = intensity === "高アクティブ" ? "bg-orange-500" : intensity === "安定" ? "bg-blue-500" : "bg-slate-400";

    return (
        <Card className="h-full border-border bg-card flex flex-col overflow-hidden">
            <CardHeader className="pb-4 bg-muted/20">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <CardTitle className="text-base font-bold text-foreground leading-none">チャンネル分析</CardTitle>
                    </div>
                </div>
            </CardHeader>

            <CardContent className="flex-1 p-6 flex flex-col justify-between gap-6">
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                        <p className="text-[10px] font-black text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                            <Users className="w-3 h-3" /> 参加ユーザー
                        </p>
                        <p className="text-2xl font-black text-foreground">{uniqueUsers.toLocaleString()}</p>
                        <p className="text-[9px] text-muted-foreground font-medium">今月のアクティブユーザー</p>
                    </div>

                    <div className="space-y-1 text-right">
                        <p className="text-[10px] font-black text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 justify-end">
                            比率 <BarChart3 className="w-3 h-3" />
                        </p>
                        <p className="text-2xl font-black text-primary">{share}%</p>
                        <p className="text-[9px] text-muted-foreground font-medium">全体メッセージ内</p>
                    </div>
                </div>

                <div className="h-px bg-linear-to-r from-transparent via-border to-transparent"></div>

                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <MessageCircle className="w-4 h-4 text-muted-foreground" />
                            <span className="text-xs font-bold text-foreground">平均熱量（件/人）</span>
                        </div>
                        <span className="text-sm font-black text-foreground">{avgMsgs}</span>
                    </div>

                    <div className="relative h-2 w-full bg-muted rounded-full overflow-hidden">
                        <div
                            className={`absolute inset-y-0 left-0 transition-all duration-1000 ${intensityColor}`}
                            style={{ width: `${Math.min(100, (parseFloat(avgMsgs) / 50) * 100)}%` }}
                        />
                    </div>

                    <div className="flex items-center justify-between text-[10px] font-bold text-muted-foreground/60 uppercase">
                        <span>低め</span>
                        <div className="flex items-center gap-1 text-primary">
                            <Zap className="w-3 h-3 fill-current" />
                            <span className="font-black text-primary">{intensity}</span>
                        </div>
                        <span>高め</span>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
