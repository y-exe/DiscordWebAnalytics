import { Events, type Client, type GuildBasedChannel, type Message } from "discord.js";
import type { Pool } from "pg";
import { EXCLUDED_USER_IDS } from "../config";

export function describeChannel(channel: GuildBasedChannel): {
  name: string;
  categoryName: string;
  categoryId: string | null;
  position: number;
} {
  const isThread = channel.isThread();
  const parent = isThread ? channel.parent : null;
  const category = isThread ? (parent?.parent ?? null) : channel.parent;

  const categoryName = category?.name ?? "未分類";
  const categoryId = category?.id ?? null;
  const categoryPosition = category?.position ?? 999;

  let basePosition = 999;
  if (parent) {
    basePosition = parent.position;
  } else if (!isThread) {
    basePosition = channel.position;
  }

  const position = categoryPosition * 1000 + basePosition;
  const name = parent ? `${parent.name} / ${channel.name}` : channel.name;
  return { name, categoryName, categoryId, position };
}

export function loadLogger(client: Client, pool: Pool): void {
  const knownChannelIds = new Set<string>();
  const knownMemberIds = new Set<string>();

  async function ensureChannel(channel: GuildBasedChannel, guildId: string): Promise<void> {
    if (knownChannelIds.has(channel.id)) return;

    const { name, categoryName, categoryId, position } = describeChannel(channel);

    await pool.query(
      `
      INSERT INTO channels (channel_id, guild_id, name, category_name, category_id, position, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, TRUE)
      ON CONFLICT (channel_id) DO UPDATE
      SET guild_id = EXCLUDED.guild_id,
          name = EXCLUDED.name,
          category_name = EXCLUDED.category_name,
          category_id = EXCLUDED.category_id,
          position = EXCLUDED.position,
          is_active = TRUE
      `,
      [channel.id, guildId, name, categoryName, categoryId, position],
    );
    knownChannelIds.add(channel.id);
  }

  /** 新規発言者のユーザー・ギルド別メンバー情報を記録する (同期を待たずに表示名を最新化) */
  async function ensureMember(message: Message<true>): Promise<void> {
    const userId = message.author.id;
    if (knownMemberIds.has(userId)) return;

    const displayName =
      message.member?.displayName ?? message.author.displayName ?? message.author.username;
    const avatarUrl = message.member?.displayAvatarURL() ?? message.author.displayAvatarURL();

    await pool.query(
      `
      INSERT INTO users (user_id, display_name, username, avatar_url)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id) DO UPDATE
      SET display_name = EXCLUDED.display_name, username = EXCLUDED.username, avatar_url = EXCLUDED.avatar_url
      `,
      [userId, displayName, message.author.username, avatarUrl],
    );
    await pool.query(
      `
      INSERT INTO guild_members (guild_id, user_id, display_name, avatar_url)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (guild_id, user_id) DO UPDATE
      SET display_name = EXCLUDED.display_name,
          avatar_url = EXCLUDED.avatar_url,
          updated_at = CURRENT_TIMESTAMP
      `,
      [message.guild.id, userId, displayName, avatarUrl],
    );
    knownMemberIds.add(userId);
  }

  client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot || !message.inGuild() || EXCLUDED_USER_IDS.has(message.author.id)) {
      return;
    }

    try {
      await ensureChannel(message.channel, message.guild.id);
      await ensureMember(message);
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
      );
    } catch (error) {
      console.error(`Log Error: ${error}`);
    }
  });

  client.on(Events.MessageDelete, async (message) => {
    try {
      await pool.query("DELETE FROM messages WHERE message_id = $1", [message.id]);
    } catch (error) {
      console.error(`Delete Error: ${error}`);
    }
  });

  client.on(Events.MessageBulkDelete, async (messages) => {
    if (!messages.size) return;
    try {
      await pool.query("DELETE FROM messages WHERE message_id = ANY($1::bigint[])", [
        [...messages.keys()],
      ]);
    } catch (error) {
      console.error(`Bulk Delete Error: ${error}`);
    }
  });
}
