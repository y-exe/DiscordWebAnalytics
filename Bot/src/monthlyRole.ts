import type { Pool, PoolClient } from "pg";
export { monthlyBounds } from "../../shared/monthly-ranking";

export function previousJstMonth(now = new Date()): { year: number; month: number } {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const previous = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth() - 1, 1));
  return { year: previous.getUTCFullYear(), month: previous.getUTCMonth() + 1 };
}

// 再配備時の重複を防ぎ、Discordでの変更完了後にだけ成功を記録する。
export async function updateMonthlyRoleOnce(
  pool: Pool,
  guildId: string,
  roleId: string,
  update: (year: number, month: number, db: PoolClient) => Promise<string>,
  now = new Date(),
): Promise<boolean> {
  const { year, month } = previousJstMonth(now);
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const lock = await db.query("SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired", [
      `ymkw-monthly-role:${guildId}:${roleId}`,
    ]);
    if (!lock.rows[0]?.acquired) {
      await db.query("ROLLBACK");
      return false;
    }
    const completed = await db.query(
      "SELECT 1 FROM monthly_role_runs WHERE guild_id=$1 AND role_id=$2 AND report_year=$3 AND report_month=$4",
      [guildId, roleId, year, month],
    );
    if (completed.rows.length > 0) {
      await db.query("COMMIT");
      return false;
    }
    const winnerId = await update(year, month, db);
    await db.query(
      "INSERT INTO monthly_role_runs (guild_id, role_id, report_year, report_month, winner_id) VALUES ($1,$2,$3,$4,$5)",
      [guildId, roleId, year, month, winnerId],
    );
    await db.query("COMMIT");
    console.log(`Monthly role completed: ${year}-${month} role=${roleId} winner=${winnerId}`);
    return true;
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}
