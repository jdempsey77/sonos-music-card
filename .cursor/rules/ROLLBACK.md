---
description: Rollback procedure for Sonos Music Card deployments
alwaysApply: false
---

# ROLLBACK — Sonos Music Card

## Pre-Deploy Backup

Before every deploy, the DEPLOY process copies the current card to `.bak`:
```
/homeassistant/www/community/sonos-music-card/sonos-music-card.js.bak
```

## Rollback Steps

### 1. Restore from backup
```bash
ssh -p 2222 -i ~/.ssh/id_ed25519_ha root@192.168.4.124 \
  "cp /homeassistant/www/community/sonos-music-card/sonos-music-card.js.bak \
      /homeassistant/www/community/sonos-music-card/sonos-music-card.js"
```

### 2. Hard refresh browser
- Cmd+Shift+R (Mac) / Ctrl+Shift+R (Windows/Linux)

### 3. Verify
- Card renders previous version
- No console errors
- Previous functionality restored

## Git Rollback

If the backup is also broken, restore from git:
```bash
# Find last known-good commit
git log --oneline -10

# Restore card file from that commit
git checkout <hash> -- src/sonos-music-card.js

# Redeploy
scp -P 2222 -i ~/.ssh/id_ed25519_ha \
  src/sonos-music-card.js \
  root@192.168.4.124:/homeassistant/www/community/sonos-music-card/sonos-music-card.js
```

## Nuclear Option

Remove the card entirely:
```bash
ssh -p 2222 -i ~/.ssh/id_ed25519_ha root@192.168.4.124 \
  "rm /homeassistant/www/community/sonos-music-card/sonos-music-card.js"
```
Then remove the Lovelace resource from Settings > Dashboards > Resources.
