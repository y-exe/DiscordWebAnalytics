import { EXCLUDE_CHANNEL_ID } from "./discord-ranking";

export function monthlyBounds(year: number, month: number): [Date, Date] {
  const offset = 9 * 60 * 60 * 1000;
  return [
    new Date(Date.UTC(year, month - 1, 1) - offset),
    new Date(Date.UTC(year, month, 1) - offset),
  ];
}

export function monthlyRankingQuery(
  year: number,
  month: number,
  guildId: string,
  excludedChannelIds: readonly string[] = [EXCLUDE_CHANNEL_ID],
) {
  const [startDate, endDate] = monthlyBounds(year, month);
  return {
    text: `SELECT m.user_id, count(*) AS count, COALESCE(gm.display_name, u.display_name) AS display_name
      FROM messages m
      LEFT JOIN users u ON u.user_id = m.user_id
      LEFT JOIN guild_members gm ON gm.guild_id = m.guild_id AND gm.user_id = m.user_id
      WHERE m.created_at >= $1 AND m.created_at < $2
        AND m.is_bot = FALSE AND m.guild_id = $3 AND m.channel_id <> ALL($4::bigint[])
        AND (u.user_id IS NOT NULL AND u.username NOT ILIKE 'deleted%user' AND COALESCE(gm.display_name, u.display_name) NOT ILIKE 'deleted%user')
      GROUP BY m.user_id, u.display_name, gm.display_name
      ORDER BY count DESC, m.user_id ASC LIMIT 10`,
    values: [startDate, endDate, guildId, excludedChannelIds],
  };
}
