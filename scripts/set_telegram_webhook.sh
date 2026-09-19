#!/usr/bin/env bash
# 把 Telegram bot 的 webhook 指到 Cloudflare Worker。
#
# 用法:
#   TELEGRAM_BOT_TOKEN=xxx TELEGRAM_WEBHOOK_SECRET=yyy \
#     ./scripts/set_telegram_webhook.sh https://telegram-tutor.你的帳號.workers.dev
#
# 查看目前設定:  ./scripts/set_telegram_webhook.sh --info
# 取消 webhook:  ./scripts/set_telegram_webhook.sh --delete

set -euo pipefail

: "${TELEGRAM_BOT_TOKEN:?請先設定環境變數 TELEGRAM_BOT_TOKEN}"
API="https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}"

case "${1:-}" in
  --info)
    curl -sS "${API}/getWebhookInfo"
    echo
    exit 0
    ;;
  --delete)
    curl -sS -X POST "${API}/deleteWebhook"
    echo
    exit 0
    ;;
  "")
    echo "用法: $0 <worker 網址> | --info | --delete" >&2
    exit 1
    ;;
esac

WORKER_URL="$1"
: "${TELEGRAM_WEBHOOK_SECRET:?請先設定環境變數 TELEGRAM_WEBHOOK_SECRET（要和 Worker 上設的那組一樣）}"

if [[ "$WORKER_URL" != https://* ]]; then
  echo "Telegram 只接受 https 網址，收到的是: $WORKER_URL" >&2
  exit 1
fi

echo "把 webhook 設到 ${WORKER_URL} ..."
curl -sS -X POST "${API}/setWebhook" \
  -H 'Content-Type: application/json' \
  -d "$(printf '{"url":"%s","secret_token":"%s","allowed_updates":["message"],"drop_pending_updates":true}' \
        "$WORKER_URL" "$TELEGRAM_WEBHOOK_SECRET")"
echo
echo
echo "目前狀態："
curl -sS "${API}/getWebhookInfo"
echo
