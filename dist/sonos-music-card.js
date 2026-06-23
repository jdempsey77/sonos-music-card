// Sonos Music Card v0.16.5
// Preact + htm, no build step — Custom HA Lovelace card for Sonos.
// Control/transport via native HA media_player services; media browsing via
// Jellyfin API (direct HTTP from the card); playback via HA play_media of a
// Jellyfin stream URL the speakers fetch directly. No Music Assistant.
// v0.16.0 adds a YouTube Music tab backed by ytm-service on ska (ytmusicapi
// search + yt-dlp stream resolution); speakers fetch the googlevideo m4a URL.

import { h, render } from 'https://esm.sh/preact@10';
import { useState, useEffect, useCallback, useMemo, useRef } from 'https://esm.sh/preact@10/hooks';
import htm from 'https://esm.sh/htm@3';

const html = htm.bind(h);

// ── Card config (set in setConfig, read module-wide) ────────────
let _smcConfig = {};

// ── Jellyfin config + client ────────────────────────────────────
let _jellyfinUrl = null;          // public, browser-facing (browse + images)
let _jellyfinInternalUrl = null;  // speaker-facing base for stream URLs
let _jellyfinToken = null;
let _jellyfinUserId = null;

// ── YouTube Music config ────────────────────────────────────────
// ytm-service on ska: ytmusicapi search + yt-dlp stream resolution, exposed at
// ska.hq.stylee.org/ytm/. Speakers fetch the resolved googlevideo m4a URL.
let _ytmServiceUrl = null;        // browser-facing base, e.g. https://ska.hq.stylee.org/ytm
// Jellyfin item id of the track we last started from Browse. Sonos doesn't
// reflect Jellyfin cover art back through HA (entity_picture is null), so we
// use this to source the Now Playing art ourselves. Cleared when idle.
let _smcNowPlayingJfId = null;

// YTM now-playing metadata — set when a YTM track starts, cleared when Jellyfin
// playback starts or the player goes idle. HA reports the raw stream URL as
// media_title for YTM tracks, so we substitute this in buildNpInfo().
let _ytmNowPlaying = null;  // {title, artist, thumbnail} | null

// ── Card-side queue (Branch B) ──────────────────────────────────
// HA exposes no full-queue read for these entities: the card's configured
// speakers are music_assistant-platform entities (sonos.get_queue rejects them),
// and music_assistant.get_queue returns only current_item + next_item with null
// images — not the full list. So we track what WE enqueue ourselves. The Queue
// tab reads these directly; no API call needed.
let _smcQueue = [];           // [{id, name, subtitle, imageTag}] — Jellyfin tracks we enqueued
let _smcQueueEntityId = null; // which speaker the Jellyfin queue belongs to (scopes validity)

// Parallel YTM queue — same idea, different shape (external thumbnails, videoIds).
let _ytmQueue = [];           // [{videoId, title, artist, thumbnail}]
let _ytmQueueEntityId = null; // which speaker the YTM queue belongs to

// Normalize a YTM search/album row ({id|videoId, title, artist, thumbnail}) into
// a queue item.
function toYtmQueueItem(t) {
  return {
    videoId: t.videoId || t.id,
    title: t.title || null,
    artist: t.artist || null,
    thumbnail: t.thumbnail || null,
  };
}

// Which source is currently active (drives the Queue tab). YTM wins if it has a
// queue or a stored now-playing track; otherwise Jellyfin if it does.
function activeSource() {
  if (_ytmQueue.length > 0 || _ytmNowPlaying) return 'ytm';
  if (_smcQueue.length > 0 || _smcNowPlayingJfId) return 'jellyfin';
  return null;
}

// GET against the Jellyfin API. Auth via api_key query param (not a custom
// header) so the browser issues a simple CORS GET with no preflight.
async function jfGet(path) {
  if (!_jellyfinUrl || !_jellyfinToken) return null;
  const sep = path.includes('?') ? '&' : '?';
  try {
    const r = await fetch(`${_jellyfinUrl}${path}${sep}api_key=${encodeURIComponent(_jellyfinToken)}`);
    return r.ok ? r.json() : null;
  } catch { return null; }
}

async function jfGetUserId() {
  if (_jellyfinUserId) return _jellyfinUserId;
  // A jellyfin_user_id config override wins if set.
  if (_smcConfig?.jellyfin_user_id) {
    _jellyfinUserId = _smcConfig.jellyfin_user_id;
    return _jellyfinUserId;
  }
  // API keys aren't tied to a user, so /Users/Me is invalid (400). Pick a user
  // from /Users, preferring an administrator (sees all libraries).
  const users = await jfGet('/Users');
  if (Array.isArray(users) && users.length) {
    const admin = users.find(u => u?.Policy?.IsAdministrator);
    _jellyfinUserId = (admin || users[0]).Id || null;
  }
  return _jellyfinUserId;
}

// Primary image (public endpoint — no token required).
function jfImageUrl(itemId, tag) {
  if (!_jellyfinUrl || !itemId) return null;
  let u = `${_jellyfinUrl}/Items/${itemId}/Images/Primary?fillHeight=96&fillWidth=96&quality=90`;
  if (tag) u += `&tag=${encodeURIComponent(tag)}`;
  return u;
}

// Speaker-facing stream URL — uses the internal Jellyfin base so the Sonos
// speakers (on a different VLAN) can fetch it directly. mp3 transcode is the
// most reliable container for Sonos over plain HTTP.
function jfStreamUrl(itemId) {
  return `${_jellyfinInternalUrl}/Audio/${itemId}/stream.mp3?api_key=${encodeURIComponent(_jellyfinToken)}&audioCodec=mp3&Container=mp3`;
}

// Full-size cover art for the currently-playing Jellyfin track (public base —
// browser-facing). Used as a fallback when HA gives us no entity_picture.
function jfNowPlayingArt() {
  if (!_smcNowPlayingJfId || !_jellyfinUrl) return null;
  return `${_jellyfinUrl}/Items/${_smcNowPlayingJfId}/Images/Primary?api_key=${encodeURIComponent(_jellyfinToken)}`;
}

// Build normalized browse rows for a navigation frame.
async function jfFetchRows(frame) {
  const uid = await jfGetUserId();
  switch (frame.kind) {
    case 'root': {
      const data = await jfGet(`/Users/${uid}/Views`);
      const views = (data?.Items || []).filter(v => v.CollectionType === 'music');
      return views.map(v => ({
        id: v.Id, name: v.Name, subtitle: 'Library',
        imageTag: v.ImageTags?.Primary,
        next: { kind: 'library', title: v.Name, libId: v.Id },
      }));
    }
    case 'library':
      return [
        { id: 'cat-artists', name: 'Artists', icon: '\u{1F3A4}', next: { kind: 'artists', title: 'Artists', libId: frame.libId } },
        { id: 'cat-albums', name: 'Albums', icon: '\u{1F4BF}', next: { kind: 'albums', title: 'Albums', libId: frame.libId } },
        { id: 'cat-playlists', name: 'Playlists', icon: '\u{1F3B5}', next: { kind: 'playlists', title: 'Playlists', libId: frame.libId } },
      ];
    case 'artists': {
      const data = await jfGet(`/Artists?ParentId=${frame.libId}&Recursive=true&SortBy=SortName&SortOrder=Ascending&Limit=2000&UserId=${uid}`);
      return collapseFeaturingArtists((data?.Items || []).map(a => ({
        id: a.Id, name: a.Name, subtitle: 'Artist',
        imageTag: a.ImageTags?.Primary,
        next: { kind: 'artist', title: a.Name, artistId: a.Id },
      })));
    }
    case 'albums': {
      const data = await jfGet(`/Items?ParentId=${frame.libId}&IncludeItemTypes=MusicAlbum&Recursive=true&SortBy=SortName&SortOrder=Ascending&Limit=2000&UserId=${uid}`);
      return (data?.Items || []).map(al => ({
        id: al.Id, name: al.Name, subtitle: al.AlbumArtist || 'Album',
        imageTag: al.ImageTags?.Primary,
        next: { kind: 'album', title: al.Name, albumId: al.Id },
      }));
    }
    case 'playlists': {
      const data = await jfGet(`/Items?IncludeItemTypes=Playlist&Recursive=true&SortBy=SortName&Limit=500&UserId=${uid}`);
      return (data?.Items || []).map(pl => ({
        id: pl.Id, name: pl.Name, subtitle: 'Playlist',
        imageTag: pl.ImageTags?.Primary,
        next: { kind: 'playlist', title: pl.Name, playlistId: pl.Id },
      }));
    }
    case 'artist': {
      const data = await jfGet(`/Items?AlbumArtistIds=${frame.artistId}&IncludeItemTypes=MusicAlbum&Recursive=true&SortBy=PremiereDate,ProductionYear,SortName&SortOrder=Descending&Limit=500&UserId=${uid}`);
      return (data?.Items || []).map(al => ({
        id: al.Id, name: al.Name, subtitle: al.ProductionYear ? String(al.ProductionYear) : 'Album',
        imageTag: al.ImageTags?.Primary,
        next: { kind: 'album', title: al.Name, albumId: al.Id },
      }));
    }
    case 'album': {
      const data = await jfGet(`/Items?ParentId=${frame.albumId}&IncludeItemTypes=Audio&SortBy=ParentIndexNumber,IndexNumber,SortName&Limit=500&UserId=${uid}`);
      const items = data?.Items || [];
      const trackIds = items.map(t => t.Id);
      return items.map((t, i) => ({
        id: t.Id, name: t.Name, track: true, trackIds, trackIndex: i,
        subtitle: (t.Artists && t.Artists.join(', ')) || t.AlbumArtist || '',
        imageTag: t.ImageTags?.Primary,
      }));
    }
    case 'playlist': {
      const data = await jfGet(`/Playlists/${frame.playlistId}/Items?UserId=${uid}&Limit=1000`);
      const items = data?.Items || [];
      const trackIds = items.map(t => t.Id);
      return items.map((t, i) => ({
        id: t.Id, name: t.Name, track: true, trackIds, trackIndex: i,
        subtitle: (t.Artists && t.Artists.join(', ')) || '',
        imageTag: t.ImageTags?.Primary,
      }));
    }
    default:
      return [];
  }
}

// Full-text search across the music library. Returns items split by Type.
async function jfSearch(term) {
  const uid = await jfGetUserId();
  const data = await jfGet(`/Items?searchTerm=${encodeURIComponent(term)}&IncludeItemTypes=Audio,MusicAlbum,MusicArtist&Recursive=true&Limit=50&UserId=${uid}`);
  const items = data?.Items || [];
  return {
    artists: items.filter(i => i.Type === 'MusicArtist'),
    albums: items.filter(i => i.Type === 'MusicAlbum'),
    tracks: items.filter(i => i.Type === 'Audio'),
  };
}

// Normalize a track to the card-side queue shape.
function toQueueItem(t) {
  return { id: t.id, name: t.name, subtitle: t.subtitle || '', imageTag: t.imageTag || null };
}

