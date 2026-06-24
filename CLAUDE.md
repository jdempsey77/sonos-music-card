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
and a media browser backed by Jellyfin **and** YouTube Music.

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
- **`ServiceBar`** — Jellyfin / YouTube Music toggle, drives `_smcService`.
  Active Jellyfin = teal accent, active YTM = red accent. **Rendered only on the
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
let _smcService = 'jf'       // active service: 'jf' (Jellyfin) | 'ytm' — drives Search/Browse
let _smcUserSelected = false // true after explicit user tap — blocks auto-detect
let _smcUserSelectedAt = 0   // timestamp of last user tap
let _smcDirty = false        // signals Preact to re-render after auto-detect change
```

### Key functions
| Function | Purpose |
|---|---|
| `smcInit(hass)` | Cold load. Seeds `_smcSpeakers` from playing state or localStorage |
| `smcAutoDetect(hass)` | Every hass update. Promotes a playing speaker if nothing selected |
| `smcToggleSpeaker(entityId, hass)` | Chip toggle = group membership (clean on/off, v0.19.0). Add → simple `join` to the active coordinator if something's playing, else just select; remove → `unjoin` (stops). Last speaker can't be removed. Async; `_smcSpeakers` mutates synchronously for optimistic UI. Sets `_smcUserSelected = true` |
| `transportPlayPause/Next/Prev(hass, entityId)` | Shared transport (v0.19.0) used by both BottomBar and NowPlayingView. Native/Jellyfin → HA `media_*` services; YTM → resolve adjacent `_ytmQueue` track card-side |
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

Known limitation: the queue + YTM now-playing do **not** persist across a card
reload — `localStorage` is blocked by Edge/Chromium tracking prevention in this
HA environment (see the safe storage wrapper, v0.17.2), so both are in-memory by
design. Intentionally not implemented, not a bug.

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

## Open work
- [x] Search tab (Jellyfin search API) — v0.14.0
- [x] Now Playing queue view — v0.15.0 (Queue tab, card-side, read-only)
- [x] Artist/album "Play all" affordance in Browse — v0.15.0 (Play All + Add All)
- [x] YouTube Music support — v0.16.0 (ytm-service on ska; search + stream via yt-dlp)
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
- [x] localStorage tracking-prevention console spam — v0.17.2 (safe storage wrapper)
- [x] Auto-detect oscillation between two playing speakers (latch) — v0.18.0
- [x] Render-phase side effects / impure `getNowPlaying` (moved to effects) — v0.18.0
- [x] YTM title/art lost after reload (recover from `media_content_id`) — v0.18.0
- [x] Volume slider flooding HA (300ms debounce) — v0.18.0
- [x] Persistent transport on every tab (BottomBar replaces MiniPlayer) — v0.19.0
- [x] Speaker chip model simplified (clean join/unjoin, no rejoin dance) — v0.19.0
- [x] Album thumbnails in Browse (maxHeight/maxWidth + imageTag audit) — v0.19.0
- [~] Queue + YTM now-playing persistence across reload — **intentionally not
  implemented**: `localStorage` is blocked by Edge/Chromium tracking prevention in
  this HA/Edge environment, so card-side queue + `_ytmNowPlaying` are in-memory by
  design (see the v0.17.2 safe storage wrapper). Not a bug.

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
