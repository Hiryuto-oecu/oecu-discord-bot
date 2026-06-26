const { MessageFlags, ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js');

module.exports = {
  name: 'gabaReaction',
  contextMenus: [
    {
      data: new ContextMenuCommandBuilder()
        .setName('GABAリアクション')
        .setType(ApplicationCommandType.Message),
      async execute(interaction) {
        await interaction.reply({ content: 'この機能は現在開発中です。', flags: MessageFlags.Ephemeral });
      },
    },
  ],
};
