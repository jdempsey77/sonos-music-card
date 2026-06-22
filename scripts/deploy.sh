#!/bin/bash
set -e

SRC="src/sonos-music-card.js"
REMOTE="root@192.168.4.124"
REMOTE_PATH="/homeassistant/www/community/sonos-music-card/sonos-music-card.js"
SSH_KEY="$HOME/.ssh/id_ed25519_ha"
SSH_PORT=2222

# Source .env from repo root for HOME_ASSISTANT_TOKEN
if [ -z "$HOME_ASSISTANT_TOKEN" ] && [ -f "$(dirname "$0")/../.env" ]; then
  source "$(dirname "$0")/../.env"
fi
if [ -z "$HOME_ASSISTANT_TOKEN" ]; then
  echo "Set HOME_ASSISTANT_TOKEN in .env or environment"
  exit 1
fi

VERSION=$(head -1 "$SRC" | grep -o 'v[0-9.]*' || echo "unknown")

# 1. Copy src -> dist/ (committed for HACS)
cp "$SRC" "dist/sonos-music-card.js"

# 2. Deploy the file to HA
echo "Deploying $SRC ($VERSION)..."
scp -i "$SSH_KEY" -P "$SSH_PORT" "$SRC" "$REMOTE:$REMOTE_PATH"

# 3. Bump ?v= cache-buster in the HA resource registry (WebSocket-only on this HA)
export HOME_ASSISTANT_TOKEN
python3 "$(dirname "$0")/bump-version.py"

echo "Deployed $VERSION. Cmd+R in HA to reload."
