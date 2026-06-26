const fs = require('node:fs');
const path = require('node:path');
const JSONBig = require('json-bigint')({ storeAsString: true });

async function ensureDir(filePath) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    return JSONBig.parse(raw);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`[jsonStore] Failed to read ${filePath}:`, error);
    }
    return fallback;
  }
}

function readJsonSync(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSONBig.parse(raw);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`[jsonStore] Failed to read ${filePath}:`, error);
    }
    return fallback;
  }
}

async function writeJson(filePath, data) {
  await ensureDir(filePath);
  const tmpPath = `${filePath}.tmp`;
  await fs.promises.writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fs.promises.rename(tmpPath, filePath);
}

function writeJsonSync(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

module.exports = {
  readJson,
  readJsonSync,
  writeJson,
  writeJsonSync,
};
