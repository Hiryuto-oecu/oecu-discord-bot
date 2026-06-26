# oecu_bot Node.js 版

Python/Py-cord 版を `discord.js v14` ベースに移植した Discord Bot です。

## 主な移植済み機能

- `/ping`
- `/restart` (Bot owner 限定)
- `/assign_role`
- `/email_verify`, `/verify_number`
- `change.json` 監視通知
- ⚠️ リアクションによるメッセージ削除・タイムアウト
- メッセージコマンド `GABAリアクション`
- `/join`, `/leave`, `/play`
- Twitter/X リンクの `fxtwitter.com` 置換と削除リアクション
- `/update`, `/update_status`, `/devmode` (Bot owner 限定 / Docker updater 連携)
- 任意有効化: `/janken`, `/janken_leaderboard`, `/oshirase`, `/listchannels`

## セットアップ

```bash
cd Node
cp .env.example .env
# .env を編集して DISCORD_BOT_TOKEN などを設定
npm install
npm start
```

## Docker

```bash
cd Node
cp .env.example .env
# .env を編集
docker compose up -d --build
```

ログ確認:

```bash
docker compose logs -f
```

停止:

```bash
docker compose down
```

この `docker-compose.yml` は既定で GHCR の公開 image
`ghcr.io/hiryuto-oecu/oecu-discord-bot:latest` を使います。
ローカルソースから手元で image を作る場合は、別途 `docker build` で任意 tag を作り、
`.env` の `OECU_BOT_IMAGE_REF` に指定してください。

## 別の Linux サーバーで動かす手順

本番用の Linux サーバー（例: Ubuntu 22.04 / Debian 12）にデプロイする手順です。
「Docker で動かす方法（推奨）」と「Node を直接動かす方法（systemd 常駐）」の 2 通りを記載します。

### 0. コードを配置する

リポジトリをサーバーに持っていきます。どちらか好きな方法で構いません。

```bash
# git を使う場合
git clone <このリポジトリのURL> oecu_bot
cd oecu_bot/Node

# もしくは Node ディレクトリだけ rsync/scp で転送する場合
# scp -r ./Node user@server:/opt/oecu_bot
```

`node_modules/` は転送せず、サーバー側で `npm install` してください
（OS/アーキテクチャ依存のパッケージがあるため）。

### A. Docker で動かす（推奨）

いちばん移植性が高く、サーバーに Node を入れなくても動きます。

#### A-1. Docker をインストール

```bash
# Docker 公式の便利スクリプト
curl -fsSL https://get.docker.com | sh

# sudo なしで docker を使いたい場合（再ログインで反映）
sudo usermod -aG docker "$USER"

# 起動と自動起動の有効化
sudo systemctl enable --now docker
```

`docker compose version` が表示されれば準備完了です。

#### A-2. 起動

```bash
cd Node
cp .env.example .env
# .env を編集して DISCORD_BOT_TOKEN などを設定

docker compose up -d
```

- `docker-compose.yml` の `restart: unless-stopped` により、サーバー再起動後も自動で立ち上がります。
- `/restart` コマンド（終了コード 42）で終了しても、Docker が自動的に再起動します。

#### A-3. 運用コマンド

```bash
docker compose logs -f          # ログ確認
docker compose restart          # 再起動
docker compose down             # 停止・削除
docker compose pull             # GHCR から最新 image を取得
docker compose up -d            # 最新 image で再起動
```

#### A-4. 自動更新 updater を入れる（任意）

Bot に Docker socket を渡さず、ホスト側 systemd が GHCR image を更新します。
導入は clone したリポジトリのディレクトリで 1 回だけ実行します。

```bash
sudo bash deploy/install-updater.sh
```

導入後:

- prod モード: `ghcr.io/hiryuto-oecu/oecu-discord-bot:latest` を 1 時間ごとに確認
- dev モード: `ghcr.io/hiryuto-oecu/oecu-discord-bot:dev` を 1 分ごとに確認
- `/update`: Owner 限定で即時更新を要求
- `/update_status`: 直近の更新結果を表示
- `/devmode on|off`: dev/prod の自動更新モードを切替

ホスト側の確認:

```bash
systemctl status oecu-bot-update.path
systemctl list-timers 'oecu-bot-update*'
journalctl -u oecu-bot-update.service -f
```

アンインストールは項目選択式です。設定ファイルを残す場合は `--keep-config` を使えます。

```bash
sudo bash deploy/uninstall-updater.sh
sudo bash deploy/uninstall-updater.sh --all --keep-config
sudo bash deploy/uninstall-updater.sh --dry-run --all
```

### B. Node を直接動かす（systemd で常駐）

Docker を使わない場合の手順です。

#### B-1. 必要なものをインストール

`ffmpeg` は `/play`（音声再生）に必須です。Node は 18 以上が必要です（20 LTS 推奨）。

```bash
# Node.js 20 LTS（NodeSource）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs ffmpeg

node -v
ffmpeg -version
```

#### B-2. 依存インストールと動作確認

```bash
cd /opt/oecu_bot/Node     # 配置したパスに合わせて変更
cp .env.example .env
# .env を編集

npm ci          # package-lock.json があるので ci を推奨（無ければ npm install）
npm start       # まずは手動で起動確認（Ctrl+C で停止）
```

#### B-3. systemd サービスとして常駐させる

`/etc/systemd/system/oecu-bot.service` を作成します（パス・ユーザー名は環境に合わせて変更）。

```ini
[Unit]
Description=oecu_bot (Node.js / discord.js)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=oecu
WorkingDirectory=/opt/oecu_bot/Node
EnvironmentFile=/opt/oecu_bot/Node/.env
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=3
# /restart コマンドの終了コード 42 も「再起動扱い」にする
SuccessExitStatus=42

[Install]
WantedBy=multi-user.target
```

有効化と起動:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now oecu-bot
```

運用コマンド:

```bash
sudo systemctl status oecu-bot     # 状態確認
sudo journalctl -u oecu-bot -f     # ログ確認
sudo systemctl restart oecu-bot    # 再起動
sudo systemctl stop oecu-bot       # 停止
```

> systemd を使わず付属の `start.sh`（終了コード 42 で再起動するループ）で常駐させることもできますが、
> サーバー再起動後の自動起動やログ管理の面で systemd 運用を推奨します。

### 事前に確認すること（共通）

- `.env` に正しい `DISCORD_BOT_TOKEN` と `DISCORD_GUILD_IDS` を設定済みであること。
- Discord Developer Portal で Server Members Intent / Message Content Intent を有効化済みであること。
- メール認証を使う場合は SMTP 設定（`SMTP_HOST` など）が本番サーバーから到達できること。
- `data/` （状態 JSON）と `sounds/`（MP3）が配置されていること。
  - Docker の場合、`data/` はボリュームで永続化、`sounds/` は読み取り専用でマウントされます。

## メール送信について

Python 版は `localhost:25` の Postfix に送信していました。Docker コンテナ内の `localhost` はコンテナ自身を指すため、ホスト側 Postfix を使う場合は環境に応じて `SMTP_HOST=host.docker.internal` などを設定してください。

外部 SMTP を使う場合は `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` を設定します。

## データとサウンド

- 状態 JSON は `Node/data/`
- MP3 は `Node/sounds/`

`docker-compose.yml` では `data` は永続化のため通常ボリューム、`sounds` は読み取り専用でマウントしています。

## 注意

Discord Developer Portal で以下の Gateway Intents を有効にしてください。

- Server Members Intent
- Message Content Intent

ボイス再生には Bot にボイスチャンネルの接続/発言権限が必要です。
