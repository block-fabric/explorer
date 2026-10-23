// The sidechain explorers' API (chains/L2-API.md, backend/src/chain/l2/). Amounts are sats; sidechain hashes and
// txids are the nodes' own hex, eCash ones (mainchain blocks, deposit txids, M6 ids) in Bitcoin display order.

export interface L2Summary {
  tip: { height: number; hash: string; time: number | null } | null;
  /** the highest indexed height (== tip.height when caught up) */
  indexed: number;
  ready: boolean;
  blocks: number;
  txs: number;
  addresses: number;
  /** sats held on the sidechain */
  wealth: number;
  /** the treasury on eCash */
  escrow: { amount: number; txid: string; sequence: number } | null;
  deposits: { count: number; amount: number };
  withdrawals: { count: number; amount: number };
  pendingBundle: { m6id: string | null; payouts: { address: string; amount: number; fee: number }[]; total: number } | null;
  /** null when the node cannot list its mempool (Thunder, zSide) */
  mempool: { count: number } | null;
  /** BMM coverage over the newest `window` eCash blocks; null: no eCash explorer API (CHAIN.MAINCHAIN_API) */
  bmm?: { window: number; mainHeight: number; accepts: number; coverage: number; lastMainHeight: number | null; bidMedian: number } | null;
}

/** A sidechain block's BMM, from the eCash explorer's drivechain index */
export interface L2Bmm {
  /** the eCash block that carried it */
  mainHeight: number;
  mainHash: string;
  /** sats: the fee of the M8 request, paid to that block's miner */
  bid: number | null;
  /** the M8 request (eCash txid) */
  requestTxid: string | null;
  /** M8 requests for this slot in that eCash block */
  requests: number;
  contested: boolean;
}

/** An M8 request for this slot in an eCash block (sideBlock in the nodes' order) */
export interface L2BmmRequest {
  txid: string;
  bid: number;
  sideBlock: string;
  accepted: boolean;
}

export interface L2BlockSummary {
  height: number;
  hash: string;
  prevHash: string | null;
  time: number | null;
  /** the eCash block that carried it (BMM) */
  mainBlock: { hash: string; height: number } | null;
  txCount: number;
  outputs: number;
  inputs: number;
  fees: number;
  deposits: number;
  volume: number;
  /** null: no BMM known for it (or no eCash explorer API) */
  bmm?: L2Bmm | null;
}

export type L2OutPointKind = 'regular' | 'coinbase' | 'deposit' | 'marketFunds' | 'payout';

export interface L2OutPoint {
  kind: L2OutPointKind;
  txid: string | null;
  vout: number | null;
  /** a short display form, e.g. "deposit 1a2b…:0" */
  label: string;
}

export type L2ContentType = 'value' | 'withdrawal' | 'bitname' | 'bitnameReservation' | 'bitasset' | 'bitassetControl'
  | 'bitassetReservation' | 'ammLpToken' | 'dutchAuctionReceipt' | 'marketFunds' | 'swapPending' | 'other';

export interface L2Content {
  type: L2ContentType;
  value?: number;
  mainAddress?: string;
  mainFee?: number;
  assetId?: string;
  amount?: number;
  name?: string;
  /** the node's own JSON */
  raw?: any;
}

export interface L2Spent {
  txid: string | null;
  vin: number | null;
  height: number;
  kind: 'tx' | 'bundle' | 'state';
}

export interface L2Input {
  outpoint: L2OutPoint;
  address: string | null;
  content: L2Content | null;
  value: number | null;
}

export interface L2Output {
  vout: number;
  address: string;
  content: L2Content;
  /** sats the output holds (0 for non-sats content) */
  value: number;
  memo: string | null;
  spent: L2Spent | null;
}

export interface L2TxSummary {
  txid: string;
  /** position in the block */
  index: number;
  inputs: L2Input[];
  outputs: L2Output[];
  fee: number;
  size: number | null;
  /** TxData as the node gives it, its type lifted out */
  data: ({ type: string } & Record<string, any>) | null;
  /** zSide's Orchard bundle */
  shielded: { actions: number; valueBalance: number; flags: number } | null;
  /** the address of each input's verifying key, in input order */
  signers: string[];
  /** a market tx (Truthcoin's Trade, AmplifyBeta), else null */
  market?: L2Market | null;
}

export type L2PayoutKind = 'buyChange' | 'sellProceeds' | 'sellChange';

/**
 * What a market tx did (Truthcoin): its inputs = payouts + cost + fee (the miner fee). cost: sats into the market
 * (negative: a sell's proceeds out of it); null when not known (an unconfirmed tx, an input the index cannot value)
 */
export interface L2Market {
  action: 'buy' | 'sell' | 'amplify';
  marketId: string;
  outcome: number | null;
  shares: number;
  /** a buy's max cost incl. the miner fee, a sell's min proceeds */
  limit: number | null;
  /** false: its block skipped it; null: unconfirmed */
  applied: boolean | null;
  cost: number | null;
  payouts: { kind: L2PayoutKind; outpoint: L2OutPoint; vout: number; address: string; value: number; spent: L2Spent | null }[];
}

/** An address's shares in the markets and its Votecoin (Truthcoin: GET l2/address/:address/positions) */
export interface L2Positions {
  address: string;
  positions: { marketId: string; title: string | null; outcome: number; outcomeName: string | null; shares: number; price: number | null; value: number | null }[];
  /** sats, the positions at the markets' current prices */
  value: number;
  votecoin: number;
  height: number;
}

export interface L2Tx extends L2TxSummary {
  status: { confirmed: true; height: number; hash: string; time: number | null } | { confirmed: false };
}

export interface L2Deposit {
  outpoint: L2OutPoint;
  mainTxid: string;
  address: string;
  burned: boolean;
  amount: number;
  height: number;
  hash: string;
  time: number | null;
  spent: L2Spent | null;
}

export interface L2Withdrawal {
  txid: string;
  vout: number;
  height: number;
  time: number | null;
  address: string;
  mainAddress: string;
  amount: number;
  mainFee: number;
  status: 'pending' | 'bundled' | 'paid';
  m6id: string | null;
}

/** (its deposits are the list, where BlockSummary has their count) */
export interface L2Block extends Omit<L2BlockSummary, 'deposits'> {
  merkleRoot: string;
  prevMainHash: string;
  nextHash: string | null;
  coinbase: { txid: string; outputs: L2Output[] } | null;
  txs: L2TxSummary[];
  /** credited when this block connected */
  deposits: L2Deposit[];
  bundleSpends: { outpoint: L2OutPoint; m6id: string }[];
  /** with the M8 requests for this slot in the carrying eCash block */
  bmm?: (L2Bmm & { requestList: L2BmmRequest[] }) | null;
}

export interface L2Address {
  address: string;
  funded: { count: number; sum: number };
  spent: { count: number; sum: number };
  balance: number;
  txs: { txid: string; height: number; time: number | null; delta: number }[];
  utxos: { outpoint: L2OutPoint; content: L2Content; value: number; height: number }[];
  /** its unconfirmed txs (chains whose node lists its mempool; null: no mempool listing) and their net effect */
  mempool?: { txs: (L2Tx & { delta: number })[]; delta: number } | null;
}

export interface L2SearchResult {
  type: 'block' | 'tx' | 'address' | null;
  id: string;
}

/** A failed request, as the pages show it */
export interface L2Error {
  status: number;
  message: string;
  /** 503: the index is still being built */
  building: boolean;
}

/** A request's state for a template: loading, then data or error */
export interface Loaded<T> {
  loading: boolean;
  data?: T;
  error?: L2Error;
}
