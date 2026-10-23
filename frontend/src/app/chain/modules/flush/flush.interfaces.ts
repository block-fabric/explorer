/**
 * The shapes of Flush's public DEX API (backbone-flush doc/public-api.md, src/grpc/proto/flush/dex/v1/dex.proto: the REST
 * face prints each message with its proto field names, every field present, unset optionals null), as the explorer's
 * backend proxies them (GET /api/v1/flush/market/<path>, chains/FLUSH-API.md). Display amounts are numbers in whole
 * units (ECX: 8 decimals, launched tokens: 6); exact amounts are *_units strings. ECX has no asset id (null).
 */

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
  total: number;
  /** pools: the search stopped at its budget, next_cursor goes on */
  partial?: boolean;
}

export interface FlushStatus {
  network: string;
  flush: { height: number; time: number; hash: string; block_target: number };
  ecash: { height: number; time: number; hash?: string };
  slot: number;
  slot_active: boolean;
  escrow_ecx: number;
  launches_today: number;
  indexer_lag: number;
  updated: number;
  market_index?: boolean;
  /** the launch rules a token launch takes since Flush v2 (null or absent before) */
  launch_params?: LaunchParams | null;
}

export interface LaunchParams {
  active: boolean;
  height: number;
  fee_min_bps: number;
  fee_max_bps: number;
  fee_default_bps: number;
  supply_min_units: string;
  supply_max_units: string;
  supply_multiple_units: number;
  decimals_max: number;
  decimals_default: number;
}

/** GET assets (Flush v2): an asset with its market */
export interface AssetMarket {
  status: string;
  kinds: string[];
  progress: number | null;
  pools: number;
  books: number;
  auctions: number;
  price_ecx: number | null;
  volume_24h_ecx: number;
}

export interface AssetSummary {
  id: string;
  ticker: string;
  display_name: string | null;
  info: string | null;
  decimals: number;
  supply: number;
  supply_units: string;
  holders: number;
  logo: string | null;
  fixed_supply: boolean;
  registered_height: number;
  registration_txid: string;
  launched: boolean;
  controller: string | null;
  seq: number;
  market: AssetMarket;
}

/** GET assets/{id} (Flush v2) */
export interface AssetDetail extends AssetSummary {
  description?: string | null;
  links: { label?: string; url: string }[] | string[];
  launch: unknown | null;
  pools: Pool[];
  books: Pool[];
  auctions: unknown[];
  can_curve: { allowed: boolean; reason: string | null } | null;
}

export interface FeeShare { to: string; bps: number }

export interface CurveParams {
  supply: number;
  sale_supply: number;
  pool_supply: number;
  virtual_ecx: number;
  virtual_tokens: number;
  graduation_ecx: number;
  decimals?: number;
  max_allocation_percent?: number;
}

export interface FlushStats {
  launches: number;
  live: number;
  graduated: number;
  volume_24h: number;
  volume_total: number;
  graduation_ecx: number;
  fees: { trade_bps: number | null; split: FeeShare[] | null; pool_fee_bps: number; launch_fee_ecx: number | null };
  curve: CurveParams;
  raised_total?: number;
  pools?: number;
  liquidity_ecx?: number;
}

export interface FlushFees {
  pool_fee_tiers_ppm: number[];
  default_pool_fee_ppm: number;
  kinds: { curve: string; fee_tiers_ppm: number[] }[];
  dynamic_fees: boolean;
  launch_fee_ppm: number;
  launch_split: FeeShare[];
  launch_graduation_ecx: number;
  protocol_fee_share_ppm: number;
  network_bidder_bps: number | null;
  min_relay_fee_ecx_per_kvb: number;
  swap_split: FeeShare[];
}

export interface TreasuryInflow {
  height: number;
  time: number;
  asset: string;
  amount_ecx: number;
  source: string;
  from_swaps: number;
  from_launches: number;
  security_held: number;
}

export interface TreasuryBalance {
  asset: string;
  asset_id: string | null;
  balance: number;
  from_swaps: number;
  from_launches: number;
  security_held: number;
}

export interface FlushTreasury {
  available: boolean;
  reason: string;
  address: string | null;
  balance_ecx: number;
  inflow_24h_ecx: number;
  inflows: TreasuryInflow[];
  balances: TreasuryBalance[];
  security_paid_ecx: number;
  spending_rule: boolean;
}

export interface PoolRef { pool: string; asset_a: string; asset_b: string }

export type LaunchState = 'curve' | 'graduating' | 'graduated' | string;

