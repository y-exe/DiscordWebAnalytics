import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type Client,
  ContainerBuilder,
  DiscordAPIError,
  Events,
  MessageFlags,
  type MessageActionRowComponentBuilder,
  SeparatorBuilder,
  type SendableChannels,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
} from 'discord.js'
import type { Pool } from 'pg'
import { ANNOUNCE_CHANNEL_ID, GUILD_ID, OWNER_ID } from '../config'

// 定数
const EMOJI_FIRST = '<:first:1452959005625417790>'
const EMOJI_SECOND = '<:second:1452958981969543168>'
const EMOJI_THIRD = '<:third:1452958880379306024>'
const EXCLUDE_CHANNEL_ID = '1406033558757314752'
const KING_ROLE_ID = '1452968848998531245'

const DELETED_USER_FILTER =
  "(u.user_id IS NOT NULL AND u.username NOT ILIKE 'deleted%user' AND u.display_name NOT ILIKE 'deleted%user')"

const MONTH_SELECT_CUSTOM_ID = 'ranking_month_select'
// 古いランキングメッセージに残っているV1ボタンのcustom_id
const OLD_RANKING_BUTTON_CUSTOM_ID = 'view_ranking_details'

/** 現在のJST年月を取得する (Python版の datetime.now(ZoneInfo("Asia/Tokyo")) 相当) */
function jstYearMonth(date = new Date()): { year: number; month: number } {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
  }).format(date)
  const [year, month] = formatted.split('-').map(Number)
  return { year, month }
}

/** 年月の加算 (Python版の relativedelta(months=...) 相当) */
function shiftMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + delta
  return { year: Math.floor(total / 12), month: (total % 12) + 1 }
}

/** スラッシュコマンド定義 (/month, /all) */
export function rankingCommandDefinitions() {
  return [
    {
      name: 'month',
      description: '【管理者用】指定した月のランキングを手動送信',
    },
    {
      name: 'all',
      description: '【管理者用】全期間のランキングを表示',
    },
  ]
}

function buildMonthSelectRow(): ActionRowBuilder<StringSelectMenuBuilder> {
  const now = jstYearMonth()
  const options: StringSelectMenuOptionBuilder[] = []
  for (let i = 0; i < 12; i++) {
    const { year, month } = shiftMonths(now.year, now.month, -i)
    const mm = String(month).padStart(2, '0')
    options.push(
      new StringSelectMenuOptionBuilder()
        .setLabel(`${year}年 ${mm}月`)
        .setValue(`${year}-${mm}`),
    )
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(MONTH_SELECT_CUSTOM_ID)
    .setPlaceholder('集計したい月を選択してください...')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options)

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)
}

interface RankingRow {
  user_id: string
  count?: string | number
  msg_count?: string | number
  display_name: string | null
}

