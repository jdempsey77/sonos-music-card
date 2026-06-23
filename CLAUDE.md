# CLAUDE.md — sonos-music-card

> Repo is **PUBLIC**. Never commit tokens, internal IPs, secrets, or network
> topology. Host-specific facts (IPs, VLAN/firewall details) live in the private
> `d5-automation` repo (`ecosystem.yaml`, `ECOSYSTEM_STATE.md`).

## Roles
- **Owner**: Claude Code on ska — this file is the single authoritative doc for
  this project. CC owns it and keeps it current (Claude.ai no longer maintains a
  separate copy).
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

scripts/deploy.sh         <- scp src to HA + copy to dist/ + bump ?v= in HA Resources

scripts/bump-version.py   <- WebSocket ?v= cache-buster bump (called by deploy.sh)

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
export HOME=/home/jdempsey      # so deploy.sh finds the SSH key
./scripts/deploy.sh             # scp to HA + copy to dist/ + bump ?v= automatically
```
After deploy: **Cmd+R** in HA browser (NOT Cmd+Shift+R — clears session cookie).

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
Real Sonos `media_player` entities (confirmed via CMDB and live HA registry):
`media_player.family_room`, `media_player.office_2`, `media_player.garage_2`,
`media_player.basement_2`, `media_player.float`.

## Card config (Lovelace)
```yaml
type: custom:sonos-music-card
jellyfin_url: https://jellyfin.hq.stylee.org
jellyfin_internal_url: http://<ska-lan-ip>:8096   # reachable by the speakers (see d5-automation)
jellyfin_token: !secret jellyfin_token
# jellyfin_user_id: <optional override>
# ytm_url: https://ska.hq.stylee.org/ytm   # optional override; this is the default
include_players:
  - media_player.family_room
  - media_player.office_2
  - media_player.garage_2
  - media_player.basement_2
  - media_player.float
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

## Queue & speaker-entity facts (discovered 2026-06-22)
The card's configured speakers (`family_room`, `office_2`, `garage_2`,
`basement_2`, `float`) are **`music_assistant`-platform** `media_player` entities,
not native `sonos` entities. (Native Sonos entities exist separately:
`bedroom`, `garage`, `office`, `living_room`, `basement`.) The card still drives
everything through generic HA `media_player.*` services, so this doesn't change
control — but it dictates how the queue is read.

**Queue = card-side (Branch B).** No HA service gives a reliable full-queue read
for these entities:
- `sonos.get_queue` → "did not match any entities" (rejects MA-platform entities).
- `music_assistant.get_queue` → works, but returns only `current_item` +
  `next_item` (not the full list), and images come back `null` (our Jellyfin
  stream URLs are ingested as `media_type: radio`).

So the card tracks what it enqueues itself in module state (`_smcQueue`,
`_smcQueueEntityId`), populated by `playJfTracks()` / `enqueueJfTracks()`. The
Queue tab renders that directly — no API call. Tap-to-jump uses `play_media`
with no `enqueue` (replaces current track), leaving the visible list intact.
Limitation: a natural queue advance on the speaker isn't observed, so the
"currently playing" highlight falls back to matching the now-playing title.

## Current version
**v0.16.0** — YouTube Music tab. New `YTMView` (6th nav tab) backed by
`ytm-service` on ska (ytmusicapi search + yt-dlp stream resolution, exposed at
`ska.hq.stylee.org/ytm/`). Search songs/albums/artists, drill into albums,
tap-to-play. Tapping a song resolves a direct googlevideo m4a URL (yt-dlp,
~1-3s, per-row spinner) and hands it to the speaker via `play_media` — same
pattern as Jellyfin. YTM playback clears the Jellyfin now-playing art id and
card-side queue (different source). New module var `_ytmServiceUrl`; config key
`ytm_url` (defaults to `https://ska.hq.stylee.org/ytm`). Bottom nav now wraps
(`flex-wrap`) to fit 6 tabs on narrow cards. See `## YTM service` below.
v0.15.1 — artist collapse handles both " feat." and " featuring " via
`getFeatIndex()`. v0.15.0 added the Queue tab (card-side, read-only + tap-to-jump)
and Play All / Add All. `playJfTracks()` is metadata-aware (queue items, not bare ids).
Check top of `src/sonos-music-card.js` for the exact version comment.

## YTM service
YouTube Music backend (`ytm-service`) — runs on **ska**, NOT on GitHub (host-only,
no public repo). Host-specific addresses live in private `d5-automation`.
- **Location**: `~/code/ytm-service/app.py` on ska (Flask, ytmusicapi + yt-dlp).
- **Auth**: none. ytmusicapi `search()`/`get_album()` and yt-dlp stream resolution
  all work unauthenticated, so there is **no auth file and no cookies to expire**.
  (Auth would only be needed for personal library/playlist editing, which we don't use.)
- **Bind / proxy**: Flask on `127.0.0.1:8600`; nginx proxies `ska.hq.stylee.org/ytm/`
  → `127.0.0.1:8600` (CORS `*`, no Authelia). nginx location is canonical in the
  **portal** repo `nginx/ska.conf` (live copy: `/etc/nginx/sites-enabled/ska`).
- **Endpoints**: `GET /ytm/search?q=&type=songs|albums|artists`,
  `GET /ytm/album/<browseId>`, `GET /ytm/stream/<videoId>` (slow, ~1-3s — yt-dlp),
  `GET /ytm/health`.
- **Stream format**: yt-dlp `bestaudio[ext=m4a]/bestaudio/best` → m4a/AAC (itag 140),
  which Sonos plays natively. URLs expire (~6h) so they're resolved on demand.
- **systemd**: `systemctl --user status ytm-service` (user service, linger enabled).
  Restart: `systemctl --user restart ytm-service`. Logs: `journalctl --user -u ytm-service`.
- **Deps on ska**: `pip3 install yt-dlp ytmusicapi flask --break-system-packages`
  (installed to `~/.local`, importable by `/usr/bin/python3` as user jdempsey).

## Open work
- [x] Search tab (Jellyfin search API) — v0.14.0
- [x] Now Playing queue view — v0.15.0 (Queue tab, card-side, read-only)
- [x] Artist/album "Play all" affordance in Browse — v0.15.0 (Play All + Add All)
- [x] YouTube Music support — v0.16.0 (ytm-service on ska; search + stream via yt-dlp)
- [ ] "Shuffle" affordance for Play All / Add All
- [ ] Queue reorder / delete (Queue tab is read-only this version)
- [ ] Art that tracks queue advance (currently shows first track's art only)
- [ ] Direct-play (avoid mp3 transcode) for lossless on capable renderers
- [ ] YTM Now Playing art (raw stream URL has no cover; HA gives no entity_picture)
- [ ] YTM card-side queue (YTM playback clears `_smcQueue`; Queue tab empty for YTM)

## Session startup checklist
1. Read this file (`cat ~/code/sonos-music-card/CLAUDE.md`)
2. `grep -m1 'v0\.' src/sonos-music-card.js` — confirm current version
3. Check open work above
4. Never edit the deployed file directly — always edit `src/`, then run `./scripts/deploy.sh`
5. deploy.sh handles scp + ?v= bump automatically. No manual WebSocket step needed.
6. Test in HA with **Cmd+R** after deploy

## CC session end checklist
At the end of every CC session, before committing:
1. Update `## Current version` in this file
2. Update `## Open work` — check off completed items, add new ones
3. Append a DECISION LOG entry to `~/code/d5-automation/ECOSYSTEM_STATE.md`
4. `git add -A && git commit -m "..." && git push origin main` (both repos)
