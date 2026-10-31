import {
  ActionRowBuilder,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  ContainerBuilder,
  DiscordAPIError,
  Events,
  MessageFlags,
  type SendableChannels,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js'
import type { Pool, PoolClient } from 'pg'
import { ANNOUNCE_CHANNEL_ID, GUILD_ID, KING_ROLE_ID, OWNER_ID } from '../config'
import { updateMonthlyRoleOnce } from '../monthlyRole'
import { buildRankingComponent, monthlyRankingTitle, EXCLUDE_CHANNEL_ID, type RankingRow } from '../../../shared/discord-ranking'
import { monthlyRankingQuery } from '../../../shared/monthly-ranking'

const DELETED_USER_FILTER =
  "(u.user_id IS NOT NULL AND u.username NOT ILIKE 'deleted%user' AND u.display_name NOT ILIKE 'deleted%user')"

const MONTH_SELECT_CUSTOM_ID = 'ranking_month_select'
const OLD_RANKING_BUTTON_CUSTOM_ID = 'view_ranking_details'

function jstYearMonth(date = new Date()): { year: number; month: number } {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
  }).format(date)
  const [year, month] = formatted.split('-').map(Number)
  return { year, month }
}

function shiftMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + delta
  return { year: Math.floor(total / 12), month: (total % 12) + 1 }
}

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

export function buildRankingContainer(
  title: string,
  rows: RankingRow[],
  year: number,
  month: number,
  showRoleReward = true,
  customUrl?: string,
): ContainerBuilder {
  return new ContainerBuilder(
    buildRankingComponent(title, rows, year, month, showRoleReward, customUrl, KING_ROLE_ID),
  )
}

async function sendContainer(channel: SendableChannels, container: ContainerBuilder): Promise<unknown> {
  return channel.send({
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  })
}

async function monthlyRanking(db: Pool | PoolClient, year: number, month: number): Promise<RankingRow[]> {
  const { rows } = await db.query(monthlyRankingQuery(year, month, GUILD_ID))
  return rows as RankingRow[]
}

export async function assignWinnerRole(guild: Guild, winnerId: string): Promise<void> {
  const role = await guild.roles.fetch(KING_ROLE_ID)
  if (!role || !role.editable) throw new Error(`Role ${KING_ROLE_ID} is missing or not editable`)
  const members = await guild.members.fetch()
  const winner = await guild.members.fetch(winnerId)
  const previousWinners = [...members.values()].filter(
    member => member.id !== winnerId && member.roles.cache.has(role.id),
  )
  if (!winner.roles.cache.has(role.id)) await winner.roles.add(role, '前月の発言ランキング1位')
  for (const member of previousWinners) {
    await member.roles.remove(role, '月間ランキングのロール更新')
  }
  console.log(`Monthly role reconciled: role=${role.id} winner=${winnerId} removed=${previousWinners.map(member => member.id).join(',') || 'none'}`)
}

export async function runRankingLogic(
  client: Client,
  pool: Pool,
  year: number,
  month: number,
  channel?: SendableChannels | null,
  isAuto = false,
): Promise<void> {
  try {
    const rows = await monthlyRanking(pool, year, month)

    const guild = client.guilds.cache.get(GUILD_ID) ?? null

    if (rows.length === 0) {
      if (channel) await channel.send(`${year}年${month}月のデータはありません。`)
      return
    }

    const title = monthlyRankingTitle(year, month)
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

export function loadRanking(client: Client, pool: Pool): () => void {
  let timer: ReturnType<typeof setInterval> | undefined
  let running = false
  let stopped = false
  const checkMonthlyRole = async () => {
    if (running || stopped) return
    running = true
    try {
      await updateMonthlyRoleOnce(pool, GUILD_ID, KING_ROLE_ID, async (year, month, db) => {
        const rows = await monthlyRanking(db, year, month)
        if (!rows[0]) throw new Error(`No ranking data for ${year}-${month}`)
        const guild = await client.guilds.fetch(GUILD_ID)
        const winnerId = String(rows[0].user_id)
        await assignWinnerRole(guild, winnerId)
        return winnerId
      })
    } catch (error) {
      console.error('Monthly role update failed; retrying in 60 seconds:', error)
    } finally {
      running = false
    }
  }
  client.once(Events.ClientReady, () => {
    if (stopped) return
    void checkMonthlyRole()
    timer = setInterval(() => void checkMonthlyRole(), 60_000)
  })
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

      if (interaction.isButton() && interaction.customId === OLD_RANKING_BUTTON_CUSTOM_ID) {
        await interaction.reply({
          content:
            'このボタンは古いランキングのものです。\n新しいランキングメッセージをご利用ください！',
          flags: MessageFlags.Ephemeral,
        })
        return
      }
    } catch (error) {
      if (error instanceof DiscordAPIError) {
        console.error(`Ranking Interaction Error: ${error.code} ${error.message}`)
        return
      }
      console.error(`Ranking Error: ${error}`)
    }
  })
  return () => {
    stopped = true
    if (timer) clearInterval(timer)
  }
}

