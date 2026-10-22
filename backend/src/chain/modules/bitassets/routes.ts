import { Application } from 'express';
import { L2FeatureContext } from '../../l2/types';
import { HASH, IndexView, candidateName, derived, notFound, txsOf, utxosOf } from '../l2-views';
import { AssetStats, AuctionStats, BitAssetsView, PoolStats, SATS, auctionCurve, buildView, poolId } from './views';

/**
 * BitAssets' feature routes (chains/L2-API.md "assets"): the node's lists (bitassets, dutch_auctions,
 * get_amm_pool_state) joined with what the index says of each asset, pool and auction.
 *
 *   GET feature/assets            every asset: name (when known), supply, holders, registration, last activity, price
 *   GET feature/assets/:id        one asset (its hash, or its AssetId 01‖hash / 02‖hash): holders, mints, activity, price history
 *   GET feature/pools             the AMM pools: the node's state, price, swaps and volume
 *   GET feature/pools/:id         one pool (<asset0>-<asset1>): its events with the reserves and price after each
 *   GET feature/auctions          the Dutch auctions: status, current price, bids
 *   GET feature/auctions/:id      one auction: its price curve, bids and collects
 */

const view = derived<BitAssetsView>(index => buildView(txsOf(index), utxosOf(index)));

const POOL_ID = /^(00|0[12][0-9a-f]{64})-(00|0[12][0-9a-f]{64})$/;

/** The asset's price in sats per unit, from its pool with sats (the last event), null without one */
function priceOf(v: BitAssetsView, id: string): number | null {
  const p = v.pools.get(poolId(SATS, '01' + id));
  const last = p?.events[p.events.length - 1];
  return last?.price ?? null;
}

function assetItem(v: BitAssetsView, id: string, seq: number | null, data: any): any {
  const a: AssetStats | undefined = v.assets.get(id);
  const pools = [...v.pools.values()].filter(p => p.asset0.endsWith(id) || p.asset1.endsWith(id)).map(p => p.id);
  return {
    id, assetId: '01' + id, seq, name: candidateName(id), data,
    supply: a?.supply ?? 0, holders: a?.holders.size ?? 0, controller: a?.controller ?? null,
    registered: a?.registration ? { height: a.registration.height, time: a.registration.time, txid: a.registration.txid } : null,
    initialSupply: a?.registration?.initialSupply ?? null,
    minted: (a?.mints ?? []).reduce((s, m) => s + m.amount, 0),
    txs: a?.activity.length ?? 0, last: a?.last ?? null, price: priceOf(v, id), pools,
  };
}

function poolItem(p: PoolStats, state: any): any {
  const last = p.events[p.events.length - 1];
  const r0 = state ? Number(state.reserve0) : last?.reserve0 ?? 0;
  const r1 = state ? Number(state.reserve1) : last?.reserve1 ?? 0;
  return {
    id: p.id, asset0: p.asset0, asset1: p.asset1, state,
    price: r0 > 0 && r1 > 0 ? r0 / r1 : null,
    created: p.created, swaps: p.swaps, volume0: p.volume0, volume1: p.volume1, events: p.events.length,
    last: last ? { height: last.height, time: last.time, txid: last.txid } : null,
    replayed: last ? { reserve0: last.reserve0, reserve1: last.reserve1, outstanding: last.outstanding } : null,
  };
}

function auctionItem(id: string, state: any, a: AuctionStats | undefined, at: number): any {
  const c = auctionCurve(state, at);
  return {
    id, state, status: c.status, currentPrice: c.current, remaining: c.remaining, startBlock: c.start, endBlock: c.end,
    baseAsset: state?.base_asset ?? a?.created?.params?.base_asset ?? null, quoteAsset: state?.quote_asset ?? a?.created?.params?.quote_asset ?? null,
    created: a?.created ? { height: a.created.height, time: a.created.time, txid: a.created.txid } : null,
    bids: a?.bids.length ?? 0, collects: a?.collects.length ?? 0,
  };
}

