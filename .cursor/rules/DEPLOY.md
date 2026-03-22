---
description: Deployment steps for Sonos Music Card to Home Assistant
alwaysApply: false
---

# DEPLOY — Sonos Music Card

## Prerequisites

- SSH access to HA: `root@192.168.4.124` port `2222`, key `~/.ssh/id_ed25519_ha`
- Card directory exists on HA: `/homeassistant/www/community/sonos-music-card/`

## Deploy Steps

### 1. Backup current card (if exists)
```bash
ssh -p 2222 -i ~/.ssh/id_ed25519_ha root@192.168.4.124 \
  "cp /homeassistant/www/community/sonos-music-card/sonos-music-card.js \
      /homeassistant/www/community/sonos-music-card/sonos-music-card.js.bak 2>/dev/null || true"
```

### 2. Copy card JS to HA
```bash
scp -P 2222 -i ~/.ssh/id_ed25519_ha \
  src/sonos-music-card.js \
  root@192.168.4.124:/homeassistant/www/community/sonos-music-card/sonos-music-card.js
```

### 3. Reload Lovelace resources
Either:
- Call `lovelace/resources` WS to reload
- Or instruct user to hard refresh browser (Cmd+Shift+R / Ctrl+Shift+R)

### 4. Verify
- Open dashboard with card
- Open browser DevTools console
- Filter by `[sonos-music-card]`
- Confirm zero errors
- Confirm `hass object received` log message
- Confirm `mass/browse` response logged

## Lovelace Resource Registration

The card must be registered as a Lovelace resource:
```
URL: /local/community/sonos-music-card/sonos-music-card.js
Type: JavaScript Module
```

Add via: Settings > Dashboards > Resources > Add Resource

## First-time Setup

Create the target directory on HA if it doesn't exist:
```bash
ssh -p 2222 -i ~/.ssh/id_ed25519_ha root@192.168.4.124 \
  "mkdir -p /homeassistant/www/community/sonos-music-card"
```
