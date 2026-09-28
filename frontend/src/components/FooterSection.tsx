"use client";
import { SiDiscord, SiGithub, SiX, SiYoutube } from "react-icons/si";
import RotatingYamakawa from "./RotatingYamakawa";

type FooterLink = { text: string; href: string };

const socialLinks = [
  { label: "YouTube", href: "https://youtube.com/@yamakawateruki?si=Hb3Fn6Wdkz4tyfs5", Icon: SiYoutube },
  { label: "X（旧Twitter）", href: "https://x.com/YamakawaTeruki", Icon: SiX },
  { label: "Discord", href: "https://discord.gg/Cn7GV9rn7Y", Icon: SiDiscord },
  { label: "GitHub", href: "https://github.com/y-exe/ymkw-top", Icon: SiGithub },
];

export default function FooterSection({ variant = "light" }: { variant?: "light" | "dark" }) {
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
          <RotatingYamakawa className="mx-auto md:mx-0 md:justify-self-end" />
        </div>

        <div className={`flex flex-col items-center gap-8 border-t pt-7 text-center md:flex-row md:items-end md:justify-between md:text-left ${dark ? "border-white/20" : "border-border"}`}>
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

function FooterMenu({ title, links, dark }: { title: string; links: FooterLink[]; dark: boolean }) {
  return (
    <section className="text-center md:text-left">
      <h2 className={`mb-5 text-lg font-bold tracking-tight ${dark ? "text-white" : "text-foreground"}`}>{title}</h2>
      <ul className={`space-y-3 text-sm font-bold ${dark ? "text-white/60" : "text-muted-foreground"}`}>
        {links.map((link) => <li key={link.text}><a className={`transition-colors ${dark ? "hover:text-white focus-visible:outline-white" : "hover:text-foreground focus-visible:outline-foreground"} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2`} href={link.href}>{link.text}</a></li>)}
      </ul>
    </section>
  );
}
