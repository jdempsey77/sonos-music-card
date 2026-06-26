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
and a media browser backed by Jellyfin, YouTube Music, **and** Sonos favorites.

**Layout (v0.19.0, top → bottom):** always-visible `SpeakerBar` (speaker chips —
the chips ARE the group, no separate CTA) → `ServiceBar` (Jellyfin / YouTube Music
toggle; **hidden on Queue / Now Playing**) → `BottomNav` (4 tabs: Search · Browse ·
Queue · Now Playing) → tab content → always-visible `BottomBar`. The active service
(`_smcService`) is the **single source of truth** for all four tabs — it decides
whether Search/Browse render Jellyfin or YTM content AND which source Queue / Now
Playing / BottomBar read (not a playback heuristic). Every track row carries a
blue **play** button (starts immediately) and a gray **+** button (enqueues
without interrupting; shows a brief "Added to queue" toast via `TrackButtons`).

The **`BottomBar`** (v0.19.0, replaces the old hidden-on-Now-Playing MiniPlayer)
is mounted on **every** tab: 40x40 art · title/artist · prev · play/pause circle ·
next, plus a slim progress bar with timestamps. Tapping the bar (anywhere but the
buttons) opens the **Now Playing** tab, which is now the **expanded view only** —
art, title/artist, seek bar, shuffle/repeat, and volume sliders (no play/prev/next
row; that transport lives in the BottomBar). Both share the module-level
`transport*` helpers (`transportPlayPause` / `transportNext` / `transportPrev`),
so YTM next/prev resolve the adjacent `_ytmQueue` track card-side identically.

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

### Layout components (v0.19.0)
- **`SpeakerBar`** — replaces the old `SpeakersView`/Speakers tab. Renders the
  configured speakers as pill chips (selected = blue, unselected = gray); a
  selected chip that is also playing shows a blue dot before the name (the dot is
  gated on **selected AND playing**, not playing alone). **The chips are clean
  on/off (v0.19.0, simplified from the old Model A unjoin-all-and-rejoin dance):**
  tapping an OFF chip adds it to the selection and — if something is playing —
  joins it to the active coordinator (first selected speaker) via a single
  `media_player.join`; if nothing is playing it just adds it (becomes the target
  for the next play). Tapping an ON chip unjoins it (stops it) and drops it from
  the selection. The **last** remaining speaker can never be deselected. Handled by
  `smcToggleSpeaker` — no separate "Play here" CTA. Always visible at top.
- **`ServiceBar`** — Jellyfin / YouTube Music / **Sonos** toggle, drives
  `_smcService`. Active Jellyfin = teal accent, active YTM = red accent, active
  Sonos = green accent (`#0a1a0a`/`#22c55e`/`#86efac`). **Rendered only on the
  Search / Browse tabs** (a dead control on Queue / Now Playing; hidden + collapsed
  there).
- **`BottomNav`** — 4 tabs only: Search, Browse, Queue, Now Playing.
- **`BottomBar`** (v0.19.0, replaces `MiniPlayer`) — always-mounted persistent
  transport at the bottom of the card: 40x40 art · title/artist · prev · play/pause
  circle · next, plus a slim progress bar with timestamps. Tapping it (not the
  buttons) opens Now Playing. Nothing playing → placeholder art, "Nothing playing",
  disabled play button. Uses the shared `transport*` helpers (same callService path
  as NowPlayingView; YTM next/prev resolve the adjacent `_ytmQueue` track card-side).
- **`NowPlayingView`** is the **expanded view only** (v0.19.0) — art, title/artist,
  seek bar, shuffle/repeat modes (above volume), and volume sliders. The play/prev/
  next transport row was removed (it lives in the BottomBar now).
- **`TrackButtons`** — the play + `+` button pair on every track row. Play calls
  the existing play path and jumps to Now Playing; `+` calls the existing enqueue
  path (`enqueueJfTracks` / `enqueueYtmTrack`) and fires the "Added to queue"
  toast. Non-track rows (artists/albums/playlists) keep tap-to-navigate + chevron.
- **Service routing** lives in `SonosMusicApp`: `_smcService` is the single source
  of truth for **all four tabs**. Jellyfin keeps separate Search and Browse panels;
  YTM uses a single `YTMView` panel shown under either tab. Queue / Now Playing /
  BottomBar also read `_smcService` directly (not a playback heuristic) — switching
  the service instantly re-scopes every tab. All panels stay mounted (hidden via
  CSS) so per-view state persists across tabs.

The old `SpeakersView`/`SpeakerRow` are removed; their dead CSS (`.smc-spk-row`,
`.smc-group-bar`, `.smc-inline-group`, …) was deleted in v0.17.1.

