import React from 'react';
import { MessageCircle, Calendar, Clock, BarChart3, SearchX, LogIn } from 'lucide-react';
import { Card } from "@/components/ui/card";

const TEXT = {
    noData: '\u30c7\u30fc\u30bf\u306a\u3057',
    all: '\u5168\u4f53\u5206\u6790',
    personal: '\u500b\u4eba\u5206\u6790',
    total: '\u5408\u8a08',
    count: '\u4ef6',
    peakHour: '\u30d4\u30fc\u30af\u6642\u9593',
    maxDate: '\u6700\u591a\u65e5',
    maxDow: '\u6700\u591a\u66dc\u65e5',
    weekday: '\u66dc\u65e5',
};

const DOW_MAP = ['\u65e5', '\u6708', '\u706b', '\u6c34', '\u6728', '\u91d1', '\u571f'];

function StatItem({ icon: Icon, title, value, sub, colorClass = "text-[#111F35]", bgClass = "bg-[#111F35]/10", className = "", align = "left" }) {
    const textAlignClass = align === "right" ? "text-right" : "text-left";

    return (
        <div className={`flex h-full w-full min-w-0 items-start justify-start gap-3 p-3 text-left ${className}`}>
            <div className={`shrink-0 rounded-lg p-2 ${bgClass}`}>
                <Icon className={`h-4 w-4 ${colorClass}`} />
            </div>
            <div className={`min-w-0 ${textAlignClass}`}>
                <p className={`truncate ${textAlignClass} text-[10px] font-bold tracking-wider text-gray-500`}>{title}</p>
                <p className={`mt-0.5 truncate ${textAlignClass} text-lg font-black leading-tight text-[#111F35]`}>{value}</p>
                {sub && <p className={`mt-0.5 truncate ${textAlignClass} text-[10px] font-bold text-gray-500`}>{sub}</p>}
            </div>
        </div>
    );
}

function MobileStatItem({ icon: Icon, title, value, sub, colorClass = "text-[#111F35]", bgClass = "bg-[#111F35]/10" }) {
    return (
        <div className="flex min-w-0 items-start gap-2 rounded-xl bg-[#f8f8f8] p-3">
            <div className={`shrink-0 rounded-lg p-1.5 ${bgClass}`}>
                <Icon className={`h-3.5 w-3.5 ${colorClass}`} />
            </div>
            <div className="min-w-0">
                <p className="text-[10px] font-bold leading-none text-gray-500">{title}</p>
                <p className="mt-1 text-lg font-black leading-tight text-[#111F35]">{value}</p>
                {sub && <p className="mt-0.5 text-[10px] font-bold leading-tight text-gray-500">{sub}</p>}
            </div>
        </div>
    );
}

