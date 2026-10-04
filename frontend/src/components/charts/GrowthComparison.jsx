import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Clock, Calendar, ArrowRight } from 'lucide-react';
import { Badge } from "@/components/ui/badge";

export default function GrowthComparison({ current, previous }) {
    if (!current || !previous || current.total === 0) return null;

    const growth = ((current.total - previous.total) / (previous.total || 1)) * 100;
    const isPositive = growth >= 0;

    const maxTotal = Math.max(current.total, previous.total);
    const currentPercent = (current.total / (maxTotal || 1)) * 100;
    const previousPercent = (previous.total / (maxTotal || 1)) * 100;

    return (
        <Card className="w-full border-border shadow-xs overflow-hidden">
            <CardHeader className="pb-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                        <CardTitle className="text-xl font-black flex items-center gap-2">
                            前月比分析
                            <Badge variant={isPositive ? "default" : "destructive"} className="font-black">
                                {isPositive ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                                {isPositive ? '+' : ''}{growth.toFixed(1)}%
                            </Badge>
                        </CardTitle>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-8">
                <div className="space-y-4">
                    <div className="space-y-4">
                        <div className="space-y-1.5">
                            <div className="flex justify-between text-xs font-bold">
                                <span>今月</span>
                                <span className="text-primary">{current.total.toLocaleString()}</span>
                            </div>
                            <div className="h-3 w-full bg-muted rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-primary transition-all duration-1000"
                                    style={{ width: `${currentPercent}%` }}
                                />
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <div className="flex justify-between text-xs font-bold text-muted-foreground">
                                <span>先月</span>
                                <span>{previous.total.toLocaleString()}</span>
                            </div>
                            <div className="h-3 w-full bg-muted rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-muted-foreground/30 transition-all duration-1000"
                                    style={{ width: `${previousPercent}%` }}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex items-center justify-between rounded-xl bg-white p-4">
                        <div className="flex items-center gap-3">
                            <div className="rounded-lg bg-orange-500/10 p-2">
                                <Clock className="w-4 h-4 text-orange-500" />
                            </div>
                            <div>
                                <p className="text-[10px] font-bold text-muted-foreground">ピーク時間</p>
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-bold opacity-50">{previous.max_hour?.hour}:00</span>
                                    <ArrowRight className="w-3 h-3 text-muted-foreground/30" />
                                    <span className="text-sm font-black">{current.max_hour?.hour}:00</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center justify-between rounded-xl bg-white p-4">
                        <div className="flex items-center gap-3">
                            <div className="rounded-lg bg-green-500/10 p-2">
                                <Calendar className="w-4 h-4 text-green-500" />
                            </div>
                            <div>
                                <p className="text-[10px] font-bold text-muted-foreground">最多日</p>
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-bold opacity-50">{previous.max_date?.date.split('-')[2]}日</span>
                                    <ArrowRight className="w-3 h-3 text-muted-foreground/30" />
                                    <span className="text-sm font-black">{current.max_date?.date.split('-')[2]}日</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