// Play a list of Jellyfin tracks from startIndex via HA. `tracks` is an array of
// {id, name, subtitle, imageTag}. The first track replaces the queue; the rest
// are appended best-effort (Sonos supports enqueue=add). Sets _smcNowPlayingJfId
// so Now Playing can source cover art from Jellyfin, and rebuilds the card-side
// queue (a fresh "play" replaces it — see Branch B note above).
async function playJfTracks(hass, eid, tracks, startIndex = 0) {
  if (!hass || !eid || !tracks?.length) return;
  _ytmNowPlaying = null;        // clear YTM metadata — Jellyfin is now the source
  _ytmDirty = true;
  _ytmQueue = [];
  _ytmQueueEntityId = null;
  const slice = tracks.slice(startIndex);
  const ids = slice.map(t => t.id);
  try {
    await hass.callService('media_player', 'play_media', {
      entity_id: eid,
      media_content_id: jfStreamUrl(ids[0]),
      media_content_type: 'music',
    });
    _smcNowPlayingJfId = ids[0];
    _smcQueue = slice.map(toQueueItem);
    _smcQueueEntityId = eid;
  } catch (err) {
    console.error('[smc] play failed:', err);
    return;
  }
  for (let i = 1; i < ids.length; i++) {
    try {
      await hass.callService('media_player', 'play_media', {
        entity_id: eid,
        media_content_id: jfStreamUrl(ids[i]),
        media_content_type: 'music',
        enqueue: 'add',
      });
    } catch { break; }
  }
}

// Append tracks to the current queue without interrupting playback (enqueue=add).
// Mirrors the appended tracks into the card-side queue. Returns the count added.
async function enqueueJfTracks(hass, eid, tracks) {
  if (!hass || !eid || !tracks?.length) return 0;
  // If the card-side queue is for a different speaker, this enqueue starts a
  // fresh card-side queue scoped to eid.
  if (_smcQueueEntityId !== eid) { _smcQueue = []; _smcQueueEntityId = eid; }
  let added = 0;
  for (const t of tracks) {
    try {
      await hass.callService('media_player', 'play_media', {
        entity_id: eid,
        media_content_id: jfStreamUrl(t.id),
        media_content_type: 'music',
        enqueue: 'add',
      });
      _smcQueue.push(toQueueItem(t));
      added++;
    } catch { break; }
  }
  return added;
}

// Jump to a queue track: play it immediately, replacing the current track (no
// enqueue). Leaves the card-side queue list intact so the Queue tab still shows
// it; updates the now-playing art id so the highlight follows.
async function jumpToQueueTrack(hass, eid, track) {
  if (!hass || !eid || !track) return;
  try {
    await hass.callService('media_player', 'play_media', {
      entity_id: eid,
      media_content_id: jfStreamUrl(track.id),
      media_content_type: 'music',
    });
    _smcNowPlayingJfId = track.id;
  } catch (err) { console.error('[smc] jump failed:', err); }
}

// Collect every track for an artist (all albums, in album order) as queue items.
// Used by Play All / Add All at the artist drill level.
async function jfArtistTracks(artistId) {
  const uid = await jfGetUserId();
  const albumsData = await jfGet(`/Items?AlbumArtistIds=${artistId}&IncludeItemTypes=MusicAlbum&Recursive=true&SortBy=PremiereDate,ProductionYear,SortName&SortOrder=Descending&Limit=500&UserId=${uid}`);
  const albums = albumsData?.Items || [];
  const out = [];
  for (const al of albums) {
    const data = await jfGet(`/Items?ParentId=${al.Id}&IncludeItemTypes=Audio&SortBy=ParentIndexNumber,IndexNumber,SortName&Limit=500&UserId=${uid}`);
    for (const t of (data?.Items || [])) {
      out.push({
        id: t.Id, name: t.Name,
        subtitle: (t.Artists && t.Artists.join(', ')) || t.AlbumArtist || '',
        imageTag: t.ImageTags?.Primary,
      });
    }
  }
  return out;
}

// ── YouTube Music client (ytm-service) ──────────────────────────
// All endpoints are simple CORS GETs (the service returns Access-Control-Allow-
// Origin: *). Failures degrade to empty results / null rather than throwing.
async function ytmSearch(q, type = 'songs') {
  if (!_ytmServiceUrl) return { results: [] };
  try {
    const r = await fetch(`${_ytmServiceUrl}/search?q=${encodeURIComponent(q)}&type=${type}`);
    return r.ok ? r.json() : { results: [] };
  } catch { return { results: [] }; }
}

async function ytmAlbumTracks(browseId) {
  if (!_ytmServiceUrl) return { tracks: [] };
  try {
    const r = await fetch(`${_ytmServiceUrl}/album/${encodeURIComponent(browseId)}`);
    return r.ok ? r.json() : { tracks: [] };
  } catch { return { tracks: [] }; }
}

// Resolve a direct audio stream URL via yt-dlp (~1-3s). Returns null on failure.
async function ytmStreamUrl(videoId) {
  if (!_ytmServiceUrl) return null;
  try {
    const r = await fetch(`${_ytmServiceUrl}/stream/${encodeURIComponent(videoId)}`);
    if (!r.ok) return null;
    const data = await r.json();
    return data.url || null;
  } catch { return null; }
}

// Play a single YTM track: resolve its stream URL, then hand the raw googlevideo
// URL to the speaker via HA play_media. A different source from Jellyfin, so we
// clear the Jellyfin now-playing art id and card-side queue. Returns true on
// success. yt-dlp prefers m4a/AAC, which Sonos plays natively.
async function playYtmTrack(hass, eid, videoId, meta = {}, queue = null) {
  if (!hass || !eid || !videoId) return false;
  if (!_ytmServiceUrl) { console.error('[smc] YTM service URL not configured'); return false; }
  const url = `${_ytmServiceUrl}/audio/${encodeURIComponent(videoId)}.m4a`;
  // HA reports the raw stream URL as media_title for YTM tracks, so stash the
  // real title/artist/art to substitute in Now Playing (see buildNpInfo).
  _ytmNowPlaying = { videoId, title: meta.title || null, artist: meta.artist || null, thumbnail: meta.thumbnail || null };
  _ytmDirty = true;
  // Populate the YTM queue: the full album list if given (Play All), else this
  // one track (single tap). We don't pre-resolve the album — yt-dlp is ~1-3s per
  // track — so the queue is metadata-only; tracks stream in via enqueue.
  _ytmQueue = (queue && queue.length) ? queue.map(toYtmQueueItem) : [toYtmQueueItem({ videoId, ...meta })];
  _ytmQueueEntityId = eid;
  _smcNowPlayingJfId = null;   // different source — drop Jellyfin art
  _smcQueue = [];              // different source — drop Jellyfin queue
  _smcQueueEntityId = null;
  try {
    await hass.callService('media_player', 'play_media', {
      entity_id: eid,
      media_content_id: url,
      media_content_type: 'music',
    });
    return true;
  } catch (err) {
    console.error('[smc] YTM play failed:', err);
    return false;
  }
}

// Index of a featuring marker in an artist name, handling both spellings
// Jellyfin uses: " feat." and " featuring ". Returns the earliest, or -1.
function getFeatIndex(name) {
  const lower = name.toLowerCase();
  const i1 = lower.indexOf(' feat.');
  const i2 = lower.indexOf(' featuring ');
  if (i1 === -1 && i2 === -1) return -1;
  if (i1 === -1) return i2;
  if (i2 === -1) return i1;
  return Math.min(i1, i2);
}

// Collapse "Artist feat. X" variants under the base artist so the Artists list
// isn't polluted by featuring credits.
function collapseFeaturingArtists(artists) {
  const base = new Map(); // baseName -> row
  const result = [];
  for (const a of artists) {
    const featIdx = getFeatIndex(a.name);
    if (featIdx !== -1) {
      const baseName = a.name.slice(0, featIdx).trim();
      if (base.has(baseName)) {
        // silently drop — already have the base artist
        continue;
      }
      // No base artist yet — keep but rename to base name
      // (covers edge case: "2Pac feat. X" appears before "2Pac" in sorted list)
      const collapsed = { ...a, name: baseName };
      base.set(baseName, collapsed);
      result.push(collapsed);
    } else {
      if (base.has(a.name)) {
        // Base artist already added via a feat. entry — replace with the real entry
        const idx = result.findIndex(r => r.id === base.get(a.name).id);
        if (idx !== -1) result[idx] = a;
        base.set(a.name, a);
      } else {
        base.set(a.name, a);
        result.push(a);
      }
    }
  }
  return result;
}

// ── Theme tokens ────────────────────────────────────────────────
const THEME = {
  base: '#111111',
  surface: '#1c1c1c',
  border: '#2e2e2e',
  primary: '#3b82f6',
  primaryBg: '#0f1f3d',
  primaryLight: '#bfdbfe',
  accent: '#14b8a6',
  accentBg: '#0d1f1d',
  accentDark: '#042f2a',
  text: '#e5e5e5',
  textBright: '#ffffff',
  textSpeaker: '#d4d4d4',
  muted: '#737373',
  statusMuted: '#525252',
  statusSelected: '#93c5fd',
  chevron: '#404040',
  placeholder: '#404040',
  pillInactive: '#1c1c1c',
  miniPlayerBg: '#161616',
  navBg: '#0a0a0a',
  error: '#ef4444',
  radiusCard: '12px',
  radiusEl: '8px',
  font: 'system-ui, -apple-system, sans-serif',
};

// ── SVG Icons ───────────────────────────────────────────────────
const IconSpeaker = () => html`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="6"/></svg>`;
const IconBrowse = () => html`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`;
const IconNowPlaying = () => html`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
const IconSearch = () => html`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
const IconQueue = () => html`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`;
const IconPlay = ({ size = 18 } = {}) => html`<svg width=${size} height=${size} viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
const IconPause = ({ size = 18 } = {}) => html`<svg width=${size} height=${size} viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
const IconPrev = () => html`<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="3" y="5" width="3" height="14"/><polygon points="21 5 9 12 21 19 21 5"/></svg>`;
const IconNext = () => html`<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="18" y="5" width="3" height="14"/><polygon points="3 5 15 12 3 19 3 5"/></svg>`;
const IconShuffle = () => html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>`;
const IconRepeat = () => html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`;
const IconChevron = () => html`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
const IconMusicNote = () => html`<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
const IconYTM = () => html`<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.54 3.5 12 3.5 12 3.5s-7.54 0-9.38.55A3.02 3.02 0 0 0 .5 6.19C0 8.04 0 12 0 12s0 3.96.5 5.81a3.02 3.02 0 0 0 2.12 2.14C4.46 20.5 12 20.5 12 20.5s7.54 0 9.38-.55a3.02 3.02 0 0 0 2.12-2.14C24 15.96 24 12 24 12s0-3.96-.5-5.81zM9.75 15.5v-7l6.5 3.5-6.5 3.5z"/></svg>`;

