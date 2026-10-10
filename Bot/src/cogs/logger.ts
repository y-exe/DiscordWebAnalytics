import { Events, type Client, type GuildBasedChannel, type Message } from 'discord.js'
import type { Pool } from 'pg'
import { EXCLUDED_USER_IDS } from '../config'

/** チャンネル・カテゴリ情報から並び順positionと表示名を組み立てる (logger/sync/scanner共通) */
export function describeChannel(channel: GuildBasedChannel): {
  name: string
  categoryName: string
  categoryId: string | null
  position: number
} {
  const isThread = channel.isThread()
  const parent = isThread ? channel.parent : null
  const category = isThread ? parent?.parent ?? null : channel.parent

  const categoryName = category?.name ?? '未分類'
  const categoryId = category?.id ?? null
  const categoryPosition = category?.position ?? 999

  let basePosition = 999
  if (parent) {
    basePosition = parent.position
  } else if (!isThread) {
    basePosition = channel.position
  }

  const position = categoryPosition * 1000 + basePosition
  const name = parent ? `${parent.name} / ${channel.name}` : channel.name
  return { name, categoryName, categoryId, position }
}

export function loadLogger(client: Client, pool: Pool): void {
  const knownChannelIds = new Set<string>()

  async function ensureChannel(channel: GuildBasedChannel): Promise<void> {
    if (knownChannelIds.has(channel.id)) return

    const { name, categoryName, categoryId, position } = describeChannel(channel)

    await pool.query(
      `
      INSERT INTO channels (channel_id, name, category_name, category_id, position, is_active)
      VALUES ($1, $2, $3, $4, $5, TRUE)
      ON CONFLICT (channel_id) DO UPDATE
      SET name = EXCLUDED.name,
          category_name = EXCLUDED.category_name,
          category_id = EXCLUDED.category_id,
          position = EXCLUDED.position,
          is_active = TRUE
      `,
      [channel.id, name, categoryName, categoryId, position],
    )
    knownChannelIds.add(channel.id)
  }

  client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot || !message.inGuild() || EXCLUDED_USER_IDS.has(message.author.id)) {
      return
    }

    try {
      await ensureChannel(message.channel)
      await pool.query(
        `
        INSERT INTO messages (message_id, user_id, channel_id, guild_id, created_at, is_bot, char_count)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (message_id) DO NOTHING
        `,
        [
          message.id,
          message.author.id,
          message.channel.id,
          message.guild.id,
          message.createdAt,
          message.author.bot,
          message.content.length,
        ],
      )
    } catch (error) {
      console.error(`Log Error: ${error}`)
    }
  })

  // discord.py の on_raw_message_delete に相当。
  // discord.js はキャッシュ外の削除も PartialMessage として発火する。
  client.on(Events.MessageDelete, async (message) => {
    try {
      await pool.query('DELETE FROM messages WHERE message_id = $1', [message.id])
    } catch (error) {
      console.error(`Delete Error: ${error}`)
    }
  })

  client.on(Events.MessageBulkDelete, async (messages) => {
    if (!messages.size) return
    try {
      await pool.query('DELETE FROM messages WHERE message_id = ANY($1::bigint[])', [
        [...messages.keys()],
      ])
    } catch (error) {
      console.error(`Bulk Delete Error: ${error}`)
    }
  })
}
