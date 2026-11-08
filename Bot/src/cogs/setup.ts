import {
  ChannelType,
  Events,
  MessageFlags,
  PermissionsBitField,
  type ChatInputCommandInteraction,
  type Client,
  type TextChannel,
} from "discord.js";
import type { Pool } from "pg";
import { getGuildConfig, registerGuildIdSubdomain, upsertGuild } from "../guildRegistry";
import { card, colors, payload } from "../ui/components";

const MANAGE_GUILD = PermissionsBitField.Flags.ManageGuild;

// GuildText, GuildAnnouncement
const ANNOUNCE_CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
// GuildText, GuildAnnouncement, GuildForum
const EXCLUDE_CHANNEL_TYPES = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum,
];

/** サブドメインのベースドメイン (既定: yexe.top) */
export const SUBDOMAIN_BASE_DOMAIN = (
  process.env.SUBDOMAIN_BASE_DOMAIN || "yexe.top"
).toLowerCase();
/** 独自ドメインのDNS確認先となるVPSの公開IP */
export const SERVER_PUBLIC_IP = process.env.SERVER_PUBLIC_IP || "162.43.78.145";

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
        {
          name: "subdomain",
          description: "無料サブドメイン ([招待コード].yexe.top) を設定する",
          type: 1,
          options: [
            {
              name: "code",
              description: "使う招待コード (ケースセンシティブ。未指定でサーバーID)",
              type: 3,
              required: false,
            },
          ],
        },
        {
          name: "domain",
          description: "独自ドメインを設定する (DNSがVPSを向いている必要があります)",
          type: 1,
          options: [
            {
              name: "domain",
              description: "独自ドメイン (例: example.com)",
              type: 3,
              required: true,
            },
          ],
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

async function listGuildDomains(pool: Pool, guildId: string): Promise<string[]> {
  const { rows } = await pool.query(
    "SELECT domain, is_active FROM guild_domains WHERE guild_id = $1 ORDER BY domain",
    [guildId],
  );
  return (rows as Array<{ domain: string; is_active: boolean }>).map(
    (row) => `https://${row.domain}${row.is_active ? "" : " (無効)"}`,
  );
}

async function handleShow(pool: Pool, interaction: ChatInputCommandInteraction): Promise<string> {
  const config = await getGuildConfig(pool, interaction.guildId ?? "");
  if (!config) return "まだ設定がありません。";
  const domains = await listGuildDomains(pool, interaction.guildId ?? "");
  const lines = [
    `**告知チャンネル**: ${config.announceChannelId ? `<#${config.announceChannelId}>` : "未設定"}`,
    `**月間発言王ロール**: ${config.kingRoleId ? `<@&${config.kingRoleId}>` : "未設定"}`,
    `**ランキング除外チャンネル**: ${config.excludedChannelIds.length > 0 ? config.excludedChannelIds.map((id) => `<#${id}>`).join(" ") : "なし"}`,
    `**ダッシュボードドメイン**: ${domains.length > 0 ? domains.join(" ") : "未設定"}`,
  ];
  return lines.join("\n");
}

// ==== ダッシュボードドメイン登録 (フェーズ7) ====

/**
 * サブドメインラベルを検証する。
 * ラベルはサーバーID・招待コード・バニティコードのいずれか。
 * 招待コードはケースセンシティブなため小文字化は行わない。
 */
export function normalizeSubdomainLabel(raw: string): string | null {
  const input = raw.trim();
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9])?$/.test(input)) return null;
  return input;
}

export function buildSubdomain(label: string): string {
  return `${label}.${SUBDOMAIN_BASE_DOMAIN}`;
}

/** 独自ドメインの形式検証。エラーメッセージまたはnull (OK) を返す */
export function validateCustomDomain(raw: string): string | null {
  const domain = raw.trim().toLowerCase();
  if (!domain) return "ドメインを指定してください。";
  if (domain.length > 253) return "ドメインが長すぎます。";
  if (domain === SUBDOMAIN_BASE_DOMAIN || domain.endsWith(`.${SUBDOMAIN_BASE_DOMAIN}`)) {
    return `${SUBDOMAIN_BASE_DOMAIN} のサブドメインは /setup subdomain で設定してください。`;
  }
  if (!/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(domain)) {
    return "ドメインの形式が正しくありません (例: example.com)。";
  }
  return null;
}

interface DomainRow {
  domain: string;
  guild_id: string | bigint;
  is_active: boolean;
}

