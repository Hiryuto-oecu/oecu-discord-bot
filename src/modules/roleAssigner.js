const {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ComponentType,
  MessageFlags,
} = require('discord.js');

module.exports = {
  name: 'roleAssigner',
  commands: [
    {
      data: new SlashCommandBuilder()
        .setName('assign_role')
        .setDescription('指定したロールを自分に付与します'),
      async execute(interaction, client) {
        if (!interaction.guild) {
          await interaction.reply({ content: 'このコマンドはサーバー内でのみ使用できます。', flags: MessageFlags.Ephemeral });
          return;
        }

        const validRoles = client.config.assignableRoleIds
          .map((roleId) => interaction.guild.roles.cache.get(roleId))
          .filter(Boolean);

        if (!validRoles.length) {
          await interaction.reply({ content: '利用可能なロールが見つかりません。', flags: MessageFlags.Ephemeral });
          return;
        }

        const select = new StringSelectMenuBuilder()
          .setCustomId(`assign_role:${interaction.user.id}`)
          .setPlaceholder('付与するロールを選択してください')
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(validRoles.map((role) => ({
            label: role.name,
            value: role.id,
          })));

        const row = new ActionRowBuilder().addComponents(select);
        const response = await interaction.reply({
          content: '付与するロールを選択してください。',
          components: [row],
          flags: MessageFlags.Ephemeral,
          fetchReply: true,
        });

        try {
          const selectInteraction = await response.awaitMessageComponent({
            componentType: ComponentType.StringSelect,
            time: 60_000,
            filter: (componentInteraction) => (
              componentInteraction.customId === `assign_role:${interaction.user.id}`
              && componentInteraction.user.id === interaction.user.id
            ),
          });

          const role = interaction.guild.roles.cache.get(selectInteraction.values[0]);
          if (!role) {
            await selectInteraction.update({ content: '選択されたロールが見つかりません。', components: [] });
            return;
          }

          try {
            const member = await interaction.guild.members.fetch(interaction.user.id);
            await member.roles.add(role, 'ユーザーによる /assign_role 実行');
            await selectInteraction.update({ content: `ロール「${role.name}」を付与しました。`, components: [] });
          } catch (error) {
            console.error('[roleAssigner] Failed to assign role:', error);
            await selectInteraction.update({ content: 'ロールの付与中にエラーが発生しました。権限を確認してください。', components: [] });
          }
        } catch {
          await interaction.editReply({ content: '時間切れです。もう一度 `/assign_role` を実行してください。', components: [] }).catch(() => {});
        }
      },
    },
  ],
};
