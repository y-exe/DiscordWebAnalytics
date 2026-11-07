import {
  ChannelType,
  Events,
  MessageFlags,
  PermissionsBitField,
  type ChatInputCommandInteraction,
  type Client,
} from "discord.js";
import type { Pool } from "pg";
import { getGuildConfig, upsertGuild } from "../guildRegistry";

const MANAGE_GUILD = PermissionsBitField.Flags.ManageGuild;

// GuildText, GuildAnnouncement
const ANNOUNCE_CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
// GuildText, GuildAnnouncement, GuildForum
const EXCLUDE_CHANNEL_TYPES = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum,
];

export function setupCommandDefinitions() {
  return [
    {
      name: "setup",
      description: "このサーバーの集計設定を行います (サーバー管理権限が必要)",
      options: [
        {
          name: "announce",
          description: "月間ランキングを告知するチャンネルを設定・解除する",
          type: 1,
          options: [
            {
              name: "channel",
              description: "告知先チャンネル (未指定で解除)",
              type: 7,
              required: false,
              channel_types: ANNOUNCE_CHANNEL_TYPES,
            },
          ],
        },
        {
          name: "king-role",
          description: "月間発言王ロールを設定・解除する",
          type: 1,
          options: [
            {
              name: "role",
              description: "発言王ロール (未指定で解除)",
              type: 8,
              required: false,
            },
          ],
        },
        {
          name: "exclude",
          description: "ランキング除外チャンネルを管理する",
          type: 2,
          options: [
            {
              name: "add",
              description: "除外チャンネルに追加する",
              type: 1,
              options: [
                {
                  name: "channel",
                  description: "除外するチャンネル",
                  type: 7,
                  required: true,
                  channel_types: EXCLUDE_CHANNEL_TYPES,
                },
              ],
            },
            {
              name: "remove",
              description: "除外チャンネルから削除する",
              type: 1,
              options: [
                {
                  name: "channel",
                  description: "除外を解除するチャンネル",
                  type: 7,
                  required: true,
                  channel_types: EXCLUDE_CHANNEL_TYPES,
                },
              ],
            },
            {
              name: "clear",
              description: "除外チャンネル設定をすべて消す",
              type: 1,
            },
            {
              name: "list",
              description: "除外チャンネルの一覧を表示する",
              type: 1,
            },
          ],
        },
        {
          name: "show",
          description: "現在の設定を表示する",
          type: 1,
        },
      ],
    },
  ];
}

async function ensureGuildRow(pool: Pool, interaction: ChatInputCommandInteraction): Promise<void> {
  if (interaction.guild) await upsertGuild(pool, interaction.guild);
}

async function handleAnnounce(
  pool: Pool,
  interaction: ChatInputCommandInteraction,
): Promise<string> {
  const channel = interaction.options.getChannel("channel");
  if (!channel) {
    await pool.query(
      "UPDATE guilds SET announce_channel_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE guild_id = $1",
      [interaction.guildId],
    );
    return "告知チャンネルの設定を解除しました。月間ランキングの自動告知は行われません。";
  }
  if (!ANNOUNCE_CHANNEL_TYPES.includes(channel.type)) {
    return "テキストチャンネルを指定してください。";
  }
  await pool.query(
    "UPDATE guilds SET announce_channel_id = $2, updated_at = CURRENT_TIMESTAMP WHERE guild_id = $1",
    [interaction.guildId, channel.id],
  );
  return `月間ランキングの告知先を <#${channel.id}> に設定しました。`;
}

async function handleKingRole(
  pool: Pool,
  interaction: ChatInputCommandInteraction,
): Promise<string> {
  const role = interaction.options.getRole("role");
  if (!role) {
    await pool.query(
      "UPDATE guilds SET king_role_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE guild_id = $1",
      [interaction.guildId],
    );
    return "月間発言王ロールの設定を解除しました。";
  }
  await pool.query(
    "UPDATE guilds SET king_role_id = $2, updated_at = CURRENT_TIMESTAMP WHERE guild_id = $1",
    [interaction.guildId, role.id],
  );
  return `月間発言王ロールを <@&${role.id}> に設定しました。Botがそのロールを管理できる権限が必要です。`;
}

