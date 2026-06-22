// Sonos Music Card v0.12.2
// Preact + htm, no build step — Custom HA Lovelace card for Sonos via Music Assistant

import { h, render } from 'https://esm.sh/preact@10';
import { useState, useEffect, useCallback, useMemo, useRef } from 'https://esm.sh/preact@10/hooks';
import htm from 'https://esm.sh/htm@3';

const html = htm.bind(h);

// ── Music Assistant config ─────────────────────────────────────
const MA_ENTRY_ID = '01KMBK5ZVGF4V016KQG8ZGX9NK';

function getProvider(uri = '') {
  if (uri.startsWith('ytmusic--')) return 'ytm';
  if (uri.startsWith('plex--'))    return 'plex';
  if (uri.startsWith('library://')) return 'library';
  return 'unknown';
}

function getProviderBadge(uri = '') {
  const p = getProvider(uri);
  if (p === 'ytm')  return { label: 'YTM',  color: '#ef4444', bg: '#2d0a0a' };
  if (p === 'plex') return { label: 'PLEX', color: '#4ade80', bg: '#0a2d0a' };
  return null;
}

function dedupeByName(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = item.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function smcResolveImage(url) {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  return `${location.origin}${url}`;
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
  .smc-tab-panel { display: flex; flex-direction: column; flex: 1; overflow: hidden; min-height: 0; }
  .smc-tab-panel.hidden { display: none; }

  .smc-error { color: ${THEME.error}; font-size: 13px; text-align: center; padding: 20px; }

  /* ── Browse mode toggle ── */
  .smc-mode-toggle {
    display: flex; gap: 8px; margin-bottom: 14px;
  }
  .smc-mode-pill {
    flex: 1; padding: 10px 12px; border-radius: ${THEME.radiusEl};
    font-size: 12px; font-weight: 600; text-align: center;
    cursor: pointer; -webkit-tap-highlight-color: transparent;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
    border: 1px solid ${THEME.border}; background: ${THEME.surface}; color: ${THEME.muted};
  }
  .smc-mode-pill.active { background: ${THEME.primaryBg}; border-color: ${THEME.primary}; color: #93c5fd; }

  /* ── Search results ── */
  .smc-search-placeholder {
    text-align: center; padding: 40px 20px; color: ${THEME.muted}; font-size: 13px;
  }
  .smc-search-section { margin-bottom: 8px; }
  .smc-browse-thumb {
    width: 38px; height: 38px; border-radius: 6px;
    object-fit: cover; flex-shrink: 0;
  }
  .smc-provider-badge {
    font-size: 8px; font-weight: 700; padding: 2px 5px;
    border-radius: 4px; flex-shrink: 0; letter-spacing: 0.5px;
  }

  /* ── Recently played ── */
  .smc-recent-row {
    display: flex; gap: 10px; overflow-x: auto; padding: 0 0 12px;
    scrollbar-width: none; -ms-overflow-style: none;
  }
  .smc-recent-row::-webkit-scrollbar { display: none; }
  .smc-recent-tile {
    flex-shrink: 0; width: 72px; cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .smc-recent-art {
    width: 72px; height: 72px; border-radius: 6px;
    object-fit: cover; background: ${THEME.surface}; display: block;
  }
  .smc-recent-art-placeholder {
    width: 72px; height: 72px; border-radius: 6px;
    background: ${THEME.surface}; display: flex;
    align-items: center; justify-content: center;
    color: ${THEME.chevron}; font-size: 20px;
  }
  .smc-recent-title {
    font-size: 10px; color: ${THEME.text}; margin: 4px 0 0;
    overflow: hidden; text-overflow: ellipsis;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  }

  /* ── Context play buttons ── */
  .smc-context-buttons {
    display: flex; gap: 8px; margin-bottom: 14px;
  }
  .smc-context-btn {
    flex: 1; padding: 10px 12px; border-radius: ${THEME.radiusEl};
    font-size: 12px; font-weight: 600; text-align: center;
    cursor: pointer; border: none; -webkit-tap-highlight-color: transparent;
  }
  .smc-context-btn:active { opacity: 0.85; }
  .smc-context-btn.primary { background: ${THEME.primary}; color: #fff; }
  .smc-context-btn.secondary { background: ${THEME.surface}; color: ${THEME.text}; border: 1px solid ${THEME.border}; }

  /* ── Home screen ── */
  .smc-home-section { margin-bottom: 20px; }
  .smc-home-section-header {
    display: flex; align-items: center;
    justify-content: space-between; margin-bottom: 8px;
  }
  .smc-home-section-title {
    font-size: 10px; color: ${THEME.statusMuted};
    text-transform: uppercase; letter-spacing: 0.1em;
  }
  .smc-home-refresh {
    background: none; border: none; color: ${THEME.muted};
    cursor: pointer; font-size: 14px; padding: 2px 4px;
    -webkit-tap-highlight-color: transparent;
  }
  .smc-home-refresh:active { opacity: 0.6; }
  .smc-home-tiles {
    display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px;
    scrollbar-width: none; -ms-overflow-style: none;
  }
  .smc-home-tiles::-webkit-scrollbar { display: none; }
  .smc-home-tile {
    flex-shrink: 0; width: 72px; cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .smc-home-tile-art {
    width: 72px; height: 72px; border-radius: 8px;
    background: ${THEME.surface}; border: 1px solid ${THEME.border};
    object-fit: cover; display: block; margin-bottom: 5px;
  }
  .smc-home-tile-placeholder {
    width: 72px; height: 72px; border-radius: 8px;
    background: ${THEME.surface}; border: 1px solid ${THEME.border};
    display: flex; align-items: center; justify-content: center;
    color: ${THEME.chevron}; font-size: 20px; margin-bottom: 5px;
  }
  .smc-home-tile-name {
    font-size: 10px; color: ${THEME.muted};
    text-align: center; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap;
  }

  /* ── Context menu ── */
  .smc-more-btn {
    width: 28px; height: 28px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 6px; color: ${THEME.muted};
    font-size: 13px; letter-spacing: 1px;
    flex-shrink: 0; cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .smc-more-btn:hover { background: ${THEME.surface}; color: ${THEME.text}; }
  .smc-ctx-menu {
    background: ${THEME.surface};
    border: 1px solid ${THEME.border};
    border-radius: 8px;
    margin: 0 12px 4px 58px;
    overflow: hidden;
  }
  .smc-ctx-item {
    display: flex; align-items: center; gap: 10px;
    padding: 9px 12px; font-size: 12px;
    color: ${THEME.text}; cursor: pointer;
    border-bottom: 1px solid #1a1a1a;
  }
  .smc-ctx-item:last-child { border-bottom: none; }
  .smc-ctx-item:hover { background: #252525; }
  .smc-ctx-item.primary { color: #93c5fd; }
  .smc-ctx-item.green { color: #86efac; }
  .smc-ctx-item.muted { color: ${THEME.muted}; }
  .smc-ctx-icon {
    width: 14px; text-align: center;
    font-size: 11px; flex-shrink: 0; color: inherit;
  }
  .smc-ctx-divider { height: 1px; background: #1a1a1a; }
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
    isExternal: isExternalSource(state),
    source: a.source || null,
    duration,
    position,
    positionUpdatedAt: a.media_position_updated_at,
    shuffle: !!a.shuffle,
    repeat: a.repeat || 'off',
  };
}

function isExternalSource(state) {
  if (!state) return false;
  const source = state.attributes?.source;
  return state.state === 'playing' && source && source !== 'Music Assistant Queue';
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

// ── Speaker type detection ──────────────────────────────────────
const SONOS_IDS = ['office_2', 'family_room', 'basement_2', 'garage_2', 'float'];
function getSpeakerType(entityId) {
  return SONOS_IDS.some(s => entityId.includes(s)) ? 'sonos' : 'google';
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

  let subtext = '';
  if (isOff) subtext = 'Off';
  else if (isPlaying && title) subtext = `Playing \u00b7 ${title}`;
  else if (isGrouped) subtext = 'Grouped';
  else subtext = 'Idle';

  return html`
    <div class=${`smc-spk-row${selected ? ' selected' : ''}`}
         onClick=${() => onToggle(entityId)}>
      <div class=${`smc-chk${selected ? ' checked' : ''}`}>
        ${selected ? '\u2713' : ''}
      </div>
      <div class="smc-spk-icon">
        ${getSpeakerType(entityId) === 'google' ? 'G' : '\u266A'}
      </div>
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
function SpeakersView({ hass, selected, onSelect, onGroup, isPlaying, includePlayers, excludePlayers }) {
  const maPlayers = useMemo(() => {
    if (!hass) return [];
    if (includePlayers?.length) {
      return includePlayers.filter(id => hass.states[id]).sort();
    }
    let players = Object.entries(hass.states)
      .filter(([id, state]) => {
        if (!id.startsWith('media_player.')) return false;
        if (state.attributes?.mass_player_type !== 'player') return false;
        const name = state.attributes?.friendly_name || '';
        if (name.endsWith('+')) return false;
        if (name.endsWith('(Cast)')) return false;
        return true;
      })
      .map(([id]) => id);
    if (excludePlayers?.length) {
      players = players.filter(id => !excludePlayers.includes(id));
    }
    return players.sort();
  }, [hass, includePlayers, excludePlayers]);

  const selectedNames = useMemo(() =>
    selected.map(id => hass?.states[id]?.attributes?.friendly_name || id.replace('media_player.', '')),
  [selected, hass]);

  // Group by type
  const { sonos, google } = useMemo(() => {
    const s = [], g = [];
    maPlayers.forEach(id => {
      if (getSpeakerType(id) === 'sonos') s.push(id);
      else g.push(id);
    });
    return { sonos: s, google: g };
  }, [maPlayers]);

  const selectAll = useCallback(() => {
    maPlayers.forEach(id => { if (!selected.includes(id)) onSelect(id); });
  }, [maPlayers, selected, onSelect]);
  const selectNone = useCallback(() => {
    selected.forEach(id => onSelect(id));
  }, [selected, onSelect]);

  return html`
    <div class="smc-content">
      ${maPlayers.length === 0 && html`<p class="smc-error">No Music Assistant speakers found</p>`}
      ${maPlayers.length > 0 && html`
        <div class="smc-spk-header">
          <span class="smc-spk-title">Select speakers</span>
          <div class="smc-spk-quick">
            <span onClick=${selectAll}>All</span>
            <span style="color:${THEME.border}">\u00b7</span>
            <span onClick=${selectNone} style="color:${THEME.muted}">None</span>
          </div>
        </div>
        ${sonos.length > 0 && html`
          <div class="smc-spk-group-label">Sonos</div>
          ${sonos.map(id => html`
            <${SpeakerRow} key=${id} entityId=${id} hass=${hass}
              selected=${selected.includes(id)} onToggle=${onSelect} />
          `)}
        `}
        ${sonos.length > 0 && google.length > 0 && html`<div class="smc-spk-divider" />`}
        ${google.length > 0 && html`
          <div class="smc-spk-group-label">Google</div>
          ${google.map(id => html`
            <${SpeakerRow} key=${id} entityId=${id} hass=${hass}
              selected=${selected.includes(id)} onToggle=${onSelect} />
          `)}
        `}
      `}
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

// ── Artist grouping (collapse feat. variants) ──────────────────
function getBaseArtist(title) {
  const match = title.match(/^(.+?)(?:\s+feat\.?\s|\s+featuring\s|\s+ft\.?\s)/i);
  return match ? match[1].trim() : null;
}

function groupArtists(items) {
  const baseNames = new Set(items.map(i => i.title));
  const baseMap = new Map();
  const standalones = [];

  items.forEach(item => {
    const base = getBaseArtist(item.title);
    if (base) {
      if (!baseMap.has(base)) baseMap.set(base, { baseItem: null, variants: [] });
      baseMap.get(base).variants.push(item);
    } else {
      standalones.push(item);
    }
  });

  // Link standalone entries to their variant groups
  standalones.forEach(item => {
    if (baseMap.has(item.title)) {
      baseMap.get(item.title).baseItem = item;
    }
  });

  const result = [];
  const handledBases = new Set();

  // Build sorted list: standalones that have groups become group entries
  standalones.forEach(item => {
    if (baseMap.has(item.title)) {
      handledBases.add(item.title);
      const g = baseMap.get(item.title);
      result.push({ type: 'group', base: item.title, baseItem: g.baseItem, variants: g.variants });
    } else {
      result.push({ type: 'single', item });
    }
  });

  // Groups with no standalone base entry
  baseMap.forEach((g, base) => {
    if (!handledBases.has(base)) {
      result.push({ type: 'group', base, baseItem: null, variants: g.variants });
    }
  });

  result.sort((a, b) => {
    const nameA = a.type === 'single' ? a.item.title : a.base;
    const nameB = b.type === 'single' ? b.item.title : b.base;
    return nameA.localeCompare(nameB);
  });
  return result;
}

// ── Track Row with Context Menu ─────────────────────────────────
function TrackRow({ item, hass, entityId, onPlay, openMenuId, setOpenMenuId }) {
  const artistName = item.artists?.[0]?.name || item.artist || 'this artist';
  const isMenuOpen = openMenuId === (item.uri || item.media_content_id);
  const menuId = item.uri || item.media_content_id;

  const handleMore = useCallback((e) => {
    e.stopPropagation();
    setOpenMenuId(prev => prev === menuId ? null : menuId);
  }, [menuId, setOpenMenuId]);

  const doAction = useCallback(async (action, e) => {
    if (e) e.stopPropagation();
    setOpenMenuId(null);
    if (!hass || !entityId) return;
    const mediaId = item.uri || item.media_content_id;
    const mediaType = item.media_type || item.media_content_type || 'track';
    try {
      if (action === 'play') {
        await hass.callService('music_assistant', 'play_media',
          { media_id: mediaId, media_type: mediaType, radio_mode: false },
          { entity_id: entityId });
      } else if (action === 'next' || action === 'queue') {
        // Check if speaker is playing — if idle, fall back to 'play' enqueue mode
        const spkState = hass.states[entityId]?.state;
        const isActive = spkState === 'playing' || spkState === 'paused';
        const enqueueMode = isActive ? (action === 'next' ? 'next' : 'add') : 'play';
        await hass.callService('music_assistant', 'play_media',
          { media_id: mediaId, media_type: mediaType, enqueue: enqueueMode, radio_mode: false },
          { entity_id: entityId });
      } else if (action === 'radio') {
        const artistUri = item.artists?.[0]?.uri || mediaId;
        await hass.callService('music_assistant', 'play_media',
          { media_id: artistUri, media_type: 'artist', radio_mode: true },
          { entity_id: entityId });
      }
    } catch (err) { console.error('[smc] Context action failed:', err); }
  }, [hass, entityId, item, setOpenMenuId]);

  const title = item.name || item.title || 'Unknown';
  const subtitle = item.artists?.[0]?.name || item.artist || 'track';
  const image = item.image || (item.thumbnail ? (item.thumbnail.startsWith('http') ? item.thumbnail : location.origin + item.thumbnail) : null);
  const badge = item.uri ? getProviderBadge(item.uri) : null;

  return html`
    <div>
      <div class="smc-browse-row" onClick=${() => onPlay ? onPlay() : doAction('play')}>
        ${image
          ? html`<img class="smc-browse-thumb" src=${image} alt="" />`
          : html`<div class="smc-browse-thumb-placeholder">\u{266A}</div>`
        }
        <div class="smc-browse-info">
          <p class="smc-browse-title">${title}</p>
          <p class="smc-browse-subtitle">${subtitle}</p>
        </div>
        ${badge && html`
          <span class="smc-provider-badge" style=${`color:${badge.color}; border:1px solid ${badge.color}; background:${badge.bg};`}>
            ${badge.label}
          </span>
        `}
        <div class="smc-more-btn" onClick=${handleMore}>\u22EF</div>
      </div>
      ${isMenuOpen && html`
        <div class="smc-ctx-menu" onClick=${(e) => e.stopPropagation()}>
          <div class="smc-ctx-item primary" onClick=${(e) => doAction('play', e)}>
            <span class="smc-ctx-icon">\u25B6</span> Play now
          </div>
          <div class="smc-ctx-item" onClick=${(e) => doAction('next', e)}>
            <span class="smc-ctx-icon">\u00BB</span> Play next
          </div>
          <div class="smc-ctx-item" onClick=${(e) => doAction('queue', e)}>
            <span class="smc-ctx-icon">+</span> Add to queue
          </div>
          <div class="smc-ctx-divider" />
          <div class="smc-ctx-item muted" onClick=${(e) => doAction('radio', e)}>
            <span class="smc-ctx-icon">~</span> Artist radio \u2014 ${artistName}
          </div>
        </div>
      `}
    </div>
  `;
}

// ── Home View ───────────────────────────────────────────────────
function HomeView({ hass, primaryEntity }) {
  const [quickPicks, setQuickPicks] = useState([]);
  const [randomArtists, setRandomArtists] = useState([]);
  const [randomAlbums, setRandomAlbums] = useState([]);
  const [listenAgain, setListenAgain] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openMenuId, setOpenMenuId] = useState(null);
  const hassRef = useRef(hass);
  hassRef.current = hass;

  // Close menu on outside click
  useEffect(() => {
    if (!openMenuId) return;
    const close = () => setOpenMenuId(null);
    document.addEventListener('click', close, { once: true });
    return () => document.removeEventListener('click', close);
  }, [openMenuId]);

  const fetchSection = useCallback(async (mediaType, orderBy, limit) => {
    const h = hassRef.current;
    if (!h) return [];
    const r = await h.callWS({
      type: 'call_service',
      domain: 'music_assistant',
      service: 'get_library',
      service_data: { config_entry_id: MA_ENTRY_ID, media_type: mediaType, order_by: orderBy, limit },
      return_response: true,
    });
    return r?.response?.items || [];
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [picks, artists, albums, again] = await Promise.all([
        fetchSection('track', 'recently_played', 8),
        fetchSection('artist', 'random', 10),
        fetchSection('album', 'random', 10),
        fetchSection('track', 'recently_played', 10),
      ]);
      setQuickPicks(picks);
      setRandomArtists(artists);
      setRandomAlbums(albums);
      setListenAgain(again);
    } catch (e) { console.error('[smc] HomeView load failed:', e); }
    setLoading(false);
  }, [fetchSection]);

  useEffect(() => { loadAll(); }, []);

  const playItem = useCallback(async (item, radioMode) => {
    const h = hassRef.current;
    if (!h || !primaryEntity) return;
    try {
      await h.callService('music_assistant', 'play_media', {
        media_id: item.uri,
        media_type: item.media_type,
        radio_mode: radioMode,
      }, { entity_id: primaryEntity });
    } catch (err) { console.error('[smc] Home play failed:', err); }
  }, [primaryEntity]);

  const refreshSection = useCallback(async (section) => {
    try {
      if (section === 'picks') setQuickPicks(await fetchSection('track', 'recently_played', 8));
      else if (section === 'artists') setRandomArtists(await fetchSection('artist', 'random', 10));
      else if (section === 'albums') setRandomAlbums(await fetchSection('album', 'random', 10));
      else if (section === 'again') setListenAgain(await fetchSection('track', 'recently_played', 10));
    } catch (e) { console.error('[smc] Refresh failed:', e); }
  }, [fetchSection]);

  if (loading) return html`<p class="smc-loading">Loading...</p>`;

  return html`
    ${quickPicks.length > 0 && html`
      <div class="smc-home-section">
        <div class="smc-home-section-header">
          <span class="smc-home-section-title">Quick Picks</span>
          <button class="smc-home-refresh" onClick=${() => refreshSection('picks')}>\u21BB</button>
        </div>
        <div class="smc-browse-list">
          ${quickPicks.map(item => html`
            <${TrackRow} key=${item.uri} item=${item} hass=${hass}
              entityId=${primaryEntity} onPlay=${() => playItem(item, false)}
              openMenuId=${openMenuId} setOpenMenuId=${setOpenMenuId} />
          `)}
        </div>
      </div>
    `}
    ${randomArtists.length > 0 && html`
      <div class="smc-home-section">
        <div class="smc-home-section-header">
          <span class="smc-home-section-title">Random Artists</span>
          <button class="smc-home-refresh" onClick=${() => refreshSection('artists')}>\u21BB</button>
        </div>
        <div class="smc-home-tiles">
          ${randomArtists.map(item => html`
            <div key=${item.uri} class="smc-home-tile" onClick=${() => playItem(item, true)}>
              ${item.image
                ? html`<img class="smc-home-tile-art" src=${smcResolveImage(item.image)} alt="" />`
                : html`<div class="smc-home-tile-placeholder">\u{266A}</div>`
              }
              <p class="smc-home-tile-name">${item.name}</p>
            </div>
          `)}
        </div>
      </div>
    `}
    ${randomAlbums.length > 0 && html`
      <div class="smc-home-section">
        <div class="smc-home-section-header">
          <span class="smc-home-section-title">Random Albums</span>
          <button class="smc-home-refresh" onClick=${() => refreshSection('albums')}>\u21BB</button>
        </div>
        <div class="smc-home-tiles">
          ${randomAlbums.map(item => html`
            <div key=${item.uri} class="smc-home-tile" onClick=${() => playItem(item, false)}>
              ${item.image
                ? html`<img class="smc-home-tile-art" src=${smcResolveImage(item.image)} alt="" />`
                : html`<div class="smc-home-tile-placeholder">\u{266A}</div>`
              }
              <p class="smc-home-tile-name">${item.name}</p>
            </div>
          `)}
        </div>
      </div>
    `}
    ${listenAgain.length > 0 && html`
      <div class="smc-home-section">
        <div class="smc-home-section-header">
          <span class="smc-home-section-title">Listen Again</span>
          <button class="smc-home-refresh" onClick=${() => refreshSection('again')}>\u21BB</button>
        </div>
        <div class="smc-browse-list">
          ${listenAgain.map(item => html`
            <${TrackRow} key=${item.uri} item=${item} hass=${hass}
              entityId=${primaryEntity} onPlay=${() => playItem(item, false)}
              openMenuId=${openMenuId} setOpenMenuId=${setOpenMenuId} />
          `)}
        </div>
      </div>
    `}
  `;
}

// ── Search Result Row ────────────────────────────────────────────
function SearchResultRow({ item, hass, entityId, onDrillFromSearch, openMenuId, setOpenMenuId }) {
  const badge = getProviderBadge(item.uri);
  const subtitle = item.media_type === 'track' || item.media_type === 'album'
    ? (item.artists?.[0]?.name || '') : 'Artist';

  const handleTap = useCallback(async () => {
    if (item.media_type === 'artist') {
      onDrillFromSearch(item, true);
    } else if (item.media_type !== 'track') {
      onDrillFromSearch(item, false);
    }
    // tracks handled by TrackRow
  }, [item, onDrillFromSearch]);

  // For tracks, render TrackRow with context menu
  if (item.media_type === 'track') {
    return html`<${TrackRow} item=${item} hass=${hass} entityId=${entityId}
      openMenuId=${openMenuId} setOpenMenuId=${setOpenMenuId} />`;
  }

  return html`
    <div class="smc-browse-row" onClick=${handleTap}>
      ${item.image
        ? html`<img class="smc-browse-thumb" src=${smcResolveImage(item.image)} alt="" />`
        : html`<div class="smc-browse-thumb-placeholder">\u{266A}</div>`
      }
      <div class="smc-browse-info">
        <p class="smc-browse-title">${item.name}</p>
        <p class="smc-browse-subtitle">${subtitle}</p>
      </div>
      ${badge && html`
        <span class="smc-provider-badge" style=${`color:${badge.color}; border:1px solid ${badge.color}; background:${badge.bg};`}>
          ${badge.label}
        </span>
      `}
      <span class="smc-browse-chevron">\u203A</span>
    </div>
  `;
}

// ── Browse View ─────────────────────────────────────────────────
const MA_CATEGORIES = ['artists', 'albums', 'tracks', 'playlists', 'radio stations', 'podcasts', 'audiobooks'];
function isMACategory(item) { return MA_CATEGORIES.includes((item.title || '').toLowerCase()); }
function isHAMediaSource(item) { return (item.media_content_id || '').startsWith('media-source://'); }

function BrowseView({ hass, selectedSpeakers, onPlay }) {
  const [browseMode, setBrowseMode] = useState('home'); // 'home' | 'search' | 'library'
  // -- Search state --
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null); // { artists, albums, tracks }
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimer = useRef(null);
  // -- Library state --
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [breadcrumb, setBreadcrumb] = useState([]);
  const [libFilter, setLibFilter] = useState('');
  const [recentItems, setRecentItems] = useState([]);
  const recentFetched = useRef(false);
  const [currentContainer, setCurrentContainer] = useState(null);
  const [openMenuId, setOpenMenuId] = useState(null);
  const entityId = selectedSpeakers[0];
  const hassRef = useRef(hass);
  hassRef.current = hass;

  // Close menu on outside click
  useEffect(() => {
    if (!openMenuId) return;
    const close = () => setOpenMenuId(null);
    document.addEventListener('click', close, { once: true });
    return () => document.removeEventListener('click', close);
  }, [openMenuId]);

  const doBrowse = useCallback(async (eId, contentId, contentType) => {
    const h = hassRef.current;
    if (!h || !eId) return null;
    const params = { type: 'media_player/browse_media', entity_id: eId };
    if (contentId) { params.media_content_id = contentId; params.media_content_type = contentType || 'music_assistant'; }
    const result = await h.callWS(params);
    return result;
  }, []);

  // Filter root children: keep MA categories, remove HA media sources
  const filterLibRoot = useCallback((children) => {
    const maItems = children.filter(c => isMACategory(c) && !isHAMediaSource(c));
    return maItems.length > 0 ? maItems : children.filter(c => !isHAMediaSource(c));
  }, []);

  // Load library root
  useEffect(() => {
    if (!entityId) return;
    let cancelled = false;
    const loadRoot = async () => {
      setLoading(true); setError(null); setItems([]);
      setCurrentContainer(null);
      setBreadcrumb([{ title: 'Library', contentId: null, contentType: null }]);
      try {
        const result = await doBrowse(entityId, null, null);
        if (cancelled) return;
        setItems(filterLibRoot(result?.children || []));
      } catch (err) { if (!cancelled) setError(err.message || String(err)); }
      finally { if (!cancelled) setLoading(false); }
    };
    loadRoot();
    return () => { cancelled = true; };
  }, [entityId]);

  // Fetch recently played (once per mount)
  useEffect(() => {
    if (!entityId || recentFetched.current) return;
    recentFetched.current = true;
    const fetchRecent = async () => {
      try {
        const h = hassRef.current;
        if (!h) return;
        const result = await h.callWS({
          type: 'media_player/browse_media',
          entity_id: entityId,
          media_content_id: 'recently_played',
          media_content_type: 'music_assistant',
        });
        setRecentItems((result?.children || []).slice(0, 6));
      } catch { /* silently ignore */ }
    };
    fetchRecent();
  }, [entityId]);

  // Debounced MA search
  useEffect(() => {
    if (browseMode !== 'search') return;
    clearTimeout(searchTimer.current);
    if (!searchQuery || searchQuery.length < 2) {
      setSearchResults(null);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    searchTimer.current = setTimeout(async () => {
      const h = hassRef.current;
      if (!h) return;
      try {
        const result = await h.callWS({
          type: 'call_service',
          domain: 'music_assistant',
          service: 'search',
          service_data: { config_entry_id: MA_ENTRY_ID, name: searchQuery, limit: 20 },
          return_response: true,
        });
        const resp = result?.response || result;
        setSearchResults({
          artists: dedupeByName(resp.artists || []),
          albums: dedupeByName(resp.albums || []),
          tracks: dedupeByName(resp.tracks || []),
        });
      } catch (err) {
        console.error('[smc] Search failed:', err);
        setSearchResults({ artists: [], albums: [], tracks: [] });
      }
      setSearchLoading(false);
    }, 400);
    return () => clearTimeout(searchTimer.current);
  }, [searchQuery, browseMode]);

  // Drill from search result into browse tree (or play directly if browse fails)
  const handleDrillFromSearch = useCallback(async (item, isArtist) => {
    try {
      const result = await doBrowse(entityId, item.uri, 'music_assistant');
      if (result?.children?.length) {
        // Switch to library mode to show drill-down
        setBrowseMode('library');
        setItems(result.children);
        setCurrentContainer({ title: item.name, media_content_id: item.uri, media_content_type: 'music_assistant', media_class: item.media_type });
        setBreadcrumb([
          { title: 'Library', contentId: null, contentType: null },
          { title: item.name, contentId: item.uri, contentType: 'music_assistant', _container: { title: item.name, media_content_id: item.uri, media_content_type: 'music_assistant', media_class: item.media_type } },
        ]);
        return;
      }
    } catch { /* browse failed — play directly */ }
    // Fallback: play via MA service
    try {
      await hass.callService('music_assistant', 'play_media', {
        media_id: item.uri,
        media_type: item.media_type,
        radio_mode: isArtist,
      }, { entity_id: entityId });
    } catch (err) { console.error('[smc] Search drill play failed:', err); }
  }, [entityId, doBrowse, hass]);

  // Library: handle item tap
  const handleItemTap = useCallback(async (item) => {
    if (item.can_expand) {
      setLoading(true); setError(null);
      try {
        const drillType = item.media_class && item.media_class !== 'directory' ? item.media_class : item.media_content_type;
        const result = await doBrowse(entityId, item.media_content_id, drillType);
        setItems(result?.children || []);
        setCurrentContainer(item);
        setBreadcrumb(prev => [...prev, { title: item.title, contentId: item.media_content_id, contentType: item.media_content_type, _container: item }]);
      } catch (err) { setError(err.message || String(err)); }
      finally { setLoading(false); }
    } else if (item.can_play) {
      if (currentContainer) {
        onPlay({ ...item, _useContainer: currentContainer });
      } else {
        onPlay(item);
      }
    }
  }, [entityId, doBrowse, onPlay, currentContainer]);

  const handleBreadcrumbTap = useCallback(async (index) => {
    if (index === breadcrumb.length - 1) return;
    const target = breadcrumb[index];
    setLoading(true); setError(null);
    setBreadcrumb(prev => prev.slice(0, index + 1));
    setCurrentContainer(target._container || null);
    try {
      if (index === 0) {
        const result = await doBrowse(entityId, target.contentId, target.contentType);
        setItems(filterLibRoot(result?.children || []));
      } else {
        const result = await doBrowse(entityId, target.contentId, target.contentType);
        setItems(result?.children || []);
      }
    } catch (err) { setError(err.message || String(err)); }
    finally { setLoading(false); }
  }, [breadcrumb, entityId, doBrowse, filterLibRoot]);

  // Detect artist list level for grouping
  const isArtistLevel = breadcrumb.length === 2 &&
    breadcrumb[breadcrumb.length - 1]?.title?.toLowerCase() === 'artists';

  const handleFeatGroupTap = useCallback((group) => {
    const subItems = [];
    if (group.baseItem) subItems.push(group.baseItem);
    subItems.push(...group.variants);
    setItems(subItems);
    setCurrentContainer(null);
    setBreadcrumb(prev => [...prev, {
      title: group.base,
      contentId: null,
      contentType: '__feat_group__',
      _featItems: subItems,
    }]);
  }, []);

  const handleBreadcrumbTapWrapped = useCallback(async (index) => {
    if (index === breadcrumb.length - 1) return;
    const target = breadcrumb[index];
    if (target.contentType === '__feat_group__' && target._featItems) {
      setBreadcrumb(prev => prev.slice(0, index + 1));
      setItems(target._featItems);
      setCurrentContainer(null);
      return;
    }
    handleBreadcrumbTap(index);
  }, [breadcrumb, handleBreadcrumbTap]);

  // Context play handlers (artist/album shuffle/play)
  const handleContextPlay = useCallback(async (shuffle) => {
    if (!hass || !entityId || !currentContainer) return;
    try {
      const svcData = {
        entity_id: entityId,
        media_content_id: currentContainer.media_content_id,
        media_content_type: currentContainer.media_content_type,
      };
      if (shuffle) svcData.extra = { shuffle: true };
      await hass.callService('media_player', 'play_media', svcData);
    } catch (err) { console.error('[smc] Context play failed:', err); }
  }, [hass, entityId, currentContainer]);

  // Play a recently played item directly
  const handleRecentPlay = useCallback(async (item) => {
    if (!hass || !entityId) return;
    try {
      await hass.callService('media_player', 'play_media', {
        entity_id: entityId,
        media_content_id: item.media_content_id,
        media_content_type: item.media_content_type,
      });
    } catch (err) { console.error('[smc] Recent play failed:', err); }
  }, [hass, entityId]);

  if (!entityId) {
    return html`<div class="smc-content"><p class="smc-header">Browse</p><p class="smc-error">Select a speaker first</p></div>`;
  }

  // Library mode state
  const isAtRoot = breadcrumb.length <= 1;
  const showContextButtons = !isAtRoot && currentContainer &&
    (currentContainer.media_class === 'artist' || currentContainer.media_class === 'album');
  const isArtistContainer = currentContainer?.media_class === 'artist';

  // Compute library display items
  const displayItems = useMemo(() => {
    const filtered = libFilter
      ? items.filter(i => (i.title || '').toLowerCase().includes(libFilter.toLowerCase()))
      : items;
    if (isArtistLevel && !libFilter) {
      return { grouped: true, rows: groupArtists(filtered) };
    }
    return { grouped: false, rows: filtered };
  }, [items, libFilter, isArtistLevel]);

  // Has any search results?
  const hasResults = searchResults &&
    (searchResults.artists.length || searchResults.albums.length || searchResults.tracks.length);

  return html`
    <div class="smc-content">
      <!-- Mode toggle -->
      <div class="smc-mode-toggle">
        <div class=${`smc-mode-pill${browseMode === 'home' ? ' active' : ''}`}
          onClick=${() => setBrowseMode('home')}>\u{1F3E0} Home</div>
        <div class=${`smc-mode-pill${browseMode === 'search' ? ' active' : ''}`}
          onClick=${() => setBrowseMode('search')}>\u{1F50D} Search</div>
        <div class=${`smc-mode-pill${browseMode === 'library' ? ' active' : ''}`}
          onClick=${() => setBrowseMode('library')}>\u266A My Library</div>
      </div>

      ${browseMode === 'home' && html`
        <${HomeView} hass=${hass} primaryEntity=${entityId} />
      `}

      ${browseMode === 'search' && html`
        <!-- Search mode -->
        <div class="smc-search"><${IconSearch} /><input type="text"
          placeholder="Search Plex + YouTube Music..."
          value=${searchQuery}
          onInput=${(e) => { e.stopPropagation(); setSearchQuery(e.target.value); }}
          onClick=${(e) => e.stopPropagation()}
          onKeyDown=${(e) => e.stopPropagation()}
        /></div>
        ${!searchQuery && html`
          <p class="smc-search-placeholder">Type to search across Plex and YouTube Music</p>
        `}
        ${searchQuery && searchQuery.length < 2 && html`
          <p class="smc-search-placeholder">Keep typing...</p>
        `}
        ${searchLoading && html`<p class="smc-loading">Searching...</p>`}
        ${!searchLoading && searchResults && !hasResults && html`
          <p class="smc-search-placeholder">No results for "${searchQuery}"</p>
        `}
        ${!searchLoading && searchResults?.artists?.length > 0 && html`
          <p class="smc-section-label">Artists</p>
          <div class="smc-browse-list smc-search-section">
            ${searchResults.artists.map(item => html`
              <${SearchResultRow} key=${item.uri} item=${item} hass=${hass}
                entityId=${entityId} onDrillFromSearch=${handleDrillFromSearch}
                openMenuId=${openMenuId} setOpenMenuId=${setOpenMenuId} />
            `)}
          </div>
        `}
        ${!searchLoading && searchResults?.albums?.length > 0 && html`
          <p class="smc-section-label">Albums</p>
          <div class="smc-browse-list smc-search-section">
            ${searchResults.albums.map(item => html`
              <${SearchResultRow} key=${item.uri} item=${item} hass=${hass}
                entityId=${entityId} onDrillFromSearch=${handleDrillFromSearch}
                openMenuId=${openMenuId} setOpenMenuId=${setOpenMenuId} />
            `)}
          </div>
        `}
        ${!searchLoading && searchResults?.tracks?.length > 0 && html`
          <p class="smc-section-label">Tracks</p>
          <div class="smc-browse-list smc-search-section">
            ${searchResults.tracks.map(item => html`
              <${SearchResultRow} key=${item.uri} item=${item} hass=${hass}
                entityId=${entityId} onDrillFromSearch=${handleDrillFromSearch}
                openMenuId=${openMenuId} setOpenMenuId=${setOpenMenuId} />
            `)}
          </div>
        `}
      `}

      ${browseMode === 'library' && html`
        <!-- Library mode -->
        <div class="smc-search"><${IconSearch} /><input type="text"
          placeholder="Filter library..."
          value=${libFilter}
          onInput=${(e) => { e.stopPropagation(); setLibFilter(e.target.value); }}
          onClick=${(e) => e.stopPropagation()}
          onKeyDown=${(e) => e.stopPropagation()}
        /></div>
        ${isAtRoot && recentItems.length > 0 && html`
          <p class="smc-section-label">Recently played</p>
          <div class="smc-recent-row">
            ${recentItems.map(item => html`
              <div key=${item.media_content_id} class="smc-recent-tile" onClick=${() => handleRecentPlay(item)}>
                ${item.thumbnail
                  ? html`<img class="smc-recent-art" src=${item.thumbnail.startsWith('http') ? item.thumbnail : location.origin + item.thumbnail} alt="" />`
                  : html`<div class="smc-recent-art-placeholder">\u{266A}</div>`
                }
                <p class="smc-recent-title">${item.title}</p>
              </div>
            `)}
          </div>
        `}
        ${breadcrumb.length > 1 && html`
          <div class="smc-breadcrumb">
            ${breadcrumb.map((crumb, i) => html`
              ${i > 0 && html`<span class="smc-breadcrumb-sep">\u203A</span>`}
              <span key=${i} class=${`smc-breadcrumb-item${i === breadcrumb.length - 1 ? ' current' : ''}`}
                onClick=${() => handleBreadcrumbTapWrapped(i)}>${crumb.title}</span>
            `)}
          </div>
        `}
        ${showContextButtons && html`
          <div class="smc-context-buttons">
            <button class="smc-context-btn primary" onClick=${() => handleContextPlay(true)}>
              \u21CC ${isArtistContainer ? `Shuffle all ${currentContainer.title}` : 'Shuffle album'}
            </button>
            <button class="smc-context-btn secondary" onClick=${() => handleContextPlay(false)}>
              \u25B6 ${isArtistContainer ? `Play all ${currentContainer.title}` : 'Play album from start'}
            </button>
          </div>
        `}
        ${isAtRoot && !libFilter && html`<p class="smc-section-label">Library</p>`}
        ${loading && html`<p class="smc-loading">Loading...</p>`}
        ${error && html`<p class="smc-error">${error}</p>`}
        ${!loading && !error && displayItems.grouped && html`
          <div class="smc-browse-list">
            ${displayItems.rows.map(entry => {
              if (entry.type === 'single') {
                const item = entry.item;
                return html`
                  <div key=${item.media_content_id} class="smc-browse-row" onClick=${() => handleItemTap(item)}>
                    <div class="smc-browse-thumb-placeholder">${item.can_expand ? '\u{1F4C1}' : '\u{266A}'}</div>
                    <div class="smc-browse-info">
                      <p class="smc-browse-title">${item.title}</p>
                      <p class="smc-browse-subtitle">Artist</p>
                    </div>
                    ${item.can_expand && html`<span class="smc-browse-chevron">\u203A</span>`}
                  </div>
                `;
              }
              return html`
                <div key=${entry.base} class="smc-browse-row" onClick=${() =>
                  entry.variants.length === 0 && entry.baseItem
                    ? handleItemTap(entry.baseItem)
                    : handleFeatGroupTap(entry)
                }>
                  <div class="smc-browse-thumb-placeholder">\u{1F4C1}</div>
                  <div class="smc-browse-info">
                    <p class="smc-browse-title">${entry.base}</p>
                    <p class="smc-browse-subtitle">Artist</p>
                  </div>
                  ${entry.variants.length > 0 && html`
                    <span style="font-size:9px; color:${THEME.muted}; margin-right:6px;">
                      +${entry.variants.length} feat.
                    </span>
                  `}
                  <span class="smc-browse-chevron">\u203A</span>
                </div>
              `;
            })}
            ${displayItems.rows.length === 0 && html`<p class="smc-loading">No items found</p>`}
          </div>
        `}
        ${!loading && !error && !displayItems.grouped && html`
          <div class="smc-browse-list">
            ${displayItems.rows.map(item => {
              // Tracks (can_play, not expandable) get context menu
              if (item.can_play && !item.can_expand) {
                return html`<${TrackRow} key=${item.media_content_id} item=${item}
                  hass=${hass} entityId=${entityId}
                  onPlay=${() => handleItemTap(item)}
                  openMenuId=${openMenuId} setOpenMenuId=${setOpenMenuId} />`;
              }
              return html`
                <div key=${item.media_content_id} class="smc-browse-row" onClick=${() => handleItemTap(item)}>
                  <div class="smc-browse-thumb-placeholder">${item.can_expand ? '\u{1F4C1}' : '\u{266A}'}</div>
                  <div class="smc-browse-info">
                    <p class="smc-browse-title">${item.title}</p>
                    <p class="smc-browse-subtitle">${getSubtitle(item)}</p>
                  </div>
                  ${item.can_expand && html`<span class="smc-browse-chevron">\u203A</span>`}
                </div>
              `;
            })}
            ${displayItems.rows.length === 0 && html`<p class="smc-loading">No items found</p>`}
          </div>
        `}
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
      ${np.isExternal ? html`
        <p style="text-align:center; color:${THEME.muted}; font-size:12px; padding:12px 20px;">
          Playing via ${np.source || 'external source'} \u2014 transport controls unavailable
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
  // 1. Check for any currently playing/paused MA speaker
  const playing = Object.entries(hass.states)
    .find(([id, s]) => id.startsWith('media_player.') &&
      s.attributes?.mass_player_type === 'player' && hasMediaContext(s))?.[0];

  // 2. Try localStorage
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(SMC_KEY) || '[]'); } catch {}
  saved = saved.filter(id => hass.states[id]?.attributes?.mass_player_type === 'player');

  // 3. Priority: playing > saved > empty
  if (playing) {
    _smcSpeakers = [playing];
    _smcUserSelected = false; // auto-detect seeded
  } else if (saved.length > 0) {
    _smcSpeakers = saved;
    _smcUserSelected = true; // user previously chose these
  } else {
    _smcSpeakers = [];
    _smcUserSelected = false;
  }
  console.log('[smc] init: speakers=', _smcSpeakers, 'userSelected=', _smcUserSelected);
}

function smcAutoDetect(hass) {
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
  const selPlaying = _smcSpeakers.some(id =>
    hass.states[id]?.state === 'playing'
  );
  if (selPlaying) return;

  // Find any MA player that is actively playing (not external source)
  let active = Object.entries(hass.states).find(([id, s]) =>
    id.startsWith('media_player.') &&
    s.attributes?.mass_player_type === 'player' &&
    s.state === 'playing' &&
    !isExternalSource(s)
  )?.[0];

  // Fall back to paused (hasMediaContext) only if nothing is playing
  if (!active) {
    active = Object.entries(hass.states).find(([id, s]) =>
      id.startsWith('media_player.') &&
      s.attributes?.mass_player_type === 'player' &&
      hasMediaContext(s)
    )?.[0];
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
  const primaryEntity = selectedSpeakers[0] || null;

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

  const handlePlay = useCallback(async (item) => {
    if (!hass || !primaryEntity) return;
    try {
      // If item has a parent container, play that instead (queues full album/artist)
      const container = item._useContainer;
      const contentId = container ? container.media_content_id : item.media_content_id;
      const contentType = container ? container.media_content_type : item.media_content_type;
      await hass.callService('media_player', 'play_media', {
        entity_id: primaryEntity,
        media_content_id: contentId,
        media_content_type: contentType,
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
          onSelect=${handleSelectSpeaker} onGroup=${handleGroup} isPlaying=${isPlaying}
          includePlayers=${config.include_players} excludePlayers=${config.exclude_players} />
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
  setConfig(config) {
    this._config = config || {};
    this._includePlayers = config.include_players || null;
    this._excludePlayers = config.exclude_players || [];
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
    description: 'Full music browser and player for Sonos via Music Assistant',
  });
}
