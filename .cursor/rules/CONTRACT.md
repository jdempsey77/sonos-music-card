---
description: API contracts and data shapes for Sonos Music Card
alwaysApply: true
---

# CONTRACT — Sonos Music Card API Contracts

## Card Config Schema

```typescript
interface SonosMusicCardConfig {
  ma_url?: string;         // Music Assistant base URL (default: auto-detected)
  entity_prefix?: string;  // Sonos entity prefix (default: "media_player.")
}
```

## Music Assistant WebSocket API

### mass/browse — Browse media libraries

**Request:**
```json
{
  "type": "mass/browse",
  "item_type": "library",       // optional — "library" | "artist" | "album" | "track" | "playlist" | "radio"
  "item_id": "",                // optional — ID of item to browse into
  "provider_instance": ""       // optional — filter to specific provider (e.g., "plex", "ytmusic")
}
```

**Response:**
```json
{
  "items": [
    {
      "item_id": "string",
      "name": "string",
      "media_type": "artist|album|track|playlist|radio",
      "uri": "string",
      "image": { "url": "string" },
      "provider": "string"
    }
  ]
}
```

### mass/play_media — Play media on a player

**Service call:**
```json
{
  "domain": "mass",
  "service": "play_media",
  "service_data": {
    "entity_id": "media_player.sonos_living_room",
    "media_id": "plex://track/12345",
    "media_type": "track|album|playlist|radio",
    "enqueue": "play|next|add|replace"
  }
}
```

## Home Assistant Service Calls

### media_player.volume_set
```json
{
  "domain": "media_player",
  "service": "volume_set",
  "service_data": {
    "entity_id": "media_player.sonos_living_room",
    "volume_level": 0.5
  }
}
```

### media_player.join — Group Sonos speakers
```json
{
  "domain": "media_player",
  "service": "join",
  "service_data": {
    "entity_id": "media_player.sonos_living_room",
    "group_members": [
      "media_player.sonos_kitchen",
      "media_player.sonos_bedroom"
    ]
  }
}
```

### media_player.unjoin — Ungroup a Sonos speaker
```json
{
  "domain": "media_player",
  "service": "unjoin",
  "service_data": {
    "entity_id": "media_player.sonos_kitchen"
  }
}
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
- `media_player.float`
- `media_player.garage_2`
- `media_player.office_2`
- `media_player.family_room`
- `media_player.basement_2`

Note: `media_player.living_room` and `media_player.bedroom` are **native Sonos integration**
entities — they do NOT have `mass_player_type` and should not be used for MA API calls.

### Entity state attributes (MA-managed)
`media_title`, `media_artist`, `media_album_name`, `media_content_id`,
`media_duration`, `media_position`, `volume_level`, `group_members`,
`is_volume_muted`, `source_list`, `mass_player_type`, `mass_player_id`.
