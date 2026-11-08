import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  type APIComponentInMessageActionRow,
  type APIMessageTopLevelComponent,
} from "discord.js";

/** アクセントカラーのパレット (tokumei-botのui/components.tsと同じ方針) */
export const colors = {
  info: 0x3964fe,
  success: 0x2ecc71,
  warning: 0xf39c12,
  danger: 0xe53935,
} as const;

export function text(value: string): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(value);
}

export function button(id: string, label: string, style = ButtonStyle.Secondary): ButtonBuilder {
  return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
}

export function row(...buttons: ButtonBuilder[]): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
}

export function separator(): SeparatorBuilder {
  return new SeparatorBuilder();
}

/**
 * 標準的な情報カード (見出し+説明+アクセントカラー)。
 * iconはギルド内のカスタム絵文字 (`<:name:id>` 形式の文字列そのもの) を想定。
 */
export function card(
  title: string,
  description: string,
  color: number = colors.info,
  icon = "ℹ️",
): ContainerBuilder {
  return new ContainerBuilder()
    .setAccentColor(color)
    .addTextDisplayComponents(text(`## ${icon} ${title}\n${description}`));
}

export function payload(
  components: (ContainerBuilder | ActionRowBuilder<ButtonBuilder>)[],
  ephemeral = true,
): {
  components: (ContainerBuilder | ActionRowBuilder<ButtonBuilder>)[];
  flags: number;
  allowedMentions: { parse: never[] };
} {
  return {
    components,
    flags: MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
    allowedMentions: { parse: [] },
  };
}

/** セクション+サムネイル付きカード (画像付きの見出し) */
export function cardWithThumbnail(
  title: string,
  description: string,
  thumbnailUrl: string,
  color = colors.info,
): ContainerBuilder {
  return new ContainerBuilder()
    .setAccentColor(color)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(text(`## ${title}\n${description}`))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnailUrl)),
    );
}

export function serializeComponents(
  components: { toJSON(): unknown }[],
): APIMessageTopLevelComponent[] {
  return components.map((component) => component.toJSON()) as APIMessageTopLevelComponent[];
}

export type ActionComponent = APIComponentInMessageActionRow;
