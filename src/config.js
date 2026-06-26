const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

function parseIds(value, fallback = []) {
  if (!value) return fallback;
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function env(name, fallback = undefined) {
  return process.env[name] ?? fallback;
}

function envId(name, fallback = undefined) {
  const value = env(name, fallback);
  return value === undefined || value === null || value === '' ? undefined : String(value);
}

const defaultGuildId = '1355832680557580511';

const config = {
  token: env('DISCORD_BOT_TOKEN'),
  ownerId: envId('BOT_OWNER_ID'),
  guildIds: parseIds(env('DISCORD_GUILD_IDS'), [defaultGuildId]),
  restartExitCode: Number(env('RESTART_EXIT_CODE', '42')),

  dataDir: path.resolve(__dirname, '..', env('DATA_DIR', 'data')),
  soundDir: path.resolve(__dirname, '..', env('SOUND_DIR', 'sounds')),

  watchFilePath: path.resolve(__dirname, '..', env('WATCH_FILE_PATH', 'data/change.json')),
  watchChannelId: envId('WATCH_CHANNEL_ID'),
  watchRoleId: envId('WATCH_ROLE_ID'),

  assignableRoleIds: parseIds(env('ASSIGNABLE_ROLE_IDS'), ['1361711315260805331']),

  verifiedRoleId: envId('VERIFIED_ROLE_ID', '1371375954663968808'),
  evenVerifiedRoleId: envId('EVEN_VERIFIED_ROLE_ID', '1365240658104680448'),
  oddVerifiedRoleId: envId('ODD_VERIFIED_ROLE_ID', '1365241396117770280'),
  verifyFile: path.resolve(__dirname, '..', env('VERIFY_FILE', 'data/verify.json')),
  codeExpirationMinutes: Number(env('CODE_EXPIRATION_MINUTES', '10')),
  senderEmail: env('SENDER_EMAIL', '大学支援Bot <university.bot.verify@gmail.com>'),
  smtpHost: env('SMTP_HOST', 'localhost'),
  smtpPort: Number(env('SMTP_PORT', '25')),
  smtpSecure: env('SMTP_SECURE', 'false') === 'true',
  smtpUser: env('SMTP_USER'),
  smtpPass: env('SMTP_PASS'),

  reactionWhitelistChannelIds: parseIds(
    env('REACTION_WHITELIST_CHANNEL_IDS'),
    ['1362265150005973002', '1369989530471497728'],
  ),
  reactionTargetEmoji: env('REACTION_TARGET_EMOJI', '⚠️'),
  reactionDeleteThreshold: Number(env('REACTION_DELETE_THRESHOLD', '6')),
  reactionTimeoutMinutes: Number(env('REACTION_TIMEOUT_MINUTES', '1')),
  timeoutExemptUserIds: parseIds(env('TIMEOUT_EXEMPT_USER_IDS'), ['1361193257157263451']),

  twitterFixDataFile: path.resolve(__dirname, '..', env('TWITTER_FIX_DATA_FILE', 'data/twitter_fix_data.json')),

  enableJanken: env('ENABLE_JANKEN', 'false') === 'true',
  jankenChannelId: envId('JANKEN_CHANNEL_ID', '1361231995262337157'),
  jankenLeaderboardFile: path.resolve(__dirname, '..', env('JANKEN_LEADERBOARD_FILE', 'data/janken_leaderboard.json')),

  enableOshirase: env('ENABLE_OSHIRASE', 'false') === 'true',
  oshiraseDataFile: path.resolve(__dirname, '..', env('OSHIRASE_DATA_FILE', 'data/output.json')),
  oshiraseItemsPerPage: Number(env('OSHIRASE_ITEMS_PER_PAGE', '3')),

  enableListChannels: env('ENABLE_LISTCHANNELS', 'false') === 'true',
};

module.exports = config;
