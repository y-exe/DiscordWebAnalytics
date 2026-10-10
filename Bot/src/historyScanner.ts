import { parseArgs } from 'node:util'
import {
  ChannelType,
  type Client,
  Client as DiscordClient,
  Events,
  GatewayIntentBits,
  PermissionsBitField,
  type Guild,
  type GuildBasedChannel,
  type Message,
  type TextChannel,
  type AnyThreadChannel,
} from 'discord.js'
import type { Pool, PoolClient } from 'pg'
import { adjustDbDsn, EXCLUDED_USER_IDS, GUILD_ID, TOKEN } from './config'
import { batchExecute, createPool, withTransaction } from './db'
import { describeChannel } from './cogs/logger'

const DEFAULT_AFTER = '2025-03-28'
const BATCH_SIZE = 100
const MAX_SOURCE_RETRIES = 5
const EXCLUDE_CHANNEL_IDS: string[] = []

function log(level: 'info' | 'warn' | 'error', message: string): void {
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${message}`
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

function parseDateTime(value: string | undefined): Date {
  let normalized = (value ?? DEFAULT_AFTER).trim()
  if (normalized.length === 10) {
    normalized = `${normalized}T00:00:00+09:00`
  }
  normalized = normalized.replace('Z', '+00:00')
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized)) {
    normalized += '+09:00'
  }
  const parsed = new Date(normalized)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: ${value}`)
  }
  return parsed
}

function snowflakeFromMs(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  return (((BigInt(seconds) - 1420070400n) << 22n) + 1n).toString()
}

interface BackfillOptions {
  after: string
  before?: string
  resetProgress: boolean
}

interface Progress {
  last_message_id: string
  last_created_at: Date
}

type ScanSource = TextChannel | AnyThreadChannel

function isScanSource(channel: GuildBasedChannel): channel is ScanSource {
  return channel.type === ChannelType.GuildText || channel.isThread()
}

