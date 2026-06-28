const {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} = require('discord.js');
const { readJson, writeJson } = require('../utils/jsonStore');

const VALID_MODES = new Set(['prod', 'dev']);

function nowIso() {
  return new Date().toISOString();
}

function nonce() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isOwner(interaction, client) {
  return Boolean(client.config.ownerId && interaction.user.id === client.config.ownerId);
}

async function replyOwnerOnly(interaction, client) {
  if (isOwner(interaction, client)) return true;
  await interaction.reply({
    content: 'このコマンドは Bot owner のみ実行できます。',
    flags: MessageFlags.Ephemeral,
  });
  return false;
}

async function getMode(client) {
  const state = await readJson(client.config.modeStateFile, null);
  const mode = state?.mode;
  return VALID_MODES.has(mode) ? mode : 'prod';
}

async function writeHeartbeat(client) {
  await writeJson(client.config.heartbeatFile, {
    ok: true,
    bot_id: client.user?.id || null,
    bot_tag: client.user?.tag || null,
    updated_at: nowIso(),
    pid: process.pid,
    uptime_seconds: Math.floor(process.uptime()),
  });
}

function startHeartbeat(client) {
  const intervalMs = Math.max(5, client.config.heartbeatIntervalSeconds) * 1000;
  const tick = () => writeHeartbeat(client).catch((error) => {
    console.error('[updater] Failed to write heartbeat:', error);
  });
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
}

function parseImageAndCommit(imageStr) {
  if (!imageStr) return null;
  const match = imageStr.match(/^(.*?)\s*\(([^)]+)\)$/);
  if (match) {
    return { image: match[1], commit: match[2] };
  }
  return { image: imageStr, commit: 'unknown' };
}

function formatDiscordTimestamp(isoString) {
  if (!isoString || isoString === 'unknown') return 'unknown';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return isoString;
  return `<t:${Math.floor(date.getTime() / 1000)}:f>`;
}

