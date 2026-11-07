import {
  ChannelType,
  Events,
  PermissionsBitField,
  type Client,
  type Guild,
  type GuildMember,
} from "discord.js";
import type { Pool } from "pg";
import { EXCLUDED_USER_IDS } from "../config";
import { batchExecute } from "../db";
import { describeChannel } from "./logger";

const SYNC_INTERVAL_MS = 30 * 60 * 1000;
const FETCH_MISSING_USERS_INTERVAL_MS = 12 * 60 * 60 * 1000;

const CHANNELS_UPSERT_PREFIX = `
  INSERT INTO channels (channel_id, guild_id, name, category_name, category_id, position, is_active)
  VALUES`;

const CHANNELS_UPSERT_SUFFIX = `
  ON CONFLICT (channel_id) DO UPDATE
  SET guild_id = EXCLUDED.guild_id,
      name = EXCLUDED.name,
      category_name = EXCLUDED.category_name,
      category_id = EXCLUDED.category_id,
      position = EXCLUDED.position,
      is_active = EXCLUDED.is_active`;

const USERS_UPSERT_PREFIX = `
  INSERT INTO users (user_id, display_name, username, avatar_url)
  VALUES`;

const USERS_UPSERT_SUFFIX = `
  ON CONFLICT (user_id) DO UPDATE
  SET display_name = EXCLUDED.display_name, username = EXCLUDED.username, avatar_url = EXCLUDED.avatar_url`;

const USERS_UPSERT_NO_CONFLICT_SUFFIX = `
  ON CONFLICT (user_id) DO NOTHING`;

const GUILD_MEMBERS_UPSERT_PREFIX = `
  INSERT INTO guild_members (guild_id, user_id, display_name, avatar_url)
  VALUES`;

const GUILD_MEMBERS_UPSERT_SUFFIX = `
  ON CONFLICT (guild_id, user_id) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      avatar_url = EXCLUDED.avatar_url,
      updated_at = CURRENT_TIMESTAMP`;

export function loadSync(client: Client, pool: Pool): void {
  client.once(Events.ClientReady, () => {
    void runLooped(syncChannelsAndMembers, "同期エラー");
    setInterval(() => void runLooped(syncChannelsAndMembers, "同期エラー"), SYNC_INTERVAL_MS);

    void runLooped(fetchMissingUsers, "補完エラー");
    setInterval(
      () => void runLooped(fetchMissingUsers, "補完エラー"),
      FETCH_MISSING_USERS_INTERVAL_MS,
    );
  });

  async function runLooped(
    fn: (client: Client, pool: Pool) => Promise<void>,
    errorLabel: string,
  ): Promise<void> {
    try {
      await fn(client, pool);
    } catch (error) {
      console.error(`${errorLabel}: ${error}`);
    }
  }
}

async function syncChannelsAndMembers(client: Client, pool: Pool): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    try {
      await syncGuildChannelsAndMembers(pool, guild);
    } catch (error) {
      console.error(`同期エラー (${guild.name}): ${error}`);
    }
  }
}

async function syncGuildChannelsAndMembers(pool: Pool, guild: Guild): Promise<void> {
  const me = guild.members.me;
  if (!me) return;

  const guildChannels = [...guild.channels.cache.values()];
  const textAndForum = guildChannels.filter(
    (channel) => channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildForum,
  );
  const activeThreadsResult = await guild.channels.fetchActiveThreads().catch(() => null);
  const activeThreads = activeThreadsResult ? [...activeThreadsResult.threads.values()] : [];

  const channelData: unknown[][] = [];
  for (const channel of [...textAndForum, ...activeThreads]) {
    const perms = channel.permissionsFor(me);
    if (
      !perms?.has([
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.ViewChannel,
      ])
    ) {
      continue;
    }

    const { name, categoryName, categoryId, position } = describeChannel(channel);
    channelData.push([channel.id, guild.id, name, categoryName, categoryId, position, true]);
  }

  // 非アクティブ化は自ギルドのチャンネルに限定する (他ギルドに影響しない)
  await pool.query("UPDATE channels SET is_active = FALSE WHERE guild_id = $1", [guild.id]);
  if (channelData.length > 0) {
    await batchExecute(pool, CHANNELS_UPSERT_PREFIX, channelData, {
      suffix: CHANNELS_UPSERT_SUFFIX,
    });
  }

  const members = (await guild.members.fetch().catch(() => guild.members.cache)) as Map<
    string,
    GuildMember
  >;
  const memberData: unknown[][] = [];
  const guildMemberData: unknown[][] = [];
  for (const member of members.values()) {
    if (member.user.bot || EXCLUDED_USER_IDS.has(member.id)) continue;
    memberData.push([
      member.id,
      member.displayName,
      member.user.username,
      member.displayAvatarURL(),
    ]);
    guildMemberData.push([guild.id, member.id, member.displayName, member.displayAvatarURL()]);
  }

  if (memberData.length > 0) {
    await batchExecute(pool, USERS_UPSERT_PREFIX, memberData, { suffix: USERS_UPSERT_SUFFIX });
    await batchExecute(pool, GUILD_MEMBERS_UPSERT_PREFIX, guildMemberData, {
      suffix: GUILD_MEMBERS_UPSERT_SUFFIX,
    });
  }
  console.log(
    `同期完了 (${guild.name}): チャンネル${channelData.length}件 / メンバー${memberData.length}人`,
  );
}

async function fetchMissingUsers(client: Client, pool: Pool): Promise<void> {
  const { rows } = await pool.query(
    `
    SELECT DISTINCT m.user_id
    FROM messages m
    LEFT JOIN users u ON m.user_id = u.user_id
    WHERE u.user_id IS NULL AND m.is_bot = FALSE AND m.user_id != ALL($1::bigint[])
    `,
    [[...EXCLUDED_USER_IDS]],
  );
  if (rows.length === 0) return;

  console.log(`Unknownユーザー補完開始: 対象${rows.length}人`);

  const updates: unknown[][] = [];
  for (const row of rows) {
    const userId = String(row.user_id);
    if (EXCLUDED_USER_IDS.has(userId)) continue;
    try {
      const user = await client.users.fetch(userId);
      updates.push([
        user.id,
        user.displayName ?? user.username,
        user.username,
        user.displayAvatarURL(),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as { code?: number }).code === 10013
      ) {
        updates.push([userId, "Deleted User", "deleted_user", null]);
      } else {
        console.error(`User fetch error ${userId}: ${error}`);
      }
    }
  }

  if (updates.length > 0) {
    await batchExecute(pool, USERS_UPSERT_PREFIX, updates, {
      suffix: USERS_UPSERT_NO_CONFLICT_SUFFIX,
    });
    console.log(`補完完了: ${updates.length}人`);
  }
}
