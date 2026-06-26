#!/usr/bin/env bash
set -u

BOT_SCRIPT="src/index.js"
RESTART_CODE="${RESTART_EXIT_CODE:-42}"

if [ ! -f "$BOT_SCRIPT" ]; then
  echo "エラー: ボットスクリプト '$BOT_SCRIPT' が見つかりません。"
  exit 1
fi

echo "Node.js ボット管理スクリプトを開始します。"
echo "Bot script: $BOT_SCRIPT"
echo "Restart code: $RESTART_CODE"
echo "停止するには Ctrl+C を押してください。"

while true; do
  echo "$(date '+%Y-%m-%d %H:%M:%S') - ボットを起動します..."
  node "$BOT_SCRIPT"
  EXIT_CODE=$?
  echo "$(date '+%Y-%m-%d %H:%M:%S') - ボットが終了コード $EXIT_CODE で終了しました。"

  if [ "$EXIT_CODE" -eq "$RESTART_CODE" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') - 再起動コードを検出しました。3秒後に再起動します..."
    sleep 3
  else
    echo "$(date '+%Y-%m-%d %H:%M:%S') - 再起動コード以外のため終了します。"
    break
  fi
done

exit "$EXIT_CODE"
