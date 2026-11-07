import {
  ActionRowBuilder,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  ContainerBuilder,
  DiscordAPIError,
  Events,
  MessageFlags,
  PermissionsBitField,
  type SendableChannels,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";
import type { Pool, PoolClient } from "pg";
import {
  ANNOUNCE_CHANNEL_ID,
  EXCLUDED_CHANNEL_IDS,
  GUILD_ID,
  KING_ROLE_ID,
  OWNER_ID,
} from "../config";
import { updateMonthlyRoleOnce } from "../monthlyRole";
import {
  dashboardUrl,
  getGuildConfig,
  listAnnounceGuilds,
  listKingRoleGuilds,
  type GuildConfigWithDisplay,
} from "../guildRegistry";
import {
  buildAllTimeRankingComponent,
  buildRankingComponent,
  monthlyRankingTitle,
  rankingComponentNotes,
  type RankingComponentOptions,
  type RankingRow,
} from "../../../shared/discord-ranking";
import { monthlyRankingQuery } from "../../../shared/monthly-ranking";
import { totalRankingQuery } from "../../../shared/total-ranking";

const MONTH_SELECT_CUSTOM_ID = "ranking_month_select";
const OLD_RANKING_BUTTON_CUSTOM_ID = "view_ranking_details";

function jstYearMonth(date = new Date()): { year: number; month: number } {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
  }).format(date);
  const [year, month] = formatted.split("-").map(Number);
  return { year, month };
}

function shiftMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

export function rankingCommandDefinitions() {
  return [
    {
      name: "month",
      description: "【管理者用】指定した月のランキングを手動送信",
    },
    {
      name: "all",
      description: "【管理者用】全期間のランキングを表示",
    },
  ];
}

