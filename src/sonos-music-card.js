// Sonos Music Card — Preact + htm, no build step
// Custom HA Lovelace card for Sonos via Music Assistant

import { h, render } from 'https://esm.sh/preact@10';
import { useState, useEffect, useCallback } from 'https://esm.sh/preact@10/hooks';
import htm from 'https://esm.sh/htm@3';

const html = htm.bind(h);

// ── Theme tokens ────────────────────────────────────────────────
const THEME = {
  base: '#0f0f1a',
  surface: '#1a1a2e',
  border: '#2a2a3e',
  primary: '#7b2fbe',
  accent: '#00c9a7',
  text: '#d0d0ee',
  muted: '#6b6b8a',
  radiusCard: '12px',
  radiusEl: '8px',
  font: 'system-ui, -apple-system, sans-serif',
};

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
    padding: 24px;
    min-height: 200px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
  }
  .smc-title {
    font-size: 20px;
    font-weight: 600;
    color: ${THEME.text};
    margin: 0;
  }
  .smc-status {
    font-size: 14px;
    color: ${THEME.muted};
    margin: 0;
  }
  .smc-badge {
    display: inline-block;
    background: ${THEME.surface};
    border: 1px solid ${THEME.border};
    border-radius: ${THEME.radiusEl};
    padding: 6px 14px;
    font-size: 12px;
    color: ${THEME.accent};
    font-family: monospace;
  }
  .smc-error {
    color: #ff6b6b;
    font-size: 13px;
  }
`;

// ── App Component ───────────────────────────────────────────────
function SonosMusicApp({ hass, config }) {
  const [browseResult, setBrowseResult] = useState(null);
  const [error, setError] = useState(null);
  const [hassReceived, setHassReceived] = useState(false);

  useEffect(() => {
    if (hass) {
      console.log('[sonos-music-card] hass object received', {
        states: Object.keys(hass.states).length,
        user: hass.user?.name,
      });
      setHassReceived(true);
    }
  }, [!!hass]);

  // Fire media_player/browse_media call on mount once hass is available
  // Uses HA's standard browse_media WS API — MA hooks into this via its media_browser.py
  useEffect(() => {
    if (!hass) return;

    // Detect MA-managed players via mass_player_type attribute
    const maPlayers = Object.entries(hass.states)
      .filter(([id, state]) =>
        id.startsWith('media_player.') &&
        state.attributes.mass_player_type === 'player'
      )
      .map(([id]) => id);

    console.log('[sonos-music-card] MA-managed players:', maPlayers);

    // Use config entity_id override, or first MA player
    const sonosEntity = config?.entity_id || maPlayers[0];

    if (!sonosEntity) {
      console.warn('[sonos-music-card] No MA-managed media_player entity found');
      setError('No Music Assistant media_player found. Set entity_id in card config.');
      return;
    }

    const fetchBrowse = async () => {
      try {
        console.log(`[sonos-music-card] Firing media_player/browse_media for ${sonosEntity}...`);
        const result = await hass.callWS({
          type: 'media_player/browse_media',
          entity_id: sonosEntity,
        });
        console.log('[sonos-music-card] browse_media response:', result);
        setBrowseResult(result);
      } catch (err) {
        console.warn('[sonos-music-card] browse_media call failed:', err);
        setError(err.message || String(err));
      }
    };

    fetchBrowse();
  }, [!!hass]);

  return html`
    <div class="smc-card">
      <h2 class="smc-title">Sonos Music Card</h2>
      <p class="smc-status">
        ${hassReceived
          ? `Connected to Home Assistant`
          : 'Waiting for HA connection...'}
      </p>
      ${hassReceived && html`
        <span class="smc-badge">
          hass.states: ${Object.keys(hass.states).length} entities
        </span>
      `}
      ${browseResult && html`
        <span class="smc-badge">
          browse_media: ${browseResult.title || 'OK'} (${browseResult.children?.length || 0} items)
        </span>
      `}
      ${error && html`
        <p class="smc-error">browse_media error: ${error}</p>
      `}
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
    // Re-render on hass updates
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

    // Inject styles
    const style = document.createElement('style');
    style.textContent = cardStyles;
    this._root.appendChild(style);

    // Mount container
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
