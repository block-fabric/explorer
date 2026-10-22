import { Content } from '../../l2/types';
import { IndexTx, IndexUtxo } from '../l2-views';

/**
 * BitAssets' feature views, derived from the index (every tx with its inputs resolved, the UTXO set): each asset's
 * supply, holders, registration, mints and activity; the AMM pools replayed from their AmmMint / AmmBurn / AmmSwap
 * txs (reserves and price after each); the Dutch auctions' create, bid and collect txs. The node's own state
 * (bitassets, get_amm_pool_state, dutch_auctions) stays the reference: the routes show it next to these.
 *
 * Ids: a BitAsset's id is the hash the node lists (bitassets); an AssetId (pools, auctions, AmmSwap's pair_asset) is
 * the hex of its borsh: "00" for sats, "01" ‖ hash for a BitAsset, "02" ‖ hash for its control coin
 * (backbone-bitassets json.cpp asset_id, types.cpp). The node orders AssetIds by tag then hash, as the hex strings sort.
 */

export const SATS = '00';

/** The AssetId of what an output holds, null for content that is no asset (reservations, LP tokens, receipts) */
export function assetIdOf(c: Content | null): string | null {
  if (!c) {
    return null;
  }
  switch (c.type) {
    case 'value':
      return SATS;
    case 'bitasset':
      return c.assetId ? '01' + c.assetId : null;
    case 'bitassetControl':
      return c.assetId ? '02' + c.assetId : null;
    default:
      return null;
  }
}

function amountOf(c: Content, value: number): number {
  return c.type === 'value' ? value : c.type === 'bitassetControl' ? 1 : Number(c.amount ?? 0);
}

/** A BitAsset's hash of an AssetId ("01" ‖ hash or "02" ‖ hash), null for sats */
export function hashOfAssetId(id: string): string | null {
  return /^0[12][0-9a-f]{64}$/.test(id) ? id.slice(2) : null;
}

export interface Ref {
  height: number;
  time: number | null;
  txid: string;
}

export type ActivityKind = 'register' | 'mint' | 'transfer' | 'update' | 'swap' | 'liquidity-add' | 'liquidity-remove'
  | 'auction-create' | 'auction-bid' | 'auction-collect';

export interface ActivityRow extends Ref {
  kind: ActivityKind;
  /** units of the asset the tx moved (registration: the initial supply; mint: the amount minted) */
  amount: number;
  /** the other asset of a swap, pool or auction (an AssetId) */
  counterAsset: string | null;
  counterAmount: number | null;
  /** the outputs holding the asset after the tx (at most 5): change included, the chain cannot tell it apart */
  outputs: { address: string; amount: number }[];
}

export interface AssetStats {
  id: string;
  supply: number;
  holders: Map<string, number>;
  controller: string | null;
  registration: (Ref & { initialSupply: number }) | null;
  mints: (Ref & { amount: number })[];
  activity: ActivityRow[];
  last: Ref | null;
}

export interface PoolEvent extends Ref {
  kind: 'mint' | 'burn' | 'swap';
  /** the change of each reserve (signed) and of the LP tokens */
  amount0: number;
  amount1: number;
  lp: number;
  reserve0: number;
  reserve1: number;
  outstanding: number;
  /** reserve0 / reserve1: units of asset0 per unit of asset1, null when a reserve is empty */
  price: number | null;
}

export interface PoolStats {
  id: string;
  asset0: string;
  asset1: string;
  created: Ref | null;
  events: PoolEvent[];
  swaps: number;
  volume0: number;
  volume1: number;
}

export interface AuctionStats {
  id: string;
  created: (Ref & { params: any }) | null;
  bids: (Ref & { quantity: number; bidSize: number; bidder: string | null })[];
  collects: (Ref & { amountOfferedRemaining: number; amountReceived: number })[];
}