async function upsertGuildDomain(
  pool: Pool,
  guildId: string,
  domain: string,
  source: "guild" | "invite" | "custom",
  inviteCode: string | null,
): Promise<string | null> {
  const { rows } = await pool.query(
    "SELECT guild_id, is_active FROM guild_domains WHERE domain = $1",
    [domain],
  );
  if (rows.length > 0) {
    const existing = rows[0] as DomainRow;
    if (String(existing.guild_id) !== guildId && existing.is_active) {
      return "そのドメインは既に他のサーバーが使用しています。";
    }
  }
  await pool.query(
    `
    INSERT INTO guild_domains (domain, guild_id, source, invite_code, is_active)
    VALUES ($1, $2, $3, $4, TRUE)
    ON CONFLICT (domain) DO UPDATE
    SET guild_id = EXCLUDED.guild_id,
        source = EXCLUDED.source,
        invite_code = EXCLUDED.invite_code,
        is_active = TRUE
    `,
    [domain, guildId, source, inviteCode],
  );
  return null;
}

/** 招待コードの归属ギルドを取得する。解決できない場合はエラーを返す */
async function fetchInviteGuildId(
  client: Client,
  code: string,
): Promise<{ guildId: string | null; error: string | null }> {
  try {
    const invite = (await client.rest.get(`/invites/${encodeURIComponent(code)}`)) as {
      guild?: { id?: string } | null;
    };
    return { guildId: invite.guild?.id ?? null, error: null };
  } catch (error) {
    const status =
      typeof error === "object" && error !== null && "status" in error
        ? (error as { status?: number }).status
        : undefined;
    if (status === 404) {
      return {
        guildId: null,
        error: "招待コードが見つかりません (失効している可能性があります)。",
      };
    }
    console.error(`招待取得エラー (${code}): ${error}`);
    return { guildId: null, error: "招待コードの確認中にエラーが発生しました。" };
  }
}

function subdomainResult(domain: string, labelKind: string): string {
  return [
    `ダッシュボードのサブドメインを **https://${domain}** に設定しました。`,
    "エッジ (Caddy) が最初のアクセスで証明書を自動発行します。少し待ってからアクセスしてください。",
    labelKind === "サーバーID"
      ? "-# このサブドメインはサーバーID由来のため失効しません。"
      : "-# 元の招待コードが失効・変更されると、このドメインは自動的に無効化されます。",
  ].join("\n");
}

async function handleSubdomain(
  client: Client,
  pool: Pool,
  interaction: ChatInputCommandInteraction,
): Promise<string> {
  const guild = interaction.guild;
  if (!guild || !interaction.guildId) return "サーバー内で実行してください。";

  // ラベルの候補: サーバーID (デフォルト・不変・失効なし) / 招待コード / バニティコード。
  // 招待コードはケースセンシティブなため小文字化は行わない。
  const requested = interaction.options.getString("code")?.trim() ?? "";

  if (requested) {
    const label = normalizeSubdomainLabel(requested);
    if (!label) {
      return "招待コードには半角英数字とハイフン・アンダースコアのみ使用できます (先頭と末尾は英数字)。";
    }
    // バニティコードは /invites API で解決できないため、
    // ギルドの現在のバニティと一致する場合は検証をスキップする (取得元で归属は自明)
    let vanity: string | null = null;
    try {
      vanity = (await guild.fetchVanityData()).code;
    } catch {
      vanity = null;
    }
    if (vanity && vanity === label) {
      const domain = buildSubdomain(label);
      const conflict = await upsertGuildDomain(pool, interaction.guildId, domain, "invite", label);
      if (conflict) return conflict;
      return subdomainResult(domain, "バニティ招待コード");
    }
    const invite = await fetchInviteGuildId(client, label);
    if (invite.error) return invite.error;
    if (invite.guildId && invite.guildId !== interaction.guildId) {
      return "その招待コードは他のサーバーのものです。自サーバーの招待コードを指定してください。";
    }
    const domain = buildSubdomain(label);
    const conflict = await upsertGuildDomain(pool, interaction.guildId, domain, "invite", label);
    if (conflict) return conflict;
    return subdomainResult(domain, "招待コード");
  }

  // デフォルト: サーバーID由来のサブドメイン (不変・失効チェック不要)
  const domain = buildSubdomain(interaction.guildId);
  const conflict = await upsertGuildDomain(pool, interaction.guildId, domain, "guild", null);
  if (conflict) return conflict;
  return subdomainResult(domain, "サーバーID");
}

