const fs = require('node:fs');
const path = require('node:path');
const {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
} = require('discord.js');
const config = require('./config');
const { registerGuildCommands } = require('./utils/commands');

const commandModules = [
  require('./modules/core'),
  require('./modules/roleAssigner'),
  require('./modules/emailVerify'),
  require('./modules/fileChangeNotify'),
  require('./modules/reactionRemove'),
  require('./modules/gabaReaction'),
  require('./modules/voice'),
  require('./modules/twitterFix'),
  ...(config.enableJanken ? [require('./modules/janken')] : []),
  ...(config.enableOshirase ? [require('./modules/oshirase')] : []),
  ...(config.enableListChannels ? [require('./modules/channelLister')] : []),
];

if (!config.token) {
  console.error('エラー: DISCORD_BOT_TOKEN が設定されていません。Node/.env または環境変数に設定してください。');
  process.exit(1);
}

if (!config.guildIds.length) {
  console.error('エラー: DISCORD_GUILD_IDS が設定されていません。');
  process.exit(1);
}

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.soundDir, { recursive: true });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
    Partials.User,
  ],
});

client.commands = new Collection();
client.contextMenus = new Collection();
client.config = config;
client.deletedMessages = new Map();

for (const mod of commandModules) {
  for (const command of mod.commands || []) {
    client.commands.set(command.data.name, command);
  }
  for (const contextMenu of mod.contextMenus || []) {
    client.contextMenus.set(contextMenu.data.name, contextMenu);
  }
}

client.once(Events.ClientReady, async () => {
  console.log(`${client.user.tag} としてログインしました (ID: ${client.user.id})`);
  console.log(`discord.js バージョン: ${require('discord.js').version}`);
  console.log(`コマンド登録対象ギルド: ${config.guildIds.join(', ')}`);

  if (!config.ownerId) {
    try {
      const app = await client.application.fetch();
      const owner = app.owner;
      client.config.ownerId = owner?.id;
      console.log(`APIからボットオーナーIDを取得しました: ${client.config.ownerId || '不明'}`);
    } catch (error) {
      console.warn('アプリケーション情報の取得に失敗しました。/restart が利用できない可能性があります。', error);
    }
  } else {
    console.log(`環境変数からボットオーナーIDを読み込みました: ${config.ownerId}`);
  }

  try {
    const allCommands = [
      ...client.commands.values(),
      ...client.contextMenus.values(),
    ];
    await registerGuildCommands(client, allCommands, config.guildIds, config.token);
  } catch (error) {
    console.error('[commands] コマンド登録に失敗しました:', error);
  }

  for (const mod of commandModules) {
    if (typeof mod.onReady === 'function') {
      try {
        await mod.onReady(client);
      } catch (error) {
        console.error(`[${mod.name || 'module'}] onReady failed:`, error);
      }
    }
  }

  console.log('ボットの準備が完了しました。');
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    for (const mod of commandModules) {
      if (typeof mod.onInteractionCreate === 'function') {
        const handled = await mod.onInteractionCreate(interaction, client);
        if (handled) return;
      }
    }

    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (!command || typeof command.autocomplete !== 'function') return;
      await command.autocomplete(interaction, client);
      return;
    }

    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction, client);
      return;
    }

    if (interaction.isMessageContextMenuCommand()) {
      const contextMenu = client.contextMenus.get(interaction.commandName);
      if (!contextMenu) return;
      await contextMenu.execute(interaction, client);
      return;
    }
  } catch (error) {
    console.error('[interaction] Error:', error);
    const message = 'コマンドの実行中にエラーが発生しました。';
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: message, ephemeral: true }).catch(() => {});
    } else {
      await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  for (const mod of commandModules) {
    if (typeof mod.onMessageCreate === 'function') {
      await mod.onMessageCreate(message, client).catch((error) => {
        console.error(`[${mod.name || 'module'}] onMessageCreate failed:`, error);
      });
    }
  }
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  for (const mod of commandModules) {
    if (typeof mod.onMessageReactionAdd === 'function') {
      await mod.onMessageReactionAdd(reaction, user, client).catch((error) => {
        console.error(`[${mod.name || 'module'}] onMessageReactionAdd failed:`, error);
      });
    }
  }
});

client.on(Events.Raw, async (packet) => {
  for (const mod of commandModules) {
    if (typeof mod.onRaw === 'function') {
      await mod.onRaw(packet, client).catch((error) => {
        console.error(`[${mod.name || 'module'}] onRaw failed:`, error);
      });
    }
  }
});

process.on('SIGINT', () => {
  console.log('\nSIGINT を検出しました。ボットを終了します。');
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nSIGTERM を検出しました。ボットを終了します。');
  client.destroy();
  process.exit(0);
});

client.login(config.token).catch((error) => {
  console.error('Discord へのログインに失敗しました:', error);
  process.exit(1);
});
