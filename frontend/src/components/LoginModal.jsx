import React, { useState, useEffect } from 'react';
import { Search, User } from 'lucide-react';
import { fetchAPI } from '@/lib/api';

export default function LoginModal() {
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const cookies = document.cookie.split('; ').reduce((acc, current) => {
            const [name, value] = current.split('=');
            acc[name] = value;
            return acc;
        }, {});

        if (!cookies.user_id) {
            setIsOpen(true);
        }
    }, []);

    useEffect(() => {
        const openLoginModal = () => setIsOpen(true);

        window.addEventListener('ymkw:open-login-modal', openLoginModal);
        return () => window.removeEventListener('ymkw:open-login-modal', openLoginModal);
    }, []);

    if (!isOpen) return null;

    const handleSearch = async (e) => {
        const val = e.target.value;
        setQuery(val);

        if (val.length > 0) {
            setLoading(true);
            try {
                const res = await fetchAPI(`/users/search?q=${encodeURIComponent(val)}`);
                if (res.ok) {
                    const data = await res.json();
                    setResults(data);
                } else {
                    console.error("Search API Error:", res.status);
                }
            } catch (error) {
                console.error("Fetch Error:", error);
            } finally {
                setLoading(false);
            }
        } else {
            setResults([]);
        }
    };

    const setCookie = (name, value) => {
        document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=604800; SameSite=Lax`;
    };

    const handleLogin = (user) => {
        setCookie('user_id', user.user_id);
        setCookie('user_name', user.display_name);
        setCookie('user_avatar', user.avatar || '');

        setIsOpen(false);
        window.dispatchEvent(new Event('ymkw:auth-changed'));
        window.location.reload();
    };

    const handleSkip = () => {
        setCookie('user_id', 'guest');
        setIsOpen(false);
        window.dispatchEvent(new Event('ymkw:auth-changed'));
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-100 flex items-center justify-center p-4">
            <div className="bg-card text-card-foreground rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-fade-in border border-border">
                <div className="p-6 border-b border-border">
                    <div className="mb-5 flex items-center gap-3 text-left">
                        <img src="/ranking.webp" alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover shadow-xs" />
                        <div className="min-w-0">
                            <p
                                className="text-sm md:text-xl font-black text-foreground whitespace-nowrap"
                                style={{ fontFamily: '"Noto Sans JP", "Noto Sans Japanese", sans-serif', fontWeight: 900 }}
                            >
                                発言ランキングWeb ログイン
                            </p>
                            <p
                                className="mt-1 text-xs md:text-sm font-bold text-gray-500 whitespace-nowrap"
                                style={{ fontFamily: '"Noto Sans JP", "Noto Sans Japanese", sans-serif' }}
                            >
                                個人分析、過去のデータ、詳しいランキング等
                            </p>
                        </div>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                        やまかわてるき鯖に入っているDiscordの表示名またはユーザー名で検索してください!!
                    </p>
                </div>

                <div className="p-4">
                    <div className="relative mb-4">
                        <Search className="absolute left-3 top-2.5 w-5 h-5 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="ユーザー名で検索..."
                            className="w-full pl-10 pr-4 py-2 bg-muted border border-input rounded-xl focus:ring-2 focus:ring-primary focus:outline-hidden transition-all placeholder:text-muted-foreground"
                            value={query}
                            onChange={handleSearch}
                        />
                    </div>

                    <div className="h-64 overflow-y-auto custom-scrollbar space-y-2">
                        {loading && <p className="text-center text-sm text-muted-foreground">検索中...</p>}

                        {!loading && results.map(user => (
                            <button
                                key={user.user_id}
                                onClick={() => handleLogin(user)}
                                className="w-full flex items-center gap-3 p-3 hover:bg-muted rounded-xl transition-colors text-left"
                            >
                                {user.avatar ? (
                                    <img src={user.avatar} className="w-10 h-10 rounded-full border border-border" />
                                ) : (
                                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center"><User className="w-5 h-5 text-muted-foreground" /></div>
                                )}
                                <div>
                                    <p className="font-bold text-foreground text-sm">{user.display_name}</p>
                                    <p className="text-xs text-muted-foreground">@{user.username}</p>
                                </div>
                            </button>
                        ))}

                        {!loading && results.length === 0 && query && (
                            <p className="text-center text-muted-foreground text-sm py-4">ユーザーが見つかりません。<br />(Botの同期が完了していない可能性があります)</p>
                        )}
                    </div>
                </div>

                <div className="p-4 bg-muted/50 text-center border-t border-border">
                    <button onClick={handleSkip} className="text-sm text-muted-foreground hover:text-foreground underline transition-colors">
                        ログインせずに閲覧する
                    </button>
                </div>
            </div>
        </div>
    );
}
