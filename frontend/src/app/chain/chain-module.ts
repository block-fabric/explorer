import { Type } from '@angular/core';
import { Routes } from '@angular/router';
import { Observable } from 'rxjs';

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
  /**
   * 'l1': the eCash mainchain, on upstream mempool's pages and APIs; 'l2': a sidechain explorer, on its own lean page
   * set (chain/l2/) and API (/api/v1/l2/*), with none of upstream's pages, websocket or APIs; 'flush': Flush, a
   * Core-style sidechain (blocks of stake, assets, a DEX), on upstream's full UI over its own node plus its module's
   * pages (chain/modules/flush/, GET /api/v1/flush/*); 'freebank': FreeBank, a Core 0.16 sidechain of discount houses and
   * bills, likewise on upstream's full UI over its own node plus its module (chain/modules/freebank/, GET /api/v1/freebank/*).
   * Flush and FreeBank are the node sidechains (profiles.ts NODE_SIDECHAIN)
   */
  kind: 'l1' | 'l2' | 'flush' | 'freebank';
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
  /** more of its pages, listed in the footer only (Flush: treasury, auctions, oracles...) */
  footerNav?: NavItem[];
  /** the module's pages, added to the site's routes (use loadComponent / loadChildren to keep them lazy) */
  routes?: Routes;
  /** the transaction page's panel for describeTx data */
  txView?: () => Promise<Type<ChainDataView>>;
  /** the block page's panel for describeBlock data */
  blockView?: () => Promise<Type<ChainDataView>>;
  /**
   * L2: the chain's feature pages (chain/l2/feature.routes.ts: 'names', 'assets', 'markets', 'shielded') until
   * GET /api/v1/chain says which the backend serves
   */
  features?: L2Feature[];
  /**
   * A node sidechain (Flush, FreeBank): its views on upstream's pages (block, transaction, address panels, dashboard
   * widgets), loaded on demand by app-l2-view; a missing one shows nothing
   */
  views?: Partial<Record<ChainViewName, () => Promise<Type<any>>>>;
  /** a node sidechain: its dashboard widgets (app-drivechain-widget kinds) and their titles, by place */
  dashboard?: Partial<Record<DashboardSlot, { kind: string; title?: string }>>;
  /** a nav entry shown only when this says so (e.g. a list that is not empty), by path; an error hides it */
  navIf?: Record<string, (get: <T>(path: string) => Observable<T>) => Observable<boolean>>;
  /** the chain's address formats by eCash network id (ecash, ecashbeta, ecashtest) when they are not Bitcoin's */
  addresses?: Record<string, ChainAddressParams>;
  /** false: the backend has no address index (/api/address/* answers 405): the address page says so instead */
  addressIndex?: boolean;
  /** false: the backend cannot broadcast a transaction (no "Broadcast Transaction" link) */
  broadcast?: boolean;
  /** the search box: a route for what the chain's own ids look like (FreeBank: "house 3", "bill 12"), else null */
  searchRoute?: (text: string) => string[] | null;
}

/** The places of a node sidechain's views on upstream's pages (chain/l2/full/l2-view.component.ts) */
export type ChainViewName = 'block' | 'tx' | 'address' | 'widget';

/** The dashboard's widget places (dashboard.component.html), each filled by a module's widget of some kind */
export type DashboardSlot = 'chain' | 'treasury' | 'bmm' | 'bundles' | 'peg' | 'deposits' | 'withdrawals';

/** A chain's address formats when they are not Bitcoin's: bech32 prefix, base58 versions and their first characters */
export interface ChainAddressParams { bech32: string; p2pkh: number; p2sh: number; base58: { pubkey: string[]; script: string[] } }

export type L2Feature = 'names' | 'assets' | 'markets' | 'shielded' | 'swaps' | 'richlist';