async function resolveToServerIp(hostname: string): Promise<boolean> {
  const dns = await import("node:dns/promises");
  try {
    const a = await dns.resolve4(hostname).catch(() => [] as string[]);
    if (a.includes(SERVER_PUBLIC_IP)) return true;
  } catch {
    /* レコードなし */
  }
  try {
    const cname = await dns.resolveCname(hostname).catch(() => [] as string[]);
    for (const target of cname) {
      // 独自ドメイン → CNAME → [サーバーID].yexe.top (ワイルドカード) のチェーンを許容する
      if (target === SUBDOMAIN_BASE_DOMAIN || target.endsWith(`.${SUBDOMAIN_BASE_DOMAIN}`)) {
        return true;
      }
      const a = await dns.resolve4(target).catch(() => [] as string[]);
      if (a.includes(SERVER_PUBLIC_IP)) return true;
    }
  } catch {
    /* レコードなし */
  }
  return false;
}

async function handleCustomDomain(
  pool: Pool,
  interaction: ChatInputCommandInteraction,
): Promise<string> {
  const raw = interaction.options.getString("domain") ?? "";
  const error = validateCustomDomain(raw);
  if (error) return error;
  const domain = raw.trim().toLowerCase();

  if (!interaction.guildId) return "サーバー内で実行してください。";
  const conflict = await upsertGuildDomain(pool, interaction.guildId, domain, "custom", null);
  if (conflict) return conflict;

  const reachable = await resolveToServerIp(domain);
  if (reachable) {
    return [
      `ダッシュボードのドメインを **https://${domain}** に設定しました。`,
      "エッジ (Caddy) が最初のアクセスで証明書を自動発行します。少し待ってからアクセスしてください。",
    ].join("\n");
  }
  return [
    `ダッシュボードのドメインを **https://${domain}** に登録しました。`,
    `ただしDNSがVPS (${SERVER_PUBLIC_IP}) を指していません。CNAMEで自サーバーのサブドメイン ([サーバーID].yexe.top) に向けるか、AレコードでVPS IPを指定してください。設定後、再度 /setup domain を実行すると確認できます。`,
  ].join("\n");
}

/**
 * 招待コード由来のサブドメインの失効をチェックする (6時間ごと)。
 * 招待が存在しない、または別ギルドの招待になっていたらドメインを無効化する。
 * ただしコードがそのギルドの現在のバニティURLと一致する場合は維持する
 * (バニティは /invites API で解決できないため)。
 */
export async function checkInviteDomains(client: Client, pool: Pool): Promise<void> {
  const { rows } = await pool.query(
    `
    SELECT d.domain, d.invite_code, d.guild_id
    FROM guild_domains d
    WHERE d.source = 'invite' AND d.is_active AND d.invite_code IS NOT NULL
    `,
  );
  for (const row of rows as Array<{
    domain: string;
    invite_code: string;
    guild_id: string | bigint;
  }>) {
    const invite = await fetchInviteGuildId(client, row.invite_code);
    const owned = invite.guildId === String(row.guild_id);
    if (invite.error === null && owned) continue;
    if (invite.error !== null) {
      try {
        const guild = client.guilds.cache.get(String(row.guild_id));
        const vanity = guild ? (await guild.fetchVanityData()).code : null;
        if (vanity && vanity === row.invite_code) continue;
      } catch {
        /* バニティ未設定 → 失効扱い */
      }
    }
    await pool.query("UPDATE guild_domains SET is_active = FALSE WHERE domain = $1", [row.domain]);
    console.warn(`サブドメイン無効化: ${row.domain} (${invite.error ?? "招待が別ギルドに移管"})`);
  }
}

export function loadSetup(client: Client, pool: Pool): void {
  // サブドメイン失効チェック (6時間ごと)
  client.once(Events.ClientReady, () => {
    void checkInviteDomains(client, pool).catch((error) =>
      console.error(`失効チェックエラー: ${error}`),
    );
    setInterval(
      () =>
        void checkInviteDomains(client, pool).catch((error) =>
          console.error(`失効チェックエラー: ${error}`),
        ),
      6 * 60 * 60 * 1000,
    );
  });

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
          case "subdomain":
            message = await handleSubdomain(client, pool, interaction);
            break;
          case "domain":
            message = await handleCustomDomain(pool, interaction);
            break;
          default:
            message = "不明なサブコマンドです。";
        }
      }

      await interaction.followUp({
        ...payload([card("設定を更新しました", message, colors.info, "⚙️")], true),
      });
    } catch (error) {
      console.error(`Setup Error: ${error}`);
      if (interaction.isRepliable()) {
        await interaction
          .followUp({
            ...payload(
              [card("エラー", "設定の保存中にエラーが発生しました。", colors.danger, "⚠️")],
              true,
            ),
          })
          .catch(() => {});
      }
    }
  });
}
