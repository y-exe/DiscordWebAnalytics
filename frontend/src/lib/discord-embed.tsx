import type { Metadata } from "next";
import { serializeJsonLd } from "./seo";

/**
 * Discord Component Embeds (https://docs.discord.com/developers/link-previews/component-embeds)
 * と OG/Twitterカードのための共通ヘルパー。
 *
 * - Discord: <script id="discord:component-embed" type="application/json"> をheadに置く
 *   (inline方式。3,000バイト上限。超過時は説明文・ボタンを自動で削る)
 * - OG/Twitter: generateMetadata に socialMetadata() の結果をマージする
 */

/** Discordブランドカラー (#5865F2) */
const DEFAULT_ACCENT_COLOR = 0x5865f2;

/** inline payloadの上限 (仕様: 3,000バイト)。安全マージンを取る */
const PAYLOAD_BYTE_LIMIT = 2_800;

export interface EmbedButton {
  label: string;
  url: string;
}

export interface ComponentEmbedOptions {
  /** プレビューの見出し (markdownのH1として描画され、ページURLへリンクされる) */
  title: string;
  /** ページの絶対URL (タイトルのリンク先) */
  url: string;
  /** 説明文 (markdownのText Display) */
  description?: string;
  /** サムネイル (ギルドアイコン・アバター等の絶対URL) */
  thumbnailUrl?: string | null;
  /** 下部に並べるリンクボタン */
  buttons?: EmbedButton[];
  /** フッター的な注記 (区切り線の下に小さく表示されるmarkdown) */
  footer?: string;
  accentColor?: number;
}

/**
 * Container (type 17) を頂点とするcomponent embedペイロードを組み立てる。
 * 構成: Section(見出し+説明+サムネイル) / Separator / ボタン行 / フッター
 * 3,000バイト上限のため、超過時は説明文→フッター→ボタンの順で削る。
 */
export function buildComponentEmbed(options: ComponentEmbedOptions): Record<string, unknown> {
  const { title, url, description, thumbnailUrl, buttons, footer } = options;
  const accentColor = options.accentColor ?? DEFAULT_ACCENT_COLOR;

  const assemble = (text: string | undefined, foot: string | undefined, list: EmbedButton[]) => {
    const headSection: Record<string, unknown> = {
      type: 9,
      components: [
        { type: 10, content: `# **[${title}](${url})**` },
        ...(text ? [{ type: 10, content: text }] : []),
      ],
    };
    if (thumbnailUrl) {
      headSection.accessory = { type: 11, media: { url: thumbnailUrl } };
    }
    const body: Array<Record<string, unknown>> = [headSection];
    if (list.length > 0) {
      body.push({ type: 14, spacing: 1 });
      body.push({
        type: 1,
        components: list.map((button) => ({
          type: 2,
          style: 5,
          url: button.url,
          label: button.label,
        })),
      });
    }
    if (foot) {
      body.push({ type: 14, spacing: 1 });
      body.push({ type: 10, content: `-# ${foot}` });
    }
    return { component: { type: 17, accent_color: accentColor, components: body } };
  };

  // 上限内に収めるまで段階的に削る (description → footer → buttons)
  let payload = assemble(description, footer, buttons ?? []);
  if (payloadBytes(payload) > PAYLOAD_BYTE_LIMIT && description) {
    payload = assemble(shorten(description, 160), footer, buttons ?? []);
  }
  if (payloadBytes(payload) > PAYLOAD_BYTE_LIMIT && footer) {
    payload = assemble(description ? shorten(description, 160) : undefined, undefined, buttons ?? []);
  }
  if (payloadBytes(payload) > PAYLOAD_BYTE_LIMIT) {
    payload = assemble(
      description ? shorten(description, 80) : undefined,
      undefined,
      (buttons ?? []).slice(0, 2),
    );
  }
  return payload;
}

function payloadBytes(payload: unknown): number {
  return Buffer.byteLength(JSON.stringify(payload), "utf8");
}

function shorten(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(maxChars - 1, 1))}…`;
}

/**
 * component embedをhead内のinline scriptとして出力する。
 * JSONはserializeJsonLdで `</script>` 等をエスケープしてから埋め込む。
 */
export function DiscordComponentEmbedScript({ payload }: { payload: unknown }) {
  return (
    <script
      id="discord:component-embed"
      type="application/vnd.discord.component-embed+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(payload) }}
    />
  );
}

/**
 * OG + Twitterカードをまとめて組み立てる。
 * imageUrl が正方形 (ギルドアイコン・アバター) なら summary、横長画像なら summary_large_image。
 */
export function socialMetadata(options: {
  title: string;
  description: string;
  url: string;
  imageUrl?: string | null;
  largeImage?: boolean;
}): Metadata {
  const images = options.imageUrl ? [options.imageUrl] : undefined;
  return {
    title: options.title,
    description: options.description,
    alternates: { canonical: options.url },
    openGraph: {
      title: options.title,
      description: options.description,
      url: options.url,
      type: "website",
      ...(images ? { images } : {}),
    },
    twitter: {
      card: options.largeImage && images ? "summary_large_image" : "summary",
      title: options.title,
      description: options.description,
      ...(images ? { images } : {}),
    },
  };
}
