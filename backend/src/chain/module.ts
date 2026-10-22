import { Application, Request, Response } from 'express';

/**
 * Chain modules: everything chain-specific in the backend lives in one folder per chain,
 * backend/src/chain/modules/<id>/, listed once in backend/src/chain/modules/index.ts.
 * CHAIN.PROFILE (mempool-config.json) picks the module this instance runs; the frontend has the matching module in
 * frontend/src/app/chain/modules/<id>/. See chains/MODULES.md for how to add a sidechain.
 */

export interface ChainProfile {
  /** the module id, the value of CHAIN.PROFILE */
  id: string;
  name: string;
  unit: string;
  /** BIP300 slot on the eCash mainchain; null for the mainchain itself */
  slot: number | null;
  mainchain: boolean;
  /** Bitcoin-style PoW with a block subsidy (the stock reward/subsidy maths apply) */
  subsidy: boolean;
}

/** What the core hands a module */
export interface ChainModuleContext {
  /** this chain's node (CORE_RPC); every RPC name of rpc-api/commands.ts, or node.call(method, ...params) */
  node: RpcClient;
  /** memoize an async value for ttlMs (per key) */
  cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T>;
  /** wrap an express handler: errors become a JSON 500 (node errors) */
  handler(fn: (req: Request, res: Response) => Promise<unknown>): (req: Request, res: Response) => Promise<void>;
  /** a JSON error with a status */
  fail(req: Request, res: Response, status: number, message: string): void;
  /** int query parameter, clamped */
  intParam(v: unknown, def: number | null, min: number, max: number): number | null;
}

export interface RpcClient {
  call<T = any>(method: string, ...params: unknown[]): Promise<T>;
  [method: string]: any;
}

export interface ChainModule {
  profile: ChainProfile;
  /**
   * The module's own read-only routes. `prefix` is /api/v1/sidechain/ for a sidechain and /api/v1/chain/ for the
   * mainchain; register e.g. app.get(prefix + 'names', ...). The frontend module calls them with
   * ChainApiService.feature$('names').
   */
  initRoutes?(app: Application, prefix: string, ctx: ChainModuleContext): void;
  /** background work at startup (indexes) */
  start?(ctx: ChainModuleContext): void;
  /** a new block of this chain */
  onNewBlock?(block: { id: string; height: number }, ctx: ChainModuleContext): void;
  /**
   * What a transaction does on this chain beyond moving coins (a name registration, a swap, a vote...), shown on
   * the transaction page by the frontend module. `tx` is the node's getrawtransaction verbose JSON. Return null
   * for an ordinary transaction. Served at GET <prefix>tx/:txid.
   */
  describeTx?(tx: any, ctx: ChainModuleContext): Promise<unknown | null>;
  /** The same for a block (served at GET <prefix>block/:hash/features), e.g. FastBlocks' kind/proposer/finality */
  describeBlock?(block: any, ctx: ChainModuleContext): Promise<unknown | null>;
}
