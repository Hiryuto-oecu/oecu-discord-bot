const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { readJson, writeJson } = require('../utils/jsonStore');

const hands = ['グー', 'チョキ', 'パー'];

function judge(userHand, botHand) {
  if (userHand === botHand) {
    return { text: 'あいこ！ Draw! DRAW!', emoji: '🤝', color: 0x99aab5, win: false, resetReason: 'あいこのため連勝はリセットされました (0)' };
  }
  if (
    (userHand === 'グー' && botHand === 'チョキ')
    || (userHand === 'チョキ' && botHand === 'パー')
    || (userHand === 'パー' && botHand === 'グー')
  ) {
    return { text: 'あなたの勝ち！ Congrats!', emoji: '🎉', color: 0xf1c40f, win: true };
  }
  return { text: 'あなたの負け... Don\'t mind!', emoji: '😢', color: 0xed4245, win: false, resetReason: '負けたため連勝はリセットされました (0)' };
}

async function loadLeaderboard(client) {
  const raw = await readJson(client.config.jankenLeaderboardFile, {});
  return new Map(Object.entries(raw).map(([userId, wins]) => [String(userId), Number(wins) || 0]));
}

async function saveLeaderboard(client, leaderboard) {
  const data = {};
  for (const [userId, wins] of leaderboard.entries()) {
    data[userId] = wins;
  }
  await writeJson(client.config.jankenLeaderboardFile, data);
}

async function ensureJankenChannel(interaction, client, leaderboard = false) {
  if (interaction.channelId === client.config.jankenChannelId) return true;

  const channel = await client.channels.fetch(client.config.jankenChannelId).catch(() => null);
  const mention = channel ? channel.toString() : `ID: ${client.config.jankenChannelId}`;
  await interaction.reply({
    content: leaderboard
      ? `じゃんけんリーダーボードは ${mention} チャンネルでのみ表示できます。`
      : `じゃんけんは ${mention} チャンネルでのみプレイできます。`,
    ephemeral: true,
  });
  return false;
}

module.exports = {
  name: 'janken',
  commands: [
    {
      data: new SlashCommandBuilder()
        .setName('janken')
        .setDescription('ボットとじゃんけんをします。')
        .addStringOption((option) => option
          .setName('hand')
          .setDescription('あなたの出す手を選んでください')
          .setRequired(true)
          .addChoices(...hands.map((hand) => ({ name: hand, value: hand })))),
      async execute(interaction, client) {
        if (!await ensureJankenChannel(interaction, client, false)) return;

        const hand = interaction.options.getString('hand', true);
        const botHand = hands[Math.floor(Math.random() * hands.length)];
        const result = judge(hand, botHand);
        const leaderboard = await loadLeaderboard(client);
        const userId = interaction.user.id;

        if (result.win) {
          leaderboard.set(userId, (leaderboard.get(userId) || 0) + 1);
        } else {
          leaderboard.set(userId, 0);
        }

        await saveLeaderboard(client, leaderboard);
        const currentStreak = leaderboard.get(userId) || 0;

        const embed = new EmbedBuilder()
          .setTitle(`${result.emoji} じゃんけん ポン！ ${result.emoji}`)
          .setDescription(`結果は... **${result.text}**`)
          .setColor(result.color)
          .setTimestamp(new Date())
          .addFields(
            { name: 'あなた', value: `> ${hand}`, inline: true },
            { name: 'ボット', value: `> ${botHand}`, inline: true },
            result.win
              ? { name: '🏆 現在の連勝数', value: `${currentStreak} 連勝中！`, inline: false }
              : { name: '💨 連勝記録', value: result.resetReason, inline: false },
          )
          .setFooter({ text: `プレイヤー: ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() });

        await interaction.reply({ embeds: [embed] });
      },
    },
    {
      data: new SlashCommandBuilder()
        .setName('janken_leaderboard')
        .setDescription('じゃんけんの連勝数ランキングを表示します。'),
      async execute(interaction, client) {
        if (!await ensureJankenChannel(interaction, client, true)) return;

        const leaderboard = await loadLeaderboard(client);
        const ranking = [...leaderboard.entries()]
          .filter(([, wins]) => wins > 0)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10);

        if (!ranking.length) {
          await interaction.reply({ content: 'まだ誰もじゃんけんで連勝していません。', ephemeral: true });
          return;
        }

        const embed = new EmbedBuilder()
          .setTitle('🏆 じゃんけん連勝数リーダーボード 🏆')
          .setDescription('現在の連勝数トップランカーたちです！')
          .setColor(0x3498db)
          .setTimestamp(new Date());

        for (let i = 0; i < ranking.length; i += 1) {
          const [userId, wins] = ranking[i];
          const member = interaction.guild.members.cache.get(userId)
            || await interaction.guild.members.fetch(userId).catch(() => null);
          const user = member?.user || await client.users.fetch(userId).catch(() => null);
          const userName = member?.displayName || user?.username || `不明なユーザー (ID: ${userId})`;
          const rankEmoji = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
          embed.addFields({ name: `${rankEmoji} ${userName}`, value: `> **${wins}** 連勝中`, inline: false });
        }

        embed.setFooter({ text: `最終更新: ${new Date().toLocaleString('ja-JP')}` });
        await interaction.reply({ embeds: [embed] });
      },
    },
  ],
};
