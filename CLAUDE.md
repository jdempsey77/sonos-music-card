# CLAUDE.md — Sonos Music Card

## Project overview
Custom Home Assistant Lovelace card replacing the Sonos app.
Browses Plex + YouTube Music via Music Assistant, controls Sonos speakers,
supports multi-room grouping and Now Playing with full transport controls.

**No build step.** Single JS file, deployed directly to HA.

---

## Roles
- **Orchestrator**: Claude.ai (this file lives here — read it every session)
- **Implementer**: Claude Code / Cursor
- **Gate rule**: No deploy without the file loading clean in HA (no console errors, card renders)

---

## Stack
- Preact + htm (CDN imports, no build)
- Music Assistant (HACS addon) as music backend
- HA WebSocket API (`hass.callWS`, `hass.callService`)
- No external dependencies beyond CDN imports at top of file

---

## Repo structure
```
src/sonos-music-card.js   ← source of truth, edit this
dist/sonos-music-card.js  ← copy of src, committed for HACS
scripts/deploy.sh         ← deploys src + auto-bumps ?v= in HA Resources
hacs.json                 ← HACS metadata
.cursor/rules/            ← Cursor skill files
```

---

## Infrastructure
| Thing | Value |
|---|---|
| HA URL | `https://ha.dempsey5.com` |
| HA SSH | `ssh -i ~/.ssh/id_ed25519_ha -p 2222 root@ha.dempsey5.com` |
| Deployed path | `/homeassistant/www/community/sonos-music-card/sonos-music-card.js` |
| HA Resource ID | `209d071230f4490e838dba8d0eac535e` |
| Current resource URL | `/local/community/sonos-music-card/sonos-music-card.js?v=N` |

---

## Deploy workflow

```bash
export HA_TOKEN=<long-lived-access-token>
./scripts/deploy.sh
```

This script:
1. Copies `src/` to `dist/`
2. SCPs the file to HA
3. Auto-increments `?v=N` in HA Lovelace Resources via REST API

After deploy: **Cmd+R** in HA (NOT Cmd+Shift+R — clears session cookie and logs you out).

### Manual version bump (if script fails)
Open DevTools console on any HA page and run:
```js
(async () => {
  function findHass(el, d=0) {
    if (d>10) return null;
    if (el?._hass) return el._hass;
    if (el?.hass) return el.hass;
    const r = el?.shadowRoot;
    if (!r) return null;
    for (const c of r.children) { const h = findHass(c,d+1); if(h) return h; }
    return null;
  }
  const hass = findHass(document.querySelector('home-assistant'));
  const r = await hass.callWS({
    type: 'lovelace/resources/update',
    resource_id: '209d071230f4490e838dba8d0eac535e',
    url: '/local/community/sonos-music-card/sonos-music-card.js?v=N', // increment N
    res_type: 'module'
  });
  console.log('Bumped to:', r.url);
})();
```

---

## Architecture

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
| `smcInit(hass)` | Runs once on cold load. Seeds `_smcSpeakers` from playing state or localStorage |
| `smcAutoDetect(hass)` | Runs every hass update. Promotes playing MA speaker if nothing selected. Respects `_smcUserSelected` 30s timeout |
| `smcSelectSpeaker(entityId, hass)` | User tap handler. Sets `_smcUserSelected = true`. Replaces (not adds) if current speaker is TV/external source |
| `hasMediaContext(state)` | True if entity is playing, paused, or idle+title+mid-track. False for external sources or track-ended |
| `isExternalSource(state)` | True if playing from non-MA source (TV, line-in). These get no transport controls |
| `getNowPlaying(hass, selectedSpeakers)` | Derives now-playing from hass. Checks selected first, falls back to any MA player |
| `smcAutoDetect` | Skips external source speakers and idle+finished-track speakers |

### MA entity detection
```js
state.attributes?.mass_player_type === 'player'
```

### Browse API
```js
hass.callWS({
  type: 'media_player/browse_media',
  entity_id: 'media_player.office_2',
  media_content_id: contentId,   // null for root
  media_content_type: contentType
})
```
- Use `item.media_class` (not `media_content_type`) for drill-down type on non-directory items
- All MA content IDs are `library://type/N` format
- Library filter (My Library tab) is client-side only against loaded items
- Library filter runs against raw `items` array, never against grouped display list

