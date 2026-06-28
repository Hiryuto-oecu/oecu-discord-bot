const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

let youtubeCookie = env('YOUTUBE_COOKIE');
if (!youtubeCookie) {
  const cookiePath = path.resolve(__dirname, '..', 'data', 'youtube_cookie.txt');
  if (fs.existsSync(cookiePath)) {
    try {
      youtubeCookie = fs.readFileSync(cookiePath, 'utf8').trim();
    } catch (err) {
      console.warn('data/youtube_cookie.txt の読み込みに失敗しました:', err);
    }
  }
}

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

  youtubeCookie,

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

  updateImage: env('OECU_BOT_IMAGE', 'ghcr.io/hiryuto-oecu/oecu-discord-bot'),
  updateImageTag: env('OECU_BOT_IMAGE_TAG', 'latest'),
  modeStateFile: path.resolve(__dirname, '..', env('MODE_STATE_FILE', 'data/mode_state.json')),
  updateTriggerFile: path.resolve(__dirname, '..', env('UPDATE_TRIGGER_FILE', 'data/update_trigger.json')),
  updateStatusFile: path.resolve(__dirname, '..', env('UPDATE_STATUS_FILE', 'data/update_status.json')),
  updateNotifyStateFile: path.resolve(__dirname, '..', env('UPDATE_NOTIFY_STATE_FILE', 'data/update_notify_state.json')),
  updateNotifyChannelFile: path.resolve(__dirname, '..', env('UPDATE_NOTIFY_CHANNEL_FILE', 'data/update_notify_channel.json')),
  updateNotifyChannelId: envId('UPDATE_NOTIFY_CHANNEL_ID'),
  updateStatusCheckIntervalSeconds: Number(env('UPDATE_STATUS_CHECK_INTERVAL_SECONDS', '60')),
  heartbeatFile: path.resolve(__dirname, '..', env('HEARTBEAT_FILE', 'data/heartbeat.json')),
  heartbeatIntervalSeconds: Number(env('HEARTBEAT_INTERVAL_SECONDS', '30')),
  heartbeatMaxAgeSeconds: Number(env('HEARTBEAT_MAX_AGE_SECONDS', '120')),
};

module.exports = config;