/** Discord Components V2 (Container) でランキング表示を組み立てる */
function buildRankingContainer(
  title: string,
  rows: RankingRow[],
  year: number,
  month: number,
  showRoleReward = true,
  customUrl?: string,
): ContainerBuilder {
  const container = new ContainerBuilder().setAccentColor(0x00ddff)

  const textDisplay = (content: string) => new TextDisplayBuilder().setContent(content)

  if (month === 12) {
    container.addTextDisplayComponents(textDisplay('**🎍あけましておめでとうございます🎍**'))
  }

  container.addTextDisplayComponents(
    textDisplay(`# ${title}`),
    textDisplay(`-# <#${EXCLUDE_CHANNEL_ID}>はランキングに含まれません`),
    textDisplay('-# <:4_:1453234089980334255> **プラチャ内の発言もカウントされます。**'),
  )

  let topUserId: string | null = null
  rows.forEach((row, index) => {
    const userId = String(row.user_id)
    const count = Number(row.count ?? row.msg_count ?? 0)
    const userName = row.display_name || `<@${userId}>`

    let rankStr: string
    if (index === 0) {
      topUserId = userId
      rankStr = `## ${EMOJI_FIRST} **${userName}** (<@${userId}>) — **${count}回**`
    } else if (index === 1) {
      rankStr = `### ${EMOJI_SECOND} **${userName}** (<@${userId}>) — **${count}回**`
    } else if (index === 2) {
      rankStr = `### ${EMOJI_THIRD} **${userName}** (<@${userId}>) — **${count}回**`
    } else {
      rankStr = `**${index + 1}位** **${userName}** (<@${userId}>) — **${count}回**`
    }

    container.addTextDisplayComponents(textDisplay(rankStr))
  })

  container.addSeparatorComponents(new SeparatorBuilder())

  if (showRoleReward && topUserId) {
    container.addTextDisplayComponents(
      textDisplay(
        `**<:4_:1453234089980334255> 1位の <@${topUserId}> には <@&1452967299404271686> ロールが付与されます**`,
      ),
      textDisplay('-# 1か月ごとに切り替わります'),
    )
    container.addSeparatorComponents(new SeparatorBuilder())
  }

  container.addTextDisplayComponents(
    textDisplay('### <:2_:1453233982647959752> Web上でさらに詳しく見ることができます'),
    textDisplay(
      '-# **<a:6_:1455555980816285730> 個人分析・全体分析・グラフ分析・チャンネル比較 など**',
    ),
  )

  const targetUrl = customUrl ?? `https://ymkw.top/month/${year}/${month}`
  const actionRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel('WEBで詳しく見る')
      .setStyle(ButtonStyle.Link)
      .setURL(targetUrl)
      .setEmoji('<:3_:1453234036339245249>'),
    new ButtonBuilder()
      .setLabel('全期間のデータを見る')
      .setStyle(ButtonStyle.Link)
      .setURL('https://ymkw.top/all')
      .setEmoji('<:3_:1453234036339245249>'),
  )
  container.addActionRowComponents(actionRow)

  return container
}

async function sendContainer(channel: SendableChannels, container: ContainerBuilder): Promise<unknown> {
  return channel.send({
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  })
}

/**
 * ランキング集計・送信・王冠ロール付け外しの共通ロジック
 * (Python版 Ranking.run_ranking_logic 相当)
 */
export async function runRankingLogic(
  client: Client,
  pool: Pool,
  year: number,
  month: number,
  channel?: SendableChannels | null,
  isAuto = false,
): Promise<void> {
  const startDate = new Date(Date.UTC(year, month - 1, 1))
  const endDate = new Date(Date.UTC(year, month, 1) - 1000)

  try {
    const { rows } = await pool.query(
      `
      SELECT m.user_id, count(*) as count, u.display_name
      FROM messages m
      LEFT JOIN users u ON m.user_id = u.user_id
      WHERE m.created_at >= $1 AND m.created_at <= $2
        AND m.is_bot = FALSE AND m.guild_id = $3 AND m.channel_id != ${EXCLUDE_CHANNEL_ID}
        AND ${DELETED_USER_FILTER}
      GROUP BY m.user_id, u.display_name
      ORDER BY count DESC
      LIMIT 10
      `,
      [startDate, endDate, GUILD_ID],
    )

    const guild = client.guilds.cache.get(GUILD_ID) ?? null

    if (rows.length === 0) {
      if (channel) await channel.send(`${year}年${month}月のデータはありません。`)
      return
    }

    const title = `<:1_:1453233921310589059> ${year}年${month}月の発言ランキングはこちら！`
    const container = buildRankingContainer(title, rows, year, month)

    let targetChannel: SendableChannels | null = channel ?? null
    if (isAuto) {
      let announce: SendableChannels | null = null
      if (guild) {
        const found = guild.channels.cache.get(ANNOUNCE_CHANNEL_ID)
        if (found && found.isSendable()) announce = found
      } else {
        const fetched = await client.channels.fetch(ANNOUNCE_CHANNEL_ID).catch(() => null)
        if (fetched && 'send' in fetched) announce = fetched as SendableChannels
      }
      targetChannel = announce
    }

    if (targetChannel) {
      await sendContainer(targetChannel, container)
    }

    if (guild) {
      const topUserId = String(rows[0].user_id)
      await guild.members.fetch().catch(() => null)
      const kingRole = guild.roles.cache.get(KING_ROLE_ID)
      if (kingRole) {
        for (const member of kingRole.members.values()) {
          await member.roles.remove(kingRole).catch(() => {})
        }
        const newKing = guild.members.cache.get(topUserId)
        if (newKing) {
          await newKing.roles.add(kingRole).catch(() => {})
        }
      }
    }
  } catch (error) {
    console.error(`Ranking Error: ${error}`)
  }
}