### Module-level state (survives Preact re-renders)
```js
let _smcSpeakers = []        // selected speakers — single source of truth
let _smcService = 'jf'       // active service: 'jf' (Jellyfin) | 'ytm' | 'sonos' — drives Search/Browse
let _smcUserSelected = false // true after explicit user tap — blocks auto-detect
let _smcUserSelectedAt = 0   // timestamp of last user tap
let _smcDirty = false        // signals Preact to re-render after auto-detect change
let _smcNowPlayingJfId = null      // current Jellyfin track id (for art)
let _smcNowPlayingJfAlbumId = null // current Jellyfin album id — art is album-first (v0.20.0)
let _smcQueue = []           // card-side Jellyfin queue [{id,name,subtitle,imageTag,albumId}]
let _ytmQueue = []           // card-side YTM queue
let _haStateSaveTimer = null // debounce timer for ytm-service /state save (v0.20.0)
```

### Key functions
| Function | Purpose |
|---|---|
| `smcInit(hass)` | Cold load. Seeds `_smcSpeakers` from playing state or localStorage. On first `set hass` the card also calls `loadStateFromHA` to rehydrate queue/service/now-playing (v0.20.0) |
| `smcAutoDetect(hass)` | Every hass update. Promotes a playing speaker if nothing selected |
| `loadStateFromHA()` / `scheduleStateSave()` / `buildStateBlob()` | Cross-device state (v0.20.0; backend switched to ytm-service in v0.20.1). Persist `service` + both queues + now-playing ids to ytm-service `GET/POST ${ytm_url}/state` (SQLite-backed on ska); load on init. Save debounced 2s, called at every queue/service/now-playing mutation. The POST is a CORS **simple request** (no `Content-Type` header → `text/plain`) to skip the preflight nginx would reject; server parses with `get_json(force=True)`. Silent in-memory fallback if the endpoint is unreachable. (The name `loadStateFromHA` is retained for continuity; the backend is no longer HA — its WS `frontend/*_user_data` API is absent in this build.) |
| `jfFetchTrackAlbumInfo(trackId)` | (v0.20.0, replaces `jfFetchImageTag`) Fetch `AlbumId` + `AlbumPrimaryImageTag` for a track in one `/Items?Ids=…&Fields=…` call — used to resolve **album** art for auto-detected tracks, since most tracks have no track-level image |
| `smcToggleSpeaker(entityId, hass)` | Chip toggle = group membership (clean on/off, v0.19.0). Add → simple `join` to the active coordinator if something's playing, else just select; remove → `unjoin` (stops). Removing the **last** speaker is playback-conditional (v0.19.5): if it's playing, `media_stop` first, then deselect to zero; if idle, just deselect to zero. Async; `_smcSpeakers` mutates synchronously for optimistic UI. Sets `_smcUserSelected = true` |
| `transportPlayPause/Next/Prev(hass, entityId)` | Shared transport (v0.19.0) used by both BottomBar and NowPlayingView. Play/pause → HA `media_play_pause`. Next/prev resolve the adjacent queue track card-side and `play_media` it when the active service has a card-side queue — YTM via `ytmAdjacent`/`_ytmQueue`, Jellyfin via `jfAdjacent`/`_smcQueue` (v0.19.1; HA `media_next_track` no-ops on native Sonos entities queued via `play_media`). Falls back to HA `media_*` services when the queue is empty |
| `hasMediaContext(state)` | True if playing, paused, or idle+title+mid-track |
| `isExternalSource(state)` | True if playing from a non-queue source (TV, line-in) |
| `getNowPlaying(hass, selected, service)` | Now-playing scoped to the active service (`_smcService`): YTM context = stored `_ytmNowPlaying`; Jellyfin context = live HA state. No cross-read |
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
- Images: `/Items/{id}/Images/Primary` (public, no token). **Art is album-first**
  (v0.20.0): most tracks have no track-level image, so `/Items/{trackId}/Images/Primary`
  404s — the cover lives on the album. Resolve `AlbumId` and render
  `jfImageUrl(albumId)`. Track-level art is used only when a track genuinely carries
  its own `ImageTags.Primary`.
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
**v0.21.7** — **Now Playing pins to the launch speaker + prefers playing over paused.** Playing a Sonos favorite (e.g. a SiriusXM station) could show a *different* speaker's track/artist/art. `getNowPlaying` picked the display speaker via a media-context scan that ranked a `paused` speaker (holding stale Jellyfin metadata) equal to one actually `playing`, so a paused speaker could win. Three fixes: **(a)** `_smcPinnedEntityId` — `playSonosFavorite` (and `jfAdjacent`/`ytmAdjacent`) pin the launch/coordinator speaker, and `getNowPlaying` returns it first; cleared when JF/YTM playback takes over and on genuine idle (the stale-art `useEffect`). **(b)** `getNowPlaying` is now a **two-pass** scan — actively `playing` speakers first, then paused/idle-with-context as fallback — so a stale paused speaker can never beat one that is playing. **(c)** `buildNpInfo` detects Sonos-native content ids (`x-sonosapi-` / `x-rincon-` / `x-sonos-`) and uses HA `entity_picture` directly, bypassing the Jellyfin art pipeline (whose `/Audio/.../stream` regex never matches a Sonos stream).

