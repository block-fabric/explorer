/**
 * Chain profiles: one explorer build serves the eCash (ECX) mainchain, and later its drivechain sidechains.
 * window.__env.CHAIN_PROFILE (resources/config.js, set per container by docker/frontend/entrypoint.sh) picks the
 * chain at runtime, so several explorers run side by side from one image. The backend has the matching list in
 * backend/src/chain/profile.ts.
 */

import { ChainFrontendModule, ChainProfile } from '@app/chain/chain-module';
import { MODULES } from '@app/chain/modules';

export type { ChainProfile, NavItem } from '@app/chain/chain-module';
export type ProfileId = string;

/** Every known chain profile, by id */
export const PROFILES: Record<string, ChainProfile> = Object.fromEntries(MODULES.map(m => [m.profile.id, m.profile]));

/** The sidechains with a module of their own, in slot order (none yet: their names come from the drivechain API) */
export const SIDECHAINS: ChainProfile[] = MODULES.map(m => m.profile)
  .filter(p => !p.mainchain)
  .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));

export function profileBySlot(slot: number): ChainProfile | undefined {
  return SIDECHAINS.find(p => p.slot === slot);
}

/** The mark of a sidechain without a profile: a block (app-svg-images chain-mark, fill 'sidechain') */
export const SIDECHAIN_MARK: Pick<ChainProfile, 'mark' | 'markRects'> = {
  mark: [], markRects: [{ x: 7, y: 7, w: 18, h: 18, rx: 4.5 }],
};

/**
 * Marks of the sidechains the enforcer declares, built in the same 32x32 stroke style as the eCash mark (no logo
 * files: these are icons, so they take the slot's colour and stay sharp at any size). Keyed by the sidechain title,
 * lowercased and stripped of everything but letters and digits.
 */
export const SIDECHAIN_MARKS: Record<string, Pick<ChainProfile, 'mark' | 'markRects'>> = {
  bitnames: { mark: [
    'M9 5h15a2 2 0 0 1 2 2v18a2 2 0 0 1-2 2H9a4 4 0 0 1-4-4V9a4 4 0 0 1 4-4z',
    'M9 5v22', 'M13 12h8', 'M13 17h6',
  ] },
  bitassets: { mark: [
    'M6 9c0-2.2 4.5-4 10-4s10 1.8 10 4-4.5 4-10 4S6 11.2 6 9z',
    'M6 9v14c0 2.2 4.5 4 10 4s10-1.8 10-4V9',
    'M6 16c0 2.2 4.5 4 10 4s10-1.8 10-4',
  ] },
  solana: { mark: [
    'M7 10.5l3-3h16l-3 3z', 'M6 17.5l3-3h16l-3 3z', 'M9 24.5l3-3h16l-3 3z',
  ] },
  thunder: { mark: ['M18.5 3.5 9 18h6.5L13.5 28.5 23 14h-6.5z'] },
  truthcoin: { mark: [
    'M28 16a12 12 0 1 1-24 0 12 12 0 1 1 24 0', 'M10.5 16.5l3.5 3.5 7-7.5',
  ] },
  elements: { mark: ['M16 4c4 5 8 8.5 8 13a8 8 0 0 1-16 0c0-4.5 4-8 8-13z', 'M12.5 18a4.5 4.5 0 0 0 3.5 4'] },
  zside: { mark: [
    'M16 4l10 4v7c0 6-4 10.5-10 13-6-2.5-10-7-10-13V8z',
    'M16 12a3 3 0 0 0-1 5.8V21h2v-3.2A3 3 0 0 0 16 12z',
  ] },
  photon: { mark: [
    'M16 11a5 5 0 1 0 0 10 5 5 0 1 0 0-10',
    'M16 3v4M16 25v4M3 16h4M25 16h4M7 7l2.5 2.5M22.5 22.5L25 25M25 7l-2.5 2.5M9.5 22.5L7 25',
  ] },
  freebank: { mark: ['M4 12 16 5l12 7', 'M6 12h20', 'M6 27h20', 'M9 14v9M14 14v9M18 14v9M23 14v9'] },
  coinshift: { mark: [
    'M7 16a9 9 0 0 1 15-6.7', 'M22 5v5h-5',
    'M25 16a9 9 0 0 1-15 6.7', 'M10 27v-5h5',
  ] },
};

