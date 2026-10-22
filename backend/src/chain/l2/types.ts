import { Application, Request, Response } from 'express';

/**
 * The sidechain explorers (kind l2): the shapes of chains/L2-API.md, and what a sidechain module tells the shared
 * index (chain/l2/index.ts) about its node. The nodes are the LayerTwo-API drop-ins (backbone-*); chains/L2-NODES.md
 * says what they return. Everything common to them (outpoints, addresses, deposits, the walk, the two-way peg) is
 * here and in codec.ts; a module brings its content and data decoding and the node features it serves.
 */

export type OutPointKind = 'regular' | 'coinbase' | 'deposit' | 'marketFunds' | 'payout';

export interface OutPoint {
  kind: OutPointKind;
  txid: string | null;
  vout: number | null;
  label: string;
}

export type ContentType = 'value' | 'withdrawal' | 'bitname' | 'bitnameReservation' | 'bitasset' | 'bitassetControl'
  | 'bitassetReservation' | 'ammLpToken' | 'dutchAuctionReceipt' | 'marketFunds' | 'swapPending' | 'other';

export interface Content {
  type: ContentType;
  value?: number;
  mainAddress?: string;
  mainFee?: number;
  assetId?: string;
  amount?: number;
  name?: string;
  swapId?: string;
  raw: any;
}

export interface Spent {
  txid: string | null;
  vin: number | null;
  height: number;
  kind: 'tx' | 'bundle' | 'state';   // state: consumed by the chain's state, no tx (stateUtxos)
}

export interface Output {
  vout: number;
  address: string;
  content: Content;
  value: number;
  memo: string | null;
  spent: Spent | null;
}

export interface Input {
  outpoint: OutPoint;
  address: string | null;
  content: Content | null;
  value: number | null;
}

export interface Shielded {
  actions: number;
  valueBalance: number;
  flags: number;
}

export interface MainBlockRef {
  hash: string;
  height: number;
}

export interface BlockSummary {
  height: number;
  hash: string;
  prevHash: string | null;
  time: number | null;
  mainBlock: MainBlockRef | null;
  txCount: number;
  outputs: number;
  inputs: number;
  fees: number;
  deposits: number;
  volume: number;
}

/** A sidechain module's view of its node (ChainModule.l2) */
export interface L2Chain {
  /**
   * Where txids come from: 'canonical' = blake3 of each tx's canonical_bytes in get_block(hash, true) (Thunder);
   * 'zside' = blake3(inputs ‖ outputs ‖ Option<bundle without auth>) cut out of canonical_bytes;
   * 'index' = get_block_index(hash).txs[].txid
   */
  txids: 'canonical' | 'zside' | 'index';
  /** get_block_index(hash) gives the block's deposits and bundle spends (else: the enforcer's peg data) */
  blockIndex: boolean;
  /** tx.inputs are [outpoint, utxo_hash] pairs (the utreexo chains) rather than bare outpoints */
  inputPairs: boolean;
  /** the node has get_withdrawal_bundle(m6id): what a submitted bundle spent, for chains without a block index */
  withdrawalBundleRpc: boolean;
  /** list_mempool */
  mempool: boolean;
  /** get_transaction_info(txid) → fee_sats: the fee of a tx spending outputs no tx created (Hivemind's market funds) */
  txInfo: boolean;
  /** the node fills non-sats content (ids of names, assets) in get_utxos / get_stxos */
  fill: boolean;
  /**
   * the node's state creates and consumes outputs without a tx (Hivemind's markets: treasury consolidation, buy
   * change, payouts): the index follows list_utxos for them
   */
  stateUtxos?: boolean;
  /** how a deposit's OP_RETURN text names the sidechain address (codec.ts depositAddress) */
  depositRule: 'bare' | 'prefix' | 'checksum';
  /** get_block_hash and the rest take the sidechain hash; Coinshift spends coinbase outputs by merkle root */
  coinbaseOutPoint?: 'txid' | 'merkleRoot';
  /** features served under /api/v1/l2/feature/ (names, assets, markets, shielded, swaps) */
  features: string[];
  /** the node's Content JSON, unfilled or filled, as the contract's Content */
  content(raw: any): Content;
  /** TxData as the contract's data: { type, ...fields }; default codec.ts liftData */
  data?(raw: any): any;
  /** zSide's Orchard bundle */
  shielded?(tx: any): Shielded | null;
  /** the module's own routes under /api/v1/l2/feature/ */
  featureRoutes?(app: Application, prefix: string, ctx: L2FeatureContext): void;
}

export interface L2FeatureContext {
  rpc: { call<T = any>(method: string, ...params: unknown[]): Promise<T> };
  cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T>;
  handler(fn: (req: Request, res: Response) => Promise<unknown>): (req: Request, res: Response) => Promise<void>;
  fail(req: Request, res: Response, status: number, message: string): void;
  /** the index, for features computed from it */
  index: any;
  /** GET <prefix><path>: { items: <the node's reply to method(...params)> }, cached a few seconds */
  list(path: string, method: string, map?: (items: any[]) => any[]): void;
  /** GET <prefix><path>/:id: the node's reply to method(id), 404 when the node knows no such id */
  item(path: string, method: string, id: RegExp, param?: (id: string) => unknown, map?: (v: any) => any): void;
}
