---
description: API contracts and data shapes for Sonos Music Card
alwaysApply: true
---

# CONTRACT — Sonos Music Card API Contracts

## Card Config Schema

```typescript
interface SonosMusicCardConfig {
  entity_id?: string;  // Override MA entity for browse (default: auto-detect via mass_player_type)
}
```

## Browse API — media_player/browse_media

All browsing uses HA's standard `media_player/browse_media` WebSocket command.
MA hooks into this via its `media_browser.py` integration.

### Root browse (no content params)
```javascript
hass.callWS({
  type: 'media_player/browse_media',
  entity_id: 'media_player.family_room',
  // NO media_content_id or media_content_type for root
})
```

Returns `{ children: [...] }` — root items include MA categories + HA sources.
Filter to MA categories by title: Artists, Albums, Tracks, Playlists, Radio stations, etc.

### Drill-down browse

**CRITICAL: Use `item.media_class` as `media_content_type`, NOT `item.media_content_type`.**
Exception: if `media_class === 'directory'`, use `item.media_content_type` instead.

```javascript
const drillType = item.media_class && item.media_class !== 'directory'
  ? item.media_class
  : item.media_content_type;

hass.callWS({
  type: 'media_player/browse_media',
  entity_id: entityId,
  media_content_id: item.media_content_id,
  media_content_type: drillType,
})
```

### Verified browse tree (from browse-test.html mapping)

| Level | media_content_id | media_content_type for drill | media_class |
|---|---|---|---|
| Root category (Artists) | `artists` | `music_assistant` | `directory` |
| Artist item | `library://artist/38` | `artist` | `artist` |
| Album item | `plex--xxx://album//...` | `album` | `album` |
| Track item | `plex--xxx://track//...` | `music` (playable) | `track` |

### Browse response item shape
```typescript
interface BrowseMediaItem {
  title: string;
  media_content_id: string;
  media_content_type: string;   // DO NOT use for drill-down — use media_class instead
  media_class: string;          // USE THIS for drill-down type
  can_play: boolean;
  can_expand: boolean;
  thumbnail?: string;           // MA image proxy URL (may need auth)
  children?: BrowseMediaItem[]; // only on expanded results
}
```

## Play API — media_player.play_media

```javascript
hass.callService('media_player', 'play_media', {
  entity_id: 'media_player.family_room',
  media_content_id: item.media_content_id,
  media_content_type: item.media_content_type,
});
```

## Home Assistant Service Calls

### media_player.volume_set
```javascript
hass.callService('media_player', 'volume_set', {
  entity_id: 'media_player.family_room',
  volume_level: 0.5,  // 0.0 to 1.0
});
```

### media_player.join — Group Sonos speakers
```javascript
hass.callService('media_player', 'join', {
  entity_id: primarySpeaker,
  group_members: allSelectedSpeakers,
});
```

### media_player.unjoin — Ungroup a speaker
```javascript
hass.callService('media_player', 'unjoin', {
  entity_id: speakerToRemove,
});
```

### media_player.media_play_pause
```javascript
hass.callService('media_player', 'media_play_pause', {
  entity_id: entityId,
});
```

## MA Entity Detection

Music Assistant injects `mass_player_type: "player"` into every entity it manages.
Use this attribute to detect MA entities — **do not match by entity name**.

```javascript
const maPlayers = Object.entries(hass.states)
  .filter(([id, state]) =>
    id.startsWith('media_player.') &&
    state.attributes.mass_player_type === 'player'
  )
  .map(([id]) => id);
```

### Known MA-managed Sonos entities (this HA instance)
- `media_player.float` — Sonos Roam (portable)
- `media_player.garage_2` — Garage
- `media_player.office_2` — Office
- `media_player.family_room` — Family Room (Arc)
- `media_player.basement_2` — Basement

Note: `media_player.living_room` and `media_player.bedroom` are **native Sonos integration**
entities — they do NOT have `mass_player_type` and should not be used for MA API calls.

### Entity state attributes (MA-managed)
`media_title`, `media_artist`, `media_album_name`, `media_content_id`,
`media_duration`, `media_position`, `volume_level`, `group_members`,
`is_volume_muted`, `source_list`, `mass_player_type`, `mass_player_id`.
