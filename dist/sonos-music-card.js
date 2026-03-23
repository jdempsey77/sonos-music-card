// Sonos Music Card v0.6.0
// Preact + htm, no build step — Custom HA Lovelace card for Sonos via Music Assistant

import { h, render } from 'https://esm.sh/preact@10';
import { useState, useEffect, useCallback, useMemo, useRef } from 'https://esm.sh/preact@10/hooks';
import htm from 'https://esm.sh/htm@3';

const html = htm.bind(h);

// ── Theme tokens ────────────────────────────────────────────────
const THEME = {
  base: '#0f0f1a',
  surface: '#1a1a2e',
  border: '#2a2a3e',
  primary: '#7b2fbe',
  primaryBg: '#1e1230',
  primaryLight: '#e8d5ff',
  accent: '#00c9a7',
  accentBg: '#0d1e1c',
  accentDark: '#04342c',
  text: '#d0d0ee',
  textBright: '#f0e8ff',
  textSpeaker: '#c8c8e8',
  muted: '#6b6b8a',
  statusMuted: '#5a5a7a',
  statusSelected: '#a064d8',
  chevron: '#3a3a5a',
  placeholder: '#3a3a5a',
  pillInactive: '#1e1e30',
  miniPlayerBg: '#1a0e2e',
  navBg: '#0a0a14',
  error: '#ff6b6b',
  radiusCard: '12px',
  radiusEl: '8px',
  font: 'system-ui, -apple-system, sans-serif',
};

// ── SVG Icons ───────────────────────────────────────────────────
const IconSpeaker = () => html`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="6"/></svg>`;
const IconBrowse = () => html`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`;
const IconNowPlaying = () => html`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
const IconVolume = () => html`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`;
const IconPlay = ({ size = 18 } = {}) => html`<svg width=${size} height=${size} viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
const IconPause = ({ size = 18 } = {}) => html`<svg width=${size} height=${size} viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
const IconSearch = () => html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
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
  }
  .smc-header {
    font-size: 14px; font-weight: 600; color: ${THEME.muted};
    text-transform: uppercase; letter-spacing: 1px; margin: 0 0 16px 4px;
  }

  /* ── Speaker grid ── */
  .smc-speaker-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 12px;
  }
  .smc-speaker {
    background: ${THEME.surface}; border: 1px solid ${THEME.border};
    border-radius: ${THEME.radiusCard}; padding: 16px 14px; cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    display: flex; flex-direction: column; gap: 8px;
    user-select: none; -webkit-tap-highlight-color: transparent;
  }
  .smc-speaker:active { transform: scale(0.97); }
  .smc-speaker.selected { border-color: ${THEME.primary}; background: ${THEME.primaryBg}; }
  .smc-speaker.grouped { border-color: ${THEME.accent}; background: ${THEME.accentBg}; }
  .smc-speaker-name { font-size: 12px; font-weight: 500; color: ${THEME.textSpeaker}; margin: 0; display: flex; align-items: center; gap: 6px; }
  .smc-grouped-badge {
    font-size: 8px; padding: 1px 5px; border-radius: 4px;
    background: ${THEME.accentBg}; color: ${THEME.accent}; border: 1px solid ${THEME.accent};
    text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;
  }
  .smc-speaker-status {
    font-size: 10px; color: ${THEME.statusMuted}; margin: 0;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .smc-speaker.selected .smc-speaker-status { color: ${THEME.statusSelected}; }
  .smc-speaker.grouped .smc-speaker-status { color: ${THEME.accent}; }
  .smc-speaker-volume { display: flex; align-items: center; gap: 4px; font-size: 10px; color: ${THEME.statusMuted}; margin-top: 2px; }
  .smc-speaker.selected .smc-speaker-volume { color: ${THEME.statusSelected}; }
  .smc-speaker.grouped .smc-speaker-volume { color: ${THEME.accent}; }
  .smc-speaker-vol-slider {
    width: 100%; height: 3px; -webkit-appearance: none; appearance: none;
    background: ${THEME.border}; border-radius: 2px; outline: none;
    cursor: pointer; margin-top: 4px;
  }
  .smc-speaker-vol-slider::-webkit-slider-thumb {
    -webkit-appearance: none; width: 10px; height: 10px;
    border-radius: 50%; background: ${THEME.primary}; cursor: pointer;
  }

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
  .smc-search {
    display: flex; align-items: center; gap: 8px;
    background: ${THEME.surface}; border: 1px solid ${THEME.border};
    border-radius: ${THEME.radiusEl}; padding: 8px 12px; margin-bottom: 14px;
  }
  .smc-search svg { color: ${THEME.placeholder}; flex-shrink: 0; }
  .smc-search input {
    flex: 1; background: none; border: none; outline: none;
    color: ${THEME.text}; font-size: 13px; font-family: ${THEME.font};
  }
  .smc-search input::placeholder { color: ${THEME.placeholder}; }
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
  .np-scroll { flex: 1; overflow-y: auto; padding-bottom: 60px; }
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

  /* Queue section */
  .np-queue-toggle {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 20px; cursor: pointer; border-top: 1px solid ${THEME.border};
    -webkit-tap-highlight-color: transparent;
  }
  .np-queue-toggle span { font-size: 11px; color: ${THEME.muted}; text-transform: uppercase; letter-spacing: 0.1em; }
  .np-queue-toggle svg { color: ${THEME.muted}; transition: transform 0.2s; }
  .np-queue-toggle.open svg { transform: rotate(180deg); }
  .np-queue-list { padding: 0 12px 16px; }

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
  .smc-tab-panel { display: flex; flex-direction: column; flex: 1; overflow: hidden; }
  .smc-tab-panel.hidden { display: none; }

  .smc-error { color: ${THEME.error}; font-size: 13px; text-align: center; padding: 20px; }
`;

