/**
 * Chain profiles: one explorer build serves the Chains (CHN) mainchain and each of its drivechain sidechains.
 * window.__env.CHAIN_PROFILE (resources/config.js, set per container by docker/frontend/entrypoint.sh) picks the
 * chain at runtime, so several explorers run side by side from one image. The backend has the matching list in
 * backend/src/chain/profile.ts.
 *
 * Brand colours and marks are those of each chain's own app (apps/<chain>-app/src/webui/app/src/chain/chain.json;
 * Chains: chains-app's Midnight theme).
 */

export type ProfileId = 'chains' | 'thunder' | 'bitnames' | 'bitassets' | 'zside' | 'hivemind' | 'fastblocks' | 'freebank';

export interface NavItem {
  path: string;
  title: string;
  icon: string;  // app-svg-images name
}

export interface ChainProfile {
  id: ProfileId;
  name: string;
  tagline: string;
  unit: string;
  subunit: string;
  slot: number | null;
  mainchain: boolean;
  freebank: boolean;
  color: string;
  /** stroke paths of the chain's mark, viewBox 0 0 32 32 */
  mark: string[];
  /** rect marks (Chains' two links) */
  markRects?: { x: number; y: number; w: number; h: number; rx: number }[];
  bech32: { main: string; testnet: string; regtest: string };
  base58: { main: { pubkey: number; script: number }; test: { pubkey: number; script: number } };
  blockWeightUnits: number;
  /** extra nav entries of this profile */
  nav: NavItem[];
}

const BASE58 = { main: { pubkey: 28, script: 88 }, test: { pubkey: 111, script: 196 } };