// ── Styles ──────────────────────────────────────────────────────
const cardStyles = `
  :host {
    display: block;
    font-family: ${THEME.font};
    color: ${THEME.text};
  }
  .smc-card {
    background: ${THEME.base};
    border: 1px solid ${THEME.border};
    border-radius: ${THEME.radiusCard};
    min-height: 400px;
    height: 600px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
  }
  .smc-content {
    flex: 1;
    overflow-y: auto;
    padding: 20px 16px;
    padding-bottom: 60px;
    min-height: 0;
  }
  .smc-header {
    font-size: 14px; font-weight: 600; color: ${THEME.muted};
    text-transform: uppercase; letter-spacing: 1px; margin: 0 0 16px 4px;
  }

  /* ── Speaker checkbox list ── */
  .smc-spk-header {
    display: flex; align-items: center;
    justify-content: space-between;
    padding: 8px 14px 4px;
  }
  .smc-spk-title {
    font-size: 10px; color: ${THEME.muted};
    text-transform: uppercase; letter-spacing: 0.1em;
  }
  .smc-spk-quick {
    display: flex; gap: 6px; font-size: 10px; cursor: pointer;
  }
  .smc-spk-quick span:first-child { color: ${THEME.primary}; }
  .smc-spk-group-label {
    padding: 6px 14px 2px;
    font-size: 9px; color: #404040;
    text-transform: uppercase; letter-spacing: 0.12em;
  }
  .smc-spk-row {
    display: flex; align-items: center; gap: 10px;
    padding: 9px 14px; cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .smc-spk-row:hover { background: #161616; }
  .smc-spk-row.selected { background: #0f1f3d; }
  .smc-chk {
    width: 18px; height: 18px; border-radius: 4px;
    border: 1.5px solid ${THEME.border};
    background: ${THEME.surface};
    flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    font-size: 10px; font-weight: 700;
  }
  .smc-chk.checked {
    background: ${THEME.primary};
    border-color: ${THEME.primary};
    color: white;
  }
  .smc-spk-icon {
    width: 32px; height: 32px; border-radius: 6px;
    background: ${THEME.surface}; border: 1px solid ${THEME.border};
    flex-shrink: 0; display: flex; align-items: center;
    justify-content: center; font-size: 11px; color: #404040;
  }
  .smc-spk-info { flex: 1; min-width: 0; }
  .smc-spk-name {
    font-size: 13px; color: ${THEME.text};
    margin: 0; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis;
  }
  .smc-spk-name.muted { color: ${THEME.muted}; }
  .smc-spk-sub { font-size: 10px; color: ${THEME.muted}; margin: 2px 0 0; }
  .smc-spk-sub.playing { color: ${THEME.primary}; }
  .smc-spk-sub.off { color: #404040; }
  .smc-spk-vol { font-size: 10px; color: ${THEME.muted}; flex-shrink: 0; }
  .smc-spk-divider { height: 1px; background: #1a1a1a; margin: 4px 14px; }

  /* ── Group bar ── */
  .smc-group-bar {
    position: absolute; bottom: 0; left: 0; right: 0;
    background: ${THEME.accent}; color: ${THEME.accentDark};
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 16px; font-size: 13px; font-weight: 600;
    z-index: 2; cursor: pointer;
  }
  .smc-group-bar:active { opacity: 0.85; }
  .smc-group-names { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 400; margin-right: 12px; }
  .smc-group-action { font-weight: 700; white-space: nowrap; font-size: 13px; }
  .smc-group-warn { font-size: 9px; opacity: 0.7; font-weight: 400; margin-top: 2px; }

  /* ── Top nav tabs ── */
  .smc-nav {
    background: ${THEME.base};
    display: flex; gap: 6px; padding: 12px 16px 8px;
    flex-shrink: 0; z-index: 3;
    flex-wrap: wrap;   /* 6 tabs: wrap to a second row on narrow cards */
  }
  .smc-nav-item {
    display: flex; align-items: center; gap: 5px;
    cursor: pointer; color: ${THEME.muted}; font-size: 11px; font-weight: 500;
    padding: 6px 14px; border-radius: 20px;
    background: ${THEME.surface}; border: 1px solid ${THEME.border};
    -webkit-tap-highlight-color: transparent;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .smc-nav-item.active {
    color: ${THEME.primaryLight}; background: ${THEME.primary};
    border-color: ${THEME.primary};
  }
  .smc-nav-item svg { width: 14px; height: 14px; }

  /* ── Browse ── */
  .smc-breadcrumb {
    display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
    font-size: 10px; color: ${THEME.statusMuted}; margin-bottom: 12px; padding: 0 4px;
  }
  .smc-breadcrumb-item { cursor: pointer; -webkit-tap-highlight-color: transparent; }
  .smc-breadcrumb-item:hover { color: ${THEME.text}; }
  .smc-breadcrumb-item.current { color: ${THEME.statusSelected}; cursor: default; }
  .smc-breadcrumb-sep { color: ${THEME.chevron}; }
  .smc-section-label {
    font-size: 10px; color: ${THEME.statusMuted}; text-transform: uppercase;
    letter-spacing: 0.1em; margin: 16px 0 8px 4px;
  }
  .smc-section-label:first-of-type { margin-top: 0; }
  .smc-browse-list { display: flex; flex-direction: column; }
  .smc-browse-row {
    display: flex; align-items: center; gap: 12px;
    padding: 8px 8px; border-radius: ${THEME.radiusEl};
    cursor: pointer; -webkit-tap-highlight-color: transparent;
  }
  .smc-browse-row:active { background: ${THEME.surface}; }
  .smc-browse-thumb {
    width: 38px; height: 38px; border-radius: 6px;
    object-fit: cover; flex-shrink: 0; background: ${THEME.surface};
  }
  .smc-browse-thumb-placeholder {
    width: 38px; height: 38px; border-radius: 6px;
    background: ${THEME.surface}; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    color: ${THEME.chevron}; font-size: 16px;
  }
  .smc-browse-info { flex: 1; min-width: 0; }
  .smc-browse-title { font-size: 13px; color: ${THEME.text}; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .smc-browse-subtitle { font-size: 11px; color: ${THEME.statusMuted}; margin: 2px 0 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .smc-browse-chevron { color: ${THEME.chevron}; font-size: 14px; flex-shrink: 0; }
  .smc-loading { text-align: center; padding: 40px 0; color: ${THEME.muted}; font-size: 13px; }

  /* ── Mini-player ── */
  .smc-mini-player {
    background: ${THEME.miniPlayerBg}; border-top: 2px solid ${THEME.primary};
    display: flex; align-items: center; gap: 10px;
    padding: 8px 12px; cursor: pointer; -webkit-tap-highlight-color: transparent;
  }
  .smc-mini-art {
    width: 36px; height: 36px; border-radius: 6px;
    object-fit: cover; background: ${THEME.surface}; flex-shrink: 0;
  }
  .smc-mini-art-placeholder { width: 36px; height: 36px; border-radius: 6px; background: ${THEME.surface}; flex-shrink: 0; }
  .smc-mini-info { flex: 1; min-width: 0; }
  .smc-mini-title { font-size: 12px; color: ${THEME.text}; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .smc-mini-artist { font-size: 10px; color: ${THEME.statusMuted}; margin: 1px 0 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .smc-mini-btn {
    background: none; border: none; color: ${THEME.text};
    cursor: pointer; padding: 6px; display: flex; align-items: center;
    -webkit-tap-highlight-color: transparent;
  }
  .smc-mini-btn:active { opacity: 0.7; }

  /* ── Now Playing ── */
  .np-scroll {
    flex: 1; overflow-y: auto; min-height: 0;
    display: flex; flex-direction: column; align-items: center;
    padding: 16px; padding-bottom: 60px;
  }
  .np-art-square {
    width: 160px; height: 160px; border-radius: 12px;
    object-fit: cover; background: ${THEME.surface};
    display: block; flex-shrink: 0;
  }
  .np-art-square-placeholder {
    width: 160px; height: 160px; border-radius: 12px;
    background: ${THEME.surface}; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    color: ${THEME.chevron};
  }
  .np-track-info { width: 100%; text-align: center; margin-top: 16px; }
  .np-title { font-size: 15px; font-weight: 500; color: ${THEME.textBright}; margin: 0; }
  .np-artist { font-size: 12px; color: ${THEME.muted}; margin: 4px 0 0; }

  /* Progress bar */
  .np-progress { width: 100%; padding: 20px 0 0; }
  .np-progress-bar {
    width: 100%; height: 3px; background: ${THEME.border}; border-radius: 2px;
    position: relative; cursor: pointer; -webkit-tap-highlight-color: transparent;
  }
  .np-progress-fill {
    height: 100%; background: ${THEME.primary}; border-radius: 2px;
    position: relative; transition: width 0.3s linear;
  }
  .np-progress-dot {
    position: absolute; right: -5px; top: -4px;
    width: 11px; height: 11px; border-radius: 50%;
    background: ${THEME.primary};
  }
  .np-progress-times {
    display: flex; justify-content: space-between;
    font-size: 9px; color: ${THEME.statusMuted}; margin-top: 4px;
  }

  /* Transport controls */
  .np-transport {
    display: flex; align-items: center; justify-content: center;
    gap: 24px; padding: 16px 0;
  }
  .np-transport-btn {
    background: none; border: none; color: ${THEME.muted}; cursor: pointer;
    padding: 8px; display: flex; align-items: center;
    -webkit-tap-highlight-color: transparent;
  }
  .np-transport-btn:active { opacity: 0.7; }
  .np-transport-btn.active { color: ${THEME.primary}; }
  .np-play-btn {
    width: 44px; height: 44px; border-radius: 50%;
    background: ${THEME.primary}; border: none; color: #fff;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; -webkit-tap-highlight-color: transparent;
  }
  .np-play-btn:active { opacity: 0.85; }
  .np-repeat-badge {
    font-size: 7px; font-weight: 700; position: absolute;
    bottom: -2px; right: -2px; background: ${THEME.primary};
    color: #fff; border-radius: 4px; padding: 0 3px; line-height: 1.4;
  }

  /* Volume section */
  .np-volume-section { width: 100%; padding: 8px 0 16px; }
  .np-volume-label {
    font-size: 10px; color: ${THEME.statusMuted}; text-transform: uppercase;
    letter-spacing: 0.1em; margin-bottom: 10px;
  }
  .np-volume-row {
    display: flex; align-items: center; gap: 10px; margin-bottom: 10px;
  }
  .np-volume-name { font-size: 11px; color: ${THEME.muted}; width: 70px; flex-shrink: 0;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .np-volume-slider {
    flex: 1; height: 3px; -webkit-appearance: none; appearance: none;
    background: ${THEME.border}; border-radius: 2px; outline: none;
    cursor: pointer;
  }
  .np-volume-slider::-webkit-slider-thumb {
    -webkit-appearance: none; width: 12px; height: 12px;
    border-radius: 50%; background: ${THEME.primary}; cursor: pointer;
  }
  .np-volume-value { font-size: 10px; color: ${THEME.statusMuted}; width: 28px; text-align: right; }

  /* Nothing playing */
  .np-empty {
    flex: 1; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 16px;
    padding: 60px 20px; color: ${THEME.muted};
  }
  .np-empty-text { font-size: 14px; }
  .np-empty-btn {
    padding: 8px 20px; border-radius: 20px;
    background: ${THEME.primary}; color: #fff; border: none;
    font-size: 13px; font-weight: 500; cursor: pointer;
  }

  /* ── Tab visibility ── */
  .smc-tab-panel { display: flex; flex-direction: column; flex: 1; overflow: hidden; min-height: 0; }
  .smc-tab-panel.hidden { display: none; }

  .smc-error { color: ${THEME.error}; font-size: 13px; text-align: center; padding: 20px; }

  /* ── Search ── */
  .smc-search-box {
    padding: 12px 16px 8px;
    flex-shrink: 0;
  }
  .smc-search-input {
    width: 100%;
    box-sizing: border-box;
    background: #1c1c1c;
    border: 1px solid #2e2e2e;
    border-radius: 8px;
    color: #e5e5e5;
    font-size: 13px;
    padding: 8px 12px;
    outline: none;
    font-family: inherit;
  }
  .smc-search-input:focus { border-color: #3b82f6; }
  .smc-search-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #737373;
    font-size: 13px;
  }

  /* ── Action bar (Play All / Add All) ── */
  .smc-action-bar {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 0 8px 12px;
  }
  .smc-action-btn {
    padding: 5px 14px;
    border-radius: 16px;
    border: 1px solid #2e2e2e;
    background: #1c1c1c;
    color: #e5e5e5;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    font-family: inherit;
  }
  .smc-action-btn.primary {
    background: #3b82f6;
    border-color: #3b82f6;
    color: #fff;
  }
  .smc-action-btn:active { opacity: 0.75; }
  .smc-action-btn:disabled { opacity: 0.5; cursor: default; }

  /* ── YTM type-filter pills ── */
  .smc-pill-bar {
    display: flex; gap: 8px; padding: 0 16px 8px; flex-shrink: 0;
  }
  .smc-pill {
    padding: 5px 14px;
    border-radius: 16px;
    border: 1px solid #2e2e2e;
    background: #1c1c1c;
    color: #737373;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    font-family: inherit;
  }
  .smc-pill.active {
    background: #3b82f6;
    border-color: #3b82f6;
    color: #fff;
  }
  .smc-pill:active { opacity: 0.75; }
  /* per-row stream-resolve spinner */
  .smc-row-spinner {
    width: 16px; height: 16px; flex-shrink: 0;
    border: 2px solid #2e2e2e;
    border-top-color: ${THEME.primary};
    border-radius: 50%;
    animation: smc-spin 0.7s linear infinite;
  }
  @keyframes smc-spin { to { transform: rotate(360deg); } }

  /* ── Queue tab ── */
  .smc-queue-count {
    font-size: 10px; color: ${THEME.statusMuted}; text-transform: uppercase;
    letter-spacing: 0.1em; margin: 0 0 8px 4px;
  }
  .smc-browse-row.playing .smc-browse-title { color: ${THEME.primary}; font-weight: 600; }
  .smc-queue-now {
    color: ${THEME.primary}; flex-shrink: 0; display: flex; align-items: center;
  }
`;

