const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  MessageFlags,
} = require('discord.js');
const { readJson } = require('../utils/jsonStore');
const { truncate } = require('../utils/text');

async function loadNotificationData(client) {
  const info = await readJson(client.config.oshiraseDataFile, null);
  if (!info) return { data: null, retrievedAt: `データファイルを読み込めません: ${client.config.oshiraseDataFile}` };
  return {
    data: Array.isArray(info.data) ? info.data : [],
    retrievedAt: info.retrieved_at || 'N/A',
  };
}

function createOshiraseEmbed(pageItems, pageIndex, totalPages, retrievedAt) {
  const embed = new EmbedBuilder()
    .setTitle(`📢 お知らせリスト (ページ ${pageIndex + 1}/${totalPages})`)
    .setDescription(`データ取得日時: ${retrievedAt}`)
    .setColor(0x3498db);

  if (!pageItems.length) {
    embed.setDescription(`${embed.data.description}\n\nこのページにお知らせはありません。`);
  }

  for (const item of pageItems) {
    const title = truncate(item['タイトル'] || 'タイトルなし', 250);
    const importance = item['重要度'] || '不明';
    const marker = importance === '重要' ? '🔴 **重要**' : importance === '通常' ? '🔵 通常' : `⚪ ${importance}`;
    const date = item['掲載開始日'] || '不明';
    embed.addFields({ name: `📌 ${title}`, value: `重要度: ${marker}\n掲載開始: ${date}`, inline: false });
  }

  return embed;
}

function pageSlice(data, pageIndex, perPage) {
  return data.slice(pageIndex * perPage, (pageIndex + 1) * perPage);
}

function createComponents(client, data, userId, pageIndex, totalPages) {
  const perPage = client.config.oshiraseItemsPerPage;
  const items = pageSlice(data, pageIndex, perPage);
  const components = [];

  if (items.length) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(`oshirase:select:${userId}`)
      .setPlaceholder('詳細を見たいお知らせを選択してください')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(items.map((item, localIndex) => {
        const absoluteIndex = pageIndex * perPage + localIndex;
        const rawTitle = item['タイトル'] || '';
        return {
          label: truncate(rawTitle, 97) || 'タイトルなし',
          value: String(absoluteIndex),
          description: truncate(item['掲載開始日'] || '日付不明', 100),
        };
      }));
    components.push(new ActionRowBuilder().addComponents(select));
  }

  const prev = new ButtonBuilder()
    .setCustomId(`oshirase:prev:${userId}:${pageIndex}`)
    .setLabel('<')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(pageIndex <= 0);

  const indicator = new ButtonBuilder()
    .setCustomId(`oshirase:indicator:${userId}:${pageIndex}`)
    .setLabel(`${pageIndex + 1}/${totalPages}`)
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(true);

  const next = new ButtonBuilder()
    .setCustomId(`oshirase:next:${userId}:${pageIndex}`)
    .setLabel('>')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(pageIndex >= totalPages - 1);

  components.push(new ActionRowBuilder().addComponents(prev, indicator, next));
  return components;
}

async function renderPage(interaction, client, pageIndex, update = false) {
  const { data, retrievedAt } = await loadNotificationData(client);
  if (data === null) {
    const payload = { content: `読み込み失敗: ${retrievedAt}`, flags: MessageFlags.Ephemeral };
    if (update) await interaction.reply(payload);
    else await interaction.followUp(payload);
    return;
  }

  if (!data.length) {
    const payload = { content: `お知らせなし (取得: ${retrievedAt})`, flags: MessageFlags.Ephemeral };
    if (update) await interaction.reply(payload);
    else await interaction.followUp(payload);
    return;
  }

  const perPage = client.config.oshiraseItemsPerPage;
  const totalPages = Math.max(1, Math.ceil(data.length / perPage));
  const safePageIndex = Math.max(0, Math.min(pageIndex, totalPages - 1));
  const embed = createOshiraseEmbed(pageSlice(data, safePageIndex, perPage), safePageIndex, totalPages, retrievedAt);
  const components = createComponents(client, data, interaction.user.id, safePageIndex, totalPages);

  if (update) {
    await interaction.update({ embeds: [embed], components });
  } else {
    await interaction.followUp({ embeds: [embed], components });
  }
}

module.exports = {
  name: 'oshirase',
  commands: [
    {
      data: new SlashCommandBuilder()
        .setName('oshirase')
        .setDescription('最新のお知らせリストを表示します。'),
      async execute(interaction, client) {
        await interaction.deferReply();
        await renderPage(interaction, client, 0, false);
      },
    },
  ],

  async onInteractionCreate(interaction, client) {
    if (!interaction.isButton() && !interaction.isStringSelectMenu()) return false;
    if (!interaction.customId.startsWith('oshirase:')) return false;

    const [, action, ownerId, pageText] = interaction.customId.split(':');
    if (interaction.user.id !== ownerId) {
      await interaction.reply({ content: 'この操作はコマンド実行者のみ使用できます。', flags: MessageFlags.Ephemeral });
      return true;
    }

    if (action === 'select') {
      await interaction.reply({ content: 'お知らせの詳細を表示する機能は開発中です。', flags: MessageFlags.Ephemeral });
      return true;
    }

    if (action === 'prev' || action === 'next') {
      const currentPage = Number(pageText) || 0;
      const nextPage = action === 'prev' ? currentPage - 1 : currentPage + 1;
      await renderPage(interaction, client, nextPage, true);
      return true;
    }

    return false;
  },
};
