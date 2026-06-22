# CLAUDE.md — sonos-music-card

> Repo is **PUBLIC**. Never commit tokens, internal IPs, secrets, or network
> topology. Host-specific facts (IPs, VLAN/firewall details) live in the private
> `d5-automation` repo (`ecosystem.yaml`, `ECOSYSTEM_STATE.md`).

## Roles
- **Orchestrator**: Claude.ai (this file lives here — read it every session)
- **Implementer**: Claude Code on ska
- **Gate rule**: No deploy without the file loading clean in HA (no console errors, card renders)

## Project overview
Custom Home Assistant Lovelace card for Sonos speakers.
Speaker selection, multi-room grouping, Now Playing with full transport controls,
and a media browser backed by Jellyfin.

- **Control / transport**: native HA `media_player.*` services (HA reaches the speakers).
- **Media browsing**: Jellyfin REST API, called directly from the card (browser).
- **Playback**: HA `media_player.play_media` of a Jellyfin stream URL the speakers
  fetch directly.
- **No Music Assistant.** **No node-sonos-http-api.** **No build step.**

**Stack**: Preact + htm (CDN imports), HA WebSocket/services (`hass.callService`),
Jellyfin REST (`fetch`).

## Repo structure
src/sonos-music-card.js   <- source of truth, always edit this

dist/sonos-music-card.js  <- copy of src, committed for HACS

scripts/deploy.sh         <- rsync src to HA + (attempt) bump ?v= in HA Resources

## Why the architecture is HA-centric (network, no IPs here)
Verified 2026-06-22 (details + addresses in private `d5-automation`):
- **A Sonos control proxy cannot run on ska** — ska is firewalled from the Sonos
  speakers across the VLAN (no reach on their control port), so node-sonos-http-api
  on ska is a dead end.
- **The speakers CAN reach ska's Jellyfin** (the stream path works one way).
- **HA reaches the speakers** (it controls them today).
Conclusion: drive control through HA; let the speakers stream Jellyfin from ska
directly via the internal Jellyfin URL.

## Infrastructure
| Thing | Value |
|---|---|
| Repo on ska | `~/code/sonos-music-card` (symlink -> /mnt/store/git/sonos-music-card) |
| HA URL | `https://ha.dempsey5.com` |
| HA SSH | `ssh -i ~/.ssh/id_ed25519_ha -p 2222 root@ha.dempsey5.com` (HAOS SSH addon) |
| Deployed path | `/homeassistant/www/community/sonos-music-card/sonos-music-card.js` |
| HA Resource ID | `209d071230f4490e838dba8d0eac535e` |
| Current resource URL | `/local/community/sonos-music-card/sonos-music-card.js?v=N` |
| HA token | `HOME_ASSISTANT_TOKEN` in `.env` at repo root (gitignored) — never commit |
| Jellyfin (public) | `https://jellyfin.hq.stylee.org` (browse + images, from browser) |
| Jellyfin (internal) | ska LAN address — see `d5-automation/ecosystem.yaml` |
| Jellyfin API key | `JELLYFIN_API_KEY` in `.env` (for testing); card gets it via card config |

## Deploy workflow
```
cd ~/code/sonos-music-card
export HOME=/home/jdempsey            # so deploy.sh finds the SSH key
./scripts/deploy.sh                   # scp to HA + copy to dist/
```
After deploy: **Cmd+R** in HA browser (NOT Cmd+Shift+R — clears session cookie).

⚠️ **deploy.sh's `?v=` bump is broken on this HA.** It uses a REST endpoint
(`/api/lovelace/resources`) that 404s here, so it silently reports a bogus
`?v=0 -> v=1` and does NOT change the registry. Bump the cache-buster manually
via the WebSocket API (the resource registry is WS-only, debounced ~1s to
`/homeassistant/.storage/lovelace_resources`):
```python
# python3 with websocket-client (present on ska); $HOME_ASSISTANT_TOKEN from .env
import json, websocket
ws = websocket.create_connection("wss://ha.dempsey5.com/api/websocket", timeout=15)
ws.recv(); ws.send(json.dumps({"type":"auth","access_token":TOKEN})); ws.recv()
ws.send(json.dumps({"id":1,"type":"lovelace/resources/update",
  "resource_id":"209d071230f4490e838dba8d0eac535e",
  "url":"/local/community/sonos-music-card/sonos-music-card.js?v=NEXT","res_type":"module"}))
print(json.loads(ws.recv()))   # {"success": true}
```

## Git workflow
cd ~/code/sonos-music-card

git add -A && git commit -m "msg" && git push origin main
One remote: `origin` -> GitHub. Repo is PUBLIC — never commit tokens, IPs, or secrets.

## Architecture

### Speaker detection (`getSpeakers`)
No Music Assistant. Speakers come from `include_players` (explicit list) or every
`media_player.*` entity, minus `exclude_players`. Config is held module-wide in
`_smcConfig` (set in `setConfig`), so `getSpeakers(hass)` works everywhere.
```js
function getSpeakers(hass, config = _smcConfig) {
  if (config?.include_players?.length) return config.include_players.filter(id => hass.states[id]);
  let ids = Object.keys(hass.states).filter(id => id.startsWith('media_player.'));
  if (config?.exclude_players?.length) ids = ids.filter(id => !config.exclude_players.includes(id));
  return ids;
}
```

