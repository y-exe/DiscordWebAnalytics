import { EXCLUDE_CHANNEL_ID } from "./discord-ranking";

export function totalRankingQuery(
  guildId: string,
  excludedChannelIds: readonly string[] = [EXCLUDE_CHANNEL_ID],
) {
  return {
    text: `SELECT m.user_id, count(*) AS count, COALESCE(gm.display_name, u.display_name) AS display_name
      FROM messages m
      LEFT JOIN users u ON u.user_id = m.user_id
      LEFT JOIN guild_members gm ON gm.guild_id = m.guild_id AND gm.user_id = m.user_id
      WHERE m.is_bot = FALSE AND m.guild_id = $1 AND m.channel_id <> ALL($2::bigint[])
        AND (u.user_id IS NOT NULL AND u.username NOT ILIKE 'deleted%user' AND COALESCE(gm.display_name, u.display_name) NOT ILIKE 'deleted%user')
      GROUP BY m.user_id, u.display_name, gm.display_name
      ORDER BY count DESC, m.user_id ASC LIMIT 10`,
    values: [guildId, excludedChannelIds],
  };
}