**v0.21.6** — **favorites_folder drilling fix.** The favorites loop skipped `favorites_folder` nodes (Radio, Playlists) because they report `can_expand: false` and `can_play: false`, even though their children are reachable via an explicit `sonosBrowse` fetch. The guard now also lets `media_content_type === 'favorites_folder'` through, so the explicit fetch runs and surfaces their contents — SiriusXM stations in the Radio folder now appear.

**v0.21.5** — **Auto-detect oscillation & Sonos 402 fixes.** (a) `smcAutoDetect`'s early-return guard now uses `hasMediaContext()` (playing / paused / idle-with-title) instead of `state === 'playing'` only. Radio stations briefly report `idle` between tracks, which released the guard, let the 30s latch expire, and re-evaluated with two playing speakers — oscillating the selection. Media-context covers the idle-between-tracks gap so the guard holds. (b) `playSonosFavorite` resolves the actual group **coordinator** from HA `group_members` (where `members[0]` is the coordinator) before calling `play_media` — sending a favorite to a grouped *follower* returns 402 Invalid Args. It also falls back to `media_content_type='music'` if the `favorite_item_id` content type is rejected.

**v0.21.4** — **Refresh-loop & Sonos-routing fixes.** (a) The dirty-flag `useEffect` had no dependency array, so it ran after *every* render; when `_smcDirty` triggered `forceUpdate` the next render re-ran it, and the album-art fetch re-setting `_smcDirty` closed a `render → dirty → render` loop. It's now a single `setInterval(500ms)` poll of the flags — breaks the cycle while still picking up auto-detect / YTM metadata changes promptly. (b) Sonos **Browse** was showing the Jellyfin tree on load: `loadStateFromHA` restores `_smcService` *async*, after the first render, but `useState` only reads its initial value once. A module-level `_smcSetService` ref (registered on mount) lets `loadStateFromHA` sync the React service state immediately on restore. (c) The **Queue** tab is now hidden when Sonos is the active service (Sonos owns its own queue); switching to Sonos while on Queue auto-redirects to Browse.

**v0.21.3** — Sonos favorite **thumbnails**. `smcResolveImage` upgrades `http://` art to `https://` when the card is served over HTTPS (an http img on an https page is silently blocked as mixed content; tunein/googleusercontent serve both schemes), and favorite rows fall back to the ♪ placeholder on img `onError`. Note: several Sonos favorites point at expired/ephemeral service art (e.g. `sonos.plex.tv` proxy links that 500, stale `googleusercontent` art that 404s) — those can't be recovered client-side and show the placeholder.

**v0.21.2** — Bug fix: Sonos favorites now render. `browse_media` in this HA build is a **lazy tree** — each node returns `can_expand:true` with no `children` array, so `sonosFetchFavorites` now fetches every level explicitly (root → Favorites node → each category folder), one `sonosBrowse` per level, instead of a single drill that silently dropped folders. Debug `console.log`s removed from `sonosBrowse`.

**v0.21.0** — **Sonos favorites as a third service.** A green **Sonos** pill joins
Jellyfin and YTM in the `ServiceBar` (`_smcService` now `'jf' | 'ytm' | 'sonos'`).
Selecting it shows `SonosBrowseView` under the Browse tab: a single
`media_player.browse_media` call returns Sonos's own pre-categorized favorites tree
(Radio / Playlists / Albums / Album_Artists) with thumbnails and `favorite_item_id`
content ids, rendered as section-grouped rows each with a play button. Playback is
`media_player.play_media` with `media_content_type='favorite_item_id'` targeted at
the coordinator (`_smcSpeakers[0]`) — the simplest of the three services (no stream
URL resolution, no external API, no auth beyond HA). `favorite_item_id`s are
**index-based and volatile**, so the tree is re-fetched on every open and never
persisted. Search is unavailable under Sonos (the Search panel shows a "use Browse"
note); the Queue tab shows "Sonos manages its own queue". Now Playing is unchanged
— `buildNpInfo` reads HA state; a radio favorite surfaces the existing
external-source message (`QUEUE_SOURCES` already includes `'Sonos Queue'`).
`playSonosFavorite` cross-clears the JF/YTM now-playing + queue state (like the JF
and YTM play paths) so stale art never bleeds across services. `_smcService='sonos'`
persists via the existing ytm-service state blob. Existing JF/YTM code paths untouched.

Implementation notes:
- `sonosFetchFavorites(hass, eid)` → `sonosBrowse` (primary: `hass.callService(...,
  returnResponse=true)` positional signature; fallback: `hass.callWS` browse_media,
  absent in this HA build). The Sonos media root holds a **Favorites** node whose
  children are the category folders. `browse_media` is a **lazy tree** (each node
  returns `can_expand` with no children inlined), so v0.21.2 fetches every level
  explicitly: root → Favorites node → each category folder, one `sonosBrowse` per
  level, then collects each folder's `can_play` leaves (thumbnails via
  `smcResolveImage`; empty folders dropped).
- Browse-tab routing in `SonosMusicApp`: `sonosBrowseVisible` / `sonosSearchVisible`
  mirror the JF/YTM panel-visibility flags; all panels stay mounted (CSS-hidden).

