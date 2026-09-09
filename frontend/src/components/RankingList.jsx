import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export default function RankingList({ data, highlightUserId }) {
    const [isModalOpen, setIsModalOpen] = useState(false);

    if (!data || !Array.isArray(data) || data.length === 0) return null;

    const top1 = data[0];
    const top2 = data[1];
    const top3 = data[2];

    const displayLimit = 15;
    const listItems = data.slice(3, displayLimit);
    const hiddenItems = data.slice(displayLimit);

    const openModal = () => {
        setIsModalOpen(true);
        document.body.style.overflow = 'hidden';
    };
    const closeModal = () => {
        setIsModalOpen(false);
        document.body.style.overflow = 'unset';
    };

    return (
        <Card className="flex h-full flex-col overflow-hidden !border-[4px] !border-white/35 !bg-[#111F35] !text-white !shadow-none">
            <div className="flex items-center gap-2 border-b-2 border-white/15 px-5 py-4">
                <h3 className="text-base font-bold text-white">ランキング</h3>
            </div>

            <div className="flex-shrink-0 border-b-2 border-white/15">
                {top1 && <TopRankRow user={top1} rank={1} isHighlight={String(top1.user_id) === String(highlightUserId)} />}
                <div className="grid grid-cols-2 border-t-2 border-white/15">
                    {top2 && <TopRankRow user={top2} rank={2} isHighlight={String(top2.user_id) === String(highlightUserId)} compact />}
                    {top3 && <TopRankRow user={top3} rank={3} isHighlight={String(top3.user_id) === String(highlightUserId)} compact />}
                </div>
            </div>

            <div className="overflow-hidden flex flex-col">
                <div className="flex-1">
                    {listItems.map((user, i) => (
                        <RankRow key={user.user_id} user={user} rank={i + 4} isMe={String(user.user_id) === String(highlightUserId)} />
                    ))}
                </div>

                {hiddenItems.length > 0 && (
                    <button
                        onClick={openModal}
                        className="w-full border-t-2 border-white/15 bg-white/5 py-3 text-xs font-bold text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                    >
                        さらに表示 ({hiddenItems.length}件)
                    </button>
                )}
            </div>

            {isModalOpen && createPortal(
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 animate-in fade-in" onClick={closeModal}>
                    <Card className="w-full max-w-lg h-[80vh] flex flex-col overflow-hidden animate-in zoom-in-95 !border-[4px] !border-white/35 !bg-[#111F35] !text-white !shadow-none" onClick={e => e.stopPropagation()}>
                        <CardHeader className="p-4 border-b-2 border-white/15 flex flex-row items-center justify-between space-y-0">
                            <CardTitle className="text-lg text-white">ランキング一覧</CardTitle>
                            <button onClick={closeModal} className="p-2 hover:bg-white/10 rounded-full transition-colors"><X className="w-4 h-4 text-white/60" /></button>
                        </CardHeader>
                        <CardContent className="flex-1 overflow-y-auto p-0 custom-scrollbar">
                            {data.map((user, i) => (
                                <RankRow key={user.user_id} user={user} rank={i + 1} isMe={String(user.user_id) === String(highlightUserId)} />
                            ))}
                        </CardContent>
                    </Card>
                </div>,
                document.body
            )}
        </Card>
    );
}

function RankRow({ user, rank, isMe }) {
    return (
        <div className={`flex items-center p-3 border-b-2 border-white/15 last:border-0 transition-colors hover:bg-white/[0.08] ${isMe ? 'bg-[#D02752]/20 hover:bg-[#D02752]/25' : ''}`}>
            <span className={`result-number w-8 text-center font-bold text-sm ${rank <= 3 ? 'text-yellow-400' : 'text-white/45'}`}>{rank}</span>
            <Avatar className="w-8 h-8 mx-3">
                <AvatarImage src={user.avatar} className="object-cover" />
                <AvatarFallback className="text-xs bg-white/10 text-white/70">{user.display_name?.charAt(0) || '?'}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
                <p className={`font-bold text-xs truncate ${isMe ? 'text-[#ff6f91]' : 'text-white'}`}>{user.display_name}</p>
                <p className="text-[10px] text-white/40 truncate">@{user.username}</p>
            </div>
            <div className="text-right">
                <p className="result-number font-bold text-white text-sm">{user.count.toLocaleString()}</p>
                {user.char_count > 0 && (
                    <p className="text-[9px] text-white/40 font-mono">
                        平均 {Math.round(user.char_count / user.count)}
                    </p>
                )}
            </div>
        </div>
    );
}

function TopRankRow({ user, rank, isHighlight, compact = false }) {
    const rankColor = rank === 1 ? 'text-yellow-400' : rank === 2 ? 'text-slate-300' : 'text-orange-300';
    const avatarSize = rank === 1 ? 'w-16 h-16' : 'w-14 h-14';
    const countSize = rank === 1 ? 'text-2xl' : 'text-xl';

    if (rank === 1) {
        return (
            <div className={`relative overflow-hidden border-b-2 border-white/15 px-5 py-5 text-center ${isHighlight ? 'bg-[#D02752]/18' : 'bg-white/[0.035]'}`}>
                <div className="result-number absolute right-5 top-4 text-3xl font-black text-yellow-400/90">1</div>
                <div className="mx-auto mb-3 w-fit">
                    <Avatar className={avatarSize}>
                        <AvatarImage src={user.avatar} className="object-cover" />
                        <AvatarFallback className="bg-white/10 text-white/70">{user.display_name?.charAt(0)}</AvatarFallback>
                    </Avatar>
                </div>
                <h3 className={`mx-auto max-w-full truncate px-8 text-base font-black ${isHighlight ? 'text-[#ff8aa5]' : 'text-white'}`}>
                    {user.display_name}
                </h3>
                <p className="mb-4 truncate text-[11px] text-white/45">@{user.username}</p>
                <div className="border-t-2 border-white/15 py-3">
                    <span className={`result-number block font-black leading-none text-white ${countSize}`}>{user.count.toLocaleString()}</span>
                    <span className="mt-1 block text-[10px] font-bold tracking-wider text-white/45">メッセージ</span>
                </div>
            </div>
        );
    }

    return (
        <div className={`relative flex min-h-[150px] flex-col items-center justify-between px-4 py-5 text-center transition-colors hover:bg-white/[0.06] ${rank === 2 ? 'border-r-2 border-white/15' : ''} ${isHighlight ? 'bg-[#D02752]/18' : 'bg-white/[0.025]'}`}>
            <div className={`result-number absolute right-3 top-3 text-xl font-black ${rankColor} opacity-90`}>
                {rank}
            </div>
            <div className="rounded-full">
                <Avatar className={compact ? 'w-12 h-12' : avatarSize}>
                    <AvatarImage src={user.avatar} className="object-cover" />
                    <AvatarFallback className="bg-white/10 text-white/70">{user.display_name?.charAt(0)}</AvatarFallback>
                </Avatar>
            </div>
            <div className="min-w-0 w-full">
                <h3 className={`truncate text-xs font-black ${isHighlight ? 'text-[#ff8aa5]' : 'text-white'}`}>
                    {user.display_name}
                </h3>
                <p className="truncate text-[10px] text-white/45">@{user.username}</p>
            </div>
            <div className="mt-2 w-full border-t-2 border-white/15 pt-3">
                <span className={`result-number block font-black text-white ${compact ? 'text-lg' : countSize}`}>{user.count.toLocaleString()}</span>
                <div className="text-[9px] font-bold text-white/45">
                    メッセージ
                </div>
            </div>
        </div>
    );
}
