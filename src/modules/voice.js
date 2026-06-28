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
  StreamType,
} = require('@discordjs/voice');
const ffmpeg = require('ffmpeg-static');

if (ffmpeg) {
  const ffmpegDir = path.dirname(ffmpeg);
  if (!process.env.PATH.includes(ffmpegDir)) {
    process.env.PATH = `${ffmpegDir}${path.delimiter}${process.env.PATH}`;
  }
}

const VOICE_READY_TIMEOUT_MS = 20_000;
const VOICE_DEBUG = process.env.VOICE_DEBUG === 'true';

let ytInstance = null;
let InnertubeClass = null;
let generatePoToken = null;

async function getYoutubeInstance(client, forceRegen = false) {
  if (!InnertubeClass || !generatePoToken) {
    try {
      const yti = await import('youtubei.js');
      InnertubeClass = yti.Innertube || yti.default?.Innertube || yti.default;
    } catch (err) {
      console.error('[voice] Failed to import youtubei.js:', err);
      throw err;
    }

    try {
      const gen = await import('youtube-po-token-generator');
      generatePoToken = gen.generate || gen.default?.generate || gen.default || gen;
    } catch (err) {
      try {
        const gen = require('youtube-po-token-generator');
        generatePoToken = gen.generate || gen;
      } catch (err2) {
        console.warn('[voice] Failed to import youtube-po-token-generator, proceeding without it:', err2);
      }
    }
  }

  if (ytInstance && !forceRegen) return ytInstance;

  let opts = {};

  // 1. 動的な PO Token 生成を試みる (自動)
  try {
    if (typeof generatePoToken === 'function') {
      console.log('[voice] Generating dynamic PO Token...');
      const { poToken, visitorData } = await generatePoToken();
      if (poToken && visitorData) {
        opts.po_token = poToken;
        opts.visitor_data = visitorData;
        console.log('[voice] Dynamic PO Token generated successfully.');
      }
    }
  } catch (err) {
    console.warn('[voice] Failed to generate dynamic PO Token. Trying cookies...', err);
  }

  // 2. Cookie が設定されていれば追加する (フォールバック)
  if (client.config.youtubeCookie) {
    opts.cookie = client.config.youtubeCookie;
    console.log('[voice] Using provided YouTube cookies.');
  }

  ytInstance = await InnertubeClass.create(opts);
  return ytInstance;
}

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

          await replyOrEditEphemeral(interaction, '🔍 YouTubeの動画情報を検索/取得しています...');

          let yt = await getYoutubeInstance(client);
          let videoId = null;
          let title = '';

          const isUrl = query.includes('youtu.be') || query.includes('youtube.com');

          async function resolveVideo(forceRegen = false) {
            if (forceRegen) {
              yt = await getYoutubeInstance(client, true);
            }

            if (isUrl) {
              const match = query.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
              if (!match) {
                throw new Error('無効なYouTube URLです。');
              }
              videoId = match[1];
            } else {
              const search = await yt.search(query, { type: 'video' });
              const videos = search.videos || (search.results && search.results.filter(r => r.type === 'Video')) || [];
              if (videos.length === 0) {
                throw new Error('動画が見つかりませんでした。');
              }
              videoId = videos[0].id;
              title = (videos[0].title && typeof videos[0].title === 'object')
                ? (videos[0].title.text || videos[0].title.toString())
                : videos[0].title;
            }

            const info = await yt.getInfo(videoId);
            title = title || info.basic_info.title;
            const format = info.chooseFormat({ type: 'audio', quality: 'best' });
            if (!format) {
              throw new Error('適切な音声フォーマットが見つかりませんでした。');
            }
            const streamUrl = format.decipher(yt.session.player);
            return { streamUrl, title, videoId };
          }

          let videoData;
          try {
            videoData = await resolveVideo(false);
          } catch (firstError) {
            console.warn('[voice] Initial stream resolve failed, retrying with regenerated token...', firstError);
            try {
              videoData = await resolveVideo(true);
            } catch (retryError) {
              throw new Error(`動画情報の取得に失敗しました: ${retryError.message} (初回エラー: ${firstError.message})`);
            }
          }

          const { streamUrl, title: finalTitle, videoId: finalId } = videoData;
          const videoUrl = `https://www.youtube.com/watch?v=${finalId}`;

          await replyOrEditEphemeral(interaction, `🔊 「${finalTitle}」を再生します。\n${videoUrl}`);

          const connection = await connectOrMove(interaction, channel);
          const player = ensurePlayer(client, interaction.guild.id);
          connection.subscribe(player);

          const resource = createAudioResource(streamUrl, {
            inputType: StreamType.Arbitrary,
          });

          player.stop(true);
          player.play(resource);
        } catch (error) {
          console.error('[voice] yt-play failed:', error);
          await replyOrEditEphemeral(interaction, `YouTube動画の再生中にエラーが発生しました: ${error.message}`);
        }
      },
    },
  ],
};
