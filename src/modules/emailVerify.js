const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const nodemailer = require('nodemailer');
const crypto = require('node:crypto');
const { readJson, writeJson } = require('../utils/jsonStore');

const STUDENT_ID_PATTERN = /^[A-Z]{2}\d{2}[A-Z]\d{3}$/i;

function generateCode(length = 6) {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += crypto.randomInt(0, 10).toString();
  }
  return code;
}

function createTransport(config) {
  const transportOptions = {
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
  };

  if (config.smtpUser && config.smtpPass) {
    transportOptions.auth = {
      user: config.smtpUser,
      pass: config.smtpPass,
    };
  }

  return nodemailer.createTransport(transportOptions);
}

async function sendVerificationEmail(config, recipientEmail, code) {
  const body = `Discordサーバーでのメールアドレス認証リクエストを受け付けました。

以下の認証コードをDiscordの \`/verify_number\` コマンドで入力してください。

認証コード: ${code}

このコードは${config.codeExpirationMinutes}分間有効です。
このメールに心当たりがない場合は、無視してください。

※本メールはサーバーより自動送信されています。
返信をいただいても対応できませんのでご了承ください。

※このメールは、大学内の有志によって運営されているDiscordサーバーの認証用です。
大学とは直接の関係はありませんので、誤解のないようお願いいたします。
`;

  const transporter = createTransport(config);
  await transporter.sendMail({
    from: config.senderEmail,
    to: recipientEmail,
    subject: 'メールアドレス認証コード',
    text: body,
  });
}

async function assignRoleIfExists(member, roleId, reason) {
  if (!roleId) return true;
  const role = member.guild.roles.cache.get(roleId);
  if (!role) {
    console.warn(`[emailVerify] Role ${roleId} not found in guild ${member.guild.id}`);
    return false;
  }
  await member.roles.add(role, reason);
  return true;
}

