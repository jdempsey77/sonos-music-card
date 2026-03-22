// Sonos Music Card — Preact + htm, no build step
// Custom HA Lovelace card for Sonos via Music Assistant

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

// ── SVG Icons (inline, no dependencies) ─────────────────────────
const IconSpeaker = () => html`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="6"/></svg>`;
const IconBrowse = () => html`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`;
const IconNowPlaying = () => html`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
const IconVolume = () => html`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`;
const IconPlay = () => html`<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
const IconPause = () => html`<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
const IconSearch = () => html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;

// ── Styles ──────────────────────────────────────────────────────
const cardStyles = `
  :host {
    display: block;
    font-family: ${THEME.font};
    color: ${THEME.text};
  }

  /* ── Main card shell ── */
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

  /* ── Content area (scrollable) ── */
  .smc-content {
    flex: 1;
    overflow-y: auto;
    padding: 20px 16px;
    padding-bottom: 60px;
  }

  /* ── Section header ── */
  .smc-header {
    font-size: 14px;
    font-weight: 600;
    color: ${THEME.muted};
    text-transform: uppercase;
    letter-spacing: 1px;
    margin: 0 0 16px 4px;
  }

  /* ── Speaker grid ── */
  .smc-speaker-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 12px;
  }

  /* ── Speaker card ── */
  .smc-speaker {
    background: ${THEME.surface};
    border: 1px solid ${THEME.border};
    border-radius: ${THEME.radiusCard};
    padding: 16px 14px;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    display: flex;
    flex-direction: column;
    gap: 8px;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
  }
  .smc-speaker:active { transform: scale(0.97); }
  .smc-speaker.selected {
    border-color: ${THEME.primary};
    background: ${THEME.primaryBg};
  }
  .smc-speaker.grouped {
    border-color: ${THEME.accent};
    background: ${THEME.accentBg};
  }
  .smc-speaker-name {
    font-size: 12px; font-weight: 500;
    color: ${THEME.textSpeaker}; margin: 0; line-height: 1.3;
  }
  .smc-speaker-status {
    font-size: 10px; color: ${THEME.statusMuted}; margin: 0;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .smc-speaker.selected .smc-speaker-status { color: ${THEME.statusSelected}; }
  .smc-speaker.grouped .smc-speaker-status { color: ${THEME.accent}; }
  .smc-speaker-volume {
    display: flex; align-items: center; gap: 4px;
    font-size: 10px; color: ${THEME.statusMuted}; margin-top: 2px;
  }
  .smc-speaker.selected .smc-speaker-volume { color: ${THEME.statusSelected}; }
  .smc-speaker.grouped .smc-speaker-volume { color: ${THEME.accent}; }

  /* ── Group bar ── */
  .smc-group-bar {
    position: absolute; bottom: 48px; left: 0; right: 0;
    background: ${THEME.accent}; color: ${THEME.accentDark};
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 16px; font-size: 13px; font-weight: 600;
    z-index: 2; cursor: pointer; transition: opacity 0.15s;
  }
  .smc-group-bar:active { opacity: 0.85; }
  .smc-group-names {
    flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-size: 12px; font-weight: 400; margin-right: 12px;
  }
  .smc-group-action { font-weight: 700; white-space: nowrap; font-size: 13px; }

  /* ── Bottom nav ── */
  .smc-nav {
    background: ${THEME.navBg}; border-top: 0.5px solid ${THEME.border};
    display: flex; justify-content: space-around; align-items: center;
    height: 48px; flex-shrink: 0; z-index: 3;
  }
  .smc-nav-item {
    display: flex; flex-direction: column; align-items: center; gap: 3px;
    cursor: pointer; color: ${THEME.muted}; font-size: 9px; font-weight: 500;
    letter-spacing: 0.5px; padding: 4px 16px;
    -webkit-tap-highlight-color: transparent; position: relative;
  }
  .smc-nav-item.active { color: ${THEME.text}; }
  .smc-nav-item.active::after {
    content: ''; position: absolute; bottom: 0;
    width: 4px; height: 4px; border-radius: 50%; background: ${THEME.primary};
  }

  /* ── Browse: Search bar ── */
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

  /* ── Browse: Breadcrumb ── */
  .smc-breadcrumb {
    display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
    font-size: 10px; color: ${THEME.statusMuted}; margin-bottom: 12px;
    padding: 0 4px;
  }
  .smc-breadcrumb-item {
    cursor: pointer; transition: color 0.1s;
    -webkit-tap-highlight-color: transparent;
  }
  .smc-breadcrumb-item:hover { color: ${THEME.text}; }
  .smc-breadcrumb-item.current { color: ${THEME.statusSelected}; cursor: default; }
  .smc-breadcrumb-sep { color: ${THEME.chevron}; }

  /* ── Browse: Section label ── */
  .smc-section-label {
    font-size: 10px; color: ${THEME.statusMuted}; text-transform: uppercase;
    letter-spacing: 0.1em; margin: 16px 0 8px 4px;
  }
  .smc-section-label:first-of-type { margin-top: 0; }

  /* ── Browse: Item rows ── */
  .smc-browse-list { display: flex; flex-direction: column; }
  .smc-browse-row {
    display: flex; align-items: center; gap: 12px;
    padding: 8px 8px; border-radius: ${THEME.radiusEl};
    cursor: pointer; transition: background 0.1s;
    -webkit-tap-highlight-color: transparent;
  }
  .smc-browse-row:active { background: ${THEME.surface}; }
  .smc-browse-thumb {
    width: 38px; height: 38px; border-radius: 6px;
    object-fit: cover; background: ${THEME.surface}; flex-shrink: 0;
  }
  .smc-browse-thumb-placeholder {
    width: 38px; height: 38px; border-radius: 6px;
    background: ${THEME.surface}; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    color: ${THEME.chevron}; font-size: 16px;
  }
  .smc-browse-info { flex: 1; min-width: 0; }
  .smc-browse-title {
    font-size: 13px; color: ${THEME.text}; margin: 0;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .smc-browse-subtitle {
    font-size: 11px; color: ${THEME.statusMuted}; margin: 2px 0 0;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .smc-browse-chevron { color: ${THEME.chevron}; font-size: 14px; flex-shrink: 0; }

  /* ── Browse: Loading ── */
  .smc-loading {
    text-align: center; padding: 40px 0; color: ${THEME.muted}; font-size: 13px;
  }

  /* ── Mini-player ── */
  .smc-mini-player {
    background: ${THEME.miniPlayerBg}; border-top: 2px solid ${THEME.primary};
    display: flex; align-items: center; gap: 10px;
    padding: 8px 12px; cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .smc-mini-art {
    width: 36px; height: 36px; border-radius: 6px;
    object-fit: cover; background: ${THEME.surface}; flex-shrink: 0;
  }
  .smc-mini-art-placeholder {
    width: 36px; height: 36px; border-radius: 6px;
    background: ${THEME.surface}; flex-shrink: 0;
  }
  .smc-mini-info { flex: 1; min-width: 0; }
  .smc-mini-title {
    font-size: 12px; color: ${THEME.text}; margin: 0;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .smc-mini-artist {
    font-size: 10px; color: ${THEME.statusMuted}; margin: 1px 0 0;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .smc-mini-btn {
    background: none; border: none; color: ${THEME.text};
    cursor: pointer; padding: 6px; display: flex; align-items: center;
    -webkit-tap-highlight-color: transparent;
  }
  .smc-mini-btn:active { opacity: 0.7; }

  /* ── Error ── */
  .smc-error {
    color: ${THEME.error}; font-size: 13px; text-align: center; padding: 20px;
  }
`;

// ── Helper: get speaker display info ────────────────────────────
function getSpeakerInfo(entityId, state) {
  const attrs = state.attributes;
  const name = attrs.friendly_name || entityId.replace('media_player.', '');
  const volume = attrs.volume_level != null ? Math.round(attrs.volume_level * 100) : null;
  const groupMembers = attrs.group_members || [];
  const isGrouped = groupMembers.length > 1;

  let status = 'Idle';
  if (state.state === 'playing') {
    status = attrs.media_title ? `Playing \u00b7 ${attrs.media_title}` : 'Playing';
  } else if (isGrouped) {
    status = 'Grouped';
  }

  return { name, volume, status, isGrouped };
}

// ── Helper: get now-playing info from selected speakers ─────────
function getNowPlaying(hass, selectedSpeakers) {
  for (const id of selectedSpeakers) {
    const state = hass?.states[id];
    if (state?.state === 'playing') {
      const a = state.attributes;
      return {
        entityId: id,
        title: a.media_title || 'Unknown',
        artist: a.media_artist || '',
        art: a.entity_picture ? a.entity_picture : null,
        isPlaying: true,
      };
    }
  }
  // Check paused state too
  for (const id of selectedSpeakers) {
    const state = hass?.states[id];
    if (state?.state === 'paused') {
      const a = state.attributes;
      return {
        entityId: id,
        title: a.media_title || 'Unknown',
        artist: a.media_artist || '',
        art: a.entity_picture ? a.entity_picture : null,
        isPlaying: false,
      };
    }
  }
  return null;
}

// ── Helper: classify browse item for subtitle ───────────────────
function getSubtitle(item) {
  const t = item.media_content_type || item.media_class || '';
  if (t.includes('artist')) return 'Artist';
  if (t.includes('album')) return 'Album';
  if (t.includes('playlist')) return 'Playlist';
  if (t.includes('track')) return 'Track';
  if (t.includes('app')) return 'Source';
  return t || '';
}

// ── Speaker Card Component ──────────────────────────────────────
function SpeakerCard({ entityId, state, isSelected, isGrouped, onTap }) {
  const info = getSpeakerInfo(entityId, state);
  const className = `smc-speaker${isSelected ? ' selected' : ''}${isGrouped ? ' grouped' : ''}`;

  return html`
    <div class=${className} onClick=${() => onTap(entityId)}>
      <p class="smc-speaker-name">${info.name}</p>
      <p class="smc-speaker-status">${info.status}</p>
      ${info.volume != null && html`
        <div class="smc-speaker-volume">
          <${IconVolume} />
          <span>${info.volume}%</span>
        </div>
      `}
    </div>
  `;
}

// ── Speakers View ───────────────────────────────────────────────
function SpeakersView({ hass, selected, onSelect, onGroup }) {
  const maPlayers = useMemo(() => {
    if (!hass) return [];
    return Object.entries(hass.states)
      .filter(([id, state]) =>
        id.startsWith('media_player.') &&
        state.attributes.mass_player_type === 'player'
      )
      .map(([id]) => id)
      .sort();
  }, [hass]);

  const selectedNames = useMemo(() => {
    return selected.map(id => {
      const state = hass?.states[id];
      return state?.attributes?.friendly_name || id.replace('media_player.', '');
    });
  }, [selected, hass]);

  return html`
    <div class="smc-content">
      <p class="smc-header">Speakers</p>
      ${maPlayers.length === 0 && html`
        <p class="smc-error">No Music Assistant speakers found</p>
      `}
      <div class="smc-speaker-grid">
        ${maPlayers.map(id => {
          const state = hass.states[id];
          if (!state) return null;
          const idx = selected.indexOf(id);
          const isSelected = idx === 0;
          const isGrouped = idx > 0;
          return html`<${SpeakerCard}
            key=${id}
            entityId=${id}
            state=${state}
            isSelected=${isSelected}
            isGrouped=${isGrouped}
            onTap=${onSelect}
          />`;
        })}
      </div>
    </div>

    ${selected.length >= 2 && html`
      <div class="smc-group-bar" onClick=${onGroup}>
        <span class="smc-group-names">${selectedNames.join(' + ')}</span>
        <span class="smc-group-action">Play here \u25B6</span>
      </div>
    `}
  `;
}

// ── MA library categories to show at root ───────────────────────
const MA_CATEGORIES = ['artists', 'albums', 'tracks', 'playlists', 'radio stations', 'podcasts', 'audiobooks'];

function isMACategory(item) {
  return MA_CATEGORIES.includes((item.title || '').toLowerCase());
}

// ── Browse View ─────────────────────────────────────────────────
function BrowseView({ hass, selectedSpeakers, onPlay }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [breadcrumb, setBreadcrumb] = useState([]);

  const entityId = selectedSpeakers[0];

  // Use ref for hass so browse helper doesn't cause effect re-runs
  const hassRef = useRef(hass);
  hassRef.current = hass;

  // Stable browse helper — no deps that change on every render
  const doBrowse = useCallback(async (eId, contentId, contentType) => {
    const h = hassRef.current;
    if (!h || !eId) return null;
    const params = { type: 'media_player/browse_media', entity_id: eId };
    if (contentId) {
      params.media_content_id = contentId;
      params.media_content_type = contentType || 'music_assistant';
    }
    console.log('[sonos-music-card] browse:', JSON.stringify(params));
    const result = await h.callWS(params);
    console.log('[sonos-music-card] result:', result?.title, result?.children?.length, 'children');
    return result;
  }, []); // stable — no deps

  // Load root ONLY when entityId changes
  useEffect(() => {
    if (!entityId) return;
    let cancelled = false;

    const loadRoot = async () => {
      setLoading(true);
      setError(null);
      setItems([]);
      setBreadcrumb([{ title: 'Library', contentId: null, contentType: null }]);
      try {
        const result = await doBrowse(entityId, null, null);
        if (cancelled) return;
        const children = result?.children || [];
        const maItems = children.filter(isMACategory);
        console.log('[sonos-music-card] MA categories:', maItems.map(c => c.title));
        setItems(maItems.length > 0 ? maItems : children);
      } catch (err) {
        if (cancelled) return;
        console.error('[sonos-music-card] root browse failed:', err);
        setError(err.message || String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadRoot();
    return () => { cancelled = true; };
  }, [entityId]); // only entityId — doBrowse is stable

  // Tap an item — drill in or play
  const handleItemTap = useCallback(async (item) => {
    if (item.can_expand) {
      setLoading(true);
      setError(null);
      try {
        const drillType = item.media_class && item.media_class !== 'directory'
          ? item.media_class
          : item.media_content_type;
        const result = await doBrowse(entityId, item.media_content_id, drillType);
        setItems(result?.children || []);
        setBreadcrumb(prev => [...prev, {
          title: item.title,
          contentId: item.media_content_id,
          contentType: item.media_content_type,
        }]);
      } catch (err) {
        console.error('[sonos-music-card] drill-in failed:', err);
        setError(err.message || String(err));
      } finally {
        setLoading(false);
      }
    } else if (item.can_play) {
      onPlay(item);
    }
  }, [entityId, doBrowse, onPlay]);

  // Breadcrumb back-navigation
  const handleBreadcrumbTap = useCallback(async (index) => {
    if (index === breadcrumb.length - 1) return;
    const target = breadcrumb[index];
    setLoading(true);
    setError(null);
    setBreadcrumb(prev => prev.slice(0, index + 1));
    try {
      const result = await doBrowse(entityId, target.contentId, target.contentType);
      const children = result?.children || [];
      if (index === 0) {
        const maItems = children.filter(isMACategory);
        setItems(maItems.length > 0 ? maItems : children);
      } else {
        setItems(children);
      }
    } catch (err) {
      console.error('[sonos-music-card] breadcrumb nav failed:', err);
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [breadcrumb, entityId, doBrowse]);

  if (!entityId) {
    return html`
      <div class="smc-content">
        <p class="smc-header">Browse</p>
        <p class="smc-error">Select a speaker first</p>
      </div>
    `;
  }

  return html`
    <div class="smc-content">
      <!-- Search bar (non-functional placeholder) -->
      <div class="smc-search">
        <${IconSearch} />
        <input type="text" placeholder="Search..." disabled />
      </div>

      <!-- Breadcrumb (show when drilled past root) -->
      ${breadcrumb.length > 1 && html`
        <div class="smc-breadcrumb">
          ${breadcrumb.map((crumb, i) => html`
            ${i > 0 && html`<span class="smc-breadcrumb-sep">\u203A</span>`}
            <span
              key=${i}
              class=${`smc-breadcrumb-item${i === breadcrumb.length - 1 ? ' current' : ''}`}
              onClick=${() => handleBreadcrumbTap(i)}
            >${crumb.title}</span>
          `)}
        </div>
      `}

      <!-- Section label at root -->
      ${breadcrumb.length <= 1 && html`
        <p class="smc-section-label">Library</p>
      `}

      ${loading && html`<p class="smc-loading">Loading...</p>`}
      ${error && html`<p class="smc-error">${error}</p>`}

      ${!loading && !error && html`
        <div class="smc-browse-list">
          ${items.map(item => html`
            <div
              key=${item.media_content_id}
              class="smc-browse-row"
              onClick=${() => handleItemTap(item)}
            >
              <div class="smc-browse-thumb-placeholder">${item.can_expand ? '\u{1F4C1}' : '\u{266A}'}</div>
              <div class="smc-browse-info">
                <p class="smc-browse-title">${item.title}</p>
                <p class="smc-browse-subtitle">${getSubtitle(item)}</p>
              </div>
              ${item.can_expand && html`<span class="smc-browse-chevron">\u203A</span>`}
            </div>
          `)}
          ${items.length === 0 && html`
            <p class="smc-loading">No items found</p>
          `}
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
    hass.callService('media_player', 'media_play_pause', {
      entity_id: nowPlaying.entityId,
    });
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
        <div
          key=${tab.id}
          class=${`smc-nav-item${activeTab === tab.id ? ' active' : ''}`}
          onClick=${() => onTabChange(tab.id)}
        >
          <${tab.icon} />
          <span>${tab.label}</span>
        </div>
      `)}
    </div>
  `;
}

// ── App Component ───────────────────────────────────────────────
function SonosMusicApp({ hass, config }) {
  const [activeTab, setActiveTab] = useState('speakers');
  const [selectedSpeakers, setSelectedSpeakers] = useState([]);

  useEffect(() => {
    if (hass) {
      console.log('[sonos-music-card] hass object received', {
        states: Object.keys(hass.states).length,
      });
    }
  }, [!!hass]);

  const handleSelectSpeaker = useCallback((entityId) => {
    setSelectedSpeakers(prev => {
      const idx = prev.indexOf(entityId);
      if (idx >= 0) return prev.filter(id => id !== entityId);
      return [...prev, entityId];
    });
  }, []);

  const handleGroup = useCallback(async () => {
    if (!hass || selectedSpeakers.length < 2) return;
    const primary = selectedSpeakers[0];
    console.log('[sonos-music-card] Grouping speakers:', selectedSpeakers);
    try {
      await hass.callService('media_player', 'join', {
        entity_id: primary,
        group_members: selectedSpeakers,
      });
      console.log('[sonos-music-card] Group created successfully');
    } catch (err) {
      console.error('[sonos-music-card] Group failed:', err);
    }
  }, [hass, selectedSpeakers]);

  const handlePlay = useCallback(async (item) => {
    const target = selectedSpeakers[0];
    if (!hass || !target) return;
    console.log('[sonos-music-card] Playing:', item.title, 'on', target);
    try {
      await hass.callService('media_player', 'play_media', {
        entity_id: target,
        media_content_id: item.media_content_id,
        media_content_type: item.media_content_type,
      });
      console.log('[sonos-music-card] Play started');
    } catch (err) {
      console.error('[sonos-music-card] Play failed:', err);
    }
  }, [hass, selectedSpeakers]);

  const nowPlaying = useMemo(
    () => getNowPlaying(hass, selectedSpeakers),
    [hass, selectedSpeakers]
  );

  if (!hass) {
    return html`<div class="smc-card"><p class="smc-error">Waiting for HA connection...</p></div>`;
  }

  return html`
    <div class="smc-card">
      ${activeTab === 'speakers' && html`
        <${SpeakersView}
          hass=${hass}
          selected=${selectedSpeakers}
          onSelect=${handleSelectSpeaker}
          onGroup=${handleGroup}
        />
      `}
      ${activeTab === 'browse' && html`
        <${BrowseView}
          hass=${hass}
          selectedSpeakers=${selectedSpeakers}
          onPlay=${handlePlay}
        />
      `}
      ${activeTab === 'playing' && html`
        <div class="smc-content">
          <p class="smc-header">Now Playing</p>
          <p style="color: ${THEME.muted}; font-size: 13px; text-align: center; padding: 40px 0;">Coming in P4</p>
        </div>
      `}
      <${MiniPlayer}
        nowPlaying=${nowPlaying}
        hass=${hass}
        onTap=${() => setActiveTab('playing')}
      />
      <${BottomNav} activeTab=${activeTab} onTabChange=${setActiveTab} />
    </div>
  `;
}

// ── Custom Element ──────────────────────────────────────────────
class SonosMusicCard extends HTMLElement {
  constructor() {
    super();
    this._hass = null;
    this._config = {};
    this._initialized = false;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._initialized) {
      this._initialized = true;
      this._init();
    }
    if (this._root) {
      this._renderApp();
    }
  }

  get hass() {
    return this._hass;
  }

  setConfig(config) {
    this._config = config || {};
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
    render(
      h(SonosMusicApp, { hass: this._hass, config: this._config }),
      this._container
    );
  }

  getCardSize() {
    return 6;
  }

  static getConfigElement() {
    return document.createElement('div');
  }

  static getStubConfig() {
    return {};
  }
}

// ── Register ────────────────────────────────────────────────────
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
