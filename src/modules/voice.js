const fs = require('node:fs');
const path = require('node:path');
const {
  MessageFlags,
  PermissionFlagsBits,
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
const play = require('play-dl');
const ffmpeg = require('ffmpeg-static');

if (ffmpeg) {
  const ffmpegDir = path.dirname(ffmpeg);
  if (!process.env.PATH.includes(ffmpegDir)) {
    process.env.PATH = `${ffmpegDir}${path.delimiter}${process.env.PATH}`;
  }
}

const VOICE_READY_TIMEOUT_MS = 20_000;
const VOICE_DEBUG = process.env.VOICE_DEBUG === 'true';


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

async function getBotVoicePermissionIssue(interaction, channel) {
  const me = interaction.guild.members.me || await interaction.guild.members.fetchMe();
  const permissions = channel.permissionsFor(me);
  if (!permissions) {
    return 'ボイスチャンネルの権限を確認できませんでした。';
  }

  const missing = [];
  if (!permissions.has(PermissionFlagsBits.ViewChannel)) missing.push('チャンネルを見る');
  if (!permissions.has(PermissionFlagsBits.Connect)) missing.push('接続');
  if (!permissions.has(PermissionFlagsBits.Speak)) missing.push('発言');

  if (!missing.length) return null;
  return `Bot に \`${channel.name}\` の権限が不足しています: ${missing.join(' / ')}`;
}

function attachConnectionListeners(connection, guildId) {
  if (connection._oecuListenersAttached) return;
  connection._oecuListenersAttached = true;

  connection.on('error', (error) => {
    console.error(`[voice] Connection error in guild ${guildId}:`, error);
  });

  connection.on('stateChange', (oldState, newState) => {
    if (VOICE_DEBUG) {
      console.log(`[voice] (${guildId}) state: ${oldState.status} -> ${newState.status}`);
    }
  });

  if (VOICE_DEBUG) {
    connection.on('debug', (message) => {
      console.log(`[voice] (${guildId}) debug: ${message}`);
    });
  }

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
      // チャンネル移動などによる一時的な切断 -> 復帰を待つ
    } catch {
      // 本当の切断とみなして破棄する
      connection.destroy();
    }
  });
}

async function connectOrMove(interaction, channel) {
  let connection = getVoiceConnection(interaction.guild.id);
  if (!connection) {
    connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: interaction.guild.id,
      adapterCreator: interaction.guild.voiceAdapterCreator,
      selfDeaf: true,
      debug: VOICE_DEBUG,
    });
    attachConnectionListeners(connection, interaction.guild.id);
  } else if (connection.joinConfig.channelId !== channel.id) {
    connection.rejoin({
      channelId: channel.id,
      guildId: interaction.guild.id,
      adapterCreator: interaction.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
  }

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, VOICE_READY_TIMEOUT_MS);
    return connection;
  } catch (error) {
    connection.destroy();
    throw error;
  }
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

