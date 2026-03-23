#!/bin/bash
# Usage: ./scripts/deploy.sh
set -e

SRC="src/sonos-music-card.js"
REMOTE="root@192.168.4.124"
REMOTE_PATH="/homeassistant/www/community/sonos-music-card/sonos-music-card.js"
SSH_KEY="$HOME/.ssh/id_ed25519_ha"
SSH_PORT=2222

VERSION=$(head -1 "$SRC" | grep -o 'v[0-9.]*' || echo "unknown")
echo "Deploying $SRC ($VERSION)..."
scp -i "$SSH_KEY" -P "$SSH_PORT" "$SRC" "$REMOTE:$REMOTE_PATH"
echo "Deployed. Remember to bump ?v= in HA Settings → Dashboards → Resources."
