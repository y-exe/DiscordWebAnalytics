"use client";

import { cn } from "@/lib/utils";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import { Check, LogIn, LogOut, UserRound, X } from "lucide-react";
import { useEffect, useState } from "react";

const smoothSpring = {
    type: "spring",
    bounce: 0,
    duration: 0.35,
};

function getLoggedInUser() {
    const cookies = document.cookie.split("; ").reduce((all, entry) => {
        const separator = entry.indexOf("=");
        if (separator !== -1) all[entry.slice(0, separator)] = entry.slice(separator + 1);
        return all;
    }, {});
    const id = cookies.user_id ? decodeURIComponent(cookies.user_id) : "";
    if (!id || id === "guest") return null;
    return {
        id,
        name: cookies.user_name ? decodeURIComponent(cookies.user_name) : "",
        avatar: cookies.user_avatar ? decodeURIComponent(cookies.user_avatar) : "",
    };
}

export function LogoutButton({ className = "" }) {
    const [isExpanded, setIsExpanded] = useState(false);

    const handleLogoutClick = () => {
        setIsExpanded(true);
    };

    const handleConfirm = () => {
        ["user_id", "user_name", "user_avatar"].forEach((name) => {
            document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`;
        });
        window.dispatchEvent(new Event("ymkw:auth-changed"));
        setIsExpanded(false);
    };

    const handleCancel = () => {
        setIsExpanded(false);
    };

    return (
        <MotionConfig transition={smoothSpring}>
            <motion.div
                layout
                className={cn("relative inline-flex items-center gap-2", className)}
            >
                <motion.div
                    layout
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                >
                    <button
                        className={cn(
                            "h-9 text-xs px-4 inline-flex items-center justify-center rounded-xl font-bold transition-shadow cursor-pointer text-white",
                            isExpanded
                                ? "bg-red-600 hover:bg-red-700"
                                : "bg-red-500 hover:bg-red-600"
                        )}
                        onClick={isExpanded ? handleConfirm : handleLogoutClick}
                    >
                        <AnimatePresence mode="wait" initial={false}>
                            <motion.span
                                key={isExpanded ? "check-icon" : "logout-icon"}
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.8 }}
                                transition={{ duration: 0.15 }}
                                className="mr-2 flex items-center"
                            >
                                {isExpanded ? (
                                    <Check className="h-3.5 w-3.5" />
                                ) : (
                                    <LogOut className="h-3.5 w-3.5" />
                                )}
                            </motion.span>
                        </AnimatePresence>
                        <AnimatePresence mode="wait" initial={false}>
                            <motion.span
                                key={isExpanded ? "confirm" : "logout"}
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -4 }}
                                transition={{ duration: 0.15 }}
                            >
                                {isExpanded ? "確認" : "ログアウト"}
                            </motion.span>
                        </AnimatePresence>
                    </button>
                </motion.div>

                <AnimatePresence mode="popLayout">
                    {isExpanded && (
                        <motion.div
                            key="cancel-button"
                            layout
                            initial={{ opacity: 0, scale: 0.8, x: -8 }}
                            animate={{ opacity: 1, scale: 1, x: 0 }}
                            exit={{ opacity: 0, scale: 0.8, x: -8 }}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                        >
                            <button
                                className="h-9 w-9 inline-flex items-center justify-center rounded-xl border border-border bg-background text-foreground hover:bg-muted cursor-pointer transition-shadow"
                                onClick={handleCancel}
                                aria-label="キャンセル"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.div>
        </MotionConfig>
    );
}

export function LoginButton({ className = "" }) {
    const [user, setUser] = useState(null);

    useEffect(() => {
        const syncUser = () => setUser(getLoggedInUser());
        syncUser();
        window.addEventListener("ymkw:auth-changed", syncUser);
        window.addEventListener("focus", syncUser);
        return () => {
            window.removeEventListener("ymkw:auth-changed", syncUser);
            window.removeEventListener("focus", syncUser);
        };
    }, []);

    const handleLogin = () => {
        window.dispatchEvent(new Event('ymkw:open-login-modal'));
    };

    if (user) {
        return (
            <div className={cn("inline-flex items-center gap-2", className)}>
                <div className="inline-flex max-w-44 items-center gap-2 rounded-xl bg-secondary px-2 py-1.5 text-xs font-bold text-secondary-foreground">
                    {user.avatar ? <img src={user.avatar} alt="" className="h-6 w-6 rounded-full object-cover" /> : <UserRound className="h-4 w-4" />}
                    <span className="truncate">{user.name || "ログイン中"}</span>
                </div>
                <LogoutButton />
            </div>
        );
    }

    return (
        <MotionConfig transition={smoothSpring}>
            <motion.div
                layout
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className={cn("inline-flex", className)}
            >
                <button
                    className="h-9 text-xs px-5 inline-flex items-center justify-center rounded-xl font-bold bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-all cursor-pointer active:scale-95"
                    onClick={handleLogin}
                >
                    <LogIn className="h-3.5 w-3.5 mr-2" />
                    ログイン
                </button>
            </motion.div>
        </MotionConfig>
    );
}