export function featureRoutes(app: Application, prefix: string, ctx: L2FeatureContext): void {
  const index = ctx.index as IndexView;
  const nodeAssets = () => ctx.cached('bitassets', 5000, () => ctx.rpc.call<any[]>('bitassets'));
  const nodeAuctions = () => ctx.cached('dutch_auctions', 5000, () => ctx.rpc.call<any[]>('dutch_auctions'));
  const poolStates = (v: BitAssetsView) => ctx.cached('pools', 5000, async () => {
    const ids = new Map<string, [string, string]>();
    for (const [a0, a1] of index.ammPools()) {
      ids.set(poolId(a0, a1), [a0, a1]);
    }
    for (const p of v.pools.values()) {
      ids.set(p.id, [p.asset0, p.asset1]);
    }
    const out = new Map<string, any>();
    for (const [id, [a0, a1]] of ids) {
      out.set(id, await ctx.rpc.call('get_amm_pool_state', a0, a1).catch(() => null));
    }
    return out;
  });

  app.get(prefix + 'assets', ctx.handler(async (req, res) => {
    const v = view(index);
    const list = await nodeAssets();
    res.json({
      items: (list ?? []).map(([seq, id, data]) => assetItem(v, String(id), Number(seq), data)),
      reservations: v.reservations,
    });
  }));

  app.get(prefix + 'assets/:id', ctx.handler(async (req, res) => {
    let id = String(req.params.id).toLowerCase();
    if (/^0[12][0-9a-f]{64}$/.test(id)) {
      id = id.slice(2);
    }
    if (!HASH.test(id)) {
      return ctx.fail(req, res, 400, 'Invalid asset id');
    }
    const v = view(index);
    const entry = (await nodeAssets() ?? []).find(x => x[1] === id);
    if (!entry && !v.assets.has(id)) {
      return notFound(index, res, () => ctx.fail(req, res, 404, 'Unknown asset'));
    }
    const a = v.assets.get(id);
    const total = a?.supply ?? 0;
    const holders = [...(a?.holders ?? new Map<string, number>()).entries()]
      .sort((x, y) => y[1] - x[1]).slice(0, 100)
      .map(([address, amount]) => ({ address, amount, share: total ? amount / total : null }));
    const pool = v.pools.get(poolId(SATS, '01' + id));
    res.json({
      ...assetItem(v, id, entry ? Number(entry[0]) : null, entry ? entry[2] : null),
      holderList: holders,
      mints: [...(a?.mints ?? [])].reverse(),
      activity: [...(a?.activity ?? [])].reverse().slice(0, 200),
      priceHistory: (pool?.events ?? []).filter(e => e.price !== null).map(e => ({ height: e.height, time: e.time, price: e.price })),
    });
  }));

  app.get(prefix + 'pools', ctx.handler(async (req, res) => {
    const v = view(index);
    const states = await poolStates(v);
    const items = [...states.keys()].map(id => poolItem(v.pools.get(id) ?? emptyPool(id), states.get(id)));
    res.json({ items });
  }));

  app.get(prefix + 'pools/:id', ctx.handler(async (req, res) => {
    const id = String(req.params.id).toLowerCase();
    const m = POOL_ID.exec(id);
    if (!m) {
      return ctx.fail(req, res, 400, 'Invalid pool id');
    }
    const v = view(index);
    const states = await poolStates(v);
    if (!states.has(id)) {
      return notFound(index, res, () => ctx.fail(req, res, 404, 'Unknown pool'));
    }
    const p = v.pools.get(id) ?? emptyPool(id);
    res.json({
      ...poolItem(p, states.get(id)),
      history: [...p.events].reverse().slice(0, 500),
      series: p.events.filter(e => e.price !== null).map(e => ({ height: e.height, time: e.time, price: e.price, reserve0: e.reserve0, reserve1: e.reserve1 })),
    });
  }));

  app.get(prefix + 'auctions', ctx.handler(async (req, res) => {
    const v = view(index);
    const list = await nodeAuctions();
    const at = index.tipHeight() + 1;
    const ids = new Set<string>([...(list ?? []).map(x => String(x[0])), ...v.auctions.keys()]);
    const states = new Map<string, any>((list ?? []).map(x => [String(x[0]), x[1]]));
    res.json({ items: [...ids].map(id => auctionItem(id, states.get(id) ?? null, v.auctions.get(id), at)), height: at - 1 });
  }));

  app.get(prefix + 'auctions/:id', ctx.handler(async (req, res) => {
    const id = String(req.params.id).toLowerCase();
    if (!HASH.test(id)) {
      return ctx.fail(req, res, 400, 'Invalid auction id');
    }
    const v = view(index);
    const state = (await nodeAuctions() ?? []).find(x => x[0] === id)?.[1] ?? null;
    const a = v.auctions.get(id);
    if (!state && !a) {
      return notFound(index, res, () => ctx.fail(req, res, 404, 'Unknown auction'));
    }
    const at = index.tipHeight() + 1;
    res.json({
      ...auctionItem(id, state, a, at), height: at - 1,
      params: a?.created?.params ?? null,
      curve: auctionCurve(state ?? paramsAsState(a?.created?.params), at).curve,
      bidList: [...(a?.bids ?? [])].reverse(),
      collectList: [...(a?.collects ?? [])].reverse(),
    });
  }));
}

function emptyPool(id: string): PoolStats {
  const [asset0, asset1] = id.split('-');
  return { id, asset0, asset1, created: null, events: [], swaps: 0, volume0: 0, volume1: 0 };
}

/** An auction the node no longer lists, from its DutchAuctionCreate params */
function paramsAsState(p: any): any {
  return p ? { start_block: p.start_block, duration: p.duration, initial_price: p.initial_price, initial_end_price: p.final_price, initial_base_amount: p.base_amount } : null;
}