export interface BitAssetsView {
  assets: Map<string, AssetStats>;
  pools: Map<string, PoolStats>;
  auctions: Map<string, AuctionStats>;
  reservations: { total: number; open: number };
}

export const poolId = (a0: string, a1: string): string => `${a0}-${a1}`;

const ACTIVITY: Record<string, ActivityKind> = {
  BitAssetRegistration: 'register', BitAssetMint: 'mint', BitAssetUpdate: 'update', AmmSwap: 'swap', AmmMint: 'liquidity-add',
  AmmBurn: 'liquidity-remove', DutchAuctionCreate: 'auction-create', DutchAuctionBid: 'auction-bid', DutchAuctionCollect: 'auction-collect',
};

export function buildView(txs: IndexTx[], utxos: IndexUtxo[]): BitAssetsView {
  const assets = new Map<string, AssetStats>();
  const pools = new Map<string, PoolStats>();
  const auctions = new Map<string, AuctionStats>();
  const asset = (id: string): AssetStats => {
    let a = assets.get(id);
    if (!a) {
      a = { id, supply: 0, holders: new Map(), controller: null, registration: null, mints: [], activity: [], last: null };
      assets.set(id, a);
    }
    return a;
  };
  const pool = (a0: string, a1: string): PoolStats => {
    const id = poolId(a0, a1);
    let p = pools.get(id);
    if (!p) {
      p = { id, asset0: a0, asset1: a1, created: null, events: [], swaps: 0, volume0: 0, volume1: 0 };
      pools.set(id, p);
    }
    return p;
  };
  const auction = (id: string): AuctionStats => {
    let a = auctions.get(id);
    if (!a) {
      a = { id, created: null, bids: [], collects: [] };
      auctions.set(id, a);
    }
    return a;
  };
  const poolEvent = (p: PoolStats, ref: Ref, kind: PoolEvent['kind'], amount0: number, amount1: number, lp: number): void => {
    const prev = p.events[p.events.length - 1];
    const reserve0 = (prev?.reserve0 ?? 0) + amount0;
    const reserve1 = (prev?.reserve1 ?? 0) + amount1;
    const outstanding = (prev?.outstanding ?? 0) + lp;
    p.created = p.created ?? ref;
    p.events.push({ ...ref, kind, amount0, amount1, lp, reserve0, reserve1, outstanding, price: reserve0 > 0 && reserve1 > 0 ? reserve0 / reserve1 : null });
  };

  for (const t of txs) {
    const ref: Ref = { height: t.height, time: t.time, txid: t.txid };
    const d = t.data;
    // the assets spent, in the order they first occur (the node's unique_spent_assets), and what each output holds
    const spent: string[] = [];
    const inAmt = new Map<string, number>();
    const outAmt = new Map<string, number>();
    for (const i of t.inputs) {
      const id = assetIdOf(i.content);
      if (id && i.content) {
        if (!spent.includes(id)) {
          spent.push(id);
        }
        inAmt.set(id, (inAmt.get(id) ?? 0) + amountOf(i.content, i.value ?? 0));
      }
    }
    const outList = new Map<string, { address: string; amount: number }[]>();
    for (const o of t.outputs) {
      const id = assetIdOf(o.content);
      if (id) {
        const n = amountOf(o.content, o.value);
        outAmt.set(id, (outAmt.get(id) ?? 0) + n);
        outList.set(id, [...(outList.get(id) ?? []), { address: o.address, amount: n }]);
      }
    }
    let controlled: string | null = null; // the asset a mint or update is for: the last control coin spent
    for (let k = t.inputs.length - 1; k >= 0 && !controlled; k--) {
      const c = t.inputs[k].content;
      if (c?.type === 'bitassetControl' && c.assetId) {
        controlled = c.assetId;
      }
    }

    switch (d?.type) {
      case 'BitAssetRegistration':
        if (d.name_hash) {
          asset(d.name_hash).registration = { ...ref, initialSupply: Number(d.initial_supply ?? 0) };
        }
        break;
      case 'BitAssetMint':
        if (controlled) {
          asset(controlled).mints.push({ ...ref, amount: Number(d.value ?? 0) });
        }
        break;
      case 'AmmMint': {
        const pair = spent.filter(a => !a.startsWith('02')).slice(0, 2).sort();
        if (pair.length === 2) {
          poolEvent(pool(pair[0], pair[1]), ref, 'mint', Number(d.amount0 ?? 0), Number(d.amount1 ?? 0), Number(d.lp_token_mint ?? 0));
        }
        break;
      }
      case 'AmmBurn': {
        const lp = t.inputs.find(i => i.content?.type === 'ammLpToken' && String(i.content.assetId ?? '').includes(':'));
        if (lp?.content?.assetId) {
          const [a0, a1] = lp.content.assetId.split(':');
          poolEvent(pool(a0, a1), ref, 'burn', -Number(d.amount0 ?? 0), -Number(d.amount1 ?? 0), -Number(d.lp_token_burn ?? 0));
        }
        break;
      }
      case 'AmmSwap': {
        const from = spent[0];
        const to = String(d.pair_asset ?? '');
        if (from && to && from !== to) {
          const [a0, a1] = [from, to].sort();
          const p = pool(a0, a1);
          const give = Number(d.amount_spent ?? 0);
          const get = Number(d.amount_receive ?? 0);
          poolEvent(p, ref, 'swap', from === a0 ? give : -get, from === a0 ? -get : give, 0);
          p.swaps++;
          p.volume0 += from === a0 ? give : get;
          p.volume1 += from === a0 ? get : give;
        }
        break;
      }
      case 'DutchAuctionCreate':
        auction(t.txid).created = { ...ref, params: { ...d, type: undefined } };
        break;
      case 'DutchAuctionBid':
        if (d.auction_id) {
          auction(d.auction_id).bids.push({ ...ref, quantity: Number(d.quantity ?? 0), bidSize: Number(d.bid_size ?? 0), bidder: t.signers[0] ?? null });
        }
        break;
      case 'DutchAuctionCollect': {
        const receipt = t.inputs.find(i => i.content?.type === 'dutchAuctionReceipt' && i.content.assetId);
        if (receipt?.content?.assetId) {
          auction(receipt.content.assetId).collects.push({ ...ref, amountOfferedRemaining: Number(d.amount_offered_remaining ?? 0), amountReceived: Number(d.amount_received ?? 0) });
        }
        break;
      }
    }

    // the activity of each BitAsset the tx touched
    const touched = new Set<string>();
    for (const id of [...inAmt.keys(), ...outAmt.keys()]) {
      const h = hashOfAssetId(id);
      if (h) {
        touched.add(h);
      }
    }
    if (d?.type === 'BitAssetRegistration' && d.name_hash) {
      touched.add(d.name_hash);
    }
    for (const h of touched) {
      let kind: ActivityKind = ACTIVITY[d?.type] ?? 'transfer';
      if ((kind === 'mint' || kind === 'update') && controlled !== h) {
        kind = 'transfer';
      }
      const id = '01' + h;
      let counterAsset: string | null = null;
      let counterAmount: number | null = null;
      let amount = outAmt.get(id) || inAmt.get(id) || 0;
      if (kind === 'register') {
        amount = Number(d.initial_supply ?? amount);
      } else if (kind === 'mint') {
        amount = Number(d.value ?? amount);
      } else if (kind === 'swap') {
        const from = spent[0];
        const to = String(d.pair_asset ?? '');
        amount = from === id ? Number(d.amount_spent ?? 0) : Number(d.amount_receive ?? 0);
        counterAsset = from === id ? to : from ?? null;
        counterAmount = from === id ? Number(d.amount_receive ?? 0) : Number(d.amount_spent ?? 0);
      } else if (kind === 'liquidity-add' || kind === 'liquidity-remove') {
        amount = Math.abs((outAmt.get(id) ?? 0) - (inAmt.get(id) ?? 0));
        counterAsset = spent.find(a => a !== id && !a.startsWith('02')) ?? SATS;
      } else if (kind === 'auction-create') {
        amount = Number(d.base_amount ?? amount);
        counterAsset = d.quote_asset ?? null;
      }
      const a = asset(h);
      a.activity.push({ ...ref, kind, amount, counterAsset, counterAmount, outputs: (outList.get(id) ?? []).slice(0, 5) });
      a.last = ref;
    }
  }

  let reservations = 0;
  let openReservations = 0;
  for (const t of txs) {
    if (t.data?.type === 'BitAssetReservation') {
      reservations++;
    }
  }
  for (const u of utxos) {
    if (u.content.type === 'bitasset' && u.content.assetId) {
      const a = asset(u.content.assetId);
      const n = Number(u.content.amount ?? 0);
      a.supply += n;
      a.holders.set(u.address, (a.holders.get(u.address) ?? 0) + n);
    } else if (u.content.type === 'bitassetControl' && u.content.assetId) {
      asset(u.content.assetId).controller = u.address;
    } else if (u.content.type === 'bitassetReservation') {
      openReservations++;
    }
  }
  return { assets, pools, auctions, reservations: { total: reservations, open: openReservations } };
}

