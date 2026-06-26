const chokidar = require('chokidar');
const { EmbedBuilder } = require('discord.js');
const { readJson } = require('../utils/jsonStore');
const { parseDate } = require('../utils/time');

async function notifyFromFile(client) {
  const { watchFilePath, watchChannelId, watchRoleId } = client.config;
  if (!watchChannelId || !watchRoleId) {
    console.warn('[FileWatcher] WATCH_CHANNEL_ID or WATCH_ROLE_ID is not configured.');
    return;
  }

  const channel = await client.channels.fetch(watchChannelId).catch(() => null);
  if (!channel?.isTextBased()) {
    console.warn(`[FileWatcher] Invalid channel: ${watchChannelId}`);
    return;
  }

  const guild = channel.guild;
  const role = guild?.roles.cache.get(watchRoleId) || await guild?.roles.fetch(watchRoleId).catch(() => null);
  if (!role) {
    console.warn(`[FileWatcher] Invalid role: ${watchRoleId}`);
    return;
  }

  const payload = await readJson(watchFilePath, null);
  if (!payload) return;

  const timestamp = parseDate(payload.retrieved_at) || new Date();
  for (const entry of payload.changes || []) {
    if (entry.category !== '新規') continue;

    const data = entry.data || {};
    const embed = new EmbedBuilder()
      .setTitle(data['タイトル'] || '（タイトルなし）')
      .setDescription(`種別: ${data['種別'] || ''}\n重要度: ${data['重要度'] || ''}`)
      .setTimestamp(timestamp)
      .setColor(0x3498db)
      .addFields(
        { name: '掲載開始日', value: data['掲載開始日'] || '----', inline: true },
        { name: '休講日', value: data['休講日'] || '----', inline: true },
        { name: '補講日', value: data['補講日'] || '----', inline: true },
        { name: '授業', value: data['授業'] || '----', inline: false },
      )
      .setFooter({ text: '自動通知システム' });

    await channel.send({
      content: role.toString(),
      embeds: [embed],
      allowedMentions: { roles: [role.id] },
    });
  }
}

module.exports = {
  name: 'fileChangeNotify',
  async onReady(client) {
    const { watchFilePath, watchChannelId, watchRoleId } = client.config;
    if (!watchChannelId || !watchRoleId) {
      console.warn('[FileWatcher] Disabled because WATCH_CHANNEL_ID or WATCH_ROLE_ID is missing.');
      return;
    }

    const watcher = chokidar.watch(watchFilePath, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    });

    watcher.on('change', async () => {
      try {
        await notifyFromFile(client);
      } catch (error) {
        console.error('[FileWatcher] Failed to notify:', error);
      }
    });

    client.fileChangeWatcher = watcher;
    console.log(`[FileWatcher] Watching ${watchFilePath} → channel ${watchChannelId}, role ${watchRoleId}`);
  },
};
