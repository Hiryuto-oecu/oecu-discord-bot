const { MessageFlags, SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'core',
  commands: [
    {
      data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('ボットの応答速度や情報を表示します。'),
      async execute(interaction, client) {
        const startedAt = Date.now();
        await interaction.deferReply();
        const interactionLatency = Date.now() - startedAt;
        const apiLatency = Math.round(client.ws.ping);

        const embed = new EmbedBuilder()
          .setTitle('🏓 Pong!')
          .setDescription(`現在のボットのステータス情報です。\n(サーバー: ${interaction.guild?.name || '不明'})`)
          .setColor(0x57f287)
          .setTimestamp(new Date())
          .addFields(
            { name: '📡 APIレイテンシ', value: `${apiLatency} ms`, inline: true },
            { name: '⏱️ インタラクション応答', value: `${interactionLatency} ms`, inline: true },
            { name: '🤖 ボット情報', value: `ユーザー名: ${client.user.username}\nID: ${client.user.id}`, inline: false },
          )
          .setFooter({
            text: `リクエスト者: ${interaction.user.username}`,
            iconURL: interaction.user.displayAvatarURL(),
          });

        await interaction.followUp({ embeds: [embed] });
      },
    },
    {
      data: new SlashCommandBuilder()
        .setName('restart')
        .setDescription('ボットを再起動します (オーナー限定)。'),
      async execute(interaction, client) {
        const ownerId = client.config.ownerId;
        if (!ownerId) {
          await interaction.reply({ content: 'エラー: ボットのオーナーIDが設定されていません。再起動できません。', flags: MessageFlags.Ephemeral });
          return;
        }

        if (interaction.user.id !== ownerId) {
          console.warn(`警告: 権限のないユーザー (${interaction.user.tag}, ID: ${interaction.user.id}) が /restart を試行しました。`);
          await interaction.reply({ content: 'エラー: このコマンドを実行する権限がありません。', flags: MessageFlags.Ephemeral });
          return;
        }

        console.log(`オーナー (${interaction.user.tag}, ID: ${interaction.user.id}) により再起動コマンドが実行されました。`);
        await interaction.reply({ content: 'ボットを再起動します...', flags: MessageFlags.Ephemeral });
        setTimeout(() => {
          console.log(`終了コード ${client.config.restartExitCode} でボットプロセスを終了します。`);
          process.exit(client.config.restartExitCode);
        }, 1000);
      },
    },
  ],
};