function formatChannelName(channel: GuildBasedChannel): string {
  if (channel.isThread() && channel.parent) {
    return `${channel.parent.name} / ${channel.name}`
  }
  return channel.name
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function loadProgress(pool: Pool, sourceId: string): Promise<Progress | null> {
  const { rows } = await pool.query(
    'SELECT last_message_id, last_created_at FROM backfill_progress WHERE source_id = $1',
    [sourceId],
  )
  if (rows.length === 0) return null
  return {
    last_message_id: String(rows[0].last_message_id),
    last_created_at: rows[0].last_created_at as Date,
  }
}

async function resetProgress(pool: Pool): Promise<void> {
  await pool.query('TRUNCATE TABLE backfill_progress')
  log('info', 'Cleared backfill progress.')
}

async function saveProgress(
  pool: Pool,
  sourceId: string,
  sourceName: string,
  messageId: string,
  createdAt: Date,
): Promise<void> {
  await pool.query(
    `
    INSERT INTO backfill_progress (source_id, source_name, last_message_id, last_created_at, updated_at)
    VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
    ON CONFLICT (source_id) DO UPDATE
    SET source_name = EXCLUDED.source_name,
        last_message_id = EXCLUDED.last_message_id,
        last_created_at = EXCLUDED.last_created_at,
        updated_at = CURRENT_TIMESTAMP
    `,
    [sourceId, sourceName, messageId, createdAt],
  )
}

async function saveChannels(
  pool: Pool,
  channels: GuildBasedChannel[],
  markMissingInactive = false,
): Promise<void> {
  const channelData: unknown[][] = []
  for (const channel of channels) {
    const { name, categoryName, categoryId, position } = describeChannel(channel)
    channelData.push([channel.id, formatChannelName(channel), categoryName, categoryId, position, true])
  }

  await withTransaction(pool, async (tx) => {
    if (markMissingInactive) {
      await tx.query('UPDATE channels SET is_active = FALSE')
    }
    if (channelData.length > 0) {
      await batchExecute(
        tx,
        `
        INSERT INTO channels (channel_id, name, category_name, category_id, position, is_active)
        VALUES`,
        channelData,
        {
          suffix: `
        ON CONFLICT (channel_id) DO UPDATE
        SET name = EXCLUDED.name,
            category_name = EXCLUDED.category_name,
            category_id = EXCLUDED.category_id,
            position = EXCLUDED.position,
            is_active = EXCLUDED.is_active`,
        },
      )
    }
  })
  log('info', `Synced ${channelData.length} channels.`)
}

async function saveToDb(
  pool: Pool,
  messages: unknown[][],
  users: unknown[][],
): Promise<void> {
  const filteredUsers = users.filter((u) => !EXCLUDED_USER_IDS.has(String(u[0])))
  const filteredMessages = messages.filter((m) => !EXCLUDED_USER_IDS.has(String(m[1])))

  await withTransaction(pool, async (tx: PoolClient) => {
    if (filteredUsers.length > 0) {
      await batchExecute(
        tx,
        `
        INSERT INTO users (user_id, display_name, username, avatar_url)
        VALUES`,
        filteredUsers,
        {
          suffix: `
        ON CONFLICT (user_id) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            username = EXCLUDED.username,
            avatar_url = EXCLUDED.avatar_url`,
        },
      )
    }

    if (filteredMessages.length > 0) {
      await batchExecute(
        tx,
        `
        INSERT INTO messages (message_id, user_id, channel_id, guild_id, created_at, is_bot, char_count)
        VALUES`,
        filteredMessages,
        {
          suffix: `
        ON CONFLICT (message_id) DO UPDATE SET
            user_id = EXCLUDED.user_id,
            channel_id = EXCLUDED.channel_id,
            guild_id = EXCLUDED.guild_id,
            created_at = EXCLUDED.created_at,
            is_bot = EXCLUDED.is_bot,
            char_count = EXCLUDED.char_count`,
        },
      )
    }
  })
}

async function collectThreads(
  guild: Guild,
  parentChannels: GuildBasedChannel[],
): Promise<AnyThreadChannel[]> {
  const parentIds = new Set(parentChannels.map((c) => c.id))
  const me = guild.members.me
  const threadsById = new Map<string, AnyThreadChannel>()
  let skippedPermissionCount = 0

  const active = await guild.channels.fetchActiveThreads().catch(() => null)
  if (active) {
    for (const thread of active.threads.values()) {
      if (thread.parentId && parentIds.has(thread.parentId) && !EXCLUDE_CHANNEL_IDS.includes(thread.id)) {
        threadsById.set(thread.id, thread)
      }
    }
  }

  for (const parent of parentChannels) {
    const perms = me ? parent.permissionsFor(me) : null
    if (
      !perms?.has([
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.ViewChannel,
      ])
    ) {
      skippedPermissionCount++
      continue
    }

    if ('threads' in parent && parent.threads) {
      for (const thread of parent.threads.cache.values()) {
        if (!EXCLUDE_CHANNEL_IDS.includes(thread.id)) {
          threadsById.set(thread.id, thread)
        }
      }
    }

    if ('threads' in parent && parent.threads) {
      try {
        const publicArchived = await parent.threads.fetchArchived({ type: 'public' })
        for (const thread of publicArchived.threads.values()) {
          if (!EXCLUDE_CHANNEL_IDS.includes(thread.id)) {
            threadsById.set(thread.id, thread)
          }
        }
      } catch (error) {
        log('warn', `Failed to fetch archived threads in ${parent.name}: ${error}`)
      }

      if (parent.type === ChannelType.GuildText) {
        try {
          const privateArchived = await parent.threads.fetchArchived({ type: 'private' })
          for (const thread of privateArchived.threads.values()) {
            if (!EXCLUDE_CHANNEL_IDS.includes(thread.id)) {
              threadsById.set(thread.id, thread)
            }
          }
        } catch (error) {
          log('info', `Skipping unjoined private archived threads in ${parent.name}: ${error}`)
        }
      }
    }

    await sleep(500)
  }

  if (skippedPermissionCount > 0) {
    log(
      'warn',
      `Skipped archived-thread discovery in ${skippedPermissionCount} channels due to missing channel permissions.`,
    )
  }

  return [...threadsById.values()]
}

async function fetchPage(
  channel: ScanSource,
  afterId: string,
  beforeId: string | null,
): Promise<Message[]> {
  const result = await channel.messages.fetch({
    limit: 100,
    after: afterId,
    ...(beforeId ? { before: beforeId } : {}),
  })
  return [...result.values()].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
}

async function scanMessageSourceOnce(
  pool: Pool,
  channel: ScanSource,
  cursorAfterId: string,
  beforeId: string | null,
): Promise<number> {
  const batchMessages: unknown[][] = []
  const userData = new Map<string, unknown[]>()
  let channelCount = 0
  let lastMessage: Message | null = null

  while (true) {
    const page = await fetchPage(channel, cursorAfterId, beforeId)
    if (page.length === 0) break

    for (const msg of page) {
      cursorAfterId = msg.id
      lastMessage = msg

      if (EXCLUDED_USER_IDS.has(msg.author.id)) continue

      batchMessages.push([
        msg.id,
        msg.author.id,
        msg.channel.id,
        msg.guildId ?? GUILD_ID,
        msg.createdAt,
        msg.author.bot,
        msg.content.length,
      ])

      if (!userData.has(msg.author.id)) {
        userData.set(msg.author.id, [
          msg.author.id,
          msg.author.displayName ?? msg.author.username,
          msg.author.username,
          msg.author.displayAvatarURL(),
        ])
      }

      if (batchMessages.length >= BATCH_SIZE) {
        await saveToDb(pool, batchMessages, [...userData.values()])
        await saveProgress(
          pool,
          msg.channel.id,
          formatChannelName(msg.channel as GuildBasedChannel),
          msg.id,
          msg.createdAt,
        )
        channelCount += batchMessages.length
        batchMessages.length = 0
        userData.clear()
        await sleep(500)
      }
    }

    if (page.length < 100) break
  }

  if (batchMessages.length > 0 || userData.size > 0) {
    await saveToDb(pool, batchMessages, [...userData.values()])
    if (lastMessage && batchMessages.length > 0) {
      await saveProgress(pool, channel.id, formatChannelName(channel), lastMessage.id, lastMessage.createdAt)
    }
    channelCount += batchMessages.length
  }

  return channelCount
}

async function scanMessageSource(
  pool: Pool,
  guild: Guild,
  channel: ScanSource,
  afterMs: number,
  beforeMs: number | null,
  index: number,
  total: number,
): Promise<{ processed: number; success: boolean | null }> {
  const me = guild.members.me
  const perms = me ? channel.permissionsFor(me) : null
  if (
    !perms?.has([
      PermissionsBitField.Flags.ReadMessageHistory,
      PermissionsBitField.Flags.ViewChannel,
    ])
  ) {
    return { processed: 0, success: null }
  }

  log('info', `[${index}/${total}] Scanning: ${formatChannelName(channel)}...`)
  let processed = 0
  let retries = 0
  let progress = await loadProgress(pool, channel.id)
  const afterSnowflake = snowflakeFromMs(afterMs)
  const beforeSnowflake = beforeMs !== null ? snowflakeFromMs(beforeMs) : null

  let cursorAfterId = afterSnowflake
  if (
    progress &&
    progress.last_message_id &&
    progress.last_created_at &&
    progress.last_created_at.getTime() > afterMs
  ) {
    cursorAfterId = progress.last_message_id
    log(
      'info',
      `Resuming ${formatChannelName(channel)} after message ${progress.last_message_id} (${progress.last_created_at.toISOString()})`,
    )
  } else {
    progress = null
  }

  while (true) {
    try {
      const channelCount = await scanMessageSourceOnce(pool, channel, cursorAfterId, beforeSnowflake)
      processed += channelCount
      log('info', `Finished ${formatChannelName(channel)}: Processed ${processed} messages.`)
      await sleep(2000)
      return { processed, success: true }
    } catch (error) {
      const isForbidden =
        typeof error === 'object' && error !== null && (error as { status?: number }).status === 403
      if (isForbidden) {
        log('error', `Forbidden error in ${formatChannelName(channel)}. Skipping.`)
        return { processed, success: null }
      }

      retries++
      progress = await loadProgress(pool, channel.id)
      if (progress && progress.last_message_id) {
        cursorAfterId = progress.last_message_id
      }
      if (retries > MAX_SOURCE_RETRIES) {
        log(
          'error',
          `Giving up ${formatChannelName(channel)} after ${retries} retries: ${error}`,
        )
        return { processed, success: false }
      }
      const waitSeconds = Math.min(60, 5 * retries)
      log(
        'warn',
        `Temporary error in ${formatChannelName(channel)}: ${error}. Retry ${retries}/${MAX_SOURCE_RETRIES} after ${waitSeconds}s.`,
      )
      await sleep(waitSeconds * 1000)
    }
  }
}

async function backfill(
  client: Client,
  options: BackfillOptions,
): Promise<void> {
  log('info', 'Starting history backfill process...')

  const dsn = await adjustDbDsn(process.env.DB_DSN)
  if (!dsn) {
    log('error', 'DB_DSN is not configured.')
    return
  }

  const pool = createPool(dsn, {
    max: 5,
    applicationName: 'ymkw-history-scanner',
    statementTimeoutMs: 120_000,
  })

  try {
    if (options.resetProgress) {
      await resetProgress(pool)
    }
    const afterDate = parseDateTime(options.after)
    const beforeDate = options.before ? parseDateTime(options.before) : null
    log('info', `Fetching messages after ${afterDate.toISOString()}`)
    if (beforeDate) {
      log('info', `Fetching messages before ${beforeDate.toISOString()}`)
    }

    const guild = client.guilds.cache.get(GUILD_ID)
    if (!guild) {
      log('error', `Guild not found (ID: ${GUILD_ID}).`)
      return
    }

    await guild.channels.fetch()
    let totalMessages = 0

    const allChannels = [...guild.channels.cache.values()]
    const textChannels = allChannels.filter(
      (c) => c.type === ChannelType.GuildText && !EXCLUDE_CHANNEL_IDS.includes(c.id),
    )
    const forumChannels = allChannels.filter(
      (c) => c.type === ChannelType.GuildForum && !EXCLUDE_CHANNEL_IDS.includes(c.id),
    )
    log(
      'info',
      `Found ${textChannels.length} text channels and ${forumChannels.length} forum channels.`,
    )
    await saveChannels(pool, [...textChannels, ...forumChannels], true)

    const sources: ScanSource[] = [...textChannels.filter(isScanSource)]

    const threads = await collectThreads(guild, [...textChannels, ...forumChannels])
    await saveChannels(pool, threads, false)
    sources.push(...threads)
    log('info', `Scanning ${sources.length} message sources including ${threads.length} threads.`)

    const failedSources: string[] = []
    let skippedPermissionSources = 0
    for (let i = 0; i < sources.length; i++) {
      const { processed, success } = await scanMessageSource(
        pool,
        guild,
        sources[i],
        afterDate.getTime(),
        beforeDate ? beforeDate.getTime() : null,
        i + 1,
        sources.length,
      )
      totalMessages += processed
      if (success === null) {
        skippedPermissionSources++
        continue
      }
      if (!success) {
        failedSources.push(formatChannelName(sources[i]))
      }
    }

    log('info', `==========\nBackfill complete! Total processed: ${totalMessages} messages.`)
    if (skippedPermissionSources > 0) {
      log(
        'warn',
        `Skipped ${skippedPermissionSources} message sources due to missing channel permissions.`,
      )
    }
    if (failedSources.length > 0) {
      throw new Error(
        `Backfill finished with ${failedSources.length} incomplete sources: ${failedSources.slice(0, 10).join(', ')}`,
      )
    }
  } finally {
    await pool.end()
  }
}

function parseBackfillOptions(): BackfillOptions {
  const { values } = parseArgs({
    options: {
      after: {
        type: 'string',
        default: process.env.BACKFILL_AFTER ?? DEFAULT_AFTER,
      },
      before: {
        type: 'string',
        default: process.env.BACKFILL_BEFORE,
      },
      'reset-progress': { type: 'boolean', default: false },
    },
  })
  return {
    after: values.after as string,
    before: values.before as string | undefined,
    resetProgress: Boolean(values['reset-progress']),
  }
}

async function run(): Promise<void> {
  if (!TOKEN) {
    log('error', 'DISCORD_TOKEN is missing in .env')
    process.exit(1)
  }

  const options = parseBackfillOptions()

  const client = new DiscordClient({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  })

  let failed = false
  client.once(Events.ClientReady, async (ready) => {
    log('info', `Logged in as ${ready.user.tag}`)
    try {
      await backfill(client, options)
    } catch (error) {
      log('error', `Backfill error: ${error}`)
      failed = true
    } finally {
      log('info', 'Closing client...')
      await client.destroy()
      process.exit(failed ? 1 : 0)
    }
  })

  try {
    await client.login(TOKEN)
  } catch (error) {
    log('error', `Bot execution error: ${error}`)
    process.exit(1)
  }
}

void run()