module.exports = {
  name: 'emailVerify',
  commands: [
    {
      data: new SlashCommandBuilder()
        .setName('email_verify')
        .setDescription('メールアドレスの確認を行います。')
        .addStringOption((option) => option
          .setName('user_name')
          .setDescription('メールアドレスの @ より前を入力してください (例: GP99A123)')
          .setRequired(true))
        .addStringOption((option) => option
          .setName('domain')
          .setDescription('メールアドレスの種類を選択してください')
          .setRequired(true)
          .addChoices(
            { name: '@oecu.jp', value: '@oecu.jp' },
            { name: '@osakac.ac.jp', value: '@osakac.ac.jp' },
          )),
      async execute(interaction, client) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        let userName = interaction.options.getString('user_name', true).toUpperCase();
        const domain = interaction.options.getString('domain', true);

        if (!STUDENT_ID_PATTERN.test(userName)) {
          await interaction.followUp({
            content: '学生番号の形式が正しくありません。\n再度、学生番号を確認してください。\n形式例: GP99A123\n(職員・教員の方はお問い合わせください。)',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const verifyData = await readJson(client.config.verifyFile, {});
        const existingEntry = verifyData[userName];

        if (existingEntry?.verified) {
          if (String(existingEntry.discord_id) === interaction.user.id) {
            await interaction.followUp({ content: `学生番号 \`${userName}\` は既に認証済みです。`, flags: MessageFlags.Ephemeral });
          } else {
            console.warn(`[emailVerify] User ${interaction.user.id} tried to verify already verified ID ${userName} owned by ${existingEntry.discord_id}`);
            await interaction.followUp({ content: `学生番号 \`${userName}\` は他のユーザーによって既に認証されています。問題がある場合は管理者に連絡してください。`, flags: MessageFlags.Ephemeral });
          }
          return;
        }

        if (existingEntry && String(existingEntry.discord_id) !== interaction.user.id) {
          console.warn(`[emailVerify] User ${interaction.user.id} tried to verify ID ${userName} pending by ${existingEntry.discord_id}`);
          await interaction.followUp({ content: `学生番号 \`${userName}\` は現在、他のユーザーが認証手続き中です。しばらく待ってから再度試すか、管理者に連絡してください。`, flags: MessageFlags.Ephemeral });
          return;
        }

        const code = generateCode();
        const now = new Date();
        const expiresAt = new Date(now.getTime() + client.config.codeExpirationMinutes * 60 * 1000);
        const fullEmail = `${userName}${domain}`;

        try {
          await sendVerificationEmail(client.config, fullEmail, code);
        } catch (error) {
          console.error(`[emailVerify] Failed to send email to ${fullEmail}:`, error);
          await interaction.followUp({ content: 'メールの送信に失敗しました。サーバー管理者に連絡してください。', flags: MessageFlags.Ephemeral });
          return;
        }

        verifyData[userName] = {
          discord_id: interaction.user.id,
          domain,
          code,
          expires_at: expiresAt.toISOString(),
          verified: false,
          verified_at: null,
        };
        await writeJson(client.config.verifyFile, verifyData);

        console.info(`[emailVerify] Verification code generated for ${userName} (${interaction.user.id}). Expires at ${expiresAt.toISOString()}.`);
        await interaction.followUp({
          content: `\`${fullEmail}\` に \`university.bot.verify@gmail.com\` から認証コードを送信しました。\n`
            + `メールを確認し、\`${client.config.codeExpirationMinutes}\`分以内に \`/verify_number\` コマンドでコードを入力してください。\n`
            + '## 大半は迷惑メールフォルダに振り分けられますので、そちらもご確認ください。',
          flags: MessageFlags.Ephemeral,
        });
      },
    },
    {
      data: new SlashCommandBuilder()
        .setName('verify_number')
        .setDescription('メールで受信した認証コードを入力します。')
        .addStringOption((option) => option
          .setName('code')
          .setDescription('6桁の認証コードを入力してください')
          .setRequired(true)),
      async execute(interaction, client) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const code = interaction.options.getString('code', true);
        if (!/^\d{6}$/.test(code)) {
          await interaction.followUp({ content: '認証コードの形式が正しくありません (6桁の数字)。\n再度、認証コードを確認してください。', flags: MessageFlags.Ephemeral });
          return;
        }

        const verifyData = await readJson(client.config.verifyFile, {});
        let targetUserName = null;

        for (const [userName, data] of Object.entries(verifyData)) {
          if (
            !data.verified
            && data.code === code
            && String(data.discord_id) === interaction.user.id
          ) {
            const expiresAt = data.expires_at ? new Date(data.expires_at) : null;
            if (!expiresAt || Number.isNaN(expiresAt.getTime())) {
              console.error(`[emailVerify] Invalid expires_at for ${userName}: ${data.expires_at}`);
              await interaction.followUp({ content: '認証データの処理中にエラーが発生しました。管理者に連絡してください。', flags: MessageFlags.Ephemeral });
              return;
            }

            if (Date.now() > expiresAt.getTime()) {
              console.warn(`[emailVerify] Verification code expired for ${userName} (${interaction.user.id}).`);
              await interaction.followUp({ content: `この認証コード (\`${code}\`) は有効期限が切れています。\n\`/email_verify\` コマンドで新しいコードをリクエストしてください。`, flags: MessageFlags.Ephemeral });
              return;
            }

            targetUserName = userName;
            break;
          }
        }

        if (!targetUserName) {
          console.warn(`[emailVerify] Invalid code entered by ${interaction.user.id}. Code: ${code}`);
          await interaction.followUp({ content: '認証コードが正しくないか、有効期限が切れています。\nコードを確認するか、`/email_verify` コマンドで新しいコードをリクエストしてください。', flags: MessageFlags.Ephemeral });
          return;
        }

        verifyData[targetUserName].verified = true;
        verifyData[targetUserName].verified_at = new Date().toISOString();
        verifyData[targetUserName].code = null;
        verifyData[targetUserName].expires_at = null;
        await writeJson(client.config.verifyFile, verifyData);

        try {
          const member = await interaction.guild.members.fetch(interaction.user.id);
          await assignRoleIfExists(member, client.config.verifiedRoleId, 'メールアドレス認証完了');

          const numberSuffix = targetUserName.slice(-3);
          if (/^\d{3}$/.test(numberSuffix)) {
            const parityRoleId = Number(numberSuffix) % 2 === 0
              ? client.config.evenVerifiedRoleId
              : client.config.oddVerifiedRoleId;
            await assignRoleIfExists(member, parityRoleId, 'メールアドレス認証完了');
          } else {
            console.warn(`[emailVerify] Cannot determine parity role for ${targetUserName}`);
          }
        } catch (error) {
          console.error('[emailVerify] Role assignment failed:', error);
          await interaction.followUp({ content: '認証に成功しましたが、ロールの付与中にエラーが発生しました。管理者に連絡してください。', flags: MessageFlags.Ephemeral });
          return;
        }

        console.info(`[emailVerify] User ${targetUserName} (${interaction.user.id}) successfully verified.`);
        await interaction.followUp({ content: `認証に成功しました！ (学生番号: \`${targetUserName}\`)`, flags: MessageFlags.Ephemeral });
      },
    },
  ],
};
