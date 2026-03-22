# Sonos Music Card

Custom Home Assistant Lovelace card for Sonos speakers via Music Assistant.

Built with Preact + htm — no build step required.

## Installation

### HACS (recommended)
1. Add this repo as a custom repository in HACS
2. Install "Sonos Music Card"
3. Add the card to your dashboard

### Manual
1. Copy `src/sonos-music-card.js` to `/config/www/community/sonos-music-card/`
2. Add as a Lovelace resource: `/local/community/sonos-music-card/sonos-music-card.js`

## Usage

```yaml
type: custom:sonos-music-card
```

## Features (planned)
- Browse Plex and YouTube Music libraries via Music Assistant
- Queue management with drag-to-reorder
- Multi-room Sonos grouping
- Now-playing bar with album art and progress