export const PROFILES: Record<ProfileId, ChainProfile> = {
  chains: {
    id: 'chains', name: 'Chains', tagline: 'The Chains drivechain mainchain (BIP300/BIP301)', unit: 'CHN', subunit: 'sats',
    slot: null, mainchain: true, freebank: false, color: '#b5f27e',
    mark: ['M11 16h10'], markRects: [{ x: 3, y: 9, w: 12, h: 14, rx: 3.5 }, { x: 17, y: 9, w: 12, h: 14, rx: 3.5 }],
    bech32: { main: 'chn', testnet: 'tchn', regtest: 'rchn' }, base58: BASE58, blockWeightUnits: 800000,
    nav: [{ path: '/drivechain', title: 'Drivechain: sidechains, BMM, deposits, withdrawals, votes', icon: 'nav-drivechain' }],
  },
  thunder: {
    id: 'thunder', name: 'Thunder', tagline: 'Large blocks, for volume', unit: 'CHN', subunit: 'sats',
    slot: 2, mainchain: false, freebank: false, color: '#a585ff',
    mark: ['M18.5 3.5L8 18h7.5l-2 10.5L24.5 14H17z', 'M3.5 11.5h4', 'M2.5 16.5h3', 'M4.5 21.5h3'],
    bech32: { main: 'th', testnet: 'tth', regtest: 'rth' }, base58: BASE58, blockWeightUnits: 32000000,
    nav: [],
  },
  bitnames: {
    id: 'bitnames', name: 'BitNames', tagline: 'Names that point to keys, addresses and data, owned like coins', unit: 'CHN', subunit: 'sats',
    slot: 3, mainchain: false, freebank: false, color: '#b48cff',
    mark: ['M4.5 9.5a3 3 0 0 1 3-3h11.3a3 3 0 0 1 2.1.9l6.6 6.5a3 3 0 0 1 0 4.2l-6.6 6.5a3 3 0 0 1-2.1.9H7.5a3 3 0 0 1-3-3z', 'M10 16a2 2 0 1 0 4 0a2 2 0 1 0-4 0', 'M18 13.5l3 2.5-3 2.5'],
    bech32: { main: 'bn', testnet: 'tbn', regtest: 'rsc' }, base58: BASE58, blockWeightUnits: 4000000,
    nav: [{ path: '/names', title: 'Names', icon: 'chain-mark' }],
  },
  bitassets: {
    id: 'bitassets', name: 'BitAssets', tagline: 'Assets issued and traded on the sidechain: pools and Dutch auctions', unit: 'CHN', subunit: 'sats',
    slot: 4, mainchain: false, freebank: false, color: '#2bc79a',
    mark: ['M9.5 5h13l6.5 7.5L16 28 3 12.5z', 'M3 12.5h26', 'M12.5 5L10 12.5 16 28l6-15.5L19.5 5'],
    bech32: { main: 'ba', testnet: 'tba', regtest: 'rsc' }, base58: BASE58, blockWeightUnits: 4000000,
    nav: [{ path: '/assets', title: 'Assets, pools and auctions', icon: 'chain-mark' }],
  },
  fastblocks: {
    id: 'fastblocks', name: 'FastBlocks', tagline: 'Blocks of stake every 15 seconds, finalized by merged mining', unit: 'CHN', subunit: 'sats',
    slot: 5, mainchain: false, freebank: false, color: '#ff8a3d',
    mark: ['M6 18a10 10 0 1 0 20 0a10 10 0 1 0-20 0', 'M13 3.5h6', 'M16 3.5V8', 'M24.2 9.8l1.8-1.8', 'M17.5 11.5l-5 7.5h4l-1.5 5.5 5-7.5h-4z'],
    bech32: { main: 'fbl', testnet: 'tfbl', regtest: 'rsc' }, base58: BASE58, blockWeightUnits: 1500000,
    nav: [{ path: '/validators', title: 'Validators, finality and evidence', icon: 'chain-mark' }],
  },
  zside: {
    id: 'zside', name: 'zSide', tagline: 'Shielded payments (Zcash Orchard)', unit: 'CHN', subunit: 'sats',
    slot: 6, mainchain: false, freebank: false, color: '#f26b9c',
    mark: ['M16 3.5l10 3.8v8.2c0 6.3-4.2 10.7-10 13-5.8-2.3-10-6.7-10-13V7.3z', 'M11.5 11.5h9l-9 9h9'],
    bech32: { main: 'zs', testnet: 'tzs', regtest: 'rsc' }, base58: BASE58, blockWeightUnits: 4000000,
    nav: [{ path: '/shielded', title: 'The shielded pool', icon: 'chain-mark' }],
  },
  hivemind: {
    id: 'hivemind', name: 'Hivemind', tagline: 'Prediction markets, resolved by votecoin holders', unit: 'CHN', subunit: 'sats',
    slot: 9, mainchain: false, freebank: false, color: '#f5b83d',
    mark: ['M16 3.5l10.8 6.25v12.5L16 28.5 5.2 22.25V9.75z', 'M10.5 19.5l3.8-3.8 2.9 2.9 4.3-5.1', 'M21.5 13.5v3'],
    bech32: { main: 'hm', testnet: 'thm', regtest: 'rsc' }, base58: BASE58, blockWeightUnits: 4000000,
    nav: [{ path: '/markets', title: 'Markets, decisions and reputation', icon: 'chain-mark' }],
  },
  freebank: {
    id: 'freebank', name: 'FreeBank', tagline: 'The FreeBank sidechain of eCash', unit: 'ECX', subunit: 'szats',
    slot: 130, mainchain: false, freebank: true, color: '#d8b45a', mark: [],
    bech32: { main: 'fbk', testnet: 'fbk', regtest: 'fbkrt' }, base58: { main: { pubkey: 75, script: 125 }, test: { pubkey: 75, script: 125 } },
    blockWeightUnits: 4000000, nav: [],
  },
};

/** The sidechain profiles, in slot order */
export const SIDECHAINS: ChainProfile[] = Object.values(PROFILES).filter(p => !p.mainchain && !p.freebank).sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));

export function profileBySlot(slot: number): ChainProfile | undefined {
  return SIDECHAINS.find(p => p.slot === slot);
}

const env = (typeof window !== 'undefined' && window['__env']) || {};

function resolveProfile(): ChainProfile {
  const id = String(env.CHAIN_PROFILE || 'chains').toLowerCase() as ProfileId;
  return PROFILES[id] ?? PROFILES.chains;
}

export const PROFILE: ChainProfile = resolveProfile();

/** main | testnet | regtest: the address prefixes shown and accepted */
export const CHAIN_NETWORK: 'main' | 'testnet' | 'regtest' = (['main', 'testnet', 'regtest'].includes(env.CHAIN_NETWORK) ? env.CHAIN_NETWORK : 'testnet');

