export interface RankingRow {
  user_id: string;
  count?: string | number;
  msg_count?: string | number;
  display_name: string | null;
}

/** ギルド別に差し替える描画要素。未指定の項目は従来の既定値 (既定ギルド用) になる */
export interface RankingComponentOptions {
  /** 月間ランキングのWEBボタンURL。nullでボタン自体を非表示にする */
  monthUrl?: string | null;
  /** 全期間ランキングのWEBボタンURL。nullでボタン自体を非表示にする */
  allUrl?: string | null;
  /** 除外チャンネルの注記行。nullで非表示 */
  excludedNote?: string | null;
  /** 追加の注記行 (既定ギルドの「プラチャ」案内など)。nullで非表示 */
  extraNote?: string | null;
  /** ヘッダーのサムネイル (ギルドアイコン等)。指定時はセクション+サムネイル構造になる */
  thumbnail?: string | null;
}

interface TextDisplay {
  type: 10;
  content: string;
}
interface Separator {
  type: 14;
}
interface LinkButton {
  type: 2;
  style: 5;
  label: string;
  url: string;
  emoji: { id: string; name: string; animated: false };
}
interface ActionRow {
  type: 1;
  components: LinkButton[];
}
interface Thumbnail {
  type: 11;
  media: { url: string };
}
interface Section {
  type: 9;
  components: TextDisplay[];
  accessory: Thumbnail;
}
export interface RankingComponent {
  type: 17;
  accent_color: number;
  components: (TextDisplay | Separator | ActionRow | Section)[];
}

/** メダル絵文字 (1〜3位) */
const MEDALS = [
  "<:first:1452959005625417790>",
  "<:second:1452958981969543168>",
  "<:third:1452958880379306024>",
];

function rankLine(rank: number, row: RankingRow): string {
  const userId = String(row.user_id);
  const count = Number(row.count ?? row.msg_count ?? 0);
  const userName = row.display_name || `<@${userId}>`;
  const rankLabel = rank <= 3 ? MEDALS[rank - 1] : `**${rank}位**`;
  return `${rankLabel} **${userName}** (<@${userId}>) — **${count}回**`;
}

export function buildRankingComponent(
  title: string,
  rows: RankingRow[],
  year: number,
  month: number,
  showRoleReward = true,
  customUrl?: string,
  roleId?: string | null,
  options: RankingComponentOptions = {},
): RankingComponent {
  const components: RankingComponent["components"] = [];
  const text = (content: string) => components.push({ type: 10, content });
  const monthUrl = options.monthUrl !== undefined ? options.monthUrl : customUrl;
  const allUrl = options.allUrl ?? null;
  const excludedNote = options.excludedNote !== undefined ? options.excludedNote : null;
  const extraNote =
    options.extraNote !== undefined
      ? options.extraNote
      : "-# <:4_:1453234089980334255> **プラチャ内の発言もカウントされます。**";

  if (month === 12) text("**🎍あけましておめでとうございます🎍**");

  // ヘッダー (見出し+注記)。サムネイル指定時はセクション+サムネイル構造になる
  const headerLines = [`# ${title}`];
  if (excludedNote) headerLines.push(excludedNote);
  if (extraNote) headerLines.push(extraNote);
  const headerText = { type: 10 as const, content: headerLines.join("\n") };
  if (options.thumbnail) {
    components.push({
      type: 9,
      components: [headerText],
      accessory: { type: 11, media: { url: options.thumbnail } },
    });
  } else {
    components.push(headerText);
  }

  components.push({ type: 14 });

  // 上位3位と4位以降をグループ化 (コンポーネント数を抑えて読みやすく)
  const podium = rows.slice(0, 3).map((row, index) => rankLine(index + 1, row));
  if (podium.length > 0) text(podium.join("\n"));
  const rest = rows.slice(3).map((row, index) => rankLine(index + 4, row));
  if (rest.length > 0) text(rest.join("\n"));

  components.push({ type: 14 });

  if (showRoleReward && roleId && rows[0]) {
    text(
      `**<:4_:1453234089980334255> 1位の <@${rows[0].user_id}> には <@&${roleId}> ロールが付与されます**`,
    );
    text("-# 1か月ごとに切り替わります");
    components.push({ type: 14 });
  }
  text("### <:2_:1453233982647959752> Web上でさらに詳しく見ることができます");
  text("-# **<a:6_:1455555980816285730> 個人分析・全体分析・グラフ分析・チャンネル比較 など**");
  const button = (label: string, url: string): LinkButton => ({
    type: 2,
    style: 5,
    label,
    url,
    emoji: { id: "1453234036339245249", name: "3_", animated: false },
  });
  const buttons: LinkButton[] = [];
  if (monthUrl) buttons.push(button("WEBで詳しく見る", monthUrl));
  if (allUrl) buttons.push(button("全期間のデータを見る", allUrl));
  if (buttons.length > 0) components.push({ type: 1, components: buttons });
  return { type: 17, accent_color: 0x00ddff, components };
}

/** ギルド設定からランキングの注記行を組み立てる (Botとバックエンドの共有) */
export function rankingComponentNotes(
  excludedChannelIds: readonly string[],
  privateChatCategoryIds: readonly unknown[] = [],
): RankingComponentOptions {
  const excludedNote =
    excludedChannelIds.length === 1
      ? `-# <#${excludedChannelIds[0]}>はランキングに含まれません`
      : excludedChannelIds.length > 1
        ? "-# 除外チャンネルの発言はランキングに含まれません"
        : null;
  const extraNote =
    privateChatCategoryIds.length > 0
      ? "-# <:4_:1453234089980334255> **プラチャ内の発言もカウントされます。**"
      : null;
  return { excludedNote, extraNote };
}

export function monthlyRankingTitle(year: number, month: number): string {
  return `<:1_:1453233921310589059> ${year}年${month}月の発言ランキングはこちら！`;
}

export function buildAllTimeRankingComponent(
  rows: RankingRow[],
  options: RankingComponentOptions = {},
): RankingComponent {
  // 従来どおり「WEBで詳しく見る」1ボタンのみで全期間URLへ遷移させる
  const allUrl = options.allUrl ?? null;
  return buildRankingComponent("🏆 全期間の発言ランキング", rows, 0, 0, false, undefined, null, {
    ...options,
    monthUrl: allUrl,
    allUrl: null,
  });
}

export function serializeComponentEmbed(component: RankingComponent): string | null {
  const json = JSON.stringify({ component });
  // Do not silently drop ranks or truncate names to satisfy Discord's limit.
  return new TextEncoder().encode(json).byteLength <= 3000 ? json : null;
}
