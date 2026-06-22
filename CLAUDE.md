# CLAUDE.md — sonos-music-card

## Roles
- **Orchestrator**: Claude.ai (this file lives here — read it every session)
- **Implementer**: Claude Code on ska
- **Gate rule**: No deploy without the file loading clean in HA (no console errors, card renders)

## Project overview
Custom Home Assistant Lovelace card for Sonos speakers.
Speaker selection, multi-room grouping, Now Playing with full transport controls.
Browses media via HA's native `media_player/browse_media` WebSocket API.
No Music Assistant dependency. No build step.

**Stack**: Preact + htm (CDN imports), HA WebSocket API (`hass.callWS`, `hass.callService`).

## Repo structure
src/sonos-music-card.js   <- source of truth, always edit this

dist/sonos-music-card.js  <- copy of src, committed for HACS

scripts/deploy.sh         <- rsync src to HA + bump ?v= in HA Resources

## Infrastructure
| Thing | Value |
|---|---|
| Repo on ska | `~/code/sonos-music-card` (symlink -> /mnt/store/git/sonos-music-card) |
| HA URL | `https://ha.dempsey5.com` |
| HA SSH | `ssh -i ~/.ssh/id_ed25519_ha -p 2222 root@ha.dempsey5.com` |
| Deployed path | `/homeassistant/www/community/sonos-music-card/sonos-music-card.js` |
| HA Resource ID | `209d071230f4490e838dba8d0eac535e` |
| Current resource URL | `/local/community/sonos-music-card/sonos-music-card.js?v=N` |
| HA token | In `.env` at repo root (gitignored) — never commit |

## Deploy workflow
cd ~/code/sonos-music-card

export HA_TOKEN=$(grep HA_TOKEN .env | cut -d= -f2)

./scripts/deploy.sh
After deploy: **Cmd+R** in HA browser (NOT Cmd+Shift+R — clears session cookie).

## Git workflow
cd ~/code/sonos-music-card

git add -A && git commit -m "msg" && git push origin main
One remote: `origin` -> GitHub. Repo is PUBLIC — never commit tokens, IPs, or secrets.

## Architecture

### Speaker detection
No Music Assistant dependency. Speakers identified via `include_players` config
(explicit list) or by scanning all `media_player.*` entities in hass.states.

Card config example:
```yaml
type: custom:sonos-music-card
include_players:
  - media_player.family_room
  - media_player.office_2
  - media_player.float
  - media_player.basement_2
  - media_player.garage_2
```

### getSpeakers logic
```js
// If include_players configured: use that list filtered to entities present in hass
// Else: all media_player.* entities in hass.states
function getSpeakers(hass, config) {
  if (config.include_players?.length) {
    return config.include_players.filter(id => hass.states[id]);
  }
  return Object.keys(hass.states).filter(id => id.startsWith('media_player.'));
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
| `smcInit(hass, config)` | Cold load. Seeds _smcSpeakers from playing state or localStorage |
| `smcAutoDetect(hass, config)` | Every hass update. Promotes playing speaker if nothing selected |
| `smcSelectSpeaker(entityId, hass)` | User tap handler. Sets _smcUserSelected = true |
| `hasMediaContext(state)` | True if playing, paused, or idle+title+mid-track |
| `isExternalSource(state)` | True if playing from non-queue source (TV, line-in) |
| `getNowPlaying(hass, selectedSpeakers)` | Derives now-playing from hass states |
| `getSpeakers(hass, config)` | Returns filtered list of speaker entity IDs |

### isExternalSource
```js
// True if speaker is playing from a non-queue source (TV, line-in, AirPlay)
const QUEUE_SOURCES = ['Queue', 'Music Assistant Queue'];
function isExternalSource(state) {
  if (!state || state.state !== 'playing') return false;
  const source = state.attributes?.source;
  if (!source) return false;
  return !QUEUE_SOURCES.some(q => source.includes(q));
}
```

### Browse API (native HA, no MA required)
```js
hass.callWS({
  type: 'media_player/browse_media',
  entity_id: speakerEntityId,
  media_content_id: contentId,   // null for root
  media_content_type: contentType
})
```
Sonos exposes a native browse tree via this API — no media_content_type filter needed at root.

### Transport controls (all native HA media_player services)
- play/pause: `media_player.media_play_pause`
- prev/next: `media_player.media_previous_track` / `media_player.media_next_track`
- volume: `media_player.volume_set`
- shuffle: `media_player.shuffle_set`
- repeat: `media_player.repeat_set`
- seek: `media_player.media_seek`
- group: `media_player.join` / `media_player.unjoin`

### Sonos/HA quirks
1. **`idle` instead of `paused`** — use `hasMediaContext()`: idle + media_title + 0 < position < duration
2. **`group_members: []` on solo players** — always `.length ? members : [entityId]`, never `|| [entityId]`
3. **`group_members` only on coordinator** — scan ALL entities group_members lists
4. **`entity_picture` is relative** — prepend `location.origin` if not starting with `http`

## Speaker entity IDs
| Friendly name | Entity ID |
|---|---|
| Family Room | `media_player.family_room` |
| Office | `media_player.office_2` |
| Float | `media_player.float` |
| Basement | `media_player.basement_2` |
| Garage | `media_player.garage_2` |

## Theme tokens
```js
base: '#111111', surface: '#1c1c1c', border: '#2e2e2e',
primary: '#3b82f6', accent: '#14b8a6', text: '#e5e5e5', muted: '#737373'
```
No purple. Color is functional only (blue = selected, teal = group CTA, red = error).

## Current version
**v0.12.2** — check top of `src/sonos-music-card.js` for exact version comment.
Next: **v0.13.0** — remove MA dependency.

## Open work
- [ ] v0.13.0: Remove all `music_assistant.*` service calls and `mass_player_type` checks
- [ ] v0.13.0: Replace speaker detection with `getSpeakers(hass, config)`
- [ ] v0.13.0: Replace `isExternalSource` MA queue string with `QUEUE_SOURCES` heuristic
- [ ] v0.13.0: Gut Home view (was MA get_library) — decide replacement
- [ ] v0.13.0: Gut Search (was MA search service) — decide replacement
- [ ] Decide Browse tab strategy post-MA: native Sonos browse tree vs simpler UI

## Session startup checklist
1. Read this file
2. `grep -m1 'v0\.' src/sonos-music-card.js` — confirm current version
3. Check open work section above
4. Never edit deployed file directly — always edit `src/`, then deploy
5. After deploy, `?v=` is auto-bumped by deploy script
6. Test in HA with Cmd+R
