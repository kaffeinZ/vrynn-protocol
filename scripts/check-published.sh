#!/usr/bin/env bash
#
# Does the public site show TODAY's brief? That is the only question that matters.
#
# Written after 2026-08-12..14, when publishing stopped for three days while every
# component check reported healthy. The monitoring watched sector guards, macro
# sources and synthesis retries — none of it asked whether a brief existed.
#
# Two deliberate design choices:
#   1. It checks the PUBLIC SITE, not the database. That exercises the whole chain
#      — cron, process, nginx, Cloudflare — so "the DB has a row" cannot mask a
#      site nobody can read.
#   2. It runs from SYSTEM cron, not inside the app. A check that dies with the
#      process it is checking is not a check.
#
# Install:
#   chmod +x scripts/check-published.sh
#   crontab -e →  30 7,13 * * *  /root/vrynn-protocol/scripts/check-published.sh
set -uo pipefail

SITE="https://vrynn.xyz/"
TODAY_HUMAN="$(date -u +'%-d %B %Y')"     # e.g. "14 August 2026"
TODAY_ISO="$(date -u +'%F')"
ENV_FILE="/root/vrynn-protocol/.env"

alert() {
  local msg="$1"
  echo "[check-published] $(date -u +'%F %T') FAIL: ${msg}" >&2
  # Telegram if configured; the failure is logged either way.
  local token chat
  token="$(grep -m1 '^TELEGRAM_BOT_TOKEN=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-)"
  chat="$(grep -m1 '^TELEGRAM_ADMIN_CHAT_ID=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-)"
  if [ -n "${token:-}" ] && [ -n "${chat:-}" ]; then
    curl -s -o /dev/null -X POST "https://api.telegram.org/bot${token}/sendMessage" \
      -H 'Content-Type: application/json' \
      -d "{\"chat_id\":\"${chat}\",\"text\":\"[vrynn] NOT PUBLISHED — ${msg}\"}"
  fi
  exit 1
}

body="$(curl -s --max-time 20 "$SITE")" || alert "site unreachable"
[ -n "$body" ] || alert "site returned an empty body"

# The homepage prints the brief's own date. If it is not today's, publishing stalled
# — which is exactly what a healthy-looking 200 concealed for three days.
# Bash substring match, NOT `printf | grep -q`. With `set -o pipefail`, grep -q
# exits on first match, printf takes SIGPIPE (141), and pipefail reports the whole
# pipeline as failed — so the check fired a false alarm on a perfectly good page.
if [[ "$body" != *"$TODAY_HUMAN"* ]]; then
  shown="$(printf '%s' "$body" | grep -oE '[0-9]{1,2} [A-Z][a-z]+ 20[0-9]{2}' | head -1 || true)"
  alert "homepage shows '${shown:-unknown}', expected '${TODAY_HUMAN}'"
fi

# A brief with no written read is a degraded publish, not a healthy one.
if [[ "$body" == *'class="unavailable"'* ]]; then
  alert "brief published for ${TODAY_ISO} but the written read is missing"
fi

echo "[check-published] $(date -u +'%F %T') OK: ${TODAY_HUMAN} is live"