export interface LaunchSummary {
  id: string;
  ticker: string;
  name: string;
  logo: string | null;
  creator: string;
  created_height: number;
  created_time: number;
  state: LaunchState;
  raised_ecx: number;
  sold: number;
  price_ecx: number;
  mcap_ecx: number;
  volume_24h: number;
  trades_24h: number;
  holders: number;
  change_24h: number | null;
  graduated_height: number | null;
  pool: PoolRef | null;
  /** percent of the graduation amount raised */
  progress: number;
  /** the curve's pool before graduation, the graduated pool after */
  pool_id: string;
  volume_total: number;
  trades_total: number;
}

export interface LaunchDetail extends LaunchSummary {
  description: string;
  links: { label: string; url: string }[];
  curve: CurveParams;
  trade_fee_bps: number | null;
  create_txid: string;
  first_buy_ecx: number;
  creator_share_percent: number;
  protocol_share_percent: number;
  security_share_percent: number;
  creator_fees_owed_ecx: number;
  creator_fees_paid_ecx: number;
  allocation_percent: number;
  allocation_claimed: boolean;
  min_buy_ecx: number;
  max_buy_ecx: number;
  curve_tokens_left: number;
}

export interface LaunchStats {
  launches: number;
  on_curve: number;
  graduated: number;
  volume_ecx: number;
  raised_ecx: number;
  graduation_ecx: number;
  fee_percent: number;
  creator_share_percent: number;
  curve: CurveParams;
  active: boolean;
  launches_24h: number;
  graduated_24h: number;
  volume_24h: number;
}

export interface Trade {
  txid: string;
  height: number;
  time: number;
  /** buy or sell of the token against ECX; for a pair without ECX: of asset_b against asset_a */
  side: 'buy' | 'sell' | string;
  ecx: number;
  tokens: number;
  price_ecx: number;
  address: string;
  venue: 'curve' | 'pool' | 'book' | string;
  pool: string;
  asset_in: string;
  asset_out: string;
  amount_in_units: string;
  amount_out_units: string;
  hops: number;
}

export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number; n?: number }

export interface Holder {
  address: string;
  amount: number;
  share: number;
  tag: 'creator' | 'curve' | 'pool' | null | string;
}

export interface ConcentratedState { sqrt_price_x96: string; tick: number; liquidity: string; tick_spacing: number }

export interface Pool {
  pool: string;
  asset_a: string;
  asset_b: string;
  asset_a_id: string | null;
  asset_b_id: string | null;
  reserve_a: number;
  reserve_b: number;
  /** asset_b per whole asset_a (ECX per token for a pool with ECX) */
  price: number | null;
  shares: number;
  volume_a: number;
  volume_b: number;
  swaps: number;
  created: number;
  abandoned: boolean;
  name: string;
  logo: string | null;
  liquidity_ecx: number;
  volume_24h: number;
  change_24h: number | null;
  /** the launch it graduated from (its ticker) */
  launch: string | null;
  locked: boolean;
  /** constant_product, stable, weighted, concentrated, launch, book */
  curve: string;
  fee_ppm: number;
  fee_bps: number;
  amp: number | null;
  weight_a: number | null;
  weight_b: number | null;
  default_kind: boolean;
  dynamic_fee: boolean;
  fee_now_bps: number | null;
  concentrated: ConcentratedState | null;
  depth_ecx: number;
  volume_window_ecx: number;
  price_change_window: number;
  last_activity: number;
  shares_units?: string;
  reserve_a_units?: string;
  reserve_b_units?: string;
}

export interface Tick { tick: number; price: number; liquidity_net: string; liquidity_gross: string }

export interface PoolTicks {
  pool: string;
  tick: number;
  sqrt_price_x96: string;
  liquidity: string;
  tick_spacing: number;
  items: Tick[];
}

export interface Position {
  id: string;
  pool: string;
  tick_lower: number;
  tick_upper: number;
  price_lower: number;
  price_upper: number;
  liquidity: string;
  amount_a: number;
  amount_b: number;
  fees_a: number;
  fees_b: number;
  in_range: boolean;
  txid: string;
  height: number;
  asset_a: string;
  asset_b: string;
}

export interface BookLevel { price: number; amount: number; orders: number; total: number; price_exact?: string; amount_units?: string }

export interface Book {
  book: string;
  base: string;
  quote: string;
  asks: BookLevel[];
  bids: BookLevel[];
  best_ask: number | null;
  best_bid: number | null;
  best_ask_exact?: string | null;
  best_bid_exact?: string | null;
  spread: number | null;
  ask_orders: number;
  bid_orders: number;
}

export interface Holding {
  ticker: string;
  amount: number;
  value_ecx: number;
  asset_id: string;
  /** asset, lp, position, order */
  kind: string;
  amount_units: string;
}

export interface Holdings { items: Holding[]; address: string }

export interface TickerAvailability { ticker: string; available: boolean; reason: string }

export interface CuratorWord { curator: string; name: string; verified: boolean; round: number; height: number | null }
export interface Verification { asset: string; verified: boolean; curators: CuratorWord[] }
export interface Verifications { items: Verification[] }
