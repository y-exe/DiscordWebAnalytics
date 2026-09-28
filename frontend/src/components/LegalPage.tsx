import FooterSection from "./FooterSection";

type Section = { title?: string; paragraphs: string[]; items?: string[] };
export default function LegalPage({ title, sections }: { title: string; sections: Section[] }) {
  return <main className="legal-page"><div className="max-w-4xl mx-auto py-16 px-6"><header className="legal-header mb-12"><h1 className="text-2xl md:text-4xl font-black tracking-tight">{title}</h1></header><article className="legal-content"><div className="space-y-12 leading-relaxed text-sm">{sections.map((section, index) => <section key={index}>{section.title && <h2 className="text-xl font-bold mb-4">{section.title}</h2>}{section.paragraphs.map((paragraph, p) => <p className="pl-4 mb-4" key={p}>{paragraph}</p>)}{section.items && <ul className="pl-8 list-disc space-y-2">{section.items.map((item, i) => <li key={i}>{item}</li>)}</ul>}</section>)}</div></article></div><FooterSection variant="dark" /></main>;
}