async function replyEphemeral(interaction, content) {
  if (interaction.deferred) {
    await interaction.editReply({ content });
    return;
  }
  if (interaction.replied) {
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

async function replyOrEditEphemeral(interaction, content) {
  if (interaction.deferred) {
    await interaction.editReply({ content });
    return;
  }
  if (interaction.replied) {
    await interaction.editReply({ content });
    return;
  }
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
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
          await replyEphemeral(interaction, '先にボイスチャンネルに参加してください。');
          return;
        }

        try {
          const before = getVoiceConnection(interaction.guild.id);
          await replyOrEditEphemeral(
            interaction,
            before
              ? `\`${channel.name}\` に移動しています...`
              : `\`${channel.name}\` に接続しています...`,
          );

          const permissionIssue = await getBotVoicePermissionIssue(interaction, channel);
          if (permissionIssue) {
            await replyOrEditEphemeral(interaction, permissionIssue);
            return;
          }

          await connectOrMove(interaction, channel);
          await replyOrEditEphemeral(interaction, before ? `\`${channel.name}\` に移動しました。` : `\`${channel.name}\` に参加しました。`);
        } catch (error) {
          console.error('[voice] join failed:', error);
          await replyOrEditEphemeral(interaction, `ボイスチャンネルへの接続中にエラーが発生しました: ${error.message}`);
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
          await replyEphemeral(interaction, 'ボイスチャンネルに接続していません。');
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
          await interaction.respond([{ name: '候補なし', value: '候補なし' }]).catch(() => {});
          return;
        }

        await interaction.respond(files.map((file) => ({ name: file, value: file }))).catch(() => {});
      },
      async execute(interaction, client) {
        const channel = getMemberVoiceChannel(interaction);
        if (!channel) {
          await replyEphemeral(interaction, 'このコマンドを使用するには、まずボイスチャンネルに参加してください。');
          return;
        }

        const filename = interaction.options.getString('filename', true);
        if (filename === '候補なし') {
          await replyEphemeral(interaction, '再生できる有効なサウンドファイルがありません。');
          return;
        }

        const soundPath = safeSoundPath(client.config.soundDir, filename);
        if (!soundPath) {
          await replyEphemeral(interaction, `ファイル '${filename}' が見つかりませんでした。`);
          return;
        }

        try {
          await replyOrEditEphemeral(interaction, `🔊 サウンド '${filename}' の再生準備中です...`);

          const permissionIssue = await getBotVoicePermissionIssue(interaction, channel);
          if (permissionIssue) {
            await replyOrEditEphemeral(interaction, permissionIssue);
            return;
          }

          const connection = await connectOrMove(interaction, channel);
          const player = ensurePlayer(client, interaction.guild.id);
          connection.subscribe(player);

          const resource = createAudioResource(soundPath);
          player.stop(true);
          player.play(resource);

          await replyOrEditEphemeral(interaction, `🔊 サウンド '${filename}' を再生します。`);
        } catch (error) {
          console.error('[voice] play failed:', error);
          await replyOrEditEphemeral(interaction, `ボイスチャンネルへの接続または再生中にエラーが発生しました: ${error.message}`);
        }
      },
    },
    {
      data: new SlashCommandBuilder()
        .setName('yt-play')
        .setDescription('YouTubeの動画または音楽を再生します。')
        .addStringOption((option) => option
          .setName('query')
          .setDescription('再生したいYouTube動画のURLまたは検索キーワードを入力してください。')
          .setRequired(true)),
      async execute(interaction, client) {
        const channel = getMemberVoiceChannel(interaction);
        if (!channel) {
          await replyEphemeral(interaction, 'このコマンドを使用するには、まずボイスチャンネルに参加してください。');
          return;
        }

        const query = interaction.options.getString('query', true);

        try {
          // 処理に時間がかかる可能性があるため、レスポンスを保留する
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });

          const permissionIssue = await getBotVoicePermissionIssue(interaction, channel);
          if (permissionIssue) {
            await replyOrEditEphemeral(interaction, permissionIssue);
            return;
          }

          let url = query;
          let title = '';

          await replyOrEditEphemeral(interaction, '🔍 YouTubeの動画情報を検索/取得しています...');

          const validation = play.yt_validate(query);
          if (validation === false) {
            // 検索キーワードとして処理する
            const searchResults = await play.search(query, { limit: 1 });
            if (!searchResults || searchResults.length === 0) {
              await replyOrEditEphemeral(interaction, `❌ 「${query}」に一致する動画が見つかりませんでした。`);
              return;
            }
            url = searchResults[0].url;
            title = searchResults[0].title;
          } else {
            // URLの場合
            try {
              const videoInfo = await play.video_info(url);
              title = videoInfo.video_details.title;
            } catch (err) {
              title = 'YouTube 動画';
            }
          }

          await replyOrEditEphemeral(interaction, `🔊 「${title}」のストリームを準備中...`);

          const connection = await connectOrMove(interaction, channel);
          const player = ensurePlayer(client, interaction.guild.id);
          connection.subscribe(player);

          const stream = await play.stream(url);
          const resource = createAudioResource(stream.stream, {
            inputType: stream.type,
          });

          player.stop(true);
          player.play(resource);

          await replyOrEditEphemeral(interaction, `🔊 「${title}」を再生します。\n${url}`);
        } catch (error) {
          console.error('[voice] yt-play failed:', error);
          await replyOrEditEphemeral(interaction, `YouTube動画の再生中にエラーが発生しました: ${error.message}`);
        }
      },
    },
  ],
};
