const fs = require('node:fs');
const path = require('node:path');
const {
  SlashCommandBuilder,
} = require('discord.js');
const {
  joinVoiceChannel,
  getVoiceConnection,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');


function getMemberVoiceChannel(interaction) {
  const member = interaction.member;
  return member?.voice?.channel || null;
}

function ensurePlayer(client, guildId) {
  if (!client.voicePlayers) {
    client.voicePlayers = new Map();
  }
  if (!client.voicePlayers.has(guildId)) {
    const player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
      },
    });
    player.on('error', (error) => {
      console.error(`[voice] Audio player error in guild ${guildId}:`, error);
    });
    player.on(AudioPlayerStatus.Idle, () => {
      console.log(`[voice] Playback finished in guild ${guildId}.`);
    });
    client.voicePlayers.set(guildId, player);
  }
  return client.voicePlayers.get(guildId);
}

async function connectOrMove(interaction, channel) {
  let connection = getVoiceConnection(interaction.guild.id);
  if (!connection) {
    connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: interaction.guild.id,
      adapterCreator: interaction.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
  } else if (connection.joinConfig.channelId !== channel.id) {
    connection.rejoin({
      channelId: channel.id,
      guildId: interaction.guild.id,
      adapterCreator: interaction.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
  }

  await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
  return connection;
}

function listMp3Files(soundDir) {
  try {
    return fs.readdirSync(soundDir)
      .filter((file) => file.toLowerCase().endsWith('.mp3'));
  } catch {
    return [];
  }
}

function safeSoundPath(soundDir, filename) {
  if (!filename || filename !== path.basename(filename) || !filename.toLowerCase().endsWith('.mp3')) {
    return null;
  }
  const fullPath = path.resolve(soundDir, filename);
  if (!fullPath.startsWith(path.resolve(soundDir) + path.sep)) return null;
  return fs.existsSync(fullPath) ? fullPath : null;
}

module.exports = {
  name: 'voice',
  commands: [
    {
      data: new SlashCommandBuilder()
        .setName('join')
        .setDescription('ボイスチャンネルに参加します。'),
      async execute(interaction) {
        const channel = getMemberVoiceChannel(interaction);
        if (!channel) {
          await interaction.reply({ content: '先にボイスチャンネルに参加してください。', ephemeral: true });
          return;
        }

        try {
          const before = getVoiceConnection(interaction.guild.id);
          await connectOrMove(interaction, channel);
          await interaction.reply({ content: before ? `\`${channel.name}\` に移動しました。` : `\`${channel.name}\` に参加しました。` });
        } catch (error) {
          console.error('[voice] join failed:', error);
          await interaction.reply({ content: `ボイスチャンネルへの接続中にエラーが発生しました: ${error.message}`, ephemeral: true });
        }
      },
    },
    {
      data: new SlashCommandBuilder()
        .setName('leave')
        .setDescription('ボイスチャンネルから切断します。'),
      async execute(interaction) {
        const connection = getVoiceConnection(interaction.guild.id);
        if (!connection) {
          await interaction.reply({ content: 'ボイスチャンネルに接続していません。', ephemeral: true });
          return;
        }

        connection.destroy();
        await interaction.reply({ content: 'ボイスチャンネルから切断しました。' });
      },
    },
    {
      data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('サウンドをボイスチャンネルで再生します。')
        .addStringOption((option) => option
          .setName('filename')
          .setDescription('再生するファイル名を選択してください。')
          .setRequired(true)
          .setAutocomplete(true)),
      async autocomplete(interaction, client) {
        const focused = interaction.options.getFocused().toLowerCase();
        const files = listMp3Files(client.config.soundDir)
          .filter((file) => file.toLowerCase().startsWith(focused))
          .slice(0, 25);

        if (!files.length) {
          await interaction.respond([{ name: '候補なし', value: '候補なし' }]);
          return;
        }

        await interaction.respond(files.map((file) => ({ name: file, value: file })));
      },
      async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true });

        const channel = getMemberVoiceChannel(interaction);
        if (!channel) {
          await interaction.followUp({ content: 'このコマンドを使用するには、まずボイスチャンネルに参加してください。', ephemeral: true });
          return;
        }

        const filename = interaction.options.getString('filename', true);
        if (filename === '候補なし') {
          await interaction.followUp({ content: '再生できる有効なサウンドファイルがありません。', ephemeral: true });
          return;
        }

        const soundPath = safeSoundPath(client.config.soundDir, filename);
        if (!soundPath) {
          await interaction.followUp({ content: `ファイル '${filename}' が見つかりませんでした。`, ephemeral: true });
          return;
        }

        try {
          const connection = await connectOrMove(interaction, channel);
          const player = ensurePlayer(client, interaction.guild.id);
          connection.subscribe(player);

          const resource = createAudioResource(soundPath);
          player.stop(true);
          player.play(resource);

          await interaction.followUp({ content: `🔊 サウンド '${filename}' を再生します。`, ephemeral: false });
        } catch (error) {
          console.error('[voice] play failed:', error);
          await interaction.followUp({ content: `ボイスチャンネルへの接続または再生中にエラーが発生しました: ${error.message}`, ephemeral: true });
        }
      },
    },
  ],
};
