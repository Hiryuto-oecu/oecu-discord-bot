const { MessageFlags, SlashCommandBuilder } = require('discord.js');

async function isOwner(user, client) {
  if (client.config.ownerId) return user.id === client.config.ownerId;

  try {
    const app = await client.application.fetch();
    const owner = app.owner;
    if (owner?.members) {
      return owner.members.has(user.id);
    }
    client.config.ownerId = owner?.id;
    return user.id === client.config.ownerId;
  } catch (error) {
    console.error('[channelLister] Failed to fetch application owner:', error);
    return false;
  }
}

module.exports = {
  name: 'channelLister',
  commands: [
    {
      data: new SlashCommandBuilder()
        .setName('listchannels')
        .setDescription('サーバー内のチャンネル一覧を表示します (オーナー限定)。'),
      async execute(interaction, client) {
        if (!interaction.guild) {
          await interaction.reply({ content: 'This command can only be used within a server.', flags: MessageFlags.Ephemeral });
          return;
        }

        if (!await isOwner(interaction.user, client)) {
          await interaction.reply({ content: 'Sorry, only the bot owner can use this command.', flags: MessageFlags.Ephemeral });
          return;
        }

        const channels = [...interaction.guild.channels.cache.values()]
          .sort((a, b) => a.rawPosition - b.rawPosition)
          .map((channel) => channel.name);

        let response = channels.length
          ? `**Channels in this server:**\n${channels.map((name) => `- \`${name}\``).join('\n')}`
          : 'No channels found in this server.';

        if (response.length > 2000) {
          response = `${response.slice(0, 1990)}\n... (list truncated)`;
        }

        await interaction.reply({ content: response, flags: MessageFlags.Ephemeral });
      },
    },
  ],
};
