const { EmbedBuilder } = require('discord.js');
const { readJson, writeJson } = require('../utils/jsonStore');

const WEBHOOK_NAME = 'Twitter Fix Bot';
const twitterPattern = /(?<!<)https?:\/\/(x\.com|twitter\.com)\/([^/\s]+)\/status\/(\d+)(?:\S*)?(?!>)/g;

const state = {
  loaded: false,
  messageOwners: new Map(),
};

async function ensureLoaded(client) {
  if (state.loaded) return;
  const data = await readJson(client.config.twitterFixDataFile, {});
  state.messageOwners = new Map(
    Object.entries(data).map(([messageId, ownerId]) => [String(messageId), String(ownerId)]),
  );
  state.loaded = true;
  console.log(`[twitterFix] Loaded ${state.messageOwners.size} message owner records.`);
}

async function save(client) {
  const data = {};
  for (const [messageId, ownerId] of state.messageOwners.entries()) {
    data[String(messageId)] = String(ownerId);
  }
  await writeJson(client.config.twitterFixDataFile, data);
}

function fixTwitterLinks(content) {
  twitterPattern.lastIndex = 0;
  if (!twitterPattern.test(content)) return null;

  twitterPattern.lastIndex = 0;
  const replaced = content.replace(twitterPattern, (_, domain, username, statusId) => (
    `https://fxtwitter.com/${username}/status/${statusId}`
  ));

  return replaced === content ? null : replaced;
}

async function getOrCreateWebhook(channel) {
  const webhooks = await channel.fetchWebhooks();
  const existing = webhooks.find((webhook) => webhook.name === WEBHOOK_NAME);
  if (existing) return existing;
  return channel.createWebhook({ name: WEBHOOK_NAME });
}

async function sendFixedMessageViaWebhook(message, content) {
  const isThread = Boolean(message.channel.isThread?.());
  const baseChannel = isThread ? message.channel.parent : message.channel;
  if (!baseChannel) throw new Error('Thread parent channel was not found.');

  const webhook = await getOrCreateWebhook(baseChannel);
  const payload = {
    content,
    username: message.member?.displayName || message.author.displayName || message.author.username,
    avatarURL: message.author.displayAvatarURL(),
    allowedMentions: { parse: [] },
  };

  if (isThread) {
    payload.threadId = message.channel.id;
  }

  return webhook.send(payload);
}

async function sendFallbackMessage(message, content) {
  const embed = new EmbedBuilder()
    .setTitle('🔗 Twitter/X リンク修正')
    .setDescription(`修正されたリンク:\n${content}`)
    .setColor(0x1da1f2)
    .setFooter({ text: `元のメッセージ: ${message.member?.displayName || message.author.displayName || message.author.username}` });
  return message.channel.send({ embeds: [embed] });
}

module.exports = {
  name: 'twitterFix',

  async onReady(client) {
    await ensureLoaded(client);
  },

  async onMessageCreate(message, client) {
    if (message.author.bot) return;
    await ensureLoaded(client);

    const fixedContent = fixTwitterLinks(message.content);
    if (!fixedContent) return;

    try {
      const sentMessage = await sendFixedMessageViaWebhook(message, fixedContent);
      state.messageOwners.set(String(sentMessage.id), String(message.author.id));
      await save(client);
      await sentMessage.react('🗑️');
      await message.delete().catch(() => {});
    } catch (error) {
      if (error.code !== 50013) {
        console.error('[twitterFix] Twitter fix error:', error);
        return;
      }

      try {
        const sentMessage = await sendFallbackMessage(message, fixedContent);
        state.messageOwners.set(String(sentMessage.id), String(message.author.id));
        await save(client);
        await sentMessage.react('🗑️');
      } catch (fallbackError) {
        console.error('[twitterFix] Fallback send failed:', fallbackError);
      }
    }
  },

  async onMessageReactionAdd(reaction, user, client) {
    if (user.bot) return;
    await ensureLoaded(client);

    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch {
        return;
      }
    }

    if (reaction.emoji.toString() !== '🗑️') return;

    const message = reaction.message;
    const ownerId = state.messageOwners.get(String(message.id));
    if (!ownerId) return;

    if (String(user.id) !== ownerId) {
      await reaction.users.remove(user.id).catch(() => {});
      return;
    }

    try {
      await message.delete();
      state.messageOwners.delete(String(message.id));
      await save(client);
    } catch (error) {
      if (error.code === 10008) {
        state.messageOwners.delete(String(message.id));
        await save(client);
      }
    }
  },
};
