// Sonos Music Card v0.13.1
// Preact + htm, no build step — Custom HA Lovelace card for Sonos.
// Control/transport via native HA media_player services; media browsing via
// Jellyfin API (direct HTTP from the card); playback via HA play_media of a
// Jellyfin stream URL the speakers fetch directly. No Music Assistant.

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
  return `${_jellyfinInternalUrl}/Audio/${itemId}/stream.mp3?api_key=${encodeURIComponent(_jellyfinToken)}&audioCodec=mp3`;
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
      return (data?.Items || []).map(a => ({
        id: a.Id, name: a.Name, subtitle: 'Artist',
        imageTag: a.ImageTags?.Primary,
        next: { kind: 'artist', title: a.Name, artistId: a.Id },
      }));
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
const IconPlay = ({ size = 18 } = {}) => html`<svg width=${size} height=${size} viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
const IconPause = ({ size = 18 } = {}) => html`<svg width=${size} height=${size} viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
const IconPrev = () => html`<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="3" y="5" width="3" height="14"/><polygon points="21 5 9 12 21 19 21 5"/></svg>`;
const IconNext = () => html`<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="18" y="5" width="3" height="14"/><polygon points="3 5 15 12 3 19 3 5"/></svg>`;
const IconShuffle = () => html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>`;
const IconRepeat = () => html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`;
const IconChevron = () => html`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
const IconMusicNote = () => html`<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;

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
  .np-scroll { flex: 1; overflow-y: auto; padding-bottom: 60px; min-height: 0; }
  .np-art-container {
    position: relative; width: 100%; height: 240px;
    background: ${THEME.surface}; overflow: hidden;
  }
  .np-art { width: 100%; height: 100%; object-fit: cover; display: block; }
  .np-art-placeholder {
    width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
    color: ${THEME.chevron};
  }
  .np-art-gradient {
    position: absolute; bottom: 0; left: 0; right: 0; height: 50%;
    background: linear-gradient(to bottom, transparent 0%, ${THEME.base} 100%);
    pointer-events: none;
  }
  .np-track-info { padding: 0 20px; margin-top: -30px; position: relative; z-index: 1; }
  .np-title { font-size: 18px; font-weight: 500; color: ${THEME.textBright}; margin: 0; }
  .np-artist { font-size: 13px; color: ${THEME.statusSelected}; margin: 4px 0 0; }
  .np-album { font-size: 11px; color: ${THEME.statusMuted}; margin: 2px 0 0; }

  /* Progress bar */
  .np-progress { padding: 16px 20px 0; }
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
    gap: 24px; padding: 16px 20px;
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
  .np-volume-section { padding: 8px 20px 16px; }
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
  return {
    entityId: id,
    title: a.media_title || 'Unknown',
    artist: a.media_artist || '',
    album: a.media_album_name || '',
    art: smcResolveImage(a.entity_picture),
    isPlaying: state.state === 'playing',
    isExternal: isExternalSource(state),
    source: a.source || null,
    duration,
    position,
    positionUpdatedAt: a.media_position_updated_at,
    shuffle: !!a.shuffle,
    repeat: a.repeat || 'off',
  };
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

  // Play a list of Jellyfin tracks from startIndex via HA. First track replaces
  // the queue; the rest are appended best-effort (Sonos supports enqueue=add).
  const playList = useCallback(async (trackIds, startIndex) => {
    const h = hassRef.current;
    if (!h || !eid || !trackIds?.length) return;
    const ids = trackIds.slice(startIndex);
    try {
      await h.callService('media_player', 'play_media', {
        entity_id: eid,
        media_content_id: jfStreamUrl(ids[0]),
        media_content_type: 'music',
      });
    } catch (err) {
      console.error('[smc] play failed:', err);
      return;
    }
    for (let i = 1; i < ids.length; i++) {
      try {
        await h.callService('media_player', 'play_media', {
          entity_id: eid,
          media_content_id: jfStreamUrl(ids[i]),
          media_content_type: 'music',
          enqueue: 'add',
        });
      } catch { break; }
    }
  }, [eid]);

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
      ${loading && html`<p class="smc-loading">Loading…</p>`}
      ${error && html`<p class="smc-error">${error}</p>`}
      ${!loading && !error && html`
        <div class="smc-browse-list">
          ${rows.length === 0 && html`<p class="smc-loading">No items found</p>`}
          ${rows.map(row => {
            const img = row.imageTag ? jfImageUrl(row.id, row.imageTag) : null;
            const onTap = row.track
              ? () => playList(row.trackIds, row.trackIndex)
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
      <!-- Album art (compact) -->
      <div class="np-art-container">
        ${np.art
          ? html`<img class="np-art" src=${np.art} alt="" loading="eager" />`
          : html`<div class="np-art-placeholder"><${IconMusicNote} /></div>`
        }
        <div class="np-art-gradient" />
      </div>

      <!-- Track info -->
      <div class="np-track-info">
        <p class="np-title">${np.title}</p>
        ${np.artist && html`<p class="np-artist">${np.artist}</p>`}
        ${np.album && html`<p class="np-album">${np.album}</p>`}
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
    { id: 'browse', label: 'Browse', icon: IconBrowse },
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
      <div class=${`smc-tab-panel${activeTab !== 'browse' ? ' hidden' : ''}`}>
        <${BrowseView} hass=${hass} selectedSpeakers=${selectedSpeakers} />
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