async function notifyOwner(client, status) {
  if (!client.config.ownerId) return;
  const owner = await client.users.fetch(client.config.ownerId).catch(() => null);
  if (!owner) return;

  const title = status.result === 'success'
    ? '✅ Bot 更新が完了しました'
    : status.result === 'rollback'
      ? '↩️ Bot 更新に失敗し、ロールバックしました'
      : status.result === 'noop'
        ? 'ℹ️ Bot 更新: 変更なし'
        : '❌ Bot 更新に失敗しました';

  const fields = [
    { name: 'モード', value: status.mode || 'unknown', inline: true },
    { name: 'タグ', value: status.target_tag || 'unknown', inline: true },
    { name: '時刻', value: formatDiscordTimestamp(status.finished_at || status.started_at), inline: false },
  ];
  if (status.message) fields.push({ name: '詳細', value: String(status.message).slice(0, 1000), inline: false });
  if (status.previous_image) {
    const info = parseImageAndCommit(status.previous_image);
    fields.push({ name: '以前の image', value: info.image, inline: true });
    fields.push({ name: '以前のコミット', value: `\`${info.commit}\``, inline: true });
  }
  if (status.current_image) {
    const info = parseImageAndCommit(status.current_image);
    fields.push({ name: '現在の image', value: info.image, inline: true });
    fields.push({ name: '現在のコミット', value: `\`${info.commit}\``, inline: true });
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(status.result === 'success' || status.result === 'noop' ? 0x57f287 : 0xed4245)
    .addFields(fields)
    .setTimestamp(new Date());

  await owner.send({ embeds: [embed] });
}

async function checkUpdateStatusNotification(client) {
  const status = await readJson(client.config.updateStatusFile, null);
  if (!status?.id) return;

  const notifyState = await readJson(client.config.updateNotifyStateFile, {});
  if (notifyState.last_notified_id === status.id) return;

  if (status.result !== 'noop') {
    await notifyOwner(client, status);
  }
  await writeJson(client.config.updateNotifyStateFile, {
    last_notified_id: status.id,
    notified_at: nowIso(),
  });
}

function startUpdateStatusNotifier(client) {
  const intervalMs = Math.max(10, client.config.updateStatusCheckIntervalSeconds) * 1000;
  const tick = () => checkUpdateStatusNotification(client).catch((error) => {
    console.error('[updater] Failed to check update status:', error);
  });
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
}

function createStatusEmbed(status, mode) {
  const embed = new EmbedBuilder()
    .setTitle('🔄 Bot 更新ステータス')
    .setColor(status?.result === 'success' || status?.result === 'noop' ? 0x57f287 : 0x3498db)
    .addFields(
      { name: '現在のモード', value: mode, inline: true },
      { name: '直近結果', value: status?.result || '記録なし', inline: true },
      { name: '対象タグ', value: status?.target_tag || 'unknown', inline: true },
      { name: '開始', value: formatDiscordTimestamp(status?.started_at), inline: true },
      { name: '完了', value: formatDiscordTimestamp(status?.finished_at), inline: true },
    )
    .setTimestamp(new Date());

  if (status?.message) {
    embed.addFields({ name: '詳細', value: String(status.message).slice(0, 1000), inline: false });
  }
  if (status?.current_image) {
    const info = parseImageAndCommit(status.current_image);
    embed.addFields(
      { name: '現在の image', value: info.image, inline: true },
      { name: '現在のコミット', value: `\`${info.commit}\``, inline: true }
    );
  }
  if (status?.previous_image) {
    const info = parseImageAndCommit(status.previous_image);
    embed.addFields(
      { name: '以前の image', value: info.image, inline: true },
      { name: '以前のコミット', value: `\`${info.commit}\``, inline: true }
    );
  }

  return embed;
}

module.exports = {
  name: 'updater',
  commands: [
    {
      data: new SlashCommandBuilder()
        .setName('update')
        .setDescription('Bot の Docker image 更新を要求します (Owner 限定)。'),
      async execute(interaction, client) {
        if (!await replyOwnerOnly(interaction, client)) return;
        const mode = await getMode(client);
        const request = {
          id: nonce(),
          requested_at: nowIso(),
          requested_by: interaction.user.id,
          mode,
        };
        await writeJson(client.config.updateTriggerFile, request);
        await interaction.reply({
          content: `更新を要求しました。mode=\`${mode}\`。ホスト側 systemd updater が検知して実行します。`,
          flags: MessageFlags.Ephemeral,
        });
      },
    },
    {
      data: new SlashCommandBuilder()
        .setName('update_status')
        .setDescription('Bot 更新の直近ステータスを表示します (Owner 限定)。'),
      async execute(interaction, client) {
        if (!await replyOwnerOnly(interaction, client)) return;
        const [mode, status] = await Promise.all([
          getMode(client),
          readJson(client.config.updateStatusFile, null),
        ]);
        await interaction.reply({
          embeds: [createStatusEmbed(status, mode)],
          flags: MessageFlags.Ephemeral,
        });
      },
    },
    {
      data: new SlashCommandBuilder()
        .setName('devmode')
        .setDescription('自動更新の dev/prod モードを切り替えます (Owner 限定)。')
        .addStringOption((option) => option
          .setName('mode')
          .setDescription('dev を有効にするか、prod に戻すか')
          .setRequired(true)
          .addChoices(
            { name: 'on (dev)', value: 'dev' },
            { name: 'off (prod)', value: 'prod' },
          )),
      async execute(interaction, client) {
        if (!await replyOwnerOnly(interaction, client)) return;
        const mode = interaction.options.getString('mode', true);
        await writeJson(client.config.modeStateFile, {
          mode,
          updated_at: nowIso(),
          updated_by: interaction.user.id,
        });
        await interaction.reply({
          content: `更新モードを \`${mode}\` に切り替えました。systemd updater が timer 設定を反映します。`,
          flags: MessageFlags.Ephemeral,
        });
      },
    },
  ],

  async onReady(client) {
    const currentMode = await readJson(client.config.modeStateFile, null);
    if (!VALID_MODES.has(currentMode?.mode)) {
      await writeJson(client.config.modeStateFile, {
        mode: 'prod',
        updated_at: nowIso(),
        updated_by: 'bot-default',
      });
    }

    startHeartbeat(client);
    startUpdateStatusNotifier(client);
  },
};