/** The mark id of a sidechain title, when we have one for it (else null: the generic block) */
export function sidechainMarkId(name: string | null | undefined): string | null {
  const id = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return Object.prototype.hasOwnProperty.call(SIDECHAIN_MARKS, id) ? id : null;
}

const SLOT_PALETTE = ['#ff8a3d', '#a585ff', '#5aa6ff', '#f26b9c', '#f5b83d', '#7bd88f', '#ff6b6b', '#c9a0ff'];

/** A sidechain's colour: its profile's, else one per slot */
export function slotColor(slot: number): string {
  return profileBySlot(slot)?.color ?? SLOT_PALETTE[((slot % SLOT_PALETTE.length) + SLOT_PALETTE.length) % SLOT_PALETTE.length];
}

/** The app-svg-images chain-mark fill of a sidechain: its profile id, its own mark by title, else the generic block */
export function slotMarkId(slot: number, name?: string | null): string {
  return sidechainMarkId(name) ?? profileBySlot(slot)?.id ?? 'sidechain';
}

const env = (typeof window !== 'undefined' && window['__env']) || {};

function resolveModule(): ChainFrontendModule {
  const id = String(env.CHAIN_PROFILE || 'ecash').toLowerCase();
  return MODULES.find(m => m.profile.id === id) ?? MODULES[0];
}

/** The chain module this explorer runs (CHAIN_PROFILE) and its profile */
export const MODULE: ChainFrontendModule = resolveModule();
export const PROFILE: ChainProfile = MODULE.profile;

/** The eCash networks (backend/src/chain/networks.ts): their names and address prefixes (Bitcoin's) */
export type NetworkId = 'ecash' | 'ecashbeta' | 'ecashtest';
export const NETWORKS: Record<NetworkId, { id: NetworkId; name: string; bech32: string }> = {
  ecash: { id: 'ecash', name: 'Mainnet', bech32: 'bc' },
  ecashbeta: { id: 'ecashbeta', name: 'Betanet', bech32: 'bc' },
  ecashtest: { id: 'ecashtest', name: 'Testnet', bech32: 'tb' },
};

/** The network this explorer shows (CHAIN_NETWORK): the address prefixes shown and accepted, the name in the header */
export const CHAIN_NETWORK: NetworkId = (Object.keys(NETWORKS).includes(String(env.CHAIN_NETWORK).toLowerCase())
  ? String(env.CHAIN_NETWORK).toLowerCase() : 'ecashbeta') as NetworkId;
export const NETWORK_NAME = NETWORKS[CHAIN_NETWORK].name;

/**
 * The public URLs of the explorers (profile or network id -> URL), from CHAIN_EXPLORER_URLS:
 * "ecash=https://...,ecashtest=https://..."
 */
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

export function bech32Prefix(): string {
  return NETWORKS[CHAIN_NETWORK].bech32;
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
  {
    // The theme compiles its colours into Bootstrap; recolour what carries the accent at runtime:
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
      /* ECX has no price feed here: no fiat amounts */
      app-fiat, .fiat, .table-cell-fiat { display: none !important; }
    `;
    document.head.appendChild(style);
    const favicon = document.querySelector('link[rel="icon"][type="image/svg+xml"]') || document.querySelector('link[rel="icon"]');
    if (favicon) {
      favicon.setAttribute('type', 'image/svg+xml');
      favicon.setAttribute('href', 'data:image/svg+xml,' + encodeURIComponent(markSvg(PROFILE, 64)));
    }
  }
  const title = `${PROFILE.name} Explorer` + (CHAIN_NETWORK === 'ecash' ? '' : ` (${NETWORK_NAME})`);
  document.title = title;
  for (const sel of ['meta[property="og:title"]', 'meta[name="twitter:title"]']) {
    document.querySelector(sel)?.setAttribute('content', title);
  }
  const desc = `Explore ${PROFILE.name}: ${PROFILE.tagline}. Blocks, transactions and mempool in real time.`;
  for (const sel of ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']) {
    document.querySelector(sel)?.setAttribute('content', desc);
  }
}
