import React from 'react';

export function ReportPeriodCard({ title, subTitle, className = '' }) {
    return (
        <div className={`flex w-fit flex-col items-center gap-1 rounded-xl bg-[#f8f8f8] px-5 py-3 ${className}`}>
            <p className="text-[9px] font-bold text-primary uppercase tracking-[0.2em] leading-none">
                {subTitle}
            </p>
            <h2 className="text-2xl font-extrabold tracking-tight text-foreground md:text-3xl" style={{ fontFamily: '"Outfit", sans-serif' }}>
                {title}
            </h2>
        </div>
    );
}

export default function PageHeader({ title, subTitle, showPeriodCard = true }) {
    return (
        <div className="relative mb-2 pt-3 animate-in fade-in w-full text-center">
            <div className="mb-5 flex flex-col items-center gap-3">
                <img src="/ranking.webp" alt="" className="h-20 w-20 rounded-2xl object-cover md:h-[5.5rem] md:w-[5.5rem]" />
                <p
                    className="text-3xl font-black italic text-foreground md:text-4xl"
                    style={{ fontFamily: '"Noto Sans JP", "Noto Sans Japanese", sans-serif', fontWeight: 900 }}
                >
                    発言ランキングWeb
                </p>
                <p
                    className="-mt-2 text-base font-bold !text-gray-500 md:text-lg"
                    style={{ fontFamily: '"Noto Sans JP", "Noto Sans Japanese", sans-serif' }}
                >
                    個人分析、過去のデータ、詳しいランキング等
                </p>
            </div>
            {showPeriodCard && <ReportPeriodCard title={title} subTitle={subTitle} className="mx-auto mb-4" />}
        </div>
    );
}
