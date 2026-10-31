export const DEFAULT_GUILD_ID = '1355073968532619376'
export const DEFAULT_KING_ROLE_ID = '1503873180362739834'
export const EXCLUDE_CHANNEL_ID = '1406033558757314752'

export interface RankingRow {
  user_id: string
  count?: string | number
  msg_count?: string | number
  display_name: string | null
}

interface TextDisplay { type: 10; content: string }
interface Separator { type: 14 }
interface LinkButton {
  type: 2
  style: 5
  label: string
  url: string
  emoji: { id: string; name: string; animated: false }
}
interface ActionRow { type: 1; components: LinkButton[] }
export interface RankingComponent {
  type: 17
  accent_color: number
  components: (TextDisplay | Separator | ActionRow)[]
}

export function buildRankingComponent(
  title: string,
  rows: RankingRow[],
  year: number,
  month: number,
  showRoleReward = true,
  customUrl?: string,
  roleId = DEFAULT_KING_ROLE_ID,
): RankingComponent {
  const components: RankingComponent['components'] = []
  const text = (content: string) => components.push({ type: 10, content })
  if (month === 12) text('**🎍あけましておめでとうございます🎍**')
  text(`# ${title}`)
  text(`-# <#${EXCLUDE_CHANNEL_ID}>はランキングに含まれません`)
  text('-# <:4_:1453234089980334255> **プラチャ内の発言もカウントされます。**')
  rows.forEach((row, index) => {
    const userId = String(row.user_id)
    const count = Number(row.count ?? row.msg_count ?? 0)
    const userName = row.display_name || `<@${userId}>`
    const medals = ['<:first:1452959005625417790>', '<:second:1452958981969543168>', '<:third:1452958880379306024>']
    const rank = index === 0 ? `## ${medals[0]}` : index < 3 ? `### ${medals[index]}` : `**${index + 1}位**`
    text(`${rank} **${userName}** (<@${userId}>) — **${count}回**`)
  })
  components.push({ type: 14 })
  if (showRoleReward && rows[0]) {
    text(`**<:4_:1453234089980334255> 1位の <@${rows[0].user_id}> には <@&${roleId}> ロールが付与されます**`)
    text('-# 1か月ごとに切り替わります')
    components.push({ type: 14 })
  }
  text('### <:2_:1453233982647959752> Web上でさらに詳しく見ることができます')
  text('-# **<a:6_:1455555980816285730> 個人分析・全体分析・グラフ分析・チャンネル比較 など**')
  const button = (label: string, url: string): LinkButton => ({
    type: 2, style: 5, label, url,
    emoji: { id: '1453234036339245249', name: '3_', animated: false },
  })
  components.push({ type: 1, components: [
    button('WEBで詳しく見る', customUrl ?? `https://ymkw.top/month/${year}/${month}`),
    button('全期間のデータを見る', 'https://ymkw.top/all'),
  ] })
  return { type: 17, accent_color: 0x00ddff, components }
}

export function monthlyRankingTitle(year: number, month: number): string {
  return `<:1_:1453233921310589059> ${year}年${month}月の発言ランキングはこちら！`
}

export function serializeComponentEmbed(component: RankingComponent): string | null {
  const json = JSON.stringify({ component })
  // Do not silently drop ranks or truncate names to satisfy Discord's limit.
  return new TextEncoder().encode(json).byteLength <= 3000 ? json : null
}
