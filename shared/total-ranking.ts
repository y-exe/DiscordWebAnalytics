import { EXCLUDE_CHANNEL_ID } from './discord-ranking'

export function totalRankingQuery(guildId: string) {
  return {
    text: `SELECT m.user_id, count(*) AS count, u.display_name
      FROM messages m LEFT JOIN users u ON m.user_id = u.user_id
      WHERE m.is_bot = FALSE AND m.guild_id = $1 AND m.channel_id != $2
        AND (u.user_id IS NOT NULL AND u.username NOT ILIKE 'deleted%user' AND u.display_name NOT ILIKE 'deleted%user')
      GROUP BY m.user_id, u.display_name
      ORDER BY count DESC, m.user_id ASC LIMIT 10`,
    values: [guildId, EXCLUDE_CHANNEL_ID],
  }
}