/** The public URLs of the explorers (profile id -> URL), from CHAIN_EXPLORER_URLS: "chains=https://...,thunder=https://..." */
export const EXPLORER_URLS: Partial<Record<ProfileId, string>> = (() => {
  const out: Partial<Record<ProfileId, string>> = {};
  const raw = String(env.CHAIN_EXPLORER_URLS || '');
  for (const part of raw.split(',')) {
    const i = part.indexOf('=');
    if (i > 0) {
      out[part.slice(0, i).trim() as ProfileId] = part.slice(i + 1).trim().replace(/\/$/, '');
    }
  }
  return out;
})();

export function explorerUrl(id: ProfileId, path = ''): string | null {
  const base = EXPLORER_URLS[id];
  return base ? base + path : null;
}

export function bech32Prefix(p: ChainProfile = PROFILE): string {
  return p.bech32[CHAIN_NETWORK];
}

/** #rrggbb scaled towards black by f (0..1) */
export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(x => Math.round(x * f));
  return '#' + c.map(x => x.toString(16).padStart(2, '0')).join('');
}

/** A chain's mark as a standalone SVG (favicon, previews) on a dark rounded square */
export function markSvg(p: ChainProfile, size: number): string {
  const rects = (p.markRects ?? []).map(r => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${r.rx}"/>`).join('');
  const paths = p.mark.map(d => `<path d="${d}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">`
    + `<rect width="32" height="32" rx="7" fill="#14161d"/>`
    + `<g fill="none" stroke="${p.color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${rects}${paths}</g></svg>`;
}

/** Apply the profile's colour and name to the page (called once at startup) */
export function applyProfileToDocument(): void {
  if (typeof document === 'undefined') {
    return;
  }
  const root = document.documentElement;
  root.setAttribute('data-chain', PROFILE.id);
  if (!PROFILE.freebank) {
    // The theme (theme-freebank.scss) compiles its gold into Bootstrap; recolour what carries the accent at runtime:
    // the accent itself on text (links, titles), a dark shade of it under light text (buttons, badges, pagination).
    const accent = PROFILE.color;
    const dark = shade(accent, 0.42);
    const darker = shade(accent, 0.34);
    const vars: Record<string, string> = {
      '--chain-accent': accent, '--chain-accent-dark': dark,
      '--title-fg': accent, '--info': accent, '--link-color': accent, '--link-hover-color': shade(accent, 0.8),
      '--mainnet-alt': accent, '--yellow': accent, '--primary': dark, '--tertiary': darker, '--alert-bg': darker,
      '--search-button': dark, '--search-button-border': darker, '--search-button-focus': shade(accent, 0.55),
      '--search-button-shadow': accent + '80',
    };
    for (const [k, v] of Object.entries(vars)) {
      root.style.setProperty(k, v);
    }
    const style = document.createElement('style');
    style.id = 'chain-profile-style';
    style.textContent = `
      a, .text-info, .btn-link { color: ${accent}; }
      a:hover, .btn-link:hover { color: ${shade(accent, 0.8)}; }
      .btn-primary, .badge-primary, .bg-primary { background-color: ${dark} !important; border-color: ${darker} !important; }
      .btn-primary:hover, .btn-primary:focus { background-color: ${darker} !important; }
      .page-item.active .page-link { background-color: ${darker} !important; border-color: ${darker} !important; }
      .badge-info, .bg-info { background-color: ${dark} !important; color: #e9ebee !important; }
      .nav-tabs .nav-link.active, .nav-pills .nav-link.active { border-bottom-color: ${accent}; }
      .navbar-nav .nav-item.active .nav-link { color: ${accent} !important; }
    `;
    document.head.appendChild(style);
    const favicon = document.querySelector('link[rel="icon"][type="image/svg+xml"]') || document.querySelector('link[rel="icon"]');
    if (favicon) {
      favicon.setAttribute('type', 'image/svg+xml');
      favicon.setAttribute('href', 'data:image/svg+xml,' + encodeURIComponent(markSvg(PROFILE, 64)));
    }
  }
  const title = `${PROFILE.name} Explorer`;
  if (document.title.includes('FreeBank Explorer') || !document.title) {
    document.title = title;
  }
  for (const sel of ['meta[property="og:title"]', 'meta[name="twitter:title"]']) {
    document.querySelector(sel)?.setAttribute('content', title);
  }
  const desc = `Explore ${PROFILE.name}: ${PROFILE.tagline}. Blocks, transactions and mempool in real time.`;
  for (const sel of ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']) {
    document.querySelector(sel)?.setAttribute('content', desc);
  }
}
