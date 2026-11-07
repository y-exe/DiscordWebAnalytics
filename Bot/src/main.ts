import { Client, Events, GatewayIntentBits, Options, REST, Routes } from "discord.js";
import { adjustDbDsn, GUILD_ID, TOKEN } from "./config";
import { createPool } from "./db";
import { deactivateGuild, seedPrimaryGuildConfig, syncGuildRegistry } from "./guildRegistry";
import { loadLogger } from "./cogs/logger";
import { loadRanking, rankingCommandDefinitions } from "./cogs/ranking";
import { loadSetup, setupCommandDefinitions } from "./cogs/setup";
import { loadSync } from "./cogs/sync";

async function main(): Promise<void> {
  if (!TOKEN) {
    console.error("エラー: DISCORD_TOKEN が設定されていません。");
    process.exit(1);
  }
  const token = TOKEN;

  const dsn = await adjustDbDsn(process.env.DB_DSN);
  if (!dsn) {
    console.error("エラー: DB_DSN が設定されていません。");
    process.exit(1);
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    makeCache: Options.cacheWithLimits({
      MessageManager: { maxSize: 100 },
    }),
  });

  const pool = createPool(dsn, { max: 5, applicationName: "ymkw-bot" });

  client.once(Events.ClientReady, async (ready) => {
    console.log(`ログイン完了: ${ready.user.tag}`);
    try {
      const rest = new REST().setToken(token);
      const synced = (await rest.put(Routes.applicationCommands(ready.user.id), {
        body: [...rankingCommandDefinitions(), ...setupCommandDefinitions()],
      })) as unknown[];
      console.log(`コマンド同期: ${synced.length}`);
    } catch (error) {
      console.error(`同期エラー: ${error}`);
    }

    try {
      await syncGuildRegistry(pool, ready.guilds.cache.values());
      const primary = ready.guilds.cache.get(GUILD_ID);
      if (primary) await seedPrimaryGuildConfig(pool, primary);
    } catch (error) {
      console.error(`ギルド登録エラー: ${error}`);
    }
  });

  client.on(Events.GuildCreate, (guild) => {
    void syncGuildRegistry(pool, [guild]).catch((error) => {
      console.error(`ギルド登録エラー: ${error}`);
    });
  });
  client.on(Events.GuildDelete, (guild) => {
    void deactivateGuild(pool, guild.id).catch((error) => {
      console.error(`ギルド登録解除エラー: ${error}`);
    });
  });

  loadLogger(client, pool);
  const stopRanking = loadRanking(client, pool);
  loadSetup(client, pool);
  loadSync(client, pool);

  client.on("error", (error) => {
    console.error(`Discord接続エラー: ${error}`);
  });
  process.on("unhandledRejection", (reason) => {
    console.error(`未処理のPromiseエラー: ${reason}`);
  });

  try {
    await client.login(token);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("token") || /an invalid token|401/i.test(message)) {
      console.error("トークン無効");
    } else {
      console.error(`エラー: ${error}`);
    }
    process.exit(1);
  }

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    stopRanking();
    console.log(`停止: ${signal} を受信`);
    try {
      await pool.end();
    } finally {
      client.destroy();
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

void main();
