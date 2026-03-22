---
description: Test criteria and manual test checklist for Sonos Music Card
alwaysApply: false
---

# TEST — Sonos Music Card

## P1 Acceptance Criteria

1. GitHub repo `github.com/jdempsey77/sonos-music-card` created with `main` and `dev` branches
2. Repo structure scaffolded (src/, .cursor/rules/, hacs.json, README.md, .gitignore)
3. Card JS file loads in HA with zero console errors
4. Card renders a placeholder UI in a Lovelace dashboard
5. `hass` object is received and logged to console confirming HA connection
6. A single `mass/browse` WebSocket call fires on card load and the response is logged to console
7. All 6 skill files exist in `.cursor/rules/` with content

## Manual Test Checklist Format

For each phase, use this format:

```
### P{N} Manual Test Checklist

- [ ] Deploy card to HA: `scp src/sonos-music-card.js root@192.168.4.124:/homeassistant/www/community/sonos-music-card/ -P 2222`
- [ ] Hard refresh browser (Cmd+Shift+R)
- [ ] Open browser console (no errors)
- [ ] Card renders expected UI
- [ ] {Phase-specific test items}
- [ ] Check HA logs for errors: Settings > System > Logs
```

## How to Run Tests

This project has no automated test framework (single JS file, no build step).
All testing is manual via browser console and HA UI.

### Quick smoke test:
1. Deploy the card JS to HA
2. Open dashboard with the card
3. Open browser DevTools console
4. Filter console by `[sonos-music-card]`
5. Verify expected log messages appear
6. Verify no red errors in console
