#!/bin/bash
set -e

SRC="src/sonos-music-card.js"
REMOTE="root@192.168.4.124"
REMOTE_PATH="/homeassistant/www/community/sonos-music-card/sonos-music-card.js"
SSH_KEY="$HOME/.ssh/id_ed25519_ha"
SSH_PORT=2222
HA_URL="https://ha.dempsey5.com"
RESOURCE_ID="209d071230f4490e838dba8d0eac535e"
BASE_URL="/local/community/sonos-music-card/sonos-music-card.js"

# Get HA token from environment or prompt
if [ -z "$HA_TOKEN" ]; then
  echo "Enter HA long-lived access token (or set HA_TOKEN env var):"
  read -s HA_TOKEN
fi

VERSION=$(head -1 "$SRC" | grep -o 'v[0-9.]*' || echo "unknown")

# 1. Deploy the file
echo "Deploying $SRC ($VERSION)..."
scp -i "$SSH_KEY" -P "$SSH_PORT" "$SRC" "$REMOTE:$REMOTE_PATH"

# 2. Also copy to dist/ for HACS
cp "$SRC" "dist/sonos-music-card.js"

# 3. Get current version param and increment
CURRENT_V=$(curl -s "$HA_URL/api/lovelace/resources" \
  -H "Authorization: Bearer $HA_TOKEN" | \
  python3 -c "
import sys, json, re
data = json.load(sys.stdin)
for r in data:
    if r.get('id') == '$RESOURCE_ID':
        m = re.search(r'v=(\d+)', r.get('url', ''))
        print(m.group(1) if m else '0')
        break
else:
    print('0')
" 2>/dev/null || echo "0")

NEXT_V=$((CURRENT_V + 1))
NEW_URL="${BASE_URL}?v=${NEXT_V}"

# 4. Update resource URL
echo "Bumping resource ?v=${CURRENT_V} -> ?v=${NEXT_V}..."
curl -s -X PATCH "$HA_URL/api/lovelace/resources/$RESOURCE_ID" \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"$NEW_URL\", \"res_type\": \"module\"}" > /dev/null

echo "Deployed $VERSION — resource at $NEW_URL"
echo "Cmd+R in HA to reload."