**v0.20.1** — Cross-device state backend swapped from HA WebSocket to ytm-service.
The v0.20.0 approach used HA's `frontend/{get,set}_user_data` WS API, but that API
is **absent in this HA build** (`hass.connection` is undefined), so it silently
no-op'd. Replaced with a SQLite-backed `GET/POST /ytm/state` endpoint on
ytm-service (Option A). Same card-side interface (`loadStateFromHA` /
`scheduleStateSave`, now arg-less; `_smcHass` removed) and same debounced-2s save.
The card POSTs as a **CORS simple request** (no `Content-Type` header → `text/plain`)
so it avoids a preflight that nginx's `GET, OPTIONS`-only allow-methods would
reject; the Flask route parses with `get_json(force=True)`. Verified end-to-end via
nginx (GET + POST round-trip, `Access-Control-Allow-Origin: *` on responses).

**v0.20.0** — Three fixes.
1. **Art pipeline rewritten album-first.** Empirically, most tracks have **no
   track-level image** — the cover lives on the album, so the raw
   `/Items/{trackId}/Images/Primary` endpoint 404s regardless of params or token.
   `buildNpInfo` now resolves album art via `jfImageUrl(albumId)`;
   `jfFetchTrackAlbumInfo` (replaces `jfFetchImageTag`) fetches `AlbumId` +
   `AlbumPrimaryImageTag` in one call for auto-detected tracks, registers
   `_smcNowPlayingJfAlbumId`, and `_smcDirty`-re-renders. A known-404 track URL no
   longer pre-empts the working album fallback. The NP/BottomBar `<img>` no longer
   hides itself with an imperative `style.display='none'` (which Preact never
   restored on the reconciled node, so a later valid src stayed hidden) — load
   failure is an `artError` state flag that resets when the art URL changes.
2. **Volume sliders follow the card's selection.** `volumeSpeakers` now derives
   from `_smcSpeakers` (what the user chose), not the playing entity's HA
   `group_members` (the real Sonos group), so an unrelated group — e.g. a household
   member grouping the living room for TV — no longer appears as a volume target.
   A selected speaker on an external source (TV/line-in) or unavailable shows a
   note instead of a slider.
3. **Cross-device queue persistence.** `service` + both queues + now-playing ids
   persist via HA `frontend/{get,set}_user_data` over the existing WebSocket —
   per-user, cross-device, cross-browser, **no new infrastructure** (localStorage is
   blocked by Edge tracking prevention here). Load-time restore on init; debounced
   2s save on every mutation; silent in-memory fallback if the WS command is absent.