function Section({ title, data, iconSrc, isPersonal = false }) {
    if (!data || data.total === 0) {
        if (isPersonal) {
            return (
                <>
                <div className="relative rounded-xl border-2 border-white bg-white p-4 pt-8 text-center sm:hidden">
                    {iconSrc && (
                        <img
                            src={iconSrc}
                            alt=""
                            className="absolute left-1/2 top-0 z-20 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full object-cover"
                        />
                    )}
                    <div className="mb-4 flex justify-center">
                        <div className="rounded-full bg-[#111F35] px-6 py-2 text-sm font-black leading-tight text-white">
                            {title}
                        </div>
                    </div>
                    <div className="flex flex-col items-center gap-3 py-6">
                        <div className="rounded-full bg-red-100 p-3">
                            <SearchX className="h-5 w-5 text-red-500" />
                        </div>
                        <p className="text-base font-black leading-relaxed text-[#111F35]!" style={{ color: '#111F35' }}>
                            このチャンネルにあなたのデータは<br />
                            ありませんでした！！
                        </p>
                    </div>
                </div>

                <div className="relative hidden h-full min-h-[180px] items-center justify-center overflow-visible rounded-xl border-2 border-white bg-white p-6 text-center sm:flex">
                    <div className="flex flex-col items-center gap-3">
                        <div className="rounded-full bg-red-100 p-3">
                            <SearchX className="h-5 w-5 text-red-500" />
                        </div>
                        <p className="text-base font-black leading-relaxed text-[#111F35]!" style={{ color: '#111F35' }}>
                            このチャンネルにあなたのデータは<br />
                            ありませんでした！！
                        </p>
                    </div>
                </div>
                </>
            );
        }

        return (
            <div className="flex h-full min-h-[180px] items-center justify-center rounded-xl border-2 border-dashed border-white/50 bg-white/12 p-6 text-center text-xs font-bold text-white/75">
                {TEXT.noData}
            </div>
        );
    }

    const color = "text-[#111F35]";
    const bg = "bg-[#f8f8f8]";

    return (
        <>
        <div className="relative rounded-xl border-2 border-white bg-white! p-4 pt-8 sm:hidden">
            {iconSrc && (
                <img
                    src={iconSrc}
                    alt=""
                    className="absolute left-1/2 top-0 z-20 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full object-cover"
                />
            )}
            <div className="mb-4 flex justify-center">
                <div className="rounded-full bg-[#111F35] px-6 py-2 text-sm font-black leading-tight text-white">
                    {title}
                </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
                <MobileStatItem
                    icon={MessageCircle}
                    title={TEXT.total}
                    value={data.total.toLocaleString()}
                    sub={TEXT.count}
                    colorClass={color}
                    bgClass={bg}
                />
                <MobileStatItem
                    icon={Clock}
                    title={TEXT.peakHour}
                    value={data.max_hour ? `${data.max_hour.hour}:00` : '--:--'}
                    sub={data.max_hour ? `${data.max_hour.count}${TEXT.count}` : ''}
                    colorClass="text-orange-500"
                    bgClass="bg-orange-500/10"
                />
                <MobileStatItem
                    icon={Calendar}
                    title={TEXT.maxDate}
                    value={data.max_date ? data.max_date.date.slice(5).replace('-', '/') : '--/--'}
                    sub={data.max_date ? `${data.max_date.count}${TEXT.count}` : ''}
                    colorClass="text-green-500"
                    bgClass="bg-green-500/10"
                />
                <MobileStatItem
                    icon={BarChart3}
                    title={TEXT.maxDow}
                    value={data.max_dow ? `${DOW_MAP[data.max_dow.dow]}${TEXT.weekday}` : '-'}
                    sub={data.max_dow ? `${data.max_dow.count}${TEXT.count}` : ''}
                    colorClass="text-purple-500"
                    bgClass="bg-purple-500/10"
                />
            </div>
        </div>

        <div className="relative hidden h-full min-h-[180px] overflow-visible rounded-xl border-2 border-white bg-white! sm:block">
            <div className="absolute bottom-4 left-1/2 top-4 z-1 w-1.5 -translate-x-1/2 rounded-full bg-gray-300" />
            <div className="absolute left-4 right-4 top-1/2 z-1 h-1.5 -translate-y-1/2 rounded-full bg-gray-300" />

            {iconSrc && (
                <img
                    src={iconSrc}
                    alt=""
                    className="absolute left-1/2 top-0 z-20 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-[#545454] object-cover"
                />
            )}

            <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[#111F35] px-7 py-3 text-center text-base font-black leading-tight text-white">
                {title}
            </div>

            <div className="relative z-0 grid h-full min-h-[172px] grid-cols-2 grid-rows-2">
                <StatItem
                    icon={MessageCircle}
                    title={TEXT.total}
                    value={data.total.toLocaleString()}
                    sub={TEXT.count}
                    colorClass={color}
                    bgClass={bg}
                    className="pr-20"
                />
                <StatItem
                    icon={Clock}
                    title={TEXT.peakHour}
                    value={data.max_hour ? `${data.max_hour.hour}:00` : '--:--'}
                    sub={data.max_hour ? `${data.max_hour.count}${TEXT.count}` : ''}
                    colorClass="text-orange-500"
                    bgClass="bg-orange-500/10"
                    className="flex-row-reverse justify-self-stretch pl-16"
                    align="right"
                />
                <StatItem
                    icon={Calendar}
                    title={TEXT.maxDate}
                    value={data.max_date ? data.max_date.date.slice(5).replace('-', '/') : '--/--'}
                    sub={data.max_date ? `${data.max_date.count}${TEXT.count}` : ''}
                    colorClass="text-green-500"
                    bgClass="bg-green-500/10"
                    className="pr-20"
                />
                <StatItem
                    icon={BarChart3}
                    title={TEXT.maxDow}
                    value={data.max_dow ? `${DOW_MAP[data.max_dow.dow]}${TEXT.weekday}` : '-'}
                    sub={data.max_dow ? `${data.max_dow.count}${TEXT.count}` : ''}
                    colorClass="text-purple-500"
                    bgClass="bg-purple-500/10"
                    className="flex-row-reverse justify-self-stretch pl-16"
                    align="right"
                />
            </div>
        </div>
        </>
    );
}

function LoginRequiredSection({ title }) {
    const openLoginModal = () => {
        window.dispatchEvent(new Event('ymkw:open-login-modal'));
    };

    const renderContent = (compact = false) => (
        <div className={`flex flex-col items-center ${compact ? 'gap-2 py-0' : 'gap-3 py-6'}`}>
            <div className={`rounded-full bg-blue-100 ${compact ? 'p-2.5' : 'p-3'}`}>
                <LogIn className={`${compact ? 'h-4 w-4' : 'h-5 w-5'} text-blue-500`} />
            </div>
            <p className={`${compact ? 'text-sm leading-snug' : 'text-base leading-relaxed'} font-black text-[#111F35]!`} style={{ color: '#111F35' }}>
                あなたはログインしてないため<br />
                個人分析を見れません！！
            </p>
            <button
                type="button"
                onClick={openLoginModal}
                className={`${compact ? 'mt-1 px-5 py-2 text-sm' : 'mt-1 px-6 py-2.5 text-sm'} inline-flex items-center gap-2 rounded-full bg-[#111F35] font-black text-white transition-transform hover:scale-105 active:scale-95`}
            >
                <LogIn className="h-4 w-4" />
                ログイン
            </button>
        </div>
    );

    return (
        <>
            <div className="relative rounded-xl border-2 border-white bg-white p-4 text-center sm:hidden">
                {renderContent(true)}
            </div>

            <div className="relative hidden h-full min-h-[180px] items-center justify-center overflow-visible rounded-xl border-2 border-white bg-white p-4 text-center sm:flex">
                {renderContent(true)}
            </div>
        </>
    );
}

export default function AnalysisPanel({ overall, personal, isPersonalAvailable, personalAvatar }) {
    return (
        <Card className="grid min-h-[220px] grid-cols-1 gap-6 rounded-2xl bg-[#f8f8f8]! p-5 shadow-none! lg:grid-cols-2">
            <Section title={TEXT.all} data={overall} iconSrc="/ymkw.webp" />
            {isPersonalAvailable ? (
                <Section title={TEXT.personal} data={personal} iconSrc={personalAvatar} isPersonal={true} />
            ) : (
                <LoginRequiredSection title={TEXT.personal} />
            )}
        </Card>
    );
}