/**
 * A Dutch auction's price over its blocks, from the node's state (dutch_auctions): after its last bid the price
 * falls linearly from price_after_most_recent_bid to end_price_after_most_recent_bid at the end block
 * (start_block + duration - 1), backbone-bitassets state.cpp AuctionState::bid. The price is in quote units for
 * all the base still offered. `curve` holds [block, price] points; `current` is the price at block `at`.
 */
export function auctionCurve(s: any, at: number): {
  start: number; end: number; status: 'upcoming' | 'live' | 'ended'; current: number | null; remaining: number; curve: [number, number][];
} {
  const start = Number(s?.start_block ?? 0);
  const duration = Math.max(1, Number(s?.duration ?? 1));
  const end = start + duration - 1;
  const hist = (k: string): { data: number; height: number }[] => (Array.isArray(s?.[k]) ? s[k] : []).map((e: any) => ({ data: Number(e.data), height: Number(e.height) }));
  const blocks = hist('most_recent_bid_block');
  const prices = hist('price_after_most_recent_bid');
  const ends = hist('end_price_after_most_recent_bid');
  const rems = hist('base_amount_remaining');
  const remaining = rems.length ? rems[rems.length - 1].data : Number(s?.initial_base_amount ?? 0);
  const priceAt = (i: number, h: number): number => {
    const last = blocks[i].data;
    const P = prices[i]?.data ?? Number(s?.initial_price ?? 0);
    const E = ends[i]?.data ?? Number(s?.initial_end_price ?? 0);
    const span = end - last;
    return span <= 0 ? P : P - Math.floor((P - E) * Math.max(0, h - last) / span);
  };
  const curve: [number, number][] = [];
  if (!blocks.length) {
    curve.push([start, Number(s?.initial_price ?? 0)], [end, Number(s?.initial_end_price ?? 0)]);
  }
  for (let i = 0; i < blocks.length; i++) {
    const from = blocks[i].data;
    const to = i + 1 < blocks.length ? blocks[i + 1].data : end;
    curve.push([from, priceAt(i, from)], [to, priceAt(i, to)]);
  }
  let status: 'upcoming' | 'live' | 'ended' = 'live';
  let current: number | null = null;
  if (at < start) {
    status = 'upcoming';
    current = Number(s?.initial_price ?? 0);
  } else if (at > end || remaining === 0) {
    status = 'ended';
  } else if (blocks.length) {
    current = priceAt(blocks.length - 1, at);
  }
  return { start, end, status, current, remaining, curve };
}
