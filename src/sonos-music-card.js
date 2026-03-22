// Sonos Music Card — Preact + htm, no build step
// Custom HA Lovelace card for Sonos via Music Assistant

import { h, render } from 'https://esm.sh/preact@10';
import { useState, useEffect, useCallback, useMemo } from 'https://esm.sh/preact@10/hooks';
import htm from 'https://esm.sh/htm@3';

const html = htm.bind(h);

// ── Theme tokens ────────────────────────────────────────────────
const THEME = {
  base: '#0f0f1a',
  surface: '#1a1a2e',
  border: '#2a2a3e',
  primary: '#7b2fbe',
  primaryBg: '#1e1230',
  accent: '#00c9a7',
  accentBg: '#0d1e1c',
  accentDark: '#04342c',
  text: '#d0d0ee',
  textSpeaker: '#c8c8e8',
  muted: '#6b6b8a',
  statusMuted: '#5a5a7a',
  statusSelected: '#a064d8',
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
  .smc-speaker:active {
    transform: scale(0.97);
  }
  .smc-speaker.selected {
    border-color: ${THEME.primary};
    background: ${THEME.primaryBg};
  }
  .smc-speaker.grouped {
    border-color: ${THEME.accent};
    background: ${THEME.accentBg};
  }

  .smc-speaker-name {
    font-size: 12px;
    font-weight: 500;
    color: ${THEME.textSpeaker};
    margin: 0;
    line-height: 1.3;
  }

  .smc-speaker-status {
    font-size: 10px;
    color: ${THEME.statusMuted};
    margin: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .smc-speaker.selected .smc-speaker-status {
    color: ${THEME.statusSelected};
  }
  .smc-speaker.grouped .smc-speaker-status {
    color: ${THEME.accent};
  }

  .smc-speaker-volume {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    color: ${THEME.statusMuted};
    margin-top: 2px;
  }
  .smc-speaker.selected .smc-speaker-volume,
  .smc-speaker.grouped .smc-speaker-volume {
    color: ${THEME.statusSelected};
  }
  .smc-speaker.grouped .smc-speaker-volume {
    color: ${THEME.accent};
  }

  /* ── Group bar ── */
  .smc-group-bar {
    position: absolute;
    bottom: 48px;
    left: 0;
    right: 0;
    background: ${THEME.accent};
    color: ${THEME.accentDark};
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    font-size: 13px;
    font-weight: 600;
    z-index: 2;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  .smc-group-bar:active {
    opacity: 0.85;
  }
  .smc-group-names {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 400;
    margin-right: 12px;
  }
  .smc-group-action {
    font-weight: 700;
    white-space: nowrap;
    font-size: 13px;
  }

  /* ── Bottom nav ── */
  .smc-nav {
    background: ${THEME.navBg};
    border-top: 0.5px solid ${THEME.border};
    display: flex;
    justify-content: space-around;
    align-items: center;
    height: 48px;
    flex-shrink: 0;
    z-index: 3;
  }
  .smc-nav-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    cursor: pointer;
    color: ${THEME.muted};
    font-size: 9px;
    font-weight: 500;
    letter-spacing: 0.5px;
    padding: 4px 16px;
    -webkit-tap-highlight-color: transparent;
    position: relative;
  }
  .smc-nav-item.active {
    color: ${THEME.text};
  }
  .smc-nav-item.active::after {
    content: '';
    position: absolute;
    bottom: 0;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: ${THEME.primary};
  }

  /* ── Error ── */
  .smc-error {
    color: ${THEME.error};
    font-size: 13px;
    text-align: center;
    padding: 20px;
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
      if (idx >= 0) {
        // Deselect
        return prev.filter(id => id !== entityId);
      }
      // Add to selection
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
        <div class="smc-content">
          <p class="smc-header">Browse</p>
          <p style="color: ${THEME.muted}; font-size: 13px; text-align: center; padding: 40px 0;">Coming in P3</p>
        </div>
      `}
      ${activeTab === 'playing' && html`
        <div class="smc-content">
          <p class="smc-header">Now Playing</p>
          <p style="color: ${THEME.muted}; font-size: 13px; text-align: center; padding: 40px 0;">Coming in P4</p>
        </div>
      `}
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
