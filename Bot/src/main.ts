import {
  Client,
  Events,
  GatewayIntentBits,
  Options,
  REST,
  Routes,
} from 'discord.js'
import { adjustDbDsn, TOKEN } from './config'
import { createPool } from './db'
import { loadLogger } from './cogs/logger'
import { loadRanking, rankingCommandDefinitions } from './cogs/ranking'
import { loadSync } from './cogs/sync'

async function main(): Promise<void> {
  if (!TOKEN) {
    console.error('エラー: DISCORD_TOKEN が設定されていません。')
    process.exit(1)
  }
  const token = TOKEN

  const dsn = await adjustDbDsn(process.env.DB_DSN)
  if (!dsn) {
    console.error('エラー: DB_DSN が設定されていません。')
    process.exit(1)
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    // メッセージ本文は保存せずメタデータのみ記録するため、
    // メッセージキャッシュは小さく保ってメモリ使用量を抑える
    makeCache: Options.cacheWithLimits({
      MessageManager: { maxSize: 100 },
    }),
  })

  const pool = createPool(dsn, { max: 5, applicationName: 'ymkw-bot' })

  client.once(Events.ClientReady, async (ready) => {
    console.log(`ログイン完了: ${ready.user.tag}`)
    try {
      const rest = new REST().setToken(token)
      const synced = (await rest.put(Routes.applicationCommands(ready.user.id), {
        body: rankingCommandDefinitions(),
      })) as unknown[]
      console.log(`コマンド同期: ${synced.length}`)
    } catch (error) {
      console.error(`同期エラー: ${error}`)
    }
    // 準備が整ってから定期同期を開始する (Python版の tasks.loop + wait_until_ready 相当)
    loadSync(client, pool)
  })

  loadLogger(client, pool)
  loadRanking(client, pool)

  client.on('error', (error) => {
    console.error(`Discord接続エラー: ${error}`)
  })
  process.on('unhandledRejection', (reason) => {
    console.error(`未処理のPromiseエラー: ${reason}`)
  })

  try {
    await client.login(token)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.toLowerCase().includes('token') || /an invalid token|401/i.test(message)) {
      console.error('トークン無効')
    } else {
      console.error(`エラー: ${error}`)
    }
    process.exit(1)
  }

  let shuttingDown = false
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`停止: ${signal} を受信`)
    try {
      await pool.end()
    } finally {
      client.destroy()
      process.exit(0)
    }
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

void main()
