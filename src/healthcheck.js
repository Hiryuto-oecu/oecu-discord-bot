const fs = require('node:fs');
const config = require('./config');
const { readJsonSync } = require('./utils/jsonStore');

const heartbeat = readJsonSync(config.heartbeatFile, null);

if (!heartbeat?.updated_at) {
  console.error(`heartbeat is missing: ${config.heartbeatFile}`);
  process.exit(1);
}

const updatedAt = new Date(heartbeat.updated_at).getTime();
if (Number.isNaN(updatedAt)) {
  console.error(`heartbeat has invalid updated_at: ${heartbeat.updated_at}`);
  process.exit(1);
}

const ageSeconds = (Date.now() - updatedAt) / 1000;
if (ageSeconds > config.heartbeatMaxAgeSeconds) {
  console.error(`heartbeat is stale: ${ageSeconds.toFixed(1)}s > ${config.heartbeatMaxAgeSeconds}s`);
  process.exit(1);
}

try {
  fs.accessSync(config.heartbeatFile, fs.constants.R_OK);
} catch (error) {
  console.error(`heartbeat is not readable: ${error.message}`);
  process.exit(1);
}

console.log(`healthy: heartbeat age ${ageSeconds.toFixed(1)}s`);
