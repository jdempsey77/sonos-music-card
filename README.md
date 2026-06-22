# Sonos Music Card

Custom Home Assistant Lovelace card for Sonos speakers via Music Assistant. Browse and play your Plex and YouTube Music libraries, control playback, manage speaker groups — all from a single card.

## Features

- **Speaker Selection** — select one or more Sonos speakers, group/ungroup with automatic unjoin handling
- **Browse** — hierarchical navigation through your MA library (Artists, Albums, Playlists, Tracks)
- **Now Playing** — album art, transport controls (play/pause/prev/next), shuffle, repeat, seek
- **Volume** — per-speaker volume sliders on speaker cards and Now Playing screen
- **Queue** — collapsible queue view with auto-refresh on track change
- **Filter** — live text filter on browse lists
- **Auto-detect** — automatically selects the currently playing speaker on load

Built with Preact + htm — no build step required. Single JS file.

## Prerequisites

- Home Assistant 2024.1.0+
- [Music Assistant](https://music-assistant.io/) installed and configured
- Plex and/or YouTube Music connected as MA providers
- Sonos speakers added to MA

## Installation

### Manual
1. Copy `src/sonos-music-card.js` to `/config/www/community/sonos-music-card/`
2. Add as a Lovelace resource: `/local/community/sonos-music-card/sonos-music-card.js`
3. Set resource type to **JavaScript Module**

### HACS (coming soon)
1. Add this repo as a custom repository in HACS
2. Install "Sonos Music Card"
3. Add the card to your dashboard

## Usage

```yaml
type: custom:sonos-music-card
```

No configuration required. The card auto-detects MA-managed speakers via the `mass_player_type` entity attribute.

## Development

```bash
# Set your HA long-lived access token
export HA_TOKEN=<your_token>

# Deploy and auto-bump resource cache version
./scripts/deploy.sh

# Reload in browser
# Cmd+R (not Cmd+Shift+R — that clears the session cookie)
```

### Architecture
- Single file: `src/sonos-music-card.js`
- No build step — Preact + htm loaded via ESM from esm.sh CDN
- Module-level `_smcSpeakers` array as single source of truth for speaker selection
- `hasMediaContext()` handles MA's `idle + media_title` as paused state
- Browse drill-down uses `item.media_class` (not `media_content_type`) as the type parameter
