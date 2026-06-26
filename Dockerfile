FROM node:20-bookworm-slim

WORKDIR /app

# ffmpeg は MP3 再生、python3/make/g++ は一部 native npm package のビルドに必要です。
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

COPY src ./src
COPY data ./data
COPY sounds ./sounds

ENV NODE_ENV=production

CMD ["node", "src/index.js"]