// ── Helpers ─────────────────────────────────────────────────────
function getSpeakerInfo(entityId, state) {
  const attrs = state.attributes;
  const name = attrs.friendly_name || entityId.replace('media_player.', '');
  const volume = attrs.volume_level != null ? Math.round(attrs.volume_level * 100) : null;
  const isGrouped = (attrs.group_members || []).length > 1;
  let status = 'Idle';
  if (state.state === 'playing') {
    status = attrs.media_title ? `Playing \u00b7 ${attrs.media_title}` : 'Playing';
  } else if (hasMediaContext(state)) {
    status = attrs.media_title ? `Paused \u00b7 ${attrs.media_title}` : 'Paused';
  } else if (isGrouped) { status = 'Grouped'; }
  return { name, volume, status, isGrouped };
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
    art: a.entity_picture
      ? (a.entity_picture.startsWith('http') ? a.entity_picture : `${location.origin}${a.entity_picture}`)
      : null,
    isPlaying: state.state === 'playing',
    duration,
    position,
    positionUpdatedAt: a.media_position_updated_at,
    shuffle: !!a.shuffle,
    repeat: a.repeat || 'off',
  };
}

function hasMediaContext(state) {
  if (!state) return false;
  if (state.state === 'playing' || state.state === 'paused') return true;
  // Sonos goes idle on pause but keeps media_title — treat as paused
  // Exception: position=0 + duration>0 means track ended naturally
  if (state.state === 'idle' && state.attributes?.media_title) {
    const pos = state.attributes.media_position || 0;
    const dur = state.attributes.media_duration || 0;
    if (dur > 0 && pos === 0) return false;
    return true;
  }
  return false;
}