// ── Now-playing helpers ─────────────────────────────────────────
// Resolve an image URL: HA entity_picture is often a relative proxy path
// (e.g. /api/media_player_proxy/...) that needs location.origin prepended.
function smcResolveImage(url) {
  if (!url) return null;
  return url.startsWith('http') ? url : `${location.origin}${url}`;
}

function buildNpInfo(id, state) {
  const a = state.attributes;
  const duration = (a.media_duration > 0 && a.media_duration < 86400)
    ? a.media_duration : 0;
  const position = (a.media_position >= 0 && a.media_position <= duration)
    ? a.media_position : 0;
  const info = {
    entityId: id,
    title: a.media_title || 'Unknown',
    artist: a.media_artist || '',
    album: a.media_album_name || '',
    art: smcResolveImage(a.entity_picture) || jfNowPlayingArt(),
    isPlaying: state.state === 'playing',
    isExternal: isExternalSource(state),
    source: a.source || null,
    duration,
    position,
    positionUpdatedAt: a.media_position_updated_at,
    shuffle: !!a.shuffle,
    repeat: a.repeat || 'off',
  };

  // HA reports the raw stream URL as media_title for YTM tracks. Substitute the
  // stored metadata when we have it and the title looks like a URL (not a name).
  if (_ytmNowPlaying && (!a.media_title || info.title.includes('videoplayback') || info.title.startsWith('http'))) {
    info.title = _ytmNowPlaying.title || info.title;
    info.artist = _ytmNowPlaying.artist || info.artist;
    info.art = info.art || _ytmNowPlaying.thumbnail || null;
  }

  return info;
}

// True if a speaker is playing from a non-queue source (TV, line-in, AirPlay).
// Playback we drive (HA play_media of a URL) reports no source, which we treat
// as internal so transport controls remain available.
const QUEUE_SOURCES = ['Queue', 'Music Assistant Queue', 'Sonos Queue'];
function isExternalSource(state) {
  if (!state || state.state !== 'playing') return false;
  const source = state.attributes?.source;
  if (!source) return false;
  return !QUEUE_SOURCES.some(q => source.includes(q));
}

function hasMediaContext(state) {
  if (!state) return false;
  if (isExternalSource(state)) return false;
  if (state.state === 'playing' || state.state === 'paused') return true;
  // Sonos goes idle on pause but keeps media_title — treat as paused
  // Exception: position=0 + duration>0 means track ended naturally
  if (state.state === 'idle' && state.attributes?.media_title) {
    const pos = state.attributes.media_position || 0;
    const dur = state.attributes.media_duration || 0;
    if (dur > 0 && (pos === 0 || pos >= dur)) return false;
    return true;
  }
  return false;
}

// ── Speaker detection ───────────────────────────────────────────
// No Music Assistant dependency. Speakers come from include_players (explicit
// list) or every media_player.* entity, minus any exclude_players.
function getSpeakers(hass, config = _smcConfig) {
  if (!hass) return [];
  if (config?.include_players?.length) {
    return config.include_players.filter(id => hass.states[id]);
  }
  let ids = Object.keys(hass.states).filter(id => id.startsWith('media_player.'));
  if (config?.exclude_players?.length) {
    ids = ids.filter(id => !config.exclude_players.includes(id));
  }
  return ids;
}

function getNowPlaying(hass, selectedSpeakers) {
  if (!hass) return null;
  // Selected speakers first
  for (const id of selectedSpeakers) {
    const state = hass.states[id];
    if (state && hasMediaContext(state)) return buildNpInfo(id, state);
  }
  // Fallback: any configured speaker with media context
  for (const id of getSpeakers(hass)) {
    const state = hass.states[id];
    if (state && hasMediaContext(state)) return buildNpInfo(id, state);
  }
  // Nothing playing/paused anywhere — player is idle, drop the stored Jellyfin
  // art id (stale art after the queue ends is wrong). _ytmNowPlaying is NOT
  // cleared here: we want the last-played YTM track to stay visible in Now
  // Playing through idle/pause until a new source actively starts. It's cleared
  // only in playJfTracks() (Jellyfin takes over); buildNpInfo's URL guard keeps
  // it from leaking into a real Jellyfin title.
  _smcNowPlayingJfId = null;
  return null;
}