**v0.19.6** — **Save as Playlist** in the Queue tab (Jellyfin only — the button is
hidden when `_smcService === 'ytm'`). The queue-count row gained a **Save as
playlist** button next to **Clear**; tapping it opens an inline name input
(prefilled "My Playlist") with **Save**/**Cancel**. Save collects the queue's
Jellyfin track ids and calls the new `jfCreatePlaylist(name, trackIds)` helper —
`POST /Playlists?api_key=…` with `{ Name, Ids, UserId, MediaType: 'Audio' }`.
`UserId` (from `jfGetUserId`) is **required** in the body for the playlist API
under API-key auth — omitting it 400s. A toast confirms `Saved "<name>"`; failure
shows an inline error for 3s. `onToast` is now wired through to QueueView. The
card-side queue is unchanged — this just persists it as a Jellyfin playlist.

**v0.19.5** — Last-speaker chip guard is now **playback-conditional**. Tapping the
only selected chip used to be a no-op (the guard blocked deselect outright). Now:
tapping it while **idle** deselects to zero (the card shows "Select a speaker
first" — all views already handle the empty selection and every `play_media` path
early-returns on `!eid`); tapping it while **playing** issues `media_stop` on that
speaker first, then deselects to zero. Both paths fall through to the existing 30s
`_smcUserSelected` latch, so `smcAutoDetect` won't immediately re-promote a playing
speaker and silently undo the deselect. Deferred: coordinator handoff when the
`[0]` speaker is removed from a group, and pruning offline/unavailable speakers
from `_smcSpeakers`.

**v0.19.4** — Clear queue button in the Queue tab. The queue-count row gained a
right-aligned **Clear** button: it empties the active service's card-side queue
(`_ytmQueue`/`_ytmQueueEntityId` + `_ytmNowPlaying` when YTM, else `_smcQueue`/
`_smcQueueEntityId` + the now-playing art ids `_smcNowPlayingJfId`/
`_smcNowPlayingJfAlbumId`/`_smcLastFetchedArtId`) and bumps QueueView's local
`force` counter to re-render. Audio already playing on the speaker is unaffected —
this only clears the card-side list.

**v0.19.3** — Three fixes.
1. **Now Playing art for auto-detected tracks** — when `_smcNowPlayingJfId` is
   null and `_smcQueue` is empty (e.g. after a reload), `buildNpInfo` extracts the
   item id from `media_content_id` and kicks off `jfFetchImageTag()` — a direct
   `/Items/{id}/Images` API call — to confirm a Primary image exists, then sets
   `_smcNowPlayingJfId` + `_smcDirty` so the next render sources art as a known
   track. New module state `_smcLastFetchedArtId` guards against repeated fetches
   for the same item (cleared everywhere `_smcNowPlayingJfId` is). `jfNowPlayingArt()`
   now prefers the queue's `imageTag` (correct cache-busting) over the raw endpoint.
2. **Browse defaults to the library level** — the BrowseView fetch effect
   auto-advances past the root view when exactly one music library is returned
   (eliminates one tap). The breadcrumb still shows Library › Music so back-nav works.
3. **Smart tap on album/playlist browse rows** — if nothing is playing, tapping an
   album/playlist row plays it all immediately and jumps to Now Playing; if
   something is playing it drills in as before. Track rows unchanged. Applied in
   both BrowseView rows and SearchView drill rows.

**v0.19.2** — Now Playing art uses the queue's `imageTag` as a fallback. When the
Jellyfin art pipeline (known JF id → stream-URL extract → album fallback) all miss,
`buildNpInfo` now looks up the current track in `_smcQueue` by id and reuses the same
`jfImageUrl(id, imageTag)` source the queue rows already render successfully (album
id via `jfImageUrl` if `imageTag` is absent), before falling back to the HA proxy.

**v0.19.1** — Jellyfin next/prev card-side queue navigation (`jfAdjacent` mirrors `ytmAdjacent`).

**v0.19.0** — Persistent bottom bar, speaker chip overhaul, album thumbnail fix.
1. **`BottomBar` replaces `MiniPlayer`** — always mounted regardless of active tab
   (the old MiniPlayer was hidden on Now Playing). Row 1: 40x40 art · title/artist ·
   prev · play/pause circle (34x34, blue) · next. Row 2: slim 2px progress bar with
   9px timestamps. Tapping the bar (not the buttons) opens Now Playing. Nothing
   playing → placeholder art + "Nothing playing" + disabled play button (50%).
2. **`NowPlayingView` is the expanded view only** — the play/prev/next transport
   row was removed (now in the BottomBar). Keeps art, title/artist, seek bar,
   shuffle/repeat (`.np-modes`, above volume), and volume sliders.
3. **Shared transport helpers** — `transportPlayPause` / `transportNext` /
   `transportPrev` are module-level and used by BOTH the BottomBar and
   NowPlayingView, so they can't drift. YTM next/prev resolve the adjacent
   `_ytmQueue` track card-side (HA `media_*_track` no-op for the non-native queue).
4. **Speaker chip model simplified** — `smcToggleSpeaker` is now clean on/off (no
   unjoin-all + rejoin dance). Tap OFF → add to selection; if something is playing,
   a single `media_player.join` adds it to the active coordinator. Tap ON →
   `media_player.unjoin` (stops it). Last speaker can't be deselected. The chip dot
   shows only when the chip is **both** selected and playing.
5. **Album thumbnails** — `jfImageUrl` now uses `maxHeight=96&maxWidth=96` (not
   `fillHeight/fillWidth`, which 404s for items without a stored thumbnail at that
   size). `imageTag: item.ImageTags?.Primary || null` is set consistently across
   every `jfFetchRows` path (views/artists/albums/playlists/tracks) and
   `jfArtistTracks`.

**v0.18.0** — Targeted bug-fix pass (8 fixes, no architectural change):
1. **Auto-detect latch (B1)** — `smcAutoDetect` ran on every ~1Hz hass push and
   never recorded its own choice, so two simultaneously-playing speakers made it
   oscillate every tick. It now latches after promoting a speaker
   (`_smcUserSelected = true` + timestamp — the same 30s block a user tap engages)
   and returns immediately if any selected speaker is `playing`.
2. **Render-phase side effect removed (A2)** — the `_smcDirty` / `_ytmDirty`
   checks (which called `setTimeout(forceUpdate)`) moved out of the `SonosMusicApp`
   render body into a `useEffect` (no dep array). Scheduling a render from the
   render body is structurally unsound.
3. **`getNowPlaying` made pure (A1)** — it no longer clears `_smcNowPlayingJfId` /
   `_smcNowPlayingJfAlbumId` on the idle path (it's called from three `useMemo`s).
   The stale-art cleanup moved to a `SonosMusicApp` `useEffect` keyed on
   `nowPlaying` (guarded to the Jellyfin service so switching to YTM doesn't wipe a
   still-valid Jellyfin art id).
4. **YTM title from `media_content_id` (B2)** — after a reload `_smcService` resets
   to `jf` and `_ytmNowPlaying` is null, so a playing YTM track showed its raw
   stream URL / "Unknown". `buildNpInfo` now detects a bad title (URL / "Unknown")
   and substitutes `_ytmNowPlaying` or a generic "YouTube Music" placeholder when
   the `media_content_id` is a `/audio/<id>.m4a` stream. YTM art now prefers the
   stored thumbnail over a (404ing) `entity_picture`.
5. **Art pipeline reordered (B4)** — `info.art` seeds **null**; the Jellyfin branch
   builds it in explicit priority: known JF id → extract from stream URL → album
   fallback → HA proxy (last). A non-null-but-404ing `entity_picture` no longer
   short-circuits the better sources. Stream-URL regex widened to `[a-f0-9-]+`
   (dashed GUIDs).
6. **Last-speaker guard (A4)** — `smcToggleSpeaker` won't deselect the only
   remaining speaker.
7. **Volume sliders fall back to selected speakers (A8)** — `volumeSpeakers` uses
   the playing group's members when grouped, else the selected speakers.
8. **Volume slider debounced (A10)** — `volume_set` now fires 300ms after the last
   drag event (module-level `_volumeDebounceTimer`) instead of on every onInput,
   so dragging no longer floods HA.

Known limitation (resolved in v0.20.0): at this version the queue + YTM
now-playing did **not** persist across a card reload — `localStorage` is blocked
by Edge/Chromium tracking prevention in this HA environment (see the safe storage
wrapper, v0.17.2). v0.20.0 added cross-device persistence via HA user-data over
the WebSocket, which sidesteps the localStorage block.

**v0.17.4** — Jellyfin now-playing art for **auto-detected tracks** (a track
already playing when the card loads, not launched from the card, so
`_smcNowPlayingJfId` is null and `jfNowPlayingArt()` returns nothing). The
Jellyfin branch of `buildNpInfo` now falls back to extracting the item ID from
`media_content_id` — which carries the Jellyfin stream URL `/Audio/{itemId}/stream`
— via regex, and builds the `/Items/{id}/Images/Primary` art URL directly. Covers
the common case of opening the card while music is already playing.

**v0.17.3** — Jellyfin now-playing art falls back to **album art** when a track
has no `Primary` image (some Jellyfin items only carry album-level art, so the
track-level `/Items/{trackId}/Images/Primary` URL 404'd and Now Playing showed a
placeholder). Track rows (`jfFetchRows` album + playlist cases), search track
meta, `jfArtistTracks`, and `toQueueItem` now carry `albumId`; new module state
`_smcNowPlayingJfAlbumId` mirrors `_smcNowPlayingJfId` (set in `playJfTracks` /
`jumpToQueueTrack`, cleared everywhere `_smcNowPlayingJfId` is cleared —
`playYtmTrack`, `enqueueYtmTrack`, idle). `jfNowPlayingArt()` returns track art
when present, else album art. The NowPlayingView `<img>` also gets an `onError`
handler that swaps to album art once if the track-level URL 404s at render time,
then hides the img if that also fails.

**v0.17.2** — Four targeted fixes. (1) **Jellyfin now-playing art 404**:
`buildNpInfo` now sets `art: jfNowPlayingArt() || smcResolveImage(a.entity_picture)`
— the HA `entity_picture` proxy returns a non-null URL that 404s for native Sonos
entities (Music Assistant was uninstalled), so the old jfNowPlayingArt() *fallback*
never fired; it's now first, and the redundant `info.art = info.art || jfNowPlayingArt()`
in the Jellyfin branch was removed. (2) **YTM album drill Add All**: the album drill
action bar gained a `+ Add All` button beside `▶ Play All`, backed by a new
`addAlbumAll` handler (enqueues every track via `enqueue:'add'`, tracks them in
`_ytmQueue`, toasts `Added N tracks`). (3) **YTM next/prev**: `handleNext`/`handlePrev`
in NowPlayingView now branch on `_smcService === 'ytm'` — HA `media_next_track` /
`media_previous_track` do nothing for the non-native YTM queue, so the card resolves
the adjacent `_ytmQueue` track itself and `play_media`s it (sets `_ytmNowPlaying` +
`_ytmDirty`). Native/Jellyfin path unchanged. (4) **localStorage tracking-prevention
spam**: all `localStorage` access routed through `storageAvailable()` / `storageSave()`
/ `storageLoad()` helpers that probe once and fall back to in-memory when storage is
blocked (Edge/Chromium tracking prevention in some HA contexts), silencing ~248 console
warnings.

**v0.17.1** — Architecture fixes on top of the v0.17.0 redesign. (1) `_smcService`
is now the **single source of truth for all four tabs**: QueueView, NowPlayingView,
and MiniPlayer read it directly (via service-scoped `getNowPlaying`/`buildNpInfo`),
not the old `activeSource()` playback heuristic (removed). Switching the service
instantly re-scopes every tab — switch to YTM while Jellyfin is audibly playing and
Now Playing shows YTM state (empty/last YTM track); audio keeps playing, the card
just moved context (accepted). (2) `enqueueJfTracks` / `enqueueYtmTrack` now
**cross-clear** the opposing service's state on entry (the enqueue path wasn't
cross-clearing — H3). (3) **Speaker model is Model A**: the chips ARE the group —
`smcToggleSpeaker` drives HA join/unjoin transport on tap (add → re-join under
primary + resume; remove → unjoin). `handleGroup` and the inline "Play here ▶" bar
removed; `smcSelectSpeaker` replaced. (4) `ServiceBar` hidden (and space collapsed)
on Queue / Now Playing. (5) UI cleanup: unified Add-All toast feedback, `.smc-nav`
comment fixed, `padding-bottom` 60px→12px on content/np-scroll (mini-player is a
flex sibling now, not an overlay), dead SpeakersView/group-bar/inline-group CSS
deleted, unjoin call shape standardized to `{ entity_id }`.

**v0.17.0** — Major layout redesign (UI/interaction layer only — no playback,
transport, queue, Jellyfin, or YTM service logic touched). The bottom-nav
Speakers tab is replaced by an always-visible `SpeakerBar` at the top (speaker
chips + inline "Play here ▶" group bar); the YTM tab is replaced by a `ServiceBar`
(Jellyfin / YouTube Music toggle driving the new `_smcService` state). Nav is now
4 tabs: Search · Browse · Queue · Now Playing. The active service decides whether
Search/Browse show Jellyfin or YTM content (Jellyfin = two panels, YTM = one
`YTMView` shown under either tab). Every track row gained a `TrackButtons` pair:
a blue play button (plays immediately, jumps to Now Playing) and a gray `+`
button (enqueues via the existing `enqueueJfTracks`/new `enqueueYtmTrack`, no
playback interruption) that fires a brief teal "Added to queue" toast. Non-track
rows keep tap-to-navigate + chevron. `SpeakersView`/`SpeakerRow` removed.

**v0.16.5** — Fixed Sonos UPnP Error 714 "Illegal MIME-Type" on the
**YouTube Music** path. The card handed Sonos the raw, extensionless
googlevideo URL; HA's Sonos integration infers the UPnP `protocolInfo` MIME
from the URL path extension, got nothing, and Sonos rejected
`SetAVTransportURI` with 714 — before fetching a byte. Fix: new `ytm-service`
endpoint `GET /ytm/audio/<videoId>.m4a` that 302-redirects to the resolved
googlevideo URL; the `.m4a` path lets HA infer `audio/mp4`. The card now plays
`${_ytmServiceUrl}/audio/<videoId>.m4a` directly in `playYtmTrack`, `onYtmJump`,
and the Play All enqueue loop — no client-side resolve. `ytmStreamUrl` (hits
`/ytm/stream/`) is retained but now unused by the card. If the 302 fails on any
Sonos model, the fallback is a full streaming proxy at the same endpoint.

**v0.16.4** — Fixed Sonos UPnP Error 714 "Illegal MIME-Type" on `play_media`.
`jfStreamUrl` was missing `&Container=mp3`, so Jellyfin did not reliably set
`Content-Type: audio/mpeg` and Sonos rejected the stream with a 714. Added
`&Container=mp3` to the stream URL query string.

**v0.16.3** — YTM track changes now re-render the UI immediately. `_ytmNowPlaying`
is module-level state, so updating it didn't trigger a Preact render — the UI
showed the previous track until some hass update happened to re-render. Added a
`_ytmDirty` flag (mirrors the existing `_smcDirty`/`forceUpdate` pattern): set
`true` wherever `_ytmNowPlaying` changes (`playYtmTrack`, QueueView YTM jump, and
on clear in `playJfTracks`), checked+consumed in `SonosMusicApp` to bump the
shared `forceUpdate` counter.
**v0.16.2** — Two YTM fixes. (1) YTM Now Playing no longer reverts to the raw URL
on idle/pause: `getNowPlaying()` no longer clears `_ytmNowPlaying` (it's cleared
only in `playJfTracks()` when Jellyfin takes over; `buildNpInfo`'s URL guard keeps
it from leaking into a real title). (2) Queue tab now works for YTM. New parallel
state `_ytmQueue` / `_ytmQueueEntityId` (shape `{videoId, title, artist, thumbnail}`),
populated in `playYtmTrack()` — one entry for a tapped song, the full album for
Play All (metadata-only; tracks still stream in via enqueue since yt-dlp is ~1-3s
each). `_ytmNowPlaying` gained a `videoId` field for the playing-row highlight.
New `activeSource()` helper (`'ytm' | 'jellyfin' | null`) picks which queue the
QueueView renders; YTM tap-to-jump resolves the stream (per-row spinner) and plays
without rebuilding the queue. `toYtmQueueItem()` normalizes id→videoId.
**v0.16.1** — YTM Now Playing fix. HA reports the raw `videoplayback?expire=…`
stream URL as `media_title` for YTM tracks, so Now Playing showed a URL and a
placeholder. New module var `_ytmNowPlaying` ({title, artist, thumbnail}) is set
in `playYtmTrack()` (metadata threaded from the tapped row), cleared in
`playJfTracks()` and when the player goes idle. `buildNpInfo()` substitutes it
when `media_title` is missing or looks like a URL (`includes('videoplayback')`
or `startsWith('http')`). `playYtmTrack(hass, eid, videoId, meta)` now takes a
meta object; `tapSong(track)` and album Play All pass the full row object.
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

## Sonos favorites service (v0.21.0)
The third media service — and the only one with **no backend at all**. Sonos
exposes its own favorites through HA, so the card just calls HA services from the
browser; there is no ska component, no nginx route, no auth beyond HA.
- **Fetch**: `media_player.browse_media`. Primary path is
  `hass.callService('media_player', 'browse_media', {entity_id}, undefined, false, true)`
  (returnResponse, positional signature — HA 2024.4+); fallback is the
  `media_player/browse_media` WS command (`hass.callWS`), which is **absent in this
  HA build** (`hass.connection` undefined) but kept as a graceful degrade.
- **Tree shape**: the speaker's media root contains a **Favorites** node whose
  children are the category folders **Radio / Playlists / Albums / Album_Artists**;
  `sonosFetchFavorites` drills into that node (if the root isn't already the
  favorites tree) and `parseBrowseMediaResult` groups can-expand children into
  folders of their `can_play` leaves. Each leaf has `title`, `thumbnail`,
  `media_content_id` (e.g. `FV:2/9`), `media_content_type: 'favorite_item_id'`.
- **Playback**: `media_player.play_media` with
  `media_content_type='favorite_item_id'`, targeted at the coordinator
  (`_smcSpeakers[0]`). Sonos favorites **replace** current playback — they don't
  enqueue card-side — so `playSonosFavorite` cross-clears JF/YTM now-playing + queue
  state. No stream URL resolution needed (the simplest of the three services).
- **Volatility**: `favorite_item_id`s are **index-based** and shift when favorites
  change, so the tree is re-fetched on every Browse open and **never persisted**.
  (`_smcService='sonos'` itself does persist via the ytm-service state blob.)
- **Tabs under Sonos**: Browse = `SonosBrowseView`; Search = "use Browse" note
  (favorites have no search); Queue = "Sonos manages its own queue"; Now Playing =
  unchanged (`buildNpInfo` reads HA state; radio favorites show the external-source
  message — `QUEUE_SOURCES` already includes `'Sonos Queue'`).

## Open work
- [x] Search tab (Jellyfin search API) — v0.14.0
- [x] Now Playing queue view — v0.15.0 (Queue tab, card-side, read-only)
- [x] Artist/album "Play all" affordance in Browse — v0.15.0 (Play All + Add All)
- [x] YouTube Music support — v0.16.0 (ytm-service on ska; search + stream via yt-dlp)
- [x] Sonos favorites support — v0.21.0 (browse_media tree, play_media favorite_item_id)
- [ ] "Shuffle" affordance for Play All / Add All
- [ ] Queue reorder / delete (Queue tab is read-only this version)
- [ ] Art that tracks queue advance (currently shows first track's art only)
- [ ] Direct-play (avoid mp3 transcode) for lossless on capable renderers
- [x] YTM Now Playing title/artist/art — v0.16.1 (`_ytmNowPlaying` + buildNpInfo substitution)
- [x] YTM card-side queue — v0.16.2 (`_ytmQueue` + `activeSource()`; Queue tab dual-source)
- [x] YTM album drill Add All button — v0.17.2 (`addAlbumAll`)
- [x] YTM next/prev (card-side, HA next/prev no-op for non-native queue) — v0.17.2
- [x] Jellyfin now-playing art 404 (prefer `jfNowPlayingArt()` over HA proxy) — v0.17.2
- [x] Jellyfin now-playing art album fallback (track has no Primary image) — v0.17.3
- [x] Jellyfin art for auto-detected tracks (extract item ID from media_content_id) — v0.17.4
- [x] Now Playing art queue imageTag fallback (reuse working queue-row art) — v0.19.2
- [x] Now Playing art for auto-detected tracks via direct API imageTag fetch — v0.19.3
- [x] Browse defaults to library level (auto-advance past root) — v0.19.3
- [x] Smart tap on album/playlist rows (play-all when idle, drill when playing) — v0.19.3
- [x] Clear queue button in Queue tab — v0.19.4
- [x] localStorage tracking-prevention console spam — v0.17.2 (safe storage wrapper)
- [x] Auto-detect oscillation between two playing speakers (latch) — v0.18.0
- [x] Render-phase side effects / impure `getNowPlaying` (moved to effects) — v0.18.0
- [x] YTM title/art lost after reload (recover from `media_content_id`) — v0.18.0
- [x] Volume slider flooding HA (300ms debounce) — v0.18.0
- [x] Persistent transport on every tab (BottomBar replaces MiniPlayer) — v0.19.0
- [x] Speaker chip model simplified (clean join/unjoin, no rejoin dance) — v0.19.0
- [x] Album thumbnails in Browse (maxHeight/maxWidth + imageTag audit) — v0.19.0
- [x] Queue + YTM now-playing persistence across reload **and across devices** —
  v0.20.1 via ytm-service `GET/POST /ytm/state` (SQLite on ska). Supersedes both
  the prior "intentionally not implemented" stance (`localStorage` blocked by Edge
  tracking prevention) and the v0.20.0 HA `frontend/*_user_data` WS attempt (that
  API is absent in this HA build). The state endpoint reuses the existing
  ytm-service + nginx — no new service.

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