function buildMonthSelectRow(): ActionRowBuilder<StringSelectMenuBuilder> {
  const now = jstYearMonth();
  const options: StringSelectMenuOptionBuilder[] = [];
  for (let i = 0; i < 12; i++) {
    const { year, month } = shiftMonths(now.year, now.month, -i);
    const mm = String(month).padStart(2, "0");
    options.push(
      new StringSelectMenuOptionBuilder().setLabel(`${year}年 ${mm}月`).setValue(`${year}-${mm}`),
    );
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(MONTH_SELECT_CUSTOM_ID)
    .setPlaceholder("集計したい月を選択してください...")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

/** ギルド設定からランキング描画の注記・URLを組み立てる */
function rankingComponentOptions(config: GuildConfigWithDisplay | null): RankingComponentOptions {
  if (!config) return {};
  const privateChatCategoryIds = config.displayConfig?.privateChatCategoryIds;
  return rankingComponentNotes(
    config.excludedChannelIds,
    Array.isArray(privateChatCategoryIds) ? privateChatCategoryIds : [],
  );
}

export function buildRankingContainer(
  title: string,
  rows: RankingRow[],
  year: number,
  month: number,
  showRoleReward = true,
  customUrl?: string,
  config: GuildConfigWithDisplay | null = null,
): ContainerBuilder {
  if (!config) {
    return new ContainerBuilder(
      buildRankingComponent(title, rows, year, month, showRoleReward, customUrl, KING_ROLE_ID),
    );
  }
  const monthUrl = dashboardUrl(config, `/month/${year}/${month}`) ?? customUrl;
  return new ContainerBuilder(
    buildRankingComponent(
      title,
      rows,
      year,
      month,
      showRoleReward,
      monthUrl,
      config.kingRoleId ?? KING_ROLE_ID,
      {
        ...rankingComponentOptions(config),
        monthUrl: monthUrl ?? null,
      },
    ),
  );
}

async function sendContainer(
  channel: SendableChannels,
  container: ContainerBuilder,
): Promise<unknown> {
  return channel.send({
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  });
}

async function monthlyRanking(
  db: Pool | PoolClient,
  year: number,
  month: number,
  guildId: string,
  excludedChannelIds: readonly string[],
): Promise<RankingRow[]> {
  const { rows } = await db.query(monthlyRankingQuery(year, month, guildId, excludedChannelIds));
  return rows as RankingRow[];
}

export async function assignWinnerRole(
  guild: Guild,
  winnerId: string,
  roleId = KING_ROLE_ID,
): Promise<void> {
  const role = await guild.roles.fetch(roleId);
  if (!role || !role.editable) throw new Error(`Role ${roleId} is missing or not editable`);
  const members = await guild.members.fetch();
  const winner = await guild.members.fetch(winnerId);
  const previousWinners = [...members.values()].filter(
    (member) => member.id !== winnerId && member.roles.cache.has(role.id),
  );
  if (!winner.roles.cache.has(role.id)) await winner.roles.add(role, "前月の発言ランキング1位");
  for (const member of previousWinners) {
    await member.roles.remove(role, "月間ランキングのロール更新");
  }
  console.log(
    `Monthly role reconciled: guild=${guild.id} role=${roleId} winner=${winnerId} removed=${previousWinners.map((member) => member.id).join(",") || "none"}`,
  );
}

export async function runRankingLogic(
  client: Client,
  pool: Pool,
  year: number,
  month: number,
  channel?: SendableChannels | null,
  isAuto = false,
  guildId = GUILD_ID,
): Promise<void> {
  try {
    const config = await getGuildConfig(pool, guildId);
    const excludedChannelIds = config?.excludedChannelIds.length
      ? config.excludedChannelIds
      : EXCLUDED_CHANNEL_IDS;
    const rows = await monthlyRanking(pool, year, month, guildId, excludedChannelIds);

    const guild = client.guilds.cache.get(guildId) ?? null;

    if (rows.length === 0) {
      if (channel) await channel.send(`${year}年${month}月のデータはありません。`);
      return;
    }

    const title = monthlyRankingTitle(year, month);
    const container = buildRankingContainer(title, rows, year, month, true, undefined, config);

    let targetChannel: SendableChannels | null = channel ?? null;
    if (isAuto) {
      let announce: SendableChannels | null = null;
      const announceChannelId = config?.announceChannelId ?? ANNOUNCE_CHANNEL_ID;
      if (announceChannelId === "0") {
        announce = null;
      } else if (guild) {
        const found = guild.channels.cache.get(announceChannelId);
        if (found && found.isSendable()) announce = found;
      } else {
        const fetched = await client.channels.fetch(announceChannelId).catch(() => null);
        if (fetched && "send" in fetched) announce = fetched as SendableChannels;
      }
      targetChannel = announce;
    }

    if (targetChannel) {
      await sendContainer(targetChannel, container);
    }
  } catch (error) {
    console.error(`Ranking Error: ${error}`);
  }
}

/** 告知チャンネルが設定された全ギルドへ月間ランキングを送信する */
export async function runMonthlyAnnouncement(
  client: Client,
  pool: Pool,
  year: number,
  month: number,
): Promise<void> {
  const targets = await listAnnounceGuilds(pool);
  for (const target of targets) {
    const guild = client.guilds.cache.get(target.guildId) ?? null;
    let announce: SendableChannels | null = null;
    if (guild) {
      const found = guild.channels.cache.get(target.announceChannelId);
      if (found && found.isSendable()) announce = found;
    } else {
      const fetched = await client.channels.fetch(target.announceChannelId).catch(() => null);
      if (fetched && "send" in fetched) announce = fetched as SendableChannels;
    }
    if (!announce) continue;

    const config = await getGuildConfig(pool, target.guildId);
    const excludedChannelIds = target.excludedChannelIds.length
      ? target.excludedChannelIds
      : EXCLUDED_CHANNEL_IDS;
    try {
      const rows = await monthlyRanking(pool, year, month, target.guildId, excludedChannelIds);
      if (rows.length === 0) continue;
      const container = buildRankingContainer(
        monthlyRankingTitle(year, month),
        rows,
        year,
        month,
        true,
        undefined,
        config,
      );
      await sendContainer(announce, container);
    } catch (error) {
      console.error(`Monthly announcement failed for guild ${target.guildId}: ${error}`);
    }
  }
}

async function handleAllCommand(
  client: Client,
  pool: Pool,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply();

  const guildId = interaction.guildId ?? GUILD_ID;
  const config = await getGuildConfig(pool, guildId);
  const excludedChannelIds = config?.excludedChannelIds.length
    ? config.excludedChannelIds
    : EXCLUDED_CHANNEL_IDS;

  const { rows } = await pool.query(totalRankingQuery(guildId, excludedChannelIds));

  if (rows.length === 0) {
    await interaction.followUp("データがありません");
    return;
  }

  const allUrl = config ? dashboardUrl(config, "/all") : undefined;
  const container = new ContainerBuilder(
    buildAllTimeRankingComponent(rows as RankingRow[], {
      ...(config ? rankingComponentOptions(config) : {}),
      ...(allUrl !== undefined ? { allUrl } : {}),
    }),
  );

  const channel = interaction.channel && "send" in interaction.channel ? interaction.channel : null;
  if (channel) {
    await sendContainer(channel, container);
  }
  await interaction.followUp({
    content: "✅ 全期間ランキングを送信しました。",
    flags: MessageFlags.Ephemeral,
  });
}

function canManageGuild(interaction: ChatInputCommandInteraction): boolean {
  if (interaction.user.id === OWNER_ID) return true;
  return interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild) ?? false;
}

export function loadRanking(client: Client, pool: Pool): () => void {
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  let stopped = false;
  const checkMonthlyRole = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const configured = await listKingRoleGuilds(pool);
      for (const { guildId, kingRoleId } of configured) {
        try {
          await updateMonthlyRoleOnce(pool, guildId, kingRoleId, async (year, month, db) => {
            const config = await getGuildConfig(pool, guildId);
            const excludedChannelIds = config?.excludedChannelIds.length
              ? config.excludedChannelIds
              : EXCLUDED_CHANNEL_IDS;
            const rows = await monthlyRanking(db, year, month, guildId, excludedChannelIds);
            if (!rows[0]) throw new Error(`No ranking data for ${year}-${month}`);
            const guild = await client.guilds.fetch(guildId);
            const winnerId = String(rows[0].user_id);
            await assignWinnerRole(guild, winnerId, kingRoleId);
            return winnerId;
          });
        } catch (error) {
          console.error(
            `Monthly role update failed for guild ${guildId}; retrying in 60 seconds:`,
            error,
          );
        }
      }
    } finally {
      running = false;
    }
  };
  client.once(Events.ClientReady, () => {
    if (stopped) return;
    void checkMonthlyRole();
    timer = setInterval(() => void checkMonthlyRole(), 60_000);
  });
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        if (!canManageGuild(interaction)) {
          await interaction.reply({
            content: "権限がありません",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        if (interaction.commandName === "month") {
          await interaction.reply({
            content: "集計したい月を選択してください:",
            components: [buildMonthSelectRow()],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        if (interaction.commandName === "all") {
          await handleAllCommand(client, pool, interaction);
          return;
        }
        return;
      }

      if (interaction.isStringSelectMenu() && interaction.customId === MONTH_SELECT_CUSTOM_ID) {
        const [yearStr, monthStr] = (interaction.values[0] ?? "").split("-");
        const year = Number(yearStr);
        const month = Number(monthStr);

        await interaction.reply({
          content: `<:2_:1453233982647959752> ${year}年${month}月の集計を開始し、結果を送信します...`,
          flags: MessageFlags.Ephemeral,
        });

        const targetChannel =
          interaction.channel && "send" in interaction.channel ? interaction.channel : null;
        await runRankingLogic(
          client,
          pool,
          year,
          month,
          targetChannel,
          false,
          interaction.guildId ?? GUILD_ID,
        );
        return;
      }

      if (interaction.isButton() && interaction.customId === OLD_RANKING_BUTTON_CUSTOM_ID) {
        await interaction.reply({
          content:
            "このボタンは古いランキングのものです。\n新しいランキングメッセージをご利用ください！",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    } catch (error) {
      if (error instanceof DiscordAPIError) {
        console.error(`Ranking Interaction Error: ${error.code} ${error.message}`);
        return;
      }
      console.error(`Ranking Error: ${error}`);
    }
  });
  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
  };
}
