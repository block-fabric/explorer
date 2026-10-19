import { Type } from '@angular/core';
import { Routes } from '@angular/router';

/**
 * Chain modules (frontend): everything chain-specific lives in one folder per chain,
 * frontend/src/app/chain/modules/<id>/, listed once in frontend/src/app/chain/modules/index.ts.
 * window.__env.CHAIN_PROFILE (resources/config.js; CHAIN_PROFILE in Docker) picks the module at runtime, so one
 * build serves every chain. The backend has the matching module in backend/src/chain/modules/<id>/.
 * See chains/MODULES.md for how to add a sidechain.
 */

export interface NavItem {
  /** route path, e.g. '/names' (a route of the module's `routes`) */
  path: string;
  title: string;
  /** app-svg-images name; 'chain-mark' draws the chain's own mark */
  icon: string;
}

export interface ChainProfile {
  id: string;
  name: string;
  tagline: string;
  unit: string;
  subunit: string;
  /** BIP300 slot on the Chains mainchain; null for the mainchain itself */
  slot: number | null;
  mainchain: boolean;
  /** brand colour (the accent of the whole site) */
  color: string;
  /** stroke paths of the chain's mark, viewBox 0 0 32 32 */
  mark: string[];
  /** rect parts of the mark (Chains' two links) */
  markRects?: { x: number; y: number; w: number; h: number; rx: number }[];
  bech32: { main: string; testnet: string; regtest: string };
  blockWeightUnits: number;
  /** blocks of stake from validators, with BMM blocks as a fallback (FastBlocks, Layers): no proof of work to show */
  pos?: boolean;
}

/**
 * A component that shows what a transaction or block does on this chain. It gets the backend module's
 * describeTx / describeBlock answer (GET /api/v1/sidechain/tx/:txid, .../block/:hash/features) as `data`.
 * Write it standalone (imports: [CommonModule, SharedModule, ...]).
 */
export interface ChainDataView {
  data: any;
}

export interface ChainFrontendModule {
  profile: ChainProfile;
  /** nav bar entries of the module's pages */
  nav?: NavItem[];
  /** the module's pages, added to the site's routes (use loadComponent / loadChildren to keep them lazy) */
  routes?: Routes;
  /** the transaction page's panel for describeTx data; without one, the core shows the decoded fields as a list */
  txView?: () => Promise<Type<ChainDataView>>;
  /** the block page's panel for describeBlock data */
  blockView?: () => Promise<Type<ChainDataView>>;
  /** the chain's OP_RETURN markers, labelled on the transaction page (the payload is what follows the tag) */
  markers?: MarkerLabel[];
  /** the backend module serves tx-tokens (a token ledger): token amounts on the transaction pages */
  tokens?: boolean;
}

export interface MarkerLabel {
  /** the tag the pushed data starts with, in hex */
  tag: string;
  name: string;
  /** the badge, e.g. 'BNAM' (default: name) */
  short?: string;
  help?: string;
  /** one line on what this marker does, from its payload */
  describe?: (payload: Uint8Array) => string;
}

/** A Chains sidechain profile with the usual defaults (CHN, sats, t<prefix> on testnet, 4 M weight units) */
export function sidechainProfile(p: Pick<ChainProfile, 'id' | 'name' | 'tagline' | 'slot' | 'color' | 'mark'> & Partial<ChainProfile> & { bech32Main: string }): ChainProfile {
  const { bech32Main, ...rest } = p;
  return {
    unit: 'CHN', subunit: 'sats', mainchain: false, blockWeightUnits: 4000000,
    bech32: { main: bech32Main, testnet: 't' + bech32Main, regtest: 'rsc' },
    ...rest,
  };
}
