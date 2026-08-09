import { useEffect, useState } from "react";
import Dashboard from "./Dashboard";

const ADMIN_API_URL = import.meta.env.PUBLIC_ADMIN_API_URL || "https://api.ymkw.top";

function currentJstMonth() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return { year: jst.getUTCFullYear(), month: jst.getUTCMonth() + 1 };
}

function browserUserId() {
  const value = document.cookie.split(/;\s*/).find((cookie) => cookie.startsWith("user_id="))?.slice("user_id=".length);
  return value && value !== "guest" ? decodeURIComponent(value) : null;
}

export default function AdminMonthGate({ year, month }) {
  const [state, setState] = useState("checking");
  const [error, setError] = useState("");
  const [userId, setUserId] = useState(null);
  const [channelId, setChannelId] = useState(null);
  const targetYear = Number(year);
  const targetMonth = Number(month);

  useEffect(() => {
    setUserId(browserUserId());
    setChannelId(new URLSearchParams(window.location.search).get("channel"));
    const current = currentJstMonth();
    const restricted = targetYear > current.year || (targetYear === current.year && targetMonth >= current.month);
    if (!restricted) {
      setState("allowed");
      return;
    }
    fetch(`${ADMIN_API_URL}/admin/session`, { credentials: "include" })
      .then((response) => setState(response.ok ? "allowed" : "login"))
      .catch(() => setState("login"));
  }, [targetMonth, targetYear]);

  async function login(event) {
    event.preventDefault();
    setError("");
    const response = await fetch(`${ADMIN_API_URL}/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: new FormData(event.currentTarget).get("password")?.toString() || "" }),
      credentials: "include",
    });
    if (response.ok) {
      setState("allowed");
      return;
    }
    setError(response.status === 429 ? "試行回数が多すぎます。10分後にもう一度お試しください。" : "パスワードが正しくありません。");
  }

  if (state === "allowed") return <Dashboard year={year} month={month} channelId={channelId} userId={userId} />;
  if (state === "checking") return <div className="min-h-[80vh]" aria-busy="true" />;

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center p-4">
      <form onSubmit={login} className="bg-white p-10 rounded-[2.5rem] border border-gray-200 shadow-2xl max-w-sm w-full text-center space-y-4">
        <h1 className="text-2xl font-black text-gray-900">管理者エリア</h1>
        <p className="text-sm text-gray-500">{year}年{month}月のデータを見るには管理者パスワードが必要です。</p>
        <input type="password" name="password" placeholder="パスワード" autoComplete="current-password" className="w-full px-5 py-4 bg-gray-50 border border-gray-200 rounded-2xl text-center font-bold outline-none focus:border-blue-500" required />
        {error && <p className="text-sm font-bold text-red-600" role="alert">{error}</p>}
        <button type="submit" className="w-full py-4 bg-gray-900 text-white font-bold rounded-2xl hover:bg-black">認証</button>
      </form>
    </div>
  );
}
