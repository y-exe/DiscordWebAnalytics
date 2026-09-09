"use client";
import { SiDiscord, SiGithub, SiX, SiYoutube } from "react-icons/si";

const socialLinks = [
  { label: "YouTube", href: "https://youtube.com/@yamakawateruki?si=Hb3Fn6Wdkz4tyfs5", Icon: SiYoutube },
  { label: "X（旧Twitter）", href: "https://x.com/YamakawaTeruki", Icon: SiX },
  { label: "Discord", href: "https://discord.gg/Cn7GV9rn7Y", Icon: SiDiscord },
  { label: "GitHub", href: "https://github.com/y-exe/ymkw-top", Icon: SiGithub },
];

export default function FooterSection({ variant = "light" }) {
  const dark = variant === "dark";
  return (
    <footer className={`${dark ? "bg-[#252525] text-white" : "bg-[#f9f9f9] text-foreground"} px-6 py-12 md:px-10 md:py-14`}>
      <div className="mx-auto grid max-w-6xl gap-12">
        <div className="grid gap-10 md:grid-cols-[1fr_1fr_auto] md:items-start">
          <div className="grid grid-cols-2 gap-8">
            <FooterMenu dark={dark} title="メニュー" links={[{ text: "ホーム", href: "/" }, { text: "月間レポート", href: "/month/2026/8" }, { text: "累計ランキング", href: "/all" }, { text: "第一回やまかわ編集大会", href: "https://event.ymkw.top" }]} />
            <FooterMenu dark={dark} title="サイトポリシー" links={[{ text: "プライバシー", href: "/privacy" }, { text: "規約", href: "/terms" }]} />
          </div>
          <div className="hidden md:block" />
          <FooterYamakawa />
        </div>

        <div className={`flex flex-col gap-8 border-t pt-7 sm:flex-row sm:items-end sm:justify-between ${dark ? "border-white/20" : "border-border"}`}>
          <div>
            <p className={`font-['Outfit',Arial,sans-serif] text-3xl font-bold tracking-[-0.05em] ${dark ? "text-white" : "text-foreground"}`}>ymkw.top</p>
            <p className={`mt-1 text-sm font-bold ${dark ? "text-white/60" : "text-muted-foreground"}`}>Copyright © 2026 YamakawaTeruki</p>
          </div>
          <nav className={`flex items-center gap-5 ${dark ? "text-white/65" : "text-muted-foreground"}`} aria-label="ソーシャルメディア">
            {socialLinks.map(({ Icon, ...link }) => <a key={link.label} href={link.href} target="_blank" rel="noreferrer" aria-label={`${link.label}を開く`} className={`flex h-6 w-6 items-center justify-center transition-transform hover:scale-110 ${dark ? "hover:text-white focus-visible:outline-white" : "hover:text-foreground focus-visible:outline-foreground"} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4`}><Icon className="h-5 w-5" aria-hidden="true" /></a>)}
          </nav>
        </div>
      </div>
    </footer>
  );
}

function FooterYamakawa() {
  return (
    <div className="footer-yamakawa" role="img" aria-label="回るやまかわロゴ">
      <div className="footer-yamakawa-grid" aria-hidden="true"><span className="footer-yamakawa-char footer-yamakawa-ya">や</span><span className="footer-yamakawa-char footer-yamakawa-ma">ま</span><span className="footer-yamakawa-char footer-yamakawa-ka">か</span><span className="footer-yamakawa-char footer-yamakawa-wa">わ</span></div>
      <style>{`@font-face{font-family:ZakkuriGothic;src:url('/fonts/ZakkuriGothicFree-Black.otf') format('opentype');font-display:swap}.footer-yamakawa{--footer-logo-size:160px;position:relative;display:flex;width:var(--footer-logo-size);height:var(--footer-logo-size);align-items:center;justify-content:center;justify-self:start;border-radius:22%;background:#f00;overflow:hidden}.footer-yamakawa-grid{position:relative;width:82%;height:82%}.footer-yamakawa-char{position:absolute;top:0;left:0;display:flex;align-items:center;justify-content:center;width:50%;height:50%;color:#fff;font-family:ZakkuriGothic,sans-serif;font-size:calc(var(--footer-logo-size) * .82 * .52);font-weight:900;line-height:.65;animation:footer-yamakawa-move 4s cubic-bezier(.22,1,.36,1) infinite;will-change:transform}.footer-yamakawa-ya{animation-name:footer-yamakawa-ya}.footer-yamakawa-ma{animation-name:footer-yamakawa-ma}.footer-yamakawa-ka{animation-name:footer-yamakawa-ka}.footer-yamakawa-wa{animation-name:footer-yamakawa-wa}@keyframes footer-yamakawa-ya{0%,100%{transform:translate3d(0,0,0)}15%,25%{transform:translate3d(0,100%,0)}40%,50%{transform:translate3d(100%,100%,0)}65%,75%{transform:translate3d(100%,0,0)}}@keyframes footer-yamakawa-ma{0%,100%{transform:translate3d(100%,0,0)}15%,25%{transform:translate3d(0,0,0)}40%,50%{transform:translate3d(0,100%,0)}65%,75%{transform:translate3d(100%,100%,0)}}@keyframes footer-yamakawa-ka{0%,100%{transform:translate3d(0,100%,0)}15%,25%{transform:translate3d(100%,100%,0)}40%,50%{transform:translate3d(100%,0,0)}65%,75%{transform:translate3d(0,0,0)}}@keyframes footer-yamakawa-wa{0%,100%{transform:translate3d(100%,100%,0)}15%,25%{transform:translate3d(100%,0,0)}40%,50%{transform:translate3d(0,0,0)}65%,75%{transform:translate3d(0,100%,0)}}@media(min-width:768px){.footer-yamakawa{justify-self:end}}`}</style>
    </div>
  );
}

function FooterMenu({ title, links, dark }) {
  return (
    <section>
      <h2 className={`mb-5 text-lg font-bold tracking-tight ${dark ? "text-white" : "text-foreground"}`}>{title}</h2>
      <ul className={`space-y-3 text-sm font-bold ${dark ? "text-white/60" : "text-muted-foreground"}`}>
        {links.map((link) => <li key={link.text}><a className={`transition-colors ${dark ? "hover:text-white focus-visible:outline-white" : "hover:text-foreground focus-visible:outline-foreground"} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2`} href={link.href}>{link.text}</a></li>)}
      </ul>
    </section>
  );
}