function getNowPlaying(hass, selectedSpeakers) {
  if (!hass) return null;
  // Check selected speakers first
  for (const id of selectedSpeakers) {
    const state = hass.states[id];
    if (state && hasMediaContext(state)) {
      return buildNpInfo(id, state);
    }
  }
  // Fallback: find any MA player that is playing/paused
  for (const [id, state] of Object.entries(hass.states)) {
    if (id.startsWith('media_player.') &&
        state.attributes.mass_player_type === 'player' &&
        hasMediaContext(state)) {
      return buildNpInfo(id, state);
    }
  }
  return null;
}

function getSubtitle(item) {
  const t = item.media_content_type || item.media_class || '';
  if (t.includes('artist')) return 'Artist';
  if (t.includes('album')) return 'Album';
  if (t.includes('playlist')) return 'Playlist';
  if (t.includes('track')) return 'Track';
  if (t.includes('app')) return 'Source';
  return t || '';
}


function formatTime(s) {
  if (!s || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec < 10 ? '0' : ''}${sec}`;
}

// ── Speaker Card ────────────────────────────────────────────────
let _volTimer = null;
function SpeakerCard({ entityId, state, isSelected, isGrouped, haGrouped, onTap, hass }) {
  const info = getSpeakerInfo(entityId, state);
  const cls = `smc-speaker${isSelected ? ' selected' : ''}${isGrouped ? ' grouped' : ''}`;
  const showSlider = isSelected || isGrouped;

  const handleVol = useCallback((e) => {
    e.stopPropagation();
    const val = parseInt(e.target.value);
    clearTimeout(_volTimer);
    _volTimer = setTimeout(() => {
      if (hass) hass.callService('media_player', 'volume_set', { entity_id: entityId, volume_level: val / 100 });
    }, 300);
  }, [hass, entityId]);

  return html`
    <div class=${cls} onClick=${() => onTap(entityId)}>
      <p class="smc-speaker-name">${info.name}${haGrouped && !isGrouped && !isSelected
        ? html`<span class="smc-grouped-badge">grouped</span>` : ''}</p>
      <p class="smc-speaker-status">${info.status}</p>
      ${info.volume != null && html`
        <div class="smc-speaker-volume"><${IconVolume} /><span>${info.volume}%</span></div>
      `}
      ${showSlider && info.volume != null && html`
        <input type="range" class="smc-speaker-vol-slider" min="0" max="100" value=${info.volume}
          onClick=${(e) => e.stopPropagation()}
          onInput=${handleVol}
          style=${`background: linear-gradient(to right, ${THEME.primary} ${info.volume}%, ${THEME.border} ${info.volume}%)`}
        />
      `}
    </div>
  `;
}

// ── Speakers View ───────────────────────────────────────────────
function SpeakersView({ hass, selected, onSelect, onGroup, isPlaying }) {
  const maPlayers = useMemo(() => {
    if (!hass) return [];
    return Object.entries(hass.states)
      .filter(([id, state]) => id.startsWith('media_player.') && state.attributes.mass_player_type === 'player')
      .map(([id]) => id).sort();
  }, [hass]);
  const selectedNames = useMemo(() =>
    selected.map(id => hass?.states[id]?.attributes?.friendly_name || id.replace('media_player.', '')),
  [selected, hass]);

  // Pre-compute all grouped entity IDs across all speakers
  const groupedEntityIds = useMemo(() => {
    const grouped = new Set();
    if (!hass) return grouped;
    Object.entries(hass.states).forEach(([id, s]) => {
      const members = s.attributes?.group_members || [];
      if (members.length > 1) members.forEach(m => grouped.add(m));
    });
    return grouped;
  }, [hass]);

  return html`
    <div class="smc-content">
      <p class="smc-header">Speakers</p>
      ${maPlayers.length === 0 && html`<p class="smc-error">No Music Assistant speakers found</p>`}
      <div class="smc-speaker-grid">
        ${maPlayers.map(id => {
          const state = hass.states[id];
          if (!state) return null;
          const idx = selected.indexOf(id);
          const haGrouped = groupedEntityIds.has(id);
          return html`<${SpeakerCard} key=${id} entityId=${id} state=${state}
            isSelected=${idx === 0} isGrouped=${idx > 0} haGrouped=${haGrouped}
            onTap=${onSelect} hass=${hass} />`;
        })}
      </div>
    </div>
    ${selected.length >= 2 && html`
      <div class="smc-group-bar" onClick=${onGroup}>
        <div>
          <span class="smc-group-names">${selectedNames.join(' + ')}</span>
          ${isPlaying && html`<div class="smc-group-warn">Changing group will briefly pause playback</div>`}
        </div>
        <span class="smc-group-action">Play here \u25B6</span>
      </div>
    `}
  `;
}

// ── Browse View ─────────────────────────────────────────────────
const MA_CATEGORIES = ['artists', 'albums', 'tracks', 'playlists', 'radio stations', 'podcasts', 'audiobooks'];
function isMACategory(item) { return MA_CATEGORIES.includes((item.title || '').toLowerCase()); }

function BrowseView({ hass, selectedSpeakers, onPlay }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [breadcrumb, setBreadcrumb] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const entityId = selectedSpeakers[0];
  const hassRef = useRef(hass);
  hassRef.current = hass;

  const doBrowse = useCallback(async (eId, contentId, contentType) => {
    const h = hassRef.current;
    if (!h || !eId) return null;
    const params = { type: 'media_player/browse_media', entity_id: eId };
    if (contentId) { params.media_content_id = contentId; params.media_content_type = contentType || 'music_assistant'; }
    const result = await h.callWS(params);
    return result;
  }, []);

  useEffect(() => {
    if (!entityId) return;
    let cancelled = false;
    const loadRoot = async () => {
      setLoading(true); setError(null); setItems([]);
      setBreadcrumb([{ title: 'Library', contentId: null, contentType: null }]);
      try {
        const result = await doBrowse(entityId, null, null);
        if (cancelled) return;
        const children = result?.children || [];
        const maItems = children.filter(isMACategory);
        setItems(maItems.length > 0 ? maItems : children);
      } catch (err) { if (!cancelled) setError(err.message || String(err)); }
      finally { if (!cancelled) setLoading(false); }
    };
    loadRoot();
    return () => { cancelled = true; };
  }, [entityId]);

  const handleItemTap = useCallback(async (item) => {
    if (item.can_expand) {
      setLoading(true); setError(null);
      try {
        const drillType = item.media_class && item.media_class !== 'directory' ? item.media_class : item.media_content_type;
        const result = await doBrowse(entityId, item.media_content_id, drillType);
        setItems(result?.children || []);
        setBreadcrumb(prev => [...prev, { title: item.title, contentId: item.media_content_id, contentType: item.media_content_type }]);
      } catch (err) { setError(err.message || String(err)); }
      finally { setLoading(false); }
    } else if (item.can_play) { onPlay(item); }
  }, [entityId, doBrowse, onPlay]);

  const handleBreadcrumbTap = useCallback(async (index) => {
    if (index === breadcrumb.length - 1) return;
    const target = breadcrumb[index];
    setLoading(true); setError(null);
    setBreadcrumb(prev => prev.slice(0, index + 1));
    try {
      const result = await doBrowse(entityId, target.contentId, target.contentType);
      const children = result?.children || [];
      setItems(index === 0 ? (children.filter(isMACategory).length > 0 ? children.filter(isMACategory) : children) : children);
    } catch (err) { setError(err.message || String(err)); }
    finally { setLoading(false); }
  }, [breadcrumb, entityId, doBrowse]);

  if (!entityId) {
    return html`<div class="smc-content"><p class="smc-header">Browse</p><p class="smc-error">Select a speaker first</p></div>`;
  }

  return html`
    <div class="smc-content">
      <div class="smc-search"><${IconSearch} /><input type="text"
        placeholder="Filter..."
        onInput=${(e) => { e.stopPropagation(); setSearchQuery(e.target.value); }}
        onClick=${(e) => e.stopPropagation()}
        onKeyDown=${(e) => e.stopPropagation()}
      /></div>
      ${breadcrumb.length > 1 && html`
        <div class="smc-breadcrumb">
          ${breadcrumb.map((crumb, i) => html`
            ${i > 0 && html`<span class="smc-breadcrumb-sep">\u203A</span>`}
            <span key=${i} class=${`smc-breadcrumb-item${i === breadcrumb.length - 1 ? ' current' : ''}`}
              onClick=${() => handleBreadcrumbTap(i)}>${crumb.title}</span>
          `)}
        </div>
      `}
      ${breadcrumb.length <= 1 && html`<p class="smc-section-label">Library</p>`}
      ${loading && html`<p class="smc-loading">Loading...</p>`}
      ${error && html`<p class="smc-error">${error}</p>`}
      ${!loading && !error && html`
        <div class="smc-browse-list">
          ${(searchQuery
            ? items.filter(i => (i.title || '').toLowerCase().includes(searchQuery.toLowerCase()))
            : items
          ).map(item => html`
            <div key=${item.media_content_id} class="smc-browse-row" onClick=${() => handleItemTap(item)}>
              <div class="smc-browse-thumb-placeholder">${item.can_expand ? '\u{1F4C1}' : '\u{266A}'}</div>
              <div class="smc-browse-info">
                <p class="smc-browse-title">${item.title}</p>
                <p class="smc-browse-subtitle">${getSubtitle(item)}</p>
              </div>
              ${item.can_expand && html`<span class="smc-browse-chevron">\u203A</span>`}
            </div>
          `)}
          ${items.length === 0 && html`<p class="smc-loading">No items found</p>`}
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
  const [queueOpen, setQueueOpen] = useState(false);
  const [queueItems, setQueueItems] = useState([]);
  const [queueLoaded, setQueueLoaded] = useState(false);

  // Reset queue when entity or track changes
  useEffect(() => {
    setQueueLoaded(false);
    setQueueItems([]);
  }, [entityId, np?.title]);

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

  // Load queue
  useEffect(() => {
    const queueEid = np?.entityId || selectedSpeakers[0];
    if (!queueOpen || queueLoaded || !queueEid) return;
    const h = hassRef.current;
    if (!h) return;
    const loadQueue = async () => {
      try {
        const result = await h.callWS({
          type: 'media_player/browse_media',
          entity_id: queueEid,
          media_content_id: 'queue',
          media_content_type: 'music_assistant',
        });
        setQueueItems(result?.children || []);
      } catch (err) {
        console.warn('[sonos-music-card] Queue load failed:', err);
      }
      setQueueLoaded(true);
    };
    loadQueue();
  }, [queueOpen, queueLoaded, np, selectedSpeakers]);

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
          ? html`<img class="np-art" src=${np.art} alt="" />`
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

      <!-- Volume sliders -->
      <div class="np-volume-section">
        <p class="np-volume-label">Volume \u00b7 ${volumeSpeakers.length} speaker${volumeSpeakers.length !== 1 ? 's' : ''}</p>
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

      <!-- Queue -->
      <div class=${`np-queue-toggle${queueOpen ? ' open' : ''}`} onClick=${() => setQueueOpen(v => !v)}>
        <span>Queue</span>
        <${IconChevron} />
      </div>
      ${queueOpen && html`
        <div class="np-queue-list">
          ${queueItems.length === 0 && html`<p class="smc-loading">No queue items</p>`}
          ${queueItems.map(item => html`
            <div key=${item.media_content_id} class="smc-browse-row">
              <div class="smc-browse-thumb-placeholder">\u{266A}</div>
              <div class="smc-browse-info">
                <p class="smc-browse-title">${item.title}</p>
                <p class="smc-browse-subtitle">${getSubtitle(item)}</p>
              </div>
            </div>
          `)}
        </div>
      `}
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
        ? html`<img class="smc-mini-art" src=${nowPlaying.art} alt="" />`
        : html`<div class="smc-mini-art-placeholder" />`
      }
      <div class="smc-mini-info">
        <p class="smc-mini-title">${nowPlaying.title}</p>
        ${nowPlaying.artist && html`<p class="smc-mini-artist">${nowPlaying.artist}</p>`}
      </div>
      <button class="smc-mini-btn" onClick=${handlePlayPause}>
        ${nowPlaying.isPlaying ? html`<${IconPause} />` : html`<${IconPlay} />`}
      </button>
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

function smcInit(hass) {

  // 1. Check for any currently playing/paused MA speaker
  const playing = Object.entries(hass.states)
    .find(([id, s]) => id.startsWith('media_player.') &&
      s.attributes?.mass_player_type === 'player' && hasMediaContext(s))?.[0];

  // 2. Try localStorage
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(SMC_KEY) || '[]'); } catch {}
  saved = saved.filter(id => hass.states[id]?.attributes?.mass_player_type === 'player');

  // 3. Priority: playing > saved > empty
  _smcSpeakers = playing ? [playing] : saved.length > 0 ? saved : [];
  console.log('[smc] init: speakers=', _smcSpeakers, 'playing=', playing, 'saved=', saved);
}

// Called on every hass update. If no selected speaker is currently playing,
// auto-switches _smcSpeakers to whichever MA player IS playing (if any).
// Does NOT persist to localStorage — only explicit user taps do that.
function smcAutoDetect(hass) {
  const selPlaying = _smcSpeakers.some(id =>
    hasMediaContext(hass.states[id])
  );
  if (selPlaying) return;

  const active = Object.entries(hass.states).find(([id, s]) =>
    id.startsWith('media_player.') &&
    s.attributes?.mass_player_type === 'player' &&
    hasMediaContext(s)
  )?.[0];

  if (active && !_smcSpeakers.includes(active)) {
    console.log('[smc] auto-detect: switching to', active);
    _smcSpeakers = [active];
    _smcDirty = true;
    try { localStorage.setItem(SMC_KEY, JSON.stringify(_smcSpeakers)); } catch {}
  }
}

function smcSelectSpeaker(entityId) {
  const idx = _smcSpeakers.indexOf(entityId);
  _smcSpeakers = idx >= 0
    ? _smcSpeakers.filter(id => id !== entityId)
    : [..._smcSpeakers, entityId];
  // Save to localStorage — only on explicit user tap
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
  const primaryEntity = selectedSpeakers[0] || null;

  // Derive now-playing directly from hass — no cached state
  const nowPlaying = useMemo(() => getNowPlaying(hass, selectedSpeakers), [hass, selectedSpeakers]);

  const isPlaying = useMemo(() =>
    selectedSpeakers.some(id => hass?.states[id]?.state === 'playing'),
  [hass, selectedSpeakers]);

  const handleSelectSpeaker = useCallback((entityId) => {
    smcSelectSpeaker(entityId);
    forceUpdate(n => n + 1); // trigger re-render with new _smcSpeakers
  }, []);

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

  const handlePlay = useCallback(async (item) => {
    if (!hass || !primaryEntity) return;
    try {
      await hass.callService('media_player', 'play_media', {
        entity_id: primaryEntity,
        media_content_id: item.media_content_id,
        media_content_type: item.media_content_type,
      });
    } catch (err) { console.error('[smc] Play failed:', err); }
  }, [hass, primaryEntity]);

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
        <${BrowseView} hass=${hass} selectedSpeakers=${selectedSpeakers} onPlay=${handlePlay} />
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
  setConfig(config) { this._config = config || {}; }
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
    description: 'Full music browser and player for Sonos via Music Assistant',
  });
}