async function handleExclude(
  pool: Pool,
  interaction: ChatInputCommandInteraction,
): Promise<string> {
  const subcommand = interaction.options.getSubcommand(true);
  const config = await getGuildConfig(pool, interaction.guildId ?? "");
  const current = config?.excludedChannelIds ?? [];

  if (subcommand === "add" || subcommand === "remove") {
    const channel = interaction.options.getChannel("channel", true);
    if (!EXCLUDE_CHANNEL_TYPES.includes(channel.type)) {
      return "テキストチャンネルまたはフォーラムチャンネルを指定してください。";
    }
    const next =
      subcommand === "add"
        ? [...new Set([...current, channel.id])]
        : current.filter((id) => id !== channel.id);
    await pool.query(
      "UPDATE guilds SET excluded_channel_ids = $2::bigint[], updated_at = CURRENT_TIMESTAMP WHERE guild_id = $1",
      [interaction.guildId, next],
    );
    return subcommand === "add"
      ? `<#${channel.id}> をランキング除外チャンネルに追加しました。`
      : `<#${channel.id}> をランキング除外チャンネルから削除しました。`;
  }

  if (subcommand === "clear") {
    await pool.query(
      "UPDATE guilds SET excluded_channel_ids = $2::bigint[], updated_at = CURRENT_TIMESTAMP WHERE guild_id = $1",
      [interaction.guildId, []],
    );
    return "ランキング除外チャンネルの設定をすべて削除しました。";
  }

  return current.length > 0
    ? `ランキング除外チャンネル: ${current.map((id) => `<#${id}>`).join(" ")}`
    : "ランキング除外チャンネルは設定されていません。";
}

async function handleShow(pool: Pool, interaction: ChatInputCommandInteraction): Promise<string> {
  const config = await getGuildConfig(pool, interaction.guildId ?? "");
  if (!config) return "まだ設定がありません。";
  const lines = [
    `**告知チャンネル**: ${config.announceChannelId ? `<#${config.announceChannelId}>` : "未設定"}`,
    `**月間発言王ロール**: ${config.kingRoleId ? `<@&${config.kingRoleId}>` : "未設定"}`,
    `**ランキング除外チャンネル**: ${config.excludedChannelIds.length > 0 ? config.excludedChannelIds.map((id) => `<#${id}>`).join(" ") : "なし"}`,
    `**ダッシュボードドメイン**: ${config.domains.length > 0 ? config.domains.map((domain) => `https://${domain}`).join(" ") : "未設定"}`,
  ];
  return lines.join("\n");
}

export function loadSetup(client: Client, pool: Pool): void {
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (!interaction.isChatInputCommand() || interaction.commandName !== "setup") return;
      if (!interaction.inGuild() || !interaction.guildId) {
        await interaction.reply({
          content: "サーバー内で実行してください。",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (!interaction.memberPermissions?.has(MANAGE_GUILD)) {
        await interaction.reply({
          content: "この操作には「サーバー管理」権限が必要です。",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await ensureGuildRow(pool, interaction);

      const group = interaction.options.getSubcommandGroup(false);
      let message: string;
      if (group === "exclude") {
        message = await handleExclude(pool, interaction);
      } else {
        switch (interaction.options.getSubcommand(true)) {
          case "announce":
            message = await handleAnnounce(pool, interaction);
            break;
          case "king-role":
            message = await handleKingRole(pool, interaction);
            break;
          case "show":
            message = await handleShow(pool, interaction);
            break;
          default:
            message = "不明なサブコマンドです。";
        }
      }

      await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
    } catch (error) {
      console.error(`Setup Error: ${error}`);
      if (interaction.isRepliable()) {
        await interaction
          .followUp({
            content: "設定の保存中にエラーが発生しました。",
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => {});
      }
    }
  });
}