function formatTime(s) {
  if (!s || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec < 10 ? '0' : ''}${sec}`;
}

// ── Speaker Row ─────────────────────────────────────────────────
function SpeakerRow({ entityId, hass, selected, onToggle }) {
  const state = hass.states[entityId];
  const name = state?.attributes?.friendly_name || entityId.replace('media_player.', '');
  const isPlaying = state?.state === 'playing';
  const isGrouped = (state?.attributes?.group_members?.length || 0) > 1;
  const isOff = state?.state === 'off';
  const vol = state?.attributes?.volume_level;
  const volPct = vol != null ? `${Math.round(vol * 100)}%` : '';
  const title = state?.attributes?.media_title;

  let subtext = 'Idle';
  if (isOff) subtext = 'Off';
  else if (isPlaying && title) subtext = `Playing · ${title}`;
  else if (isGrouped) subtext = 'Grouped';

  return html`
    <div class=${`smc-spk-row${selected ? ' selected' : ''}`}
         onClick=${() => onToggle(entityId)}>
      <div class=${`smc-chk${selected ? ' checked' : ''}`}>
        ${selected ? '✓' : ''}
      </div>
      <div class="smc-spk-icon">♪</div>
      <div class="smc-spk-info">
        <p class=${`smc-spk-name${!selected && !isPlaying ? ' muted' : ''}`}>
          ${name}
        </p>
        <p class=${`smc-spk-sub${isPlaying ? ' playing' : isOff ? ' off' : ''}`}>
          ${subtext}
        </p>
      </div>
      ${volPct && html`<span class="smc-spk-vol">${volPct}</span>`}
    </div>
  `;
}

// ── Speakers View ───────────────────────────────────────────────
function SpeakersView({ hass, selected, onSelect, onGroup, isPlaying }) {
  const speakers = useMemo(() => getSpeakers(hass).slice().sort(), [hass]);

  const selectedNames = useMemo(() =>
    selected.map(id => hass?.states[id]?.attributes?.friendly_name || id.replace('media_player.', '')),
  [selected, hass]);

  const selectAll = useCallback(() => {
    speakers.forEach(id => { if (!selected.includes(id)) onSelect(id); });
  }, [speakers, selected, onSelect]);
  const selectNone = useCallback(() => {
    selected.forEach(id => onSelect(id));
  }, [selected, onSelect]);

  return html`
    <div class="smc-content">
      ${speakers.length === 0 && html`<p class="smc-error">No speakers found</p>`}
      ${speakers.length > 0 && html`
        <div class="smc-spk-header">
          <span class="smc-spk-title">Select speakers</span>
          <div class="smc-spk-quick">
            <span onClick=${selectAll}>All</span>
            <span style="color:${THEME.border}">·</span>
            <span onClick=${selectNone} style="color:${THEME.muted}">None</span>
          </div>
        </div>
        ${speakers.map(id => html`
          <${SpeakerRow} key=${id} entityId=${id} hass=${hass}
            selected=${selected.includes(id)} onToggle=${onSelect} />
        `)}
      `}
    </div>
    ${selected.length >= 2 && html`
      <div class="smc-group-bar" onClick=${onGroup}>
        <div>
          <span class="smc-group-names">${selectedNames.join(' + ')}</span>
          ${isPlaying && html`<div class="smc-group-warn">Changing group will briefly pause playback</div>`}
        </div>
        <span class="smc-group-action">Play here ▶</span>
      </div>
    `}
  `;
}

// ── Browse View (Jellyfin) ──────────────────────────────────────
function BrowseView({ hass, selectedSpeakers }) {
  const [stack, setStack] = useState([{ kind: 'root', title: 'Library' }]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const hassRef = useRef(hass);
  hassRef.current = hass;
  const eid = selectedSpeakers[0];

  const current = stack[stack.length - 1];

  useEffect(() => {
    if (!eid || !_jellyfinUrl || !_jellyfinToken) return;
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const r = await jfFetchRows(current);
        if (!cancelled) setRows(r || []);
      } catch (e) {
        if (!cancelled) setError(e?.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [stack, eid]);

  const push = useCallback((frame) => setStack(s => [...s, frame]), []);
  const gotoCrumb = useCallback((i) => setStack(s => s.slice(0, i + 1)), []);

  // Track rows in display order → queue items (album/playlist levels are all tracks).
  const trackMeta = useMemo(() =>
    rows.filter(r => r.track).map(r => ({ id: r.id, name: r.name, subtitle: r.subtitle, imageTag: r.imageTag })),
  [rows]);

  const playList = useCallback((startIndex) =>
    playJfTracks(hassRef.current, eid, trackMeta, startIndex), [eid, trackMeta]);

  // Play All / Add All — shown at album & artist drill levels.
  const canActAll = current.kind === 'album' || current.kind === 'artist';
  const [addState, setAddState] = useState(null); // null | 'adding' | 'Added N'
  const collectTracks = useCallback(async () => {
    if (current.kind === 'album') return trackMeta;
    if (current.kind === 'artist') return await jfArtistTracks(current.artistId);
    return [];
  }, [current, trackMeta]);
  const onPlayAll = useCallback(async () => {
    const tracks = await collectTracks();
    if (tracks.length) playJfTracks(hassRef.current, eid, tracks, 0);
  }, [collectTracks, eid]);
  const onAddAll = useCallback(async () => {
    setAddState('adding');
    const tracks = await collectTracks();
    const n = await enqueueJfTracks(hassRef.current, eid, tracks);
    setAddState(`Added ${n}`);
    setTimeout(() => setAddState(null), 2000);
  }, [collectTracks, eid]);

  if (!eid) {
    return html`<div class="smc-content"><p class="smc-header">Browse</p><p class="smc-error">Select a speaker first</p></div>`;
  }
  if (!_jellyfinUrl || !_jellyfinToken) {
    return html`<div class="smc-content"><p class="smc-header">Browse</p>
      <p class="smc-error">Jellyfin not configured — set <code>jellyfin_url</code> and <code>jellyfin_token</code> in the card config.</p></div>`;
  }

  return html`
    <div class="smc-content">
      ${stack.length > 1 && html`
        <div class="smc-breadcrumb">
          ${stack.map((f, i) => html`
            ${i > 0 && html`<span class="smc-breadcrumb-sep">›</span>`}
            <span key=${i} class=${`smc-breadcrumb-item${i === stack.length - 1 ? ' current' : ''}`}
              onClick=${() => gotoCrumb(i)}>${f.title}</span>
          `)}
        </div>
      `}
      ${canActAll && !loading && !error && html`
        <div class="smc-action-bar">
          <button class="smc-action-btn primary" onClick=${onPlayAll}>▶ Play All</button>
          <button class="smc-action-btn" disabled=${addState === 'adding'} onClick=${onAddAll}>
            ${addState === 'adding' ? 'Adding…' : (addState || '+ Add All')}
          </button>
        </div>
      `}
      ${loading && html`<p class="smc-loading">Loading…</p>`}
      ${error && html`<p class="smc-error">${error}</p>`}
      ${!loading && !error && html`
        <div class="smc-browse-list">
          ${rows.length === 0 && html`<p class="smc-loading">No items found</p>`}
          ${rows.map(row => {
            const img = row.imageTag ? jfImageUrl(row.id, row.imageTag) : null;
            const onTap = row.track
              ? () => playList(row.trackIndex)
              : () => push(row.next);
            return html`
              <div key=${row.id} class="smc-browse-row" onClick=${onTap}>
                ${img
                  ? html`<img class="smc-browse-thumb" src=${img} alt="" loading="eager" />`
                  : html`<div class="smc-browse-thumb-placeholder">${row.icon || (row.track ? '♪' : '\u{1F4C1}')}</div>`
                }
                <div class="smc-browse-info">
                  <p class="smc-browse-title">${row.name}</p>
                  ${row.subtitle && html`<p class="smc-browse-subtitle">${row.subtitle}</p>`}
                </div>
                ${!row.track && html`<span class="smc-browse-chevron">›</span>`}
              </div>
            `;
          })}
        </div>
      `}
    </div>
  `;
}

// ── Search View (Jellyfin) ──────────────────────────────────────
function SearchView({ hass, selectedSpeakers, onTabChange }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);   // { artists, albums, tracks } | null
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  // SearchView owns its own drill stack. Empty = show search results (root).
  const [drillStack, setDrillStack] = useState([]);
  const [drillRows, setDrillRows] = useState([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillError, setDrillError] = useState(null);
  const hassRef = useRef(hass);
  hassRef.current = hass;
  const eid = selectedSpeakers[0];
  const debounceRef = useRef(null);

  // Debounced search (400ms). Empty query clears results back to the prompt.
  useEffect(() => {
    if (!eid || !_jellyfinUrl || !_jellyfinToken) return;
    const term = q.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!term) { setResults(null); setSearchError(null); setSearching(false); return; }
    let cancelled = false;
    debounceRef.current = setTimeout(async () => {
      setSearching(true); setSearchError(null);
      try {
        const data = await jfSearch(term);
        if (!cancelled) setResults(data);
      } catch (e) {
        if (!cancelled) setSearchError(e?.message || String(e));
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 400);
    return () => { cancelled = true; if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q, eid]);

  // Drill-down fetch (artist → albums, album → tracks). jfFetchRows already
  // handles these kinds. Empty stack = results, so nothing to fetch.
  useEffect(() => {
    if (!drillStack.length || !eid || !_jellyfinUrl || !_jellyfinToken) return;
    let cancelled = false;
    (async () => {
      setDrillLoading(true); setDrillError(null);
      try {
        const r = await jfFetchRows(drillStack[drillStack.length - 1]);
        if (!cancelled) setDrillRows(r || []);
      } catch (e) {
        if (!cancelled) setDrillError(e?.message || String(e));
      } finally {
        if (!cancelled) setDrillLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [drillStack, eid]);

  const pushDrill = useCallback((frame) => setDrillStack(s => [...s, frame]), []);

  // Tap a track: play it, then jump to Now Playing. `tracks` is queue-item metadata.
  const playAndShow = useCallback((tracks, startIndex) => {
    playJfTracks(hassRef.current, eid, tracks, startIndex);
    if (onTabChange) onTabChange('playing');
  }, [eid, onTabChange]);

  // Drill track rows (album/playlist levels) → queue items.
  const drillTrackMeta = useMemo(() =>
    drillRows.filter(r => r.track).map(r => ({ id: r.id, name: r.name, subtitle: r.subtitle, imageTag: r.imageTag })),
  [drillRows]);

  // Play All / Add All at album & artist drill levels.
  const drillCurrent = drillStack[drillStack.length - 1];
  const canActAll = drillCurrent && (drillCurrent.kind === 'album' || drillCurrent.kind === 'artist');
  const [addState, setAddState] = useState(null);
  const collectTracks = useCallback(async () => {
    if (!drillCurrent) return [];
    if (drillCurrent.kind === 'album') return drillTrackMeta;
    if (drillCurrent.kind === 'artist') return await jfArtistTracks(drillCurrent.artistId);
    return [];
  }, [drillCurrent, drillTrackMeta]);
  const onPlayAll = useCallback(async () => {
    const tracks = await collectTracks();
    if (tracks.length) playJfTracks(hassRef.current, eid, tracks, 0);
  }, [collectTracks, eid]);
  const onAddAll = useCallback(async () => {
    setAddState('adding');
    const tracks = await collectTracks();
    const n = await enqueueJfTracks(hassRef.current, eid, tracks);
    setAddState(`Added ${n}`);
    setTimeout(() => setAddState(null), 2000);
  }, [collectTracks, eid]);

  const onInput = useCallback((e) => {
    setQ(e.target.value);
    // Editing the query implies a new search — drop back out of any drill.
    setDrillStack(s => (s.length ? [] : s));
  }, []);

  if (!eid) {
    return html`<div class="smc-content"><p class="smc-header">Search</p><p class="smc-error">Select a speaker first</p></div>`;
  }
  if (!_jellyfinUrl || !_jellyfinToken) {
    return html`<div class="smc-content"><p class="smc-header">Search</p>
      <p class="smc-error">Jellyfin not configured — set <code>jellyfin_url</code> and <code>jellyfin_token</code> in the card config.</p></div>`;
  }

  const inDrill = drillStack.length > 0;
  const crumbs = ['Results', ...drillStack.map(f => f.title)];
  const hasResults = results && (results.artists.length || results.albums.length || results.tracks.length);

  const searchBox = html`
    <div class="smc-search-box">
      <input class="smc-search-input" type="search" value=${q}
        placeholder="Search artists, albums, tracks…"
        onInput=${onInput} />
    </div>
  `;

  // Drill-down view — reuses the Browse row layout.
  if (inDrill) {
    return html`
      ${searchBox}
      <div class="smc-content">
        <div class="smc-breadcrumb">
          ${crumbs.map((title, i) => html`
            ${i > 0 && html`<span class="smc-breadcrumb-sep">›</span>`}
            <span key=${i} class=${`smc-breadcrumb-item${i === crumbs.length - 1 ? ' current' : ''}`}
              onClick=${() => setDrillStack(s => s.slice(0, i))}>${title}</span>
          `)}
        </div>
        ${canActAll && !drillLoading && !drillError && html`
          <div class="smc-action-bar">
            <button class="smc-action-btn primary" onClick=${onPlayAll}>▶ Play All</button>
            <button class="smc-action-btn" disabled=${addState === 'adding'} onClick=${onAddAll}>
              ${addState === 'adding' ? 'Adding…' : (addState || '+ Add All')}
            </button>
          </div>
        `}
        ${drillLoading && html`<p class="smc-loading">Loading…</p>`}
        ${drillError && html`<p class="smc-error">${drillError}</p>`}
        ${!drillLoading && !drillError && html`
          <div class="smc-browse-list">
            ${drillRows.length === 0 && html`<p class="smc-loading">No items found</p>`}
            ${drillRows.map(row => {
              const img = row.imageTag ? jfImageUrl(row.id, row.imageTag) : null;
              const onTap = row.track
                ? () => playAndShow(drillTrackMeta, row.trackIndex)
                : () => pushDrill(row.next);
              return html`
                <div key=${row.id} class="smc-browse-row" onClick=${onTap}>
                  ${img
                    ? html`<img class="smc-browse-thumb" src=${img} alt="" loading="eager" />`
                    : html`<div class="smc-browse-thumb-placeholder">${row.icon || (row.track ? '♪' : '\u{1F4C1}')}</div>`
                  }
                  <div class="smc-browse-info">
                    <p class="smc-browse-title">${row.name}</p>
                    ${row.subtitle && html`<p class="smc-browse-subtitle">${row.subtitle}</p>`}
                  </div>
                  ${!row.track && html`<span class="smc-browse-chevron">›</span>`}
                </div>
              `;
            })}
          </div>
        `}
      </div>
    `;
  }

  // Initial / empty state — centered prompt.
  if (!searching && !searchError && !results) {
    return html`
      ${searchBox}
      <div class="smc-search-empty">Search your Jellyfin library</div>
    `;
  }

  // Results view — three sections, empty ones omitted.
  return html`
    ${searchBox}
    <div class="smc-content">
      ${searching && html`<p class="smc-loading">Searching…</p>`}
      ${searchError && html`<p class="smc-error">${searchError}</p>`}
      ${!searching && !searchError && results && !hasResults && html`
        <div class="smc-search-empty">No results</div>
      `}
      ${!searching && !searchError && hasResults && html`
        ${results.artists.length > 0 && html`
          <p class="smc-section-label">Artists</p>
          <div class="smc-browse-list">
            ${results.artists.map(a => html`
              <div key=${a.Id} class="smc-browse-row"
                onClick=${() => pushDrill({ kind: 'artist', artistId: a.Id, title: a.Name })}>
                ${a.ImageTags?.Primary
                  ? html`<img class="smc-browse-thumb" src=${jfImageUrl(a.Id, a.ImageTags.Primary)} alt="" loading="eager" />`
                  : html`<div class="smc-browse-thumb-placeholder">\u{1F3A4}</div>`}
                <div class="smc-browse-info">
                  <p class="smc-browse-title">${a.Name}</p>
                  <p class="smc-browse-subtitle">Artist</p>
                </div>
                <span class="smc-browse-chevron">›</span>
              </div>
            `)}
          </div>
        `}
        ${results.albums.length > 0 && html`
          <p class="smc-section-label">Albums</p>
          <div class="smc-browse-list">
            ${results.albums.map(al => html`
              <div key=${al.Id} class="smc-browse-row"
                onClick=${() => pushDrill({ kind: 'album', albumId: al.Id, title: al.Name })}>
                ${al.ImageTags?.Primary
                  ? html`<img class="smc-browse-thumb" src=${jfImageUrl(al.Id, al.ImageTags.Primary)} alt="" loading="eager" />`
                  : html`<div class="smc-browse-thumb-placeholder">\u{1F4BF}</div>`}
                <div class="smc-browse-info">
                  <p class="smc-browse-title">${al.Name}</p>
                  <p class="smc-browse-subtitle">${al.AlbumArtist || 'Album'}</p>
                </div>
                <span class="smc-browse-chevron">›</span>
              </div>
            `)}
          </div>
        `}
        ${results.tracks.length > 0 && html`
          <p class="smc-section-label">Tracks</p>
          <div class="smc-browse-list">
            ${results.tracks.map(t => html`
              <div key=${t.Id} class="smc-browse-row"
                onClick=${() => playAndShow([{ id: t.Id, name: t.Name, subtitle: (t.Artists && t.Artists.join(', ')) || t.AlbumArtist || '', imageTag: t.ImageTags?.Primary }], 0)}>
                ${t.ImageTags?.Primary
                  ? html`<img class="smc-browse-thumb" src=${jfImageUrl(t.Id, t.ImageTags.Primary)} alt="" loading="eager" />`
                  : html`<div class="smc-browse-thumb-placeholder">♪</div>`}
                <div class="smc-browse-info">
                  <p class="smc-browse-title">${t.Name}</p>
                  <p class="smc-browse-subtitle">${(t.Artists && t.Artists.join(', ')) || t.AlbumArtist || ''}</p>
                </div>
              </div>
            `)}
          </div>
        `}
      `}
    </div>
  `;
}

// ── YouTube Music View (ytm-service) ────────────────────────────
function YTMView({ hass, selectedSpeakers, onTabChange }) {
  const [q, setQ] = useState('');
  const [type, setType] = useState('songs');      // songs | albums | artists
  const [results, setResults] = useState(null);   // [{type, id, title, artist, album, thumbnail}] | null
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  // Album drill — null = show search results.
  const [album, setAlbum] = useState(null);        // { id, title, artist }
  const [albumTracks, setAlbumTracks] = useState([]);
  const [albumLoading, setAlbumLoading] = useState(false);
  const [albumError, setAlbumError] = useState(null);
  const [loadingId, setLoadingId] = useState(null); // videoId currently resolving
  const [addState, setAddState] = useState(null);
  const hassRef = useRef(hass);
  hassRef.current = hass;
  const eid = selectedSpeakers[0];
  const debounceRef = useRef(null);

  // Debounced search (400ms), re-runs on query or type change. Empty clears.
  useEffect(() => {
    if (!eid || !_ytmServiceUrl) return;
    const term = q.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!term) { setResults(null); setSearchError(null); setSearching(false); return; }
    let cancelled = false;
    debounceRef.current = setTimeout(async () => {
      setSearching(true); setSearchError(null);
      try {
        const data = await ytmSearch(term, type);
        if (!cancelled) setResults(data.results || []);
      } catch (e) {
        if (!cancelled) setSearchError(e?.message || String(e));
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 400);
    return () => { cancelled = true; if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q, type, eid]);

  // Album drill fetch.
  useEffect(() => {
    if (!album || !_ytmServiceUrl) return;
    let cancelled = false;
    (async () => {
      setAlbumLoading(true); setAlbumError(null);
      try {
        const data = await ytmAlbumTracks(album.id);
        if (!cancelled) setAlbumTracks(data.tracks || []);
      } catch (e) {
        if (!cancelled) setAlbumError(e?.message || String(e));
      } finally {
        if (!cancelled) setAlbumLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [album]);

  // Tap a song row: resolve its stream (spinner on the row), play, jump to Now
  // Playing. `track` carries {id, title, artist, thumbnail} for Now Playing.
  const tapSong = useCallback(async (track) => {
    if (loadingId) return;                 // one resolve at a time
    setLoadingId(track.id);
    const ok = await playYtmTrack(hassRef.current, eid, track.id, track);
    setLoadingId(null);
    if (ok && onTabChange) onTabChange('playing');
  }, [eid, loadingId, onTabChange]);

  // Album Play All: play the first track now, background-enqueue the rest. Each
  // track needs its own yt-dlp resolve (~1-3s), so the rest stream in over time.
  const playAlbumAll = useCallback(async () => {
    const ids = albumTracks.map(t => t.id).filter(Boolean);
    if (!ids.length) return;
    setAddState('starting');
    const first = albumTracks.find(t => t.id === ids[0]);
    const ok = await playYtmTrack(hassRef.current, eid, ids[0], first || {}, albumTracks);
    if (!ok) { setAddState(null); return; }
    if (onTabChange) onTabChange('playing');
    setAddState(null);
    // Fire-and-forget: resolve + append the remaining tracks in order.
    (async () => {
      for (let i = 1; i < ids.length; i++) {
        const url = `${_ytmServiceUrl}/audio/${encodeURIComponent(ids[i])}.m4a`;
        try {
          await hassRef.current.callService('media_player', 'play_media', {
            entity_id: eid, media_content_id: url, media_content_type: 'music', enqueue: 'add',
          });
        } catch { break; }
      }
    })();
  }, [albumTracks, eid, onTabChange]);

  const onInput = useCallback((e) => {
    setQ(e.target.value);
    setAlbum(a => (a ? null : a));   // editing query drops out of album drill
  }, []);

  if (!eid) {
    return html`<div class="smc-content"><p class="smc-header">YouTube Music</p><p class="smc-error">Select a speaker first</p></div>`;
  }
  if (!_ytmServiceUrl) {
    return html`<div class="smc-content"><p class="smc-header">YouTube Music</p>
      <p class="smc-error">YTM service not configured — set <code>ytm_url</code> in the card config.</p></div>`;
  }

  const thumb = (url, fallback) => url
    ? html`<img class="smc-browse-thumb" src=${url} alt="" loading="eager" referrerpolicy="no-referrer" />`
    : html`<div class="smc-browse-thumb-placeholder">${fallback}</div>`;

  const searchBox = html`
    <div class="smc-search-box">
      <input class="smc-search-input" type="search" value=${q}
        placeholder="Search YouTube Music…" onInput=${onInput} />
    </div>
    <div class="smc-pill-bar">
      ${[['songs', 'Songs'], ['albums', 'Albums'], ['artists', 'Artists']].map(([id, label]) => html`
        <button key=${id} class=${`smc-pill${type === id ? ' active' : ''}`}
          onClick=${() => { setType(id); setAlbum(null); }}>${label}</button>
      `)}
    </div>
  `;

  // Album drill view.
  if (album) {
    return html`
      ${searchBox}
      <div class="smc-content">
        <div class="smc-breadcrumb">
          <span class="smc-breadcrumb-item" onClick=${() => setAlbum(null)}>Results</span>
          <span class="smc-breadcrumb-sep">›</span>
          <span class="smc-breadcrumb-item current">${album.title}</span>
        </div>
        ${!albumLoading && !albumError && albumTracks.length > 0 && html`
          <div class="smc-action-bar">
            <button class="smc-action-btn primary" disabled=${addState === 'starting'} onClick=${playAlbumAll}>
              ${addState === 'starting' ? 'Starting…' : '▶ Play All'}
            </button>
          </div>
        `}
        ${albumLoading && html`<p class="smc-loading">Loading…</p>`}
        ${albumError && html`<p class="smc-error">${albumError}</p>`}
        ${!albumLoading && !albumError && html`
          <div class="smc-browse-list">
            ${albumTracks.length === 0 && html`<p class="smc-loading">No tracks found</p>`}
            ${albumTracks.map(t => html`
              <div key=${t.id} class="smc-browse-row" onClick=${() => tapSong(t)}>
                ${thumb(t.thumbnail, '♪')}
                <div class="smc-browse-info">
                  <p class="smc-browse-title">${t.title}</p>
                  ${t.artist && html`<p class="smc-browse-subtitle">${t.artist}</p>`}
                </div>
                ${loadingId === t.id && html`<div class="smc-row-spinner"></div>`}
              </div>
            `)}
          </div>
        `}
      </div>
    `;
  }

  // Initial / empty state.
  if (!searching && !searchError && !results) {
    return html`
      ${searchBox}
      <div class="smc-search-empty">Search YouTube Music</div>
    `;
  }

  // Results view.
  return html`
    ${searchBox}
    <div class="smc-content">
      ${searching && html`<p class="smc-loading">Searching…</p>`}
      ${searchError && html`<p class="smc-error">${searchError}</p>`}
      ${!searching && !searchError && results && results.length === 0 && html`
        <div class="smc-search-empty">No results</div>
      `}
      ${!searching && !searchError && results && results.length > 0 && html`
        <div class="smc-browse-list">
          ${results.map(r => {
            if (r.type === 'songs') {
              return html`
                <div key=${r.id} class="smc-browse-row" onClick=${() => tapSong(r)}>
                  ${thumb(r.thumbnail, '♪')}
                  <div class="smc-browse-info">
                    <p class="smc-browse-title">${r.title}</p>
                    ${r.artist && html`<p class="smc-browse-subtitle">${r.artist}</p>`}
                  </div>
                  ${loadingId === r.id && html`<div class="smc-row-spinner"></div>`}
                </div>
              `;
            }
            if (r.type === 'albums') {
              return html`
                <div key=${r.id} class="smc-browse-row"
                  onClick=${() => setAlbum({ id: r.id, title: r.title, artist: r.artist })}>
                  ${thumb(r.thumbnail, '\u{1F4BF}')}
                  <div class="smc-browse-info">
                    <p class="smc-browse-title">${r.title}</p>
                    ${r.artist && html`<p class="smc-browse-subtitle">${r.artist}</p>`}
                  </div>
                  <span class="smc-browse-chevron">›</span>
                </div>
              `;
            }
            // artists — tap searches that artist's songs.
            return html`
              <div key=${r.id} class="smc-browse-row"
                onClick=${() => { setType('songs'); setQ(r.title); }}>
                ${thumb(r.thumbnail, '\u{1F3A4}')}
                <div class="smc-browse-info">
                  <p class="smc-browse-title">${r.title}</p>
                  <p class="smc-browse-subtitle">Artist</p>
                </div>
                <span class="smc-browse-chevron">›</span>
              </div>
            `;
          })}
        </div>
      `}
    </div>
  `;
}

// ── Queue View (card-side queue — Branch B) ─────────────────────
function QueueView({ hass, selectedSpeakers, onTabChange }) {
  const hassRef = useRef(hass);
  hassRef.current = hass;
  const eid = selectedSpeakers[0];
  const [, force] = useState(0);
  const [loadingId, setLoadingId] = useState(null);

  const np = useMemo(() => getNowPlaying(hass, selectedSpeakers), [hass, selectedSpeakers]);

  // Render whichever source is active. Each queue is only valid for the speaker
  // it was built for (clears on speaker change).
  const source = activeSource();
  const isYtm = source === 'ytm';
  const queue = isYtm
    ? (_ytmQueueEntityId === eid ? _ytmQueue : [])
    : (_smcQueueEntityId === eid ? _smcQueue : []);

  // Jellyfin jump — replace the current track, leave the visible list intact.
  const onJfJump = useCallback(async (track) => {
    await jumpToQueueTrack(hassRef.current, eid, track);
    force(n => n + 1);
  }, [eid]);

  // YTM jump — resolve the stream (spinner on the row) and play it, preserving
  // the YTM queue (unlike playYtmTrack, which rebuilds it).
  const onYtmJump = useCallback(async (track) => {
    if (!hassRef.current || !eid || loadingId) return;
    const url = `${_ytmServiceUrl}/audio/${encodeURIComponent(track.videoId)}.m4a`;
    setLoadingId(track.videoId);
    _ytmNowPlaying = { videoId: track.videoId, title: track.title, artist: track.artist, thumbnail: track.thumbnail };
    _ytmDirty = true;
    try {
      await hassRef.current.callService('media_player', 'play_media', {
        entity_id: eid, media_content_id: url, media_content_type: 'music',
      });
    } catch (err) { console.error('[smc] YTM queue jump failed:', err); setLoadingId(null); return; }
    setLoadingId(null);
    force(n => n + 1);
  }, [eid, loadingId]);

  if (!eid) {
    return html`<div class="smc-content"><p class="smc-header">Queue</p><p class="smc-error">Select a speaker first</p></div>`;
  }

  if (!queue.length) {
    return html`
      <div class="np-empty">
        <${IconMusicNote} />
        <p class="np-empty-text">Nothing queued — browse and add music</p>
        <button class="np-empty-btn" onClick=${(e) => { e.stopPropagation(); onTabChange('browse'); }}>Browse</button>
      </div>
    `;
  }

  // Highlight the playing track. YTM: match the stored videoId. Jellyfin: prefer
  // the tracked art id, fall back to the now-playing title (covers natural queue
  // advance, which we don't observe).
  const isCurrent = (q) => isYtm
    ? (!!_ytmNowPlaying?.videoId && q.videoId === _ytmNowPlaying.videoId)
    : ((_smcNowPlayingJfId && q.id === _smcNowPlayingJfId) || (!!np?.title && q.name === np.title));

  return html`
    <div class="smc-content">
      <p class="smc-queue-count">${queue.length} track${queue.length !== 1 ? 's' : ''}</p>
      <div class="smc-browse-list">
        ${queue.map((q, i) => {
          const cur = isCurrent(q);
          const key = isYtm ? q.videoId : q.id;
          const title = isYtm ? q.title : q.name;
          const subtitle = isYtm ? q.artist : q.subtitle;
          const img = isYtm ? q.thumbnail : (q.imageTag ? jfImageUrl(q.id, q.imageTag) : null);
          const resolving = isYtm && loadingId === q.videoId;
          return html`
            <div key=${`${key}-${i}`} class=${`smc-browse-row${cur ? ' playing' : ''}`}
              onClick=${() => (isYtm ? onYtmJump(q) : onJfJump(q))}>
              ${img
                ? html`<img class="smc-browse-thumb" src=${img} alt="" loading="eager" referrerpolicy=${isYtm ? 'no-referrer' : undefined} />`
                : html`<div class="smc-browse-thumb-placeholder">♪</div>`}
              <div class="smc-browse-info">
                <p class="smc-browse-title">${title}</p>
                ${subtitle && html`<p class="smc-browse-subtitle">${subtitle}</p>`}
              </div>
              ${resolving
                ? html`<div class="smc-row-spinner"></div>`
                : cur && html`<span class="smc-queue-now"><${IconPlay} size=${14} /></span>`}
            </div>
          `;
        })}
      </div>
    </div>
  `;
}

// ── Now Playing View ────────────────────────────────────────────
function NowPlayingView({ hass, selectedSpeakers, onTabChange }) {
  const hassRef = useRef(hass);
  hassRef.current = hass;

  const np = useMemo(() => getNowPlaying(hass, selectedSpeakers), [hass, selectedSpeakers]);

  // Use the entity that is actually playing (from np.entityId) rather than
  // selectedSpeakers[0], which may be null if _smcSpeakers wasn't yet synced.
  const entityId = np?.entityId || selectedSpeakers[0] || null;
  const [currentPos, setCurrentPos] = useState(0);

  // Real-time progress update
  useEffect(() => {
    if (!np) return;
    const calcPos = () => {
      if (!np.positionUpdatedAt) return np.position;
      if (!np.isPlaying) return np.position;
      const elapsed = (Date.now() - new Date(np.positionUpdatedAt).getTime()) / 1000;
      return Math.min(np.position + elapsed, np.duration || Infinity);
    };
    setCurrentPos(calcPos());
    if (!np.isPlaying) return;
    const interval = setInterval(() => setCurrentPos(calcPos()), 1000);
    return () => clearInterval(interval);
  }, [np?.position, np?.positionUpdatedAt, np?.isPlaying, np?.duration]);

  // Transport controls — resolve entityId at call time, not capture time
  const callService = useCallback((service, data) => {
    const h = hassRef.current;
    const eid = np?.entityId || selectedSpeakers[0];
    if (!h || !eid) return;
    h.callService('media_player', service, { entity_id: eid, ...data });
  }, [np, selectedSpeakers]);

  const handlePlayPause = useCallback(() => callService('media_play_pause', {}), [callService]);
  const handlePrev = useCallback(() => callService('media_previous_track', {}), [callService]);
  const handleNext = useCallback(() => callService('media_next_track', {}), [callService]);

  const handleShuffle = useCallback(() => {
    if (!np) return;
    callService('shuffle_set', { shuffle: !np.shuffle });
  }, [callService, np?.shuffle]);

  const handleRepeat = useCallback(() => {
    if (!np) return;
    const cycle = { off: 'all', all: 'one', one: 'off' };
    callService('repeat_set', { repeat: cycle[np.repeat] || 'off' });
  }, [callService, np?.repeat]);

  const handleSeek = useCallback((e) => {
    if (!np?.duration) return;
    const bar = e.currentTarget;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    callService('media_seek', { seek_position: pct * np.duration });
  }, [callService, np?.duration]);

  const handleVolume = useCallback((speakerId, value) => {
    const h = hassRef.current;
    if (!h) return;
    h.callService('media_player', 'volume_set', {
      entity_id: speakerId,
      volume_level: value / 100,
    });
  }, []);

  // Grouped speakers for volume — derive entityId inside memo
  const volumeSpeakers = useMemo(() => {
    const eid = np?.entityId || selectedSpeakers[0] || null;
    if (!hass || !eid) return [];
    const primary = hass.states[eid];
    const members = primary?.attributes?.group_members?.length
      ? primary.attributes.group_members : [eid];
    return members.map(id => {
      const s = hass.states[id];
      return {
        id,
        name: s?.attributes?.friendly_name || id.replace('media_player.', ''),
        volume: s?.attributes?.volume_level != null ? Math.round(s.attributes.volume_level * 100) : 50,
      };
    });
  }, [hass, np, selectedSpeakers]);

  // Nothing playing state
  if (!np) {
    return html`
      <div class="np-empty">
        <${IconMusicNote} />
        <p class="np-empty-text">Select something to play</p>
        <button class="np-empty-btn" onClick=${(e) => { e.stopPropagation(); onTabChange('browse'); }}>Browse</button>
      </div>
    `;
  }

  const progress = np.duration > 0 ? Math.min(currentPos / np.duration, 1) : 0;

  return html`
    <div class="np-scroll">
      <!-- Album art (centered square) -->
      ${np.art
        ? html`<img class="np-art-square" src=${np.art} alt="" loading="eager" />`
        : html`<div class="np-art-square-placeholder"><${IconMusicNote} /></div>`
      }

      <!-- Track info -->
      <div class="np-track-info">
        <p class="np-title">${np.title}</p>
        ${np.artist && html`<p class="np-artist">${np.artist}</p>`}
      </div>

      <!-- Progress bar -->
      <div class="np-progress">
        <div class="np-progress-bar" onClick=${handleSeek}>
          <div class="np-progress-fill" style=${`width: ${progress * 100}%`}>
            <div class="np-progress-dot" />
          </div>
        </div>
        <div class="np-progress-times">
          <span>${formatTime(currentPos)}</span>
          <span>${formatTime(np.duration)}</span>
        </div>
      </div>

      <!-- Transport controls -->
      ${np.isExternal ? html`
        <p style="text-align:center; color:${THEME.muted}; font-size:12px; padding:12px 20px;">
          Playing via ${np.source || 'external source'} — transport controls unavailable
        </p>
      ` : html`
      <div class="np-transport">
        <button class=${`np-transport-btn${np.shuffle ? ' active' : ''}`} onClick=${(e) => { e.stopPropagation(); handleShuffle(); }}>
          <${IconShuffle} />
        </button>
        <button class="np-transport-btn" onClick=${(e) => { e.stopPropagation(); handlePrev(); }}><${IconPrev} /></button>
        <button class="np-play-btn" onClick=${(e) => { e.stopPropagation(); handlePlayPause(); }}>
          ${np.isPlaying ? html`<${IconPause} size=${22} />` : html`<${IconPlay} size=${22} />`}
        </button>
        <button class="np-transport-btn" onClick=${(e) => { e.stopPropagation(); handleNext(); }}><${IconNext} /></button>
        <button class=${`np-transport-btn${np.repeat !== 'off' ? ' active' : ''}`}
          onClick=${(e) => { e.stopPropagation(); handleRepeat(); }} style="position:relative">
          <${IconRepeat} />
          ${np.repeat === 'one' && html`<span class="np-repeat-badge">1</span>`}
        </button>
      </div>
      `}

      <!-- Volume sliders -->
      <div class="np-volume-section">
        <p class="np-volume-label">Volume · ${volumeSpeakers.length} speaker${volumeSpeakers.length !== 1 ? 's' : ''}</p>
        ${volumeSpeakers.map(sp => html`
          <div class="np-volume-row" key=${sp.id}>
            <span class="np-volume-name">${sp.name}</span>
            <input type="range" class="np-volume-slider" min="0" max="100" value=${sp.volume}
              onInput=${(e) => handleVolume(sp.id, parseInt(e.target.value))}
              style=${`background: linear-gradient(to right, ${THEME.primary} ${sp.volume}%, ${THEME.border} ${sp.volume}%)`}
            />
            <span class="np-volume-value">${sp.volume}</span>
          </div>
        `)}
      </div>
    </div>
  `;
}

// ── Mini Player ─────────────────────────────────────────────────
function MiniPlayer({ nowPlaying, hass, onTap }) {
  if (!nowPlaying) return null;
  const handlePlayPause = useCallback((e) => {
    e.stopPropagation();
    if (!hass || !nowPlaying.entityId) return;
    hass.callService('media_player', 'media_play_pause', { entity_id: nowPlaying.entityId });
  }, [hass, nowPlaying]);

  return html`
    <div class="smc-mini-player" onClick=${onTap}>
      ${nowPlaying.art
        ? html`<img class="smc-mini-art" src=${nowPlaying.art} alt="" loading="eager" />`
        : html`<div class="smc-mini-art-placeholder" />`
      }
      <div class="smc-mini-info">
        <p class="smc-mini-title">${nowPlaying.title}</p>
        ${nowPlaying.artist && html`<p class="smc-mini-artist">${nowPlaying.artist}</p>`}
      </div>
      ${nowPlaying.isExternal
        ? html`<span style="font-size:9px; color:${THEME.muted}; padding:4px 8px; border:1px solid ${THEME.border}; border-radius:4px;">${nowPlaying.source || 'EXT'}</span>`
        : html`<button class="smc-mini-btn" onClick=${handlePlayPause}>
            ${nowPlaying.isPlaying ? html`<${IconPause} />` : html`<${IconPlay} />`}
          </button>`
      }
    </div>
  `;
}

// ── Bottom Nav ──────────────────────────────────────────────────
function BottomNav({ activeTab, onTabChange }) {
  const tabs = [
    { id: 'speakers', label: 'Speakers', icon: IconSpeaker },
    { id: 'search', label: 'Search', icon: IconSearch },
    { id: 'browse', label: 'Browse', icon: IconBrowse },
    { id: 'queue', label: 'Queue', icon: IconQueue },
    { id: 'ytm', label: 'YTM', icon: IconYTM },
    { id: 'playing', label: 'Now Playing', icon: IconNowPlaying },
  ];
  return html`
    <div class="smc-nav">
      ${tabs.map(tab => html`
        <div key=${tab.id} class=${`smc-nav-item${activeTab === tab.id ? ' active' : ''}`}
          onClick=${() => onTabChange(tab.id)}>
          <${tab.icon} /><span>${tab.label}</span>
        </div>
      `)}
    </div>
  `;
}

// ── State: single source of truth ───────────────────────────────
// Module-level state survives Preact re-renders. Custom element owns it.
const SMC_KEY = 'smc_selected_speakers';
let _smcSpeakers = []; // THE selected speakers — single source of truth
let _smcDirty = false; // set when smcAutoDetect changes _smcSpeakers
let _ytmDirty = false; // set when _ytmNowPlaying changes — signals Preact to re-render
let _smcUserSelected = false; // true after explicit user tap — blocks auto-detect
let _smcUserSelectedAt = 0; // timestamp of last user tap

function smcInit(hass) {
  const speakers = getSpeakers(hass);

  // 1. Any currently playing/paused configured speaker
  const playing = speakers.find(id => hasMediaContext(hass.states[id]));

  // 2. localStorage (filtered to configured speakers)
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(SMC_KEY) || '[]'); } catch {}
  saved = saved.filter(id => speakers.includes(id));

  // 3. Priority: playing > saved > empty
  if (playing) {
    _smcSpeakers = [playing];
    _smcUserSelected = false;
  } else if (saved.length > 0) {
    _smcSpeakers = saved;
    _smcUserSelected = true;
  } else {
    _smcSpeakers = [];
    _smcUserSelected = false;
  }
  console.log('[smc] init: speakers=', _smcSpeakers, 'userSelected=', _smcUserSelected);
}

function smcAutoDetect(hass) {
  const speakers = getSpeakers(hass);

  if (_smcUserSelected) {
    // Hard block for 30s after any user tap
    const age = Date.now() - _smcUserSelectedAt;
    if (age < 30000) return;
    // After 30s, only release if selection is completely idle
    const selStillActive = _smcSpeakers.some(id => hasMediaContext(hass.states[id]));
    if (selStillActive) return;
    _smcUserSelected = false;
  }

  // Is any selected speaker actively playing?
  const selPlaying = _smcSpeakers.some(id => hass.states[id]?.state === 'playing');
  if (selPlaying) return;

  // Find any configured speaker actively playing (not external source)
  let active = speakers.find(id => {
    const s = hass.states[id];
    return s?.state === 'playing' && !isExternalSource(s);
  });

  // Fall back to paused (hasMediaContext) only if nothing is playing
  if (!active) {
    active = speakers.find(id => hasMediaContext(hass.states[id]));
  }

  if (active && !_smcSpeakers.includes(active)) {
    console.log('[smc] auto-detect: switching to', active);
    _smcSpeakers = [active];
    _smcDirty = true;
    try { localStorage.setItem(SMC_KEY, JSON.stringify(_smcSpeakers)); } catch {}
  }
}

function smcSelectSpeaker(entityId, hass) {
  const idx = _smcSpeakers.indexOf(entityId);
  if (idx >= 0) {
    // Removing — unjoin if currently grouped
    _smcSpeakers = _smcSpeakers.filter(id => id !== entityId);
    const state = hass?.states[entityId];
    const isGrouped = (state?.attributes?.group_members?.length || 0) > 1;
    if (isGrouped && hass) {
      hass.callService('media_player', 'unjoin', {}, { entity_id: entityId });
    }
  } else {
    _smcSpeakers = [..._smcSpeakers, entityId];
  }
  _smcUserSelected = true;
  _smcUserSelectedAt = Date.now();
  _smcDirty = true;
  try { localStorage.setItem(SMC_KEY, JSON.stringify(_smcSpeakers)); } catch {}
}

// ── App ─────────────────────────────────────────────────────────
function SonosMusicApp({ hass, config }) {
  const [activeTab, setActiveTab] = useState('speakers');
  // Force re-render counter — bumped when user taps a speaker
  const [, forceUpdate] = useState(0);

  // Sync auto-detected speaker changes into Preact render cycle
  if (_smcDirty) {
    _smcDirty = false;
    setTimeout(() => forceUpdate(n => n + 1), 0);
  }

  // Sync YTM now-playing changes (module-level, no hass update) into render cycle
  if (_ytmDirty) {
    _ytmDirty = false;
    setTimeout(() => forceUpdate(n => n + 1), 0);
  }

  // Read directly from module-level state — always current
  const selectedSpeakers = _smcSpeakers;

  // Derive now-playing directly from hass — no cached state
  const nowPlaying = useMemo(() => getNowPlaying(hass, selectedSpeakers), [hass, selectedSpeakers]);

  const isPlaying = useMemo(() =>
    selectedSpeakers.some(id => hass?.states[id]?.state === 'playing'),
  [hass, selectedSpeakers]);

  const handleSelectSpeaker = useCallback((entityId) => {
    smcSelectSpeaker(entityId, hass);
    forceUpdate(n => n + 1);
  }, [hass]);

  const handleGroup = useCallback(async () => {
    if (!hass || selectedSpeakers.length < 2) return;
    const primary = selectedSpeakers[0];
    const wasPlaying = selectedSpeakers.some(id => hass.states[id]?.state === 'playing');
    try {
      await Promise.all(
        selectedSpeakers.map(id => hass.callService('media_player', 'unjoin', { entity_id: id }))
      );
      await new Promise(r => setTimeout(r, 500));
      await hass.callService('media_player', 'join', { entity_id: primary, group_members: selectedSpeakers });
      if (wasPlaying) {
        await new Promise(r => setTimeout(r, 1000));
        await hass.callService('media_player', 'media_play', { entity_id: primary });
      }
    } catch (err) { console.error('[smc] Group failed:', err); }
  }, [hass, selectedSpeakers]);

  if (!hass) {
    return html`<div class="smc-card"><p class="smc-error">Waiting for HA connection...</p></div>`;
  }

  return html`
    <div class="smc-card">
      <${BottomNav} activeTab=${activeTab} onTabChange=${setActiveTab} />
      <div class=${`smc-tab-panel${activeTab !== 'speakers' ? ' hidden' : ''}`}>
        <${SpeakersView} hass=${hass} selected=${selectedSpeakers}
          onSelect=${handleSelectSpeaker} onGroup=${handleGroup} isPlaying=${isPlaying} />
      </div>
      <div class=${`smc-tab-panel${activeTab !== 'search' ? ' hidden' : ''}`}>
        <${SearchView} hass=${hass} selectedSpeakers=${selectedSpeakers} onTabChange=${setActiveTab} />
      </div>
      <div class=${`smc-tab-panel${activeTab !== 'browse' ? ' hidden' : ''}`}>
        <${BrowseView} hass=${hass} selectedSpeakers=${selectedSpeakers} />
      </div>
      <div class=${`smc-tab-panel${activeTab !== 'queue' ? ' hidden' : ''}`}>
        <${QueueView} hass=${hass} selectedSpeakers=${selectedSpeakers} onTabChange=${setActiveTab} />
      </div>
      <div class=${`smc-tab-panel${activeTab !== 'ytm' ? ' hidden' : ''}`}>
        <${YTMView} hass=${hass} selectedSpeakers=${selectedSpeakers} onTabChange=${setActiveTab} />
      </div>
      <div class=${`smc-tab-panel${activeTab !== 'playing' ? ' hidden' : ''}`}>
        <${NowPlayingView} hass=${hass} selectedSpeakers=${selectedSpeakers} onTabChange=${setActiveTab} />
      </div>
      ${activeTab !== 'playing' && html`
        <${MiniPlayer} nowPlaying=${nowPlaying} hass=${hass} onTap=${() => setActiveTab('playing')} />
      `}
    </div>
  `;
}

// ── Custom Element ──────────────────────────────────────────────
class SonosMusicCard extends HTMLElement {
  constructor() { super(); this._hass = null; this._config = {}; this._initialized = false; }
  set hass(hass) {
    this._hass = hass;
    if (!this._initialized) {
      this._initialized = true;
      smcInit(hass);
      this._init();
    } else {
      // On every subsequent hass update, auto-detect any newly playing speaker
      smcAutoDetect(hass);
    }
    if (this._root) this._renderApp();
  }
  get hass() { return this._hass; }
  setConfig(config) {
    this._config = config || {};
    _smcConfig = this._config;
    const strip = (u) => (u ? String(u).replace(/\/+$/, '') : null);
    _jellyfinUrl = strip(config.jellyfin_url);
    _jellyfinInternalUrl = strip(config.jellyfin_internal_url) || _jellyfinUrl;
    _jellyfinToken = config.jellyfin_token || null;
    _jellyfinUserId = null;
    _ytmServiceUrl = strip(config.ytm_url) || 'https://ska.hq.stylee.org/ytm';
  }
  _init() {
    this._root = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = cardStyles;
    this._root.appendChild(style);
    this._container = document.createElement('div');
    this._root.appendChild(this._container);
    this._renderApp();
  }
  _renderApp() {
    render(h(SonosMusicApp, { hass: this._hass, config: this._config }), this._container);
  }
  getCardSize() { return 8; }
  static getConfigElement() { return document.createElement('div'); }
  static getStubConfig() { return {}; }
}

if (!customElements.get('sonos-music-card')) {
  customElements.define('sonos-music-card', SonosMusicCard);
}
window.customCards = window.customCards || [];
if (!window.customCards.find(c => c.type === 'sonos-music-card')) {
  window.customCards.push({
    type: 'sonos-music-card',
    name: 'Sonos Music Card',
    description: 'Music browser and player for Sonos — Jellyfin library, native HA transport.',
  });
}