### MA search service
```js
const result = await hass.callService(
  'music_assistant', 'search',
  { config_entry_id: MA_ENTRY_ID, name: query, limit: 20 },
  undefined, undefined, true  // return_response=true
);
const { artists, albums, tracks } = result.response;
```
- Requires `return_response=true` (6th arg to `callService`)
- Returns `{ artists[], albums[], tracks[] }` each with `.name`, `.uri`, `.image`, `.media_type`
- URI prefixes: `plex--iMAzJTgG://` = Plex, `ytmusic--z2SiByjx://` = YTM, `library://` = unified MA library
- MA config entry ID: `01KMBK5ZVGF4V016KQG8ZGX9NK` (stored as `const MA_ENTRY_ID`)
- Deduplicate results by name — MA returns both `library://` and provider-specific URIs for synced content

### MA play_media service
```js
hass.callService('music_assistant', 'play_media', {
  config_entry_id: MA_ENTRY_ID,
  entity_id: primaryEntity,
  media_id: item.uri,
  media_type: item.media_type,  // 'track', 'album', 'artist'
  radio_mode: false,
}, undefined, undefined, true);
```
- Use for search results — handles YTM stream resolution properly
- `radio_mode: true` = smart radio queue from that item (use for artists)
- `radio_mode: false` = exact playback (use for tracks and albums)

### Artist grouping
`groupArtists(items)` collapses `feat.` variants into grouped rows at Artist level.
- Only active when `breadcrumb.length === 1` and items are artists
- Search BYPASSES grouping — always runs against raw items
- Splits on: `feat.`, `feat`, `featuring`, `ft.`, `ft`
- Does NOT split on `&` (band names)

---

## Speaker entity IDs
| Friendly name | Entity ID | Hardware |
|---|---|---|
| Family Room | `media_player.family_room` | Sonos Arc |
| Office | `media_player.office_2` | — |
| Float | `media_player.float` | Sonos Roam |
| Basement | `media_player.basement_2` | — |
| Garage | `media_player.garage_2` | — |

---

## Known MA quirks (work around these, don't fight them)
1. **MA reports `idle` instead of `paused`** — use `hasMediaContext()` to detect paused state: `idle + media_title + 0 < position < duration`
2. **`group_members: []` on solo players** — always use `.length ? members : [entityId]`, never `|| [entityId]` (empty array is truthy)
3. **`group_members` only on coordinator** — compute grouped set by scanning ALL entities' `group_members` lists, not just the entity itself
4. **External sources (TV)** — `source !== 'Music Assistant Queue'` when playing = no transport controls, no auto-detect
5. **Track-ended state** — `idle + media_title + position >= duration` = track finished, not paused. `hasMediaContext` returns false
6. **`entity_picture` is a relative path** — prepend `location.origin` if it doesn't start with `http`

---

## Theme (v0.8.x)
Dark neutral palette matching HA dashboard. Key tokens:
```js
base: '#111111'      // true near-black
surface: '#1c1c1c'   // card surface
border: '#2e2e2e'    // neutral grey
primary: '#3b82f6'   // blue (active/selected state)
accent: '#14b8a6'    // teal (group action bar only)
text: '#e5e5e5'      // pure light grey
muted: '#737373'     // mid grey
```
No purple. Color is functional only (blue = selected, teal = group CTA, red = error).

---

## Open bugs / backlog (as of v0.10.x)

### Known limitations
- Speaker device images require manual config (no model info in MA entity attributes)
- Search drill-down for provider-specific URIs (ytmusic--, plex--) may fail; falls back to direct play

### Style backlog
- TV/external source: hide transport controls, show "Playing via TV" message

---

## Phases completed
| Phase | Description |
|---|---|
| P0 | MA installed, Plex + YTM + Sonos connected |
| P1 | Card scaffolded, loads in HA, MA browse fires |
| P2 | Speaker grid, multi-select, grouping via `media_player.join` |
| P3 | Full browse tree, drill-down, track playback |
| P4 | Now Playing screen, transport controls, volume sliders, queue |
| P5 | Progress bar clamp, auto-detect dirty flag, speaker status, queue refresh |
| P6 | Git/HACS structure, deploy script, Bug 5 (track-ended), grouped badge fix |
| P7 | Artist feat. grouping — collapses 31 2Pac variants into single row |
| P8 | Theme redesign — neutral dark palette matching HA dashboard |
| P9 | Browse UX: source toggle, recently played, artist/album context buttons, track plays album context |
| P10 | Real search via `music_assistant/search`, Search/Library tabs, provider badges, MA play_media |

## Current version
**v0.10.x** — check top of `src/sonos-music-card.js` for exact version comment

---

## Session startup checklist
1. Read this file
2. Check current version: `grep -m1 'v0\.' src/sonos-music-card.js`
3. Check open bugs section above
4. Never edit deployed file directly — always edit `src/`, then deploy
5. After deploy, bump `?v=` (script does this automatically)
6. Test in HA with Cmd+R
