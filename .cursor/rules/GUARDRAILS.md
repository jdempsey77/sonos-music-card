---
description: Non-negotiable rules for Sonos Music Card development
alwaysApply: true
---

# GUARDRAILS — Sonos Music Card

## Non-Negotiable Rules

1. **Never edit deployed files directly** — always edit `src/` then deploy via SCP
2. **Never call Plex or YouTube Music APIs directly from the card** — all media calls go through Music Assistant
3. **Never store auth tokens in card JS** — the card uses the HA WebSocket connection which handles auth
4. **Never use localStorage** — not supported in HA Lovelace card context
5. **Always test on `dev` branch before merging to `main`**
6. **Never deploy from `main` without a passing gate** — all changes flow through `dev` first
7. **No build step** — the card is a single JS file with CDN imports (Preact + htm via esm.sh)
8. **Shadow DOM required** — use `attachShadow({ mode: 'open' })` to isolate styles
9. **All MA interactions via `hass.callWS()` or `hass.callService()`** — never open a separate WebSocket
10. **Card must gracefully handle MA being unavailable** — show a clear error, don't crash
