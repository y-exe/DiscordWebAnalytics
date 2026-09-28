"use client";

import { useEffect, useMemo, useState } from "react";
import RotatingYamakawa from "./RotatingYamakawa";

function ReelLink({ href, label, event = false }: { href: string; label: string; event?: boolean }) {
  return <a className={`home-action ${event ? "home-action--event" : ""}`} href={href} aria-label={label}><span className="reel" aria-hidden="true">{Array.from(label).map((character, index) => <span className="reel-character" key={`${character}-${index}`}><span className="reel-track" style={{ "--reel-index": index } as React.CSSProperties}><span>{character}</span><span>{character}</span></span></span>)}</span><span className="reel arrow" aria-hidden="true"><span className="reel-character"><span className="reel-track" style={{ "--reel-index": 12 } as React.CSSProperties}><span>→</span><span>→</span></span></span></span></a>;
}

function SocialReel({ label }: { label: string }) { return <span className="social-reel" aria-hidden="true">{Array.from(label).map((character, index) => <span className="social-reel-character" key={`${character}-${index}`}><span className="social-reel-track" style={{ "--reel-index": index } as React.CSSProperties}><span>{character}</span><span>{character}</span></span></span>)}</span>; }

export default function HomePage() {
  const [closing, setClosing] = useState(false);
  const [showLoader, setShowLoader] = useState(true);
  const reportUrl = useMemo(() => { const d = new Date(); d.setDate(0); return `/month/${d.getFullYear()}/${d.getMonth() + 1}`; }, []);
  useEffect(() => {
    const importMap = document.createElement("script");
    importMap.type = "importmap";
    importMap.textContent = JSON.stringify({ imports: { three: "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js", "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/" } });
    document.head.append(importMap);
    const scene = document.createElement("script"); scene.type = "module"; scene.src = "/home-scene/scene.js"; document.body.append(scene);
    const startedAt = performance.now();
    const complete = () => {
      const remaining = Math.max(0, 700 - (performance.now() - startedAt));
      window.setTimeout(() => { setClosing(true); window.setTimeout(() => setShowLoader(false), 900); }, remaining);
    };
    window.addEventListener("ymkw:scene-ready", complete, { once: true });
    const fallback = window.setTimeout(complete, 8000);
    return () => { window.removeEventListener("ymkw:scene-ready", complete); window.clearTimeout(fallback); scene.remove(); importMap.remove(); };
  }, []);
  return <main className="home" aria-label="やまかわてるき">
    <div className="tick" aria-hidden="true">{Array.from({ length: 8 }, (_, row) => <div className="row" key={row}>{Array.from({ length: 6 }, (_, i) => <span key={i}>ymkw.top</span>)}</div>)}</div>
    <div className="model" aria-hidden="true"><span id="hint" hidden /></div><div className="content-shade" aria-hidden="true" /><div className="frame" aria-hidden="true" />
    <section className="home-intro" aria-label="ホームメニュー"><Logo /><h1 className="site-title"><span>ymkw.top</span></h1><p className="site-copy">やまかわてるき鯖分析サイト</p><nav className="navigation" aria-label="統計ページ"><ReelLink href={reportUrl} label="月間レポート" /><ReelLink href="/all" label="累計ランキング" /></nav><div className="event-link"><ReelLink href="https://event.ymkw.top" label="第一回やまかわ編集大会" event /></div></section>
    <nav className="social-bar" aria-label="ソーシャルメディア"><a className="social-link" href="https://youtube.com/@yamakawateruki?si=Hb3Fn6Wdkz4tyfs5" target="_blank" rel="noreferrer" aria-label="YouTubeを開く"><svg className="youtube-icon" viewBox="0 0 28 20" aria-hidden="true"><path fill="#ff0033" d="M27.4 3.1A3.5 3.5 0 0 0 25 .6C22.8 0 18.5 0 14 0S5.2 0 3 .6A3.5 3.5 0 0 0 .6 3.1C0 5.3 0 7.7.6 10s0 4.7.6 6.9A3.5 3.5 0 0 0 3 19.4c2.2.6 6.5.6 11 .6s8.8 0 11-.6a3.5 3.5 0 0 0 2.4-2.5c.6-2.2.6-4.6.6-6.9s0-4.7-.6-6.9Z" /><path fill="#fff" d="m11.2 14.3 7.3-4.3-7.3-4.3z" /></svg><SocialReel label="YouTube" /></a><a className="social-link" href="https://x.com/YamakawaTeruki" target="_blank" rel="noreferrer" aria-label="X（旧Twitter）を開く"><svg className="x-icon" viewBox="0 0 512 512" aria-hidden="true"><path fill="currentColor" d="M459.37 151.716c.325 4.548.325 9.097.325 13.645 0 138.72-105.583 298.558-298.558 298.558-59.452 0-114.68-17.219-161.137-47.106 8.447.974 16.568 1.299 25.34 1.299 49.055 0 94.213-16.568 130.274-44.832-46.132-.975-84.792-31.188-98.112-72.772 6.498.974 12.995 1.624 19.818 1.624 9.421 0 18.843-1.299 27.614-3.573-48.081-9.747-84.143-51.98-84.143-102.985v-1.299c13.969 7.797 30.214 12.67 47.431 13.319-28.264-18.843-46.781-51.005-46.781-87.391 0-19.492 5.197-37.36 14.294-52.954 51.655 63.675 129.3 105.258 216.365 109.807-1.624-7.797-2.599-15.918-2.599-24.04 0-57.828 46.782-104.934 104.934-104.934 30.213 0 57.502 12.67 76.67 33.137 23.715-4.548 46.456-13.32 66.599-25.34-7.798 24.366-24.366 44.833-46.132 57.827 21.117-2.273 41.584-8.122 60.426-16.243-14.292 20.791-32.161 39.308-52.628 54.253Z" /></svg><SocialReel label="X（旧Twitter）" /></a><a className="social-link" href="https://discord.gg/Cn7GV9rn7Y" target="_blank" rel="noreferrer" aria-label="Discord鯖を開く"><svg className="discord-icon" viewBox="0 0 32 24" aria-hidden="true"><path fill="currentColor" d="M25.8 3.2A22 22 0 0 0 20.3 1.5l-.7 1.4a20.3 20.3 0 0 0-7.2 0l-.7-1.4a22 22 0 0 0-5.5 1.7C2.7 8.3 1.7 13.3 2.2 18.2a22 22 0 0 0 6.7 3.4l1.7-2.3a14.7 14.7 0 0 1-2.7-1.4l.7-.5a16.8 16.8 0 0 0 14.8 0l.7.5a15 15 0 0 1-2.7 1.4l1.7 2.3a22 22 0 0 0 6.7-3.4c.6-5.7-1-10.7-4-15ZM11.4 15.3c-1.6 0-2.9-1.5-2.9-3.3s1.3-3.3 2.9-3.3 2.9 1.5 2.9 3.3-1.3 3.3-2.9 3.3Zm9.2 0c-1.6 0-2.9-1.5-2.9-3.3s1.3-3.3 2.9-3.3 2.9 1.5 2.9 3.3-1.3 3.3-2.9 3.3Z" /></svg><SocialReel label="Discord鯖" /></a></nav>
    <nav className="legal-links" aria-label="サイトポリシー"><a href="/terms">terms</a><a href="/privacy">privacy</a></nav><span className="copyright">© 2026 ymkw.top</span>
    {showLoader && <div className={`site-loader ${closing ? "is-closing" : ""}`} role="status" aria-label="ホームページを読み込んでいます"><div className="site-loader-grid" aria-hidden="true"><span className="site-loader-char site-loader-char-1">や</span><span className="site-loader-char site-loader-char-2">ま</span><span className="site-loader-char site-loader-char-3">か</span><span className="site-loader-char site-loader-char-4">わ</span></div></div>}
  </main>;
}

function Logo() { return <RotatingYamakawa size="var(--yamakawa-size)" />; }