### Module-level state (survives Preact re-renders)
```js
let _smcSpeakers = []        // selected speakers — single source of truth
let _smcUserSelected = false // true after explicit user tap — blocks auto-detect
let _smcUserSelectedAt = 0   // timestamp of last user tap
let _smcDirty = false        // signals Preact to re-render after auto-detect change
```

### Key functions
| Function | Purpose |
|---|---|
| `smcInit(hass)` | Cold load. Seeds `_smcSpeakers` from playing state or localStorage |
| `smcAutoDetect(hass)` | Every hass update. Promotes a playing speaker if nothing selected |
| `smcSelectSpeaker(entityId, hass)` | User tap handler. Sets `_smcUserSelected = true` |
| `hasMediaContext(state)` | True if playing, paused, or idle+title+mid-track |
| `isExternalSource(state)` | True if playing from a non-queue source (TV, line-in) |
| `getNowPlaying(hass, selected)` | Derives now-playing from hass states |
| `getSpeakers(hass, config)` | Returns filtered list of speaker entity IDs |

### isExternalSource
Playback we drive (HA `play_media` of a URL) reports **no** `source`, which we
treat as internal so transport controls stay available.
```js
const QUEUE_SOURCES = ['Queue', 'Music Assistant Queue', 'Sonos Queue'];
function isExternalSource(state) {
  if (!state || state.state !== 'playing') return false;
  const source = state.attributes?.source;
  if (!source) return false;
  return !QUEUE_SOURCES.some(q => source.includes(q));
}
```

### Jellyfin client
- Auth via `api_key` **query param** (not `X-Emby-Token` header) — a simple CORS
  GET with no preflight. Jellyfin returns `Access-Control-Allow-Origin: *`.
- **API keys are NOT tied to a user**, so `/Users/Me` 400s. Get a user id from
  `/Users` (prefer an administrator). `jellyfin_user_id` config overrides.
- Browse tree: music libraries (`/Users/{uid}/Views`, `CollectionType==music`)
  → Artists / Albums / Playlists → artist albums → album tracks → tap to play.
- Images: `/Items/{id}/Images/Primary` (public, no token).
- Stream URL (speaker-facing, internal base): `/Audio/{id}/stream.mp3?api_key=…&audioCodec=mp3`.

### Playback
Tapping a track calls HA `media_player.play_media` with the Jellyfin stream URL.
First track replaces the queue; the rest of the album/playlist are appended
best-effort via `enqueue: 'add'` (Sonos supports it), so prev/next work.

### Transport controls (all native HA media_player services)
play_pause · previous/next · volume_set · shuffle_set · repeat_set · media_seek ·
join / unjoin.

### Sonos/HA quirks
1. **`idle` instead of `paused`** — `hasMediaContext()`: idle + media_title + 0 < position < duration
2. **`group_members: []` on solo players** — always `.length ? members : [entityId]`
3. **`group_members` only on coordinator** — scan all entities' group_members
4. **`entity_picture` is relative** — prepend `location.origin` if not `http`

## Speaker entity IDs (verified live in HA — 2026-06-22)
The prior config used stale IDs (`family_room`, `office_2`, `float`, `basement_2`,
`garage_2`) that don't exist on this HA. Real Sonos `media_player` entities:
`media_player.living_room`, `media_player.office`, `media_player.garage`,
`media_player.basement`, `media_player.bedroom`.
(Entity friendly-names have drifted from the Sonos room names; the entity_id is
authoritative. Confirm the room↔entity mapping in HA before trusting labels.)

## Card config (Lovelace)
```yaml
type: custom:sonos-music-card
jellyfin_url: https://jellyfin.hq.stylee.org
jellyfin_internal_url: http://<ska-lan-ip>:8096   # reachable by the speakers (see d5-automation)
jellyfin_token: !secret jellyfin_token
# jellyfin_user_id: <optional override>
include_players:
  - media_player.living_room
  - media_player.office
  - media_player.garage
  - media_player.basement
  - media_player.bedroom
```
`jellyfin_token` comes from HA `secrets.yaml`. `jellyfin_internal_url` defaults to
`jellyfin_url` if omitted — but the public URL is not reachable by the speakers,
so keep the internal one set.

## Theme tokens
```js
base: '#111111', surface: '#1c1c1c', border: '#2e2e2e',
primary: '#3b82f6', accent: '#14b8a6', text: '#e5e5e5', muted: '#737373'
```
No purple. Color is functional only (blue = selected, teal = group CTA, red = error).

## Current version
**v0.13.0** — removed Music Assistant; Jellyfin browse + HA play_media.
Check top of `src/sonos-music-card.js` for the exact version comment.

## Open work
- [ ] Verify card renders clean in HA browser (no console errors) — needs user Cmd+R
- [ ] Search tab (deferred — removed with MA)
- [ ] Artist/album "Play all" / "Shuffle" affordances in Browse
- [ ] Now Playing queue view (no queue read source post-MA)
- [ ] Direct-play (avoid mp3 transcode) for lossless on capable renderers

## Session startup checklist
1. Read this file
2. `grep -m1 'v0\.' src/sonos-music-card.js` — confirm current version
3. Check open work above
4. Never edit the deployed file directly — always edit `src/`, then deploy
5. After deploy, **manually bump `?v=`** via WS (deploy.sh's bump is broken — see above)
6. Test in HA with Cmd+R
