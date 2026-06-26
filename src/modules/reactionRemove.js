const {
  MessageFlags,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionsBitField,
} = require('discord.js');
const { truncate } = require('../utils/text');
const { formatUtc } = require('../utils/time');

async function sendDeletionDm(author, message, channel, guild, reactionCount, targetEmoji) {
  try {
    const contentPreview = truncate(message.content, 1000);
    const embed = new EmbedBuilder()
      .setTitle('⚠️ メッセージが削除されました')
      .setDescription('あなたのメッセージが削除されました。')
      .setColor(0xed4245)
      .setTimestamp(new Date())
      .addFields(
        { name: '削除理由', value: `メッセージにリアクション「${targetEmoji}」が${reactionCount}つ付いたため`, inline: false },
        { name: 'サーバー', value: guild.name, inline: true },
        { name: 'チャンネル', value: `#${channel.name}`, inline: true },
      )
      .setFooter({ text: 'このメッセージは自動で送信されています。' });

    if (contentPreview) {
      embed.addFields({ name: '削除されたメッセージ内容', value: `\`\`\`\n${contentPreview}\n\`\`\``, inline: false });
    }

    await author.send({ embeds: [embed] });
    console.log(`[DM] Sent deletion notification to ${author.tag} (ID: ${author.id})`);
  } catch (error) {
    console.warn(`[DM] Cannot send deletion notification to ${author.tag || author.id}:`, error.message);
  }
}

function firstMessageData(collection) {
  const message = collection.first();
  if (!message) return null;
  return {
    content: message.content,
    authorName: message.member?.displayName || message.author.displayName || message.author.username,
    timestamp: message.createdAt,
  };
}

module.exports = {
  name: 'reactionRemove',
  commands: [
    {
      data: new SlashCommandBuilder()
        .setName('remove_reason')
        .setDescription('最近削除されたメッセージの前後1メッセージを表示します。'),
      async execute(interaction, client) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (!client.deletedMessages.size) {
          await interaction.followUp({ content: '❌ 削除されたメッセージの記録がありません。', flags: MessageFlags.Ephemeral });
          return;
        }

        const latest = [...client.deletedMessages.values()]
          .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];

        const embed = new EmbedBuilder()
          .setTitle('🔍 削除されたメッセージの前後コンテキスト')
          .setDescription(`チャンネル: ${latest.channelMention}`)
          .setColor(0x3498db)
          .setTimestamp(new Date());

        if (latest.messageBefore) {
          embed.addFields({
            name: '📤 前のメッセージ',
            value: `**${latest.messageBefore.authorName}**: ${truncate(latest.messageBefore.content, 500) || '*（コンテンツなし）*'}`,
            inline: false,
          });
        } else {
          embed.addFields({ name: '📤 前のメッセージ', value: '*（前のメッセージなし）*', inline: false });
        }

        embed.addFields({
          name: '🗑️ 削除されたメッセージ',
          value: `**${latest.authorName}**: ${truncate(latest.content, 500) || '*（コンテンツなし）*'}`,
          inline: false,
        });

        if (latest.messageAfter) {
          embed.addFields({
            name: '📥 後のメッセージ',
            value: `**${latest.messageAfter.authorName}**: ${truncate(latest.messageAfter.content, 500) || '*（コンテンツなし）*'}`,
            inline: false,
          });
        } else {
          embed.addFields({ name: '📥 後のメッセージ', value: '*（後のメッセージなし）*', inline: false });
        }

        embed.setFooter({ text: `削除時刻: ${formatUtc(latest.timestamp)}` });
        await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
      },
    },
  ],

  async onMessageReactionAdd(reaction, user, client) {
    if (user.bot) return;
    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch {
        return;
      }
    }

    const { message } = reaction;
    if (!message.guild) return;
    if (client.config.reactionWhitelistChannelIds.includes(message.channelId)) return;
    if (reaction.emoji.toString() !== client.config.reactionTargetEmoji) return;

    const reactionCount = reaction.count ?? 0;
    console.log(`[DEBUG] Reaction on message ${message.id}: Emoji: ${reaction.emoji}, Target Emoji Count: ${reactionCount}`);
    if (reactionCount < client.config.reactionDeleteThreshold) return;

    if (message.partial) {
      try {
        await message.fetch();
      } catch {
        return;
      }
    }

    const channel = message.channel;
    if (!channel?.isTextBased?.() || !('messages' in channel)) return;

    const author = message.author;
    const guild = message.guild;
    const contentPreview = truncate(message.content, 50);

    let messagesBefore = null;
    let messagesAfter = null;
    try {
      messagesBefore = firstMessageData(await channel.messages.fetch({ before: message.id, limit: 1 }));
      messagesAfter = firstMessageData(await channel.messages.fetch({ after: message.id, limit: 1 }));
    } catch (error) {
      console.error('[reactionRemove] Error fetching context messages before deletion:', error);
    }

    client.deletedMessages.set(message.id, {
      id: message.id,
      content: message.content,
      authorId: author.id,
      authorName: message.member?.displayName || author.displayName || author.username,
      channelId: channel.id,
      channelMention: channel.toString(),
      timestamp: new Date(),
      guildId: guild.id,
      messageBefore: messagesBefore,
      messageAfter: messagesAfter,
    });

    console.log(`[ACTION] Message from ${author.tag} (ID: ${author.id}) deleted. Preview: "${contentPreview}"`);
    await sendDeletionDm(author, message, channel, guild, reactionCount, client.config.reactionTargetEmoji);

    let member = message.member;
    if (!member) {
      member = await guild.members.fetch(author.id).catch(() => null);
    }

    if (!member) {
      await message.delete().catch(() => {});
      await channel.send(`${author.username} のメッセージにリアクション「${client.config.reactionTargetEmoji}」が${reactionCount}つ付いたため削除されましたが、ユーザーがサーバーにいないか情報取得に失敗したためタイムアウトできませんでした。`).catch(() => {});
      return;
    }

    if (client.config.timeoutExemptUserIds.includes(member.id) || member.id === client.user.id) {
      return;
    }

    if (member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      await message.delete().catch(() => {});
      await channel.send(`${member} のメッセージにリアクション「${client.config.reactionTargetEmoji}」が${reactionCount}つ付いたため削除されましたが、管理者のためタイムアウトは行われませんでした。管理者であることを自覚してください。`).catch(() => {});
      return;
    }

    const timeoutUntil = new Date(Date.now() + client.config.reactionTimeoutMinutes * 60 * 1000);
    await message.delete().catch(() => {});
    await member.timeout(timeoutUntil, `メッセージへの「${client.config.reactionTargetEmoji}」リアクションが${reactionCount}つ付いたため`);
    await channel.send(`${member} のメッセージにリアクション「${client.config.reactionTargetEmoji}」が${reactionCount}つ付いたため削除され、${client.config.reactionTimeoutMinutes}分間のタイムアウトが付与されました。`);
  },
};
