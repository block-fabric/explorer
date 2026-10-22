import { Type } from '@angular/core';
import { Routes } from '@angular/router';

/**
 * Chain modules (frontend): everything chain-specific lives in one folder per chain,
 * frontend/src/app/chain/modules/<id>/, listed once in frontend/src/app/chain/modules/index.ts.
 * window.__env.CHAIN_PROFILE (resources/config.js; CHAIN_PROFILE in Docker) picks the module at runtime, so one
 * build serves every chain. The backend has the matching module in backend/src/chain/modules/<id>/.
 */

export interface NavItem {
  /** route path, e.g. '/mining' (a route of the module's `routes`) */
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
  /** BIP300 slot on the eCash mainchain; null for the mainchain itself */
  slot: number | null;
  mainchain: boolean;
  /** brand colour (the accent of the whole site) */
  color: string;
  /** stroke paths of the chain's mark, viewBox 0 0 32 32 */
  mark: string[];
  /** rect parts of the mark */
  markRects?: { x: number; y: number; w: number; h: number; rx: number }[];
  blockWeightUnits: number;
}

/**
 * A component that shows what a transaction or block does on this chain. It gets the backend module's
 * describeTx / describeBlock answer (GET /api/v1/chain/tx/:txid, .../block/:hash/features) as `data`.
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
  /** the transaction page's panel for describeTx data */
  txView?: () => Promise<Type<ChainDataView>>;
  /** the block page's panel for describeBlock data */
  blockView?: () => Promise<Type<ChainDataView>>;
}