async function handleAllCommand(
  client: Client,
  pool: Pool,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply()

  const { rows } = await pool.query(
    `
    SELECT
        m.user_id,
        count(*) as count,
        u.display_name,
        u.username,
        u.avatar_url as avatar
    FROM messages m
    LEFT JOIN users u ON m.user_id = u.user_id
    WHERE m.is_bot = FALSE AND m.guild_id = $1 AND m.channel_id != ${EXCLUDE_CHANNEL_ID}
      AND ${DELETED_USER_FILTER}
    GROUP BY m.user_id, u.display_name, u.username, u.avatar_url
    ORDER BY count DESC
    LIMIT 100
    `,
    [GUILD_ID],
  )

  if (rows.length === 0) {
    await interaction.followUp('データがありません')
    return
  }

  const nowJst = jstYearMonth()
  const container = buildRankingContainer(
    '🏆 全期間の発言ランキング',
    rows.slice(0, 10),
    nowJst.year,
    nowJst.month,
    false,
    'https://ymkw.top/all',
  )

  const channel = interaction.channel && 'send' in interaction.channel ? interaction.channel : null
  if (channel) {
    await sendContainer(channel, container)
  }
  await interaction.followUp({
    content: '✅ 全期間ランキングを送信しました。',
    flags: MessageFlags.Ephemeral,
  })
}

export function loadRanking(client: Client, pool: Pool): void {
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        if (interaction.user.id !== OWNER_ID) {
          await interaction.reply({
            content: '権限がありません',
            flags: MessageFlags.Ephemeral,
          })
          return
        }

        if (interaction.commandName === 'month') {
          await interaction.reply({
            content: '集計したい月を選択してください:',
            components: [buildMonthSelectRow()],
            flags: MessageFlags.Ephemeral,
          })
          return
        }

        if (interaction.commandName === 'all') {
          await handleAllCommand(client, pool, interaction)
          return
        }
        return
      }

      if (interaction.isStringSelectMenu() && interaction.customId === MONTH_SELECT_CUSTOM_ID) {
        const [yearStr, monthStr] = (interaction.values[0] ?? '').split('-')
        const year = Number(yearStr)
        const month = Number(monthStr)

        await interaction.reply({
          content: `<:2_:1453233982647959752> ${year}年${month}月の集計を開始し、結果を送信します...`,
          flags: MessageFlags.Ephemeral,
        })

        const targetChannel =
          interaction.channel && 'send' in interaction.channel ? interaction.channel : null
        await runRankingLogic(client, pool, year, month, targetChannel, false)
        return
      }

      // 古いランキングメッセージに残っているボタンへの対応
      // (Python版 DummyOldRankingView 相当。永続ビューはinteractionCreateで応答する)
      if (interaction.isButton() && interaction.customId === OLD_RANKING_BUTTON_CUSTOM_ID) {
        await interaction.reply({
          content:
            'このボタンは古いランキングのものです。\n新しいランキングメッセージをご利用ください！',
          flags: MessageFlags.Ephemeral,
        })
        return
      }
    } catch (error) {
      // DiscordAPIエラー(既に応答済みなど)は分類して握る
      if (error instanceof DiscordAPIError) {
        console.error(`Ranking Interaction Error: ${error.code} ${error.message}`)
        return
      }
      console.error(`Ranking Error: ${error}`)
    }
  })
}

// 月次タスク(月初めの自動ランキング送信)。一時停止中。
// 復活させる場合はnode-cron等で毎日0時(JST)に起動し、
// jstYearMonth()で day===1 を判定して前月分を runRankingLogic(..., isAuto=true) で送信する。
//
// Python版参考実装:
//   @tasks.loop(time=[time(hour=0, minute=0, tzinfo=ZoneInfo("Asia/Tokyo"))])
//   async def monthly_task(self):
//       now = datetime.now(ZoneInfo("Asia/Tokyo"))
//       if now.day != 1: return
//       last_month = now - relativedelta(months=1)
//       guild = self.bot.get_guild(config.GUILD_ID)
//       await self.run_ranking_logic(guild, last_month.year, last_month.month, is_auto=True)
