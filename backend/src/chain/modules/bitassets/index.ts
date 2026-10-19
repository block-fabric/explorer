import { Application } from 'express';
import { ChainModule, ChainModuleContext, sidechainProfile } from '../../module';
import { PROFILE } from '../../profile';
import { Reader, findMarkers, safeDecode } from '../../marker';
import { CHN as LEDGER_CHN, TOKEN_KINDS, auctionPriceAt, getLedger } from './ledger';

/**
 * BitAssets: assets issued and traded on the sidechain: Uniswap-v2-style exchange pools and Dutch auctions
 * (after LayerTwo Labs' BitAssets).
 *
 * Routes (/api/v1/sidechain/...):
 *   GET info                getbitassetsinfo
 *   GET assets              listassets
 *   GET asset/:id           getasset + getassethistory + the pools trading it; id = name, 0x<id> or #seq
 *   GET pools, pool/:id     listpools, getpool
 *   GET auctions, auction/:id  listauctions, getauction
 *   GET tx/:txid            the core's describeTx route: the asset operation of a transaction
 *
 * Marker: OP_RETURN "BAST" | version u8 (0) | kind u8 | op body | outputs (bitassets/src/bitassets/state.h).
 */

const TAG = '42415354';
const CHN = '0'.repeat(64);
const KINDS: Record<number, string> = {
  0: 'transfer', 1: 'reserve', 2: 'register', 3: 'mint', 4: 'update', 5: 'burn', 6: 'swap', 7: 'add-liquidity',
  8: 'remove-liquidity', 9: 'create-auction', 10: 'bid', 11: 'collect', 12: 'release',
};

export function decodeBitassetsMarker(payload: Buffer): any {
  const r = new Reader(payload);
  const version = r.u8();
  const k = r.u8();
  const op: any = { version, kind: KINDS[k] ?? `kind ${k}` };
  const script = () => r.varBytes().toString('hex');
  switch (k) {
    case 1: op.commitment = r.hex(32); break;
    case 2: op.asset = r.hash(); r.bytes(32); op.supply = r.varint(); op.decimals = r.u8(); break; // AssetData follows
    case 3: op.asset = r.hash(); op.amount = r.varint(); break;
    case 4: op.asset = r.hash(); break;
    case 5: op.tokens = r.vector(() => ({ kind: TOKEN_KINDS[r.u8()] ?? '?', id: r.hash(), amount: r.varint() })); break;
    case 6: op.assetIn = r.hash(); op.amountIn = r.varint(); op.assetOut = r.hash(); op.minOut = r.varint(); op.chnTo = script(); break;
    case 7: op.assetA = r.hash(); op.assetB = r.hash(); op.amountA = r.varint(); op.amountB = r.varint(); op.minShares = r.varint(); break;
    case 8: op.assetA = r.hash(); op.assetB = r.hash(); op.shares = r.varint(); op.minA = r.varint(); op.minB = r.varint(); op.chnTo = script(); break;
    case 9: op.base = r.hash(); op.baseAmount = r.varint(); op.quote = r.hash(); op.startPrice = r.varint(); op.endPrice = r.varint(); op.startHeight = r.i32(); op.duration = r.i32(); break;
    case 10: op.auction = r.hash(); op.quoteAmount = r.varint(); op.minBase = r.varint(); op.chnTo = script(); break;
    case 11: op.auction = r.hash(); op.chnTo = script(); break;
    case 12: op.asset = r.hash(); break;
  }
  return op;
}

/** BitAssets' routes, reused by Layers (BitAssets over FastBlocks) */
export function bitassetsRoutes(app: Application, prefix: string, ctx: ChainModuleContext): void {
  const simple = (path: string, rpc: string) => app.get(prefix + path, ctx.handler(async (req, res) => {
    res.json(await ctx.cached(path, 5000, () => ctx.node.call(rpc)));
  }));
  simple('info', 'getbitassetsinfo');
  simple('assets', 'listassets');
  simple('pools', 'listpools');
  // every auction, the collected ones too (newest first)
  app.get(prefix + 'auctions', ctx.handler(async (req, res) => {
    res.json(await ctx.cached('auctions-all', 5000, () => ctx.node.call('listauctions', true, 1000, 0)));
  }));

  app.get(prefix + 'asset/:id', ctx.handler(async (req, res) => {
    const raw = String(req.params.id).slice(0, 100);
    const id = /^[0-9a-f]{64}$/.test(raw) ? '0x' + raw : raw; // the node takes a hash as 0x<hash>
    let asset;
    try {
      asset = await ctx.node.call('getasset', id);
    } catch (e) {
      return ctx.fail(req, res, 404, 'Unknown asset');
    }
    const [history, pools, auctions] = await Promise.all([
      ctx.node.call('getassethistory', '0x' + asset.asset).catch(() => null),
      ctx.cached('pools', 5000, () => ctx.node.call('listpools')).catch(() => []),
      ctx.cached('auctions', 5000, () => ctx.node.call('listauctions')).catch(() => []),
    ]);
    res.json({
      asset, history,
      pools: (pools as any[]).filter(p => p.asset_a_id === asset.asset || p.asset_b_id === asset.asset),
      auctions: (auctions as any[]).filter(a => a.base_id === asset.asset || a.quote_id === asset.asset),
    });
  }));
  app.get(prefix + 'pool/:id', ctx.handler(async (req, res) => {
    const pools: any[] = await ctx.cached('pools', 5000, () => ctx.node.call('listpools'));
    const p = pools.find(x => x.pool === String(req.params.id));
    return p ? res.json(p) : ctx.fail(req, res, 404, 'Unknown pool');
  }));
  for (const [path, rpc] of [['auction', 'getauction']]) {
    app.get(prefix + path + '/:id', ctx.handler(async (req, res) => {
      const id = String(req.params.id);
      if (!/^[0-9a-f]{64}$/.test(id)) {
        return ctx.fail(req, res, 400, 'Invalid id');
      }
      try {
        res.json(await ctx.node.call(rpc, id));
      } catch (e) {
        ctx.fail(req, res, 404, `Unknown ${path}`);
      }
    }));
  }
}

/** What a transaction does to BitAssets' assets, pools and auctions (null if nothing), reused by Layers */
export async function bitassetsDescribeTx(tx: any, ctx: ChainModuleContext): Promise<any | null> {
  const m = findMarkers(tx, TAG)[0];
  if (!m) {
    return null;
  }
  const op: any = safeDecode(() => decodeBitassetsMarker(m.payload));
  op.vout = m.vout;
  // names for the asset ids the operation mentions
  const ids = new Set<string>();
  for (const key of ['asset', 'assetIn', 'assetOut', 'assetA', 'assetB', 'base', 'quote']) {
    if (op[key] && op[key] !== CHN) { ids.add(op[key]); }
  }
  for (const t of op.tokens ?? []) {
    if (t.kind === 'asset' || t.kind === 'control') { ids.add(t.id); }
  }
  const assets: Record<string, any> = { [CHN]: { name: 'CHN', decimals: 8 } };
  await Promise.all([...ids].map(async (id) => {
    const a = await ctx.node.call('getasset', '0x' + id).catch(() => null);
    if (a) { assets[id] = { name: a.label || a.name, decimals: a.decimals }; }
  }));
  if (op.auction) {
    op.auctionInfo = await ctx.node.call('getauction', op.auction).catch(() => null);
  }
  const L = getLedger();
  const results = L.isReady() ? L.query(e => e.tx === tx.txid, 10).map(e => ({ kind: e.kind, amounts: e.amounts, ids: e.ids, note: e.note })) : [];
  const outputs = L.isReady() ? Object.fromEntries(Object.entries(L.txTokens(tx.txid)).map(([n, [k, id, amt]]) => [n, { kind: TOKEN_KINDS[k], id, amount: amt.toString() }])) : {};
  return { chain: PROFILE.id, ops: [op], assets, results, outputs };
}

/** amount in the asset's units as a decimal string */
function fmt(rawAmount: bigint | string, decimals: number): string {
  const v = BigInt(rawAmount);
  const neg = v < 0n;
  const a = neg ? -v : v;
  if (!decimals) { return (neg ? '-' : '') + a.toString(); }
  const p = 10n ** BigInt(decimals);
  const frac = (a % p).toString().padStart(decimals, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + (a / p).toString() + (frac ? '.' + frac : '');
}

/**
 * The token ledger's routes (ledger.ts): holders, balances, pool history, real amounts of every operation.
 *   GET ledger                 status: height, ready, the self-check against the node
 *   GET asset/:id/holders      holders of an asset, largest first, and where the rest of the supply is
 *   GET asset/:id/activity     its operations, newest first (?limit=&before=)
 *   GET pool/:id/history       reserves and price per block that changed them; LP holders; activity
 *   GET auction/:id/bids       its bids and the price curve
 *   GET tokens/:address        every token an address holds
 *   GET activity               every operation, newest first (?kind=&limit=&before=)
 *   GET markets                per asset: CHN price, liquidity, holders, 24 h volume
 */
export function ledgerRoutes(app: Application, prefix: string, ctx: ChainModuleContext): void {
  const L = getLedger();
  const notReady = (req: any, res: any) => ctx.fail(req, res, 503, 'The token ledger is still being built');
  const decimalsOf = async () => {
    const meta = await L.assetMeta();
    return (id: string) => (id === LEDGER_CHN ? 8 : meta.get(id)?.decimals ?? 0);
  };
  const labelOf = async () => {
    const meta = await L.assetMeta();
    return (id: string) => (id === LEDGER_CHN ? 'CHN' : meta.get(id)?.label ?? id.slice(0, 8));
  };
  const resolveAsset = async (id: string): Promise<string | null> => {
    if (/^[0-9a-f]{64}$/.test(id)) { return id; }
    if (id.toUpperCase() === 'CHN') { return LEDGER_CHN; }
    const a = await ctx.node.call('getasset', id).catch(() => null);
    return a?.asset ?? null; // a name or #number; a hash is returned as is above
  };
  const assetOfAmount = (e: any, k: string): string | undefined => {
    const role = k.replace(/[0-9]+$/, '');
    if (e.ids[k] || e.ids[role]) { return e.ids[k] ?? e.ids[role]; }
    if (k === 'paid' || k === 'proceeds' || k === 'price') { return e.ids.quote; }
    if (k === 'bought' || k === 'remaining') { return e.ids.base; }
    if (k === 'back') { return e.note?.startsWith('back:') ? e.note.slice(5) : e.ids.quote; }
    if (k === 'refunded') { return e.ids.in; }
    if (k === 'minOut') { return e.ids.out; }
    if (k === 'supply' || k === 'amount' || k === 'startPrice' || k === 'endPrice') { return k.endsWith('Price') ? e.ids.quote : (e.ids.asset ?? e.ids.base); }
    return undefined;
  };
  const event = async (e: any) => {
    const d = await decimalsOf(), lab = await labelOf();
    const amounts: Record<string, string> = {};
    for (const [k, v] of Object.entries(e.amounts as Record<string, string>)) {
      const asset = k === 'shares' ? undefined : assetOfAmount(e, k);
      amounts[k] = asset ? fmt(v, d(asset)) : v;
    }
    return { ...e, amounts, labels: Object.fromEntries(Object.entries(e.ids).map(([k, id]) => [k, lab(id as string)])) };
  };

  app.get(prefix + 'ledger', ctx.handler(async (req, res) => {
    res.json({ ready: L.isReady(), height: L.height, tokens: L.tokens.size, pools: L.pools.size, auctions: L.auctions.size, events: L.events.length, dexHeight: L.dexHeight === Infinity ? null : L.dexHeight, verify: L.verify });
  }));

  app.get(prefix + 'asset/:id/holders', ctx.handler(async (req, res) => {
    if (!L.isReady()) { return notReady(req, res); }
    const id = await resolveAsset(String(req.params.id));
    if (!id) { return ctx.fail(req, res, 404, 'Unknown asset'); }
    const d = (await decimalsOf())(id);
    const holders = L.holders(0, id);
    const total = holders.reduce((a, h) => a + h.amount, 0n);
    let inPools = 0n, inAuctions = 0n, inContracts = 0n;
    for (const p of L.pools.values()) { if (p.a0 === id) { inPools += p.r0; } if (p.a1 === id) { inPools += p.r1; } }
    for (const a of L.auctions.values()) { if (!a.closed) { if (a.base === id) { inAuctions += a.rem; } if (a.quote === id) { inAuctions += a.proc; } } }
    for (const c of L.contracts.values()) { if (c.asset === id) { inContracts += c.amount; } }
    res.json({
      asset: id, holders: holders.length, held: fmt(total, d), inPools: fmt(inPools, d), inAuctions: fmt(inAuctions, d), inContracts: fmt(inContracts, d),
      controller: L.holders(1, id)[0]?.address ?? null,
      top: holders.slice(0, 200).map(h => ({ address: h.address, amount: fmt(h.amount, d), share: total > 0n ? Number(h.amount * 1000000n / total) / 1e6 : 0, outputs: h.outputs })),
    });
  }));

  app.get(prefix + 'asset/:id/activity', ctx.handler(async (req, res) => {
    if (!L.isReady()) { return notReady(req, res); }
    const id = await resolveAsset(String(req.params.id));
    if (!id) { return ctx.fail(req, res, 404, 'Unknown asset'); }
    const limit = ctx.intParam(req.query.limit, 50, 1, 500) as number;
    const before = ctx.intParam(req.query.before, null, 0, 1e9);
    res.json(await Promise.all(L.query(e => e.assets.includes(id), limit, before ?? undefined).map(event)));
  }));

  app.get(prefix + 'pool/:id/history', ctx.handler(async (req, res) => {
    if (!L.isReady()) { return notReady(req, res); }
    const p = L.pools.get(String(req.params.id));
    if (!p) { return ctx.fail(req, res, 404, 'Unknown pool'); }
    const d = await decimalsOf(), lab = await labelOf();
    const d0 = d(p.a0), d1 = d(p.a1);
    const flip = p.a0 === LEDGER_CHN; // the node shows the non-CHN asset first
    const points = (L.series.get(p.id) ?? []).map(([h, t, r0, r1, sh]) => {
      const x0 = Number(r0) / 10 ** d0, x1 = Number(r1) / 10 ** d1;
      const a = flip ? x1 : x0, b = flip ? x0 : x1;
      return { h, t, a, b, shares: sh.toString(), price: a ? b / a : null };
    });
    const lp = L.holders(3, p.id);
    res.json({
      pool: p.id, assetA: flip ? p.a1 : p.a0, assetB: flip ? p.a0 : p.a1, labelA: lab(flip ? p.a1 : p.a0), labelB: lab(flip ? p.a0 : p.a1),
      created: p.created, creation: p.ct,
      feesA: fmt((flip ? p.v1 : p.v0) * 3n / 1000n, flip ? d1 : d0), feesB: fmt((flip ? p.v0 : p.v1) * 3n / 1000n, flip ? d0 : d1),
      points,
      providers: lp.slice(0, 100).map(h => ({ address: h.address, shares: h.amount.toString(), share: p.sh > 0n ? Number(h.amount * 1000000n / p.sh) / 1e6 : 0 })),
      activity: await Promise.all(L.query(e => e.pool === p.id, 100).map(event)),
    });
  }));

  app.get(prefix + 'auction/:id/bids', ctx.handler(async (req, res) => {
    if (!L.isReady()) { return notReady(req, res); }
    const a = L.auctions.get(String(req.params.id));
    if (!a) { return ctx.fail(req, res, 404, 'Unknown auction'); }
    const d = await decimalsOf();
    const end = a.start + a.dur - 1;
    const steps = Math.min(60, Math.max(2, a.dur));
    const curve = Array.from({ length: steps }, (_, i) => {
      const h = a.start + Math.round(i * (end - a.start) / (steps - 1));
      return { h, price: Number(fmt(auctionPriceAt(a, h), d(a.quote))) };
    });
    res.json({ auction: a.id, start: a.start, end, curve, bids: await Promise.all(L.query(e => e.auction === a.id, 500).map(event)) });
  }));

  app.get(prefix + 'tokens/:address', ctx.handler(async (req, res) => {
    if (!L.isReady()) { return notReady(req, res); }
    const d = await decimalsOf(), lab = await labelOf();
    res.json(L.balances(String(req.params.address)).map(b => {
      const pool = b.k === 3 ? L.pools.get(b.id) : undefined;
      const pair = pool ? (pool.a0 === LEDGER_CHN ? `${lab(pool.a1)}/${lab(pool.a0)}` : `${lab(pool.a0)}/${lab(pool.a1)}`) : '';
      return {
        kind: TOKEN_KINDS[b.k], id: b.id, outputs: b.outputs,
        label: b.k === 3 ? `${pair} LP` : b.k === 2 ? 'Reservation' : b.k === 4 ? 'Auction receipt' : b.k === 1 ? `${lab(b.id)} control` : lab(b.id),
        amount: b.k === 0 ? fmt(b.amount, d(b.id)) : b.amount.toString(),
        poolShare: pool && pool.sh > 0n ? Number(b.amount * 1000000n / pool.sh) / 1e6 : undefined,
      };
    }));
  }));

  /**
   * GET tx-tokens?txids=a,b,...   per transaction (at most 50), the tokens on its inputs and outputs:
   *   { txid: { vin: { index: token }, vout: { index: token } } }, token = { kind, id, label, amount (in the asset's units) }
   * The transaction pages show them next to the CHN amounts (token outputs carry 0 CHN).
   */
  app.get(prefix + 'tx-tokens', ctx.handler(async (req, res) => {
    if (!L.isReady()) { return notReady(req, res); }
    const d = await decimalsOf(), lab = await labelOf();
    const show = ([k, id, amt]: [number, string, bigint]) => {
      const pool = k === 3 ? L.pools.get(id) : undefined;
      const label = k === 0 ? lab(id) : k === 1 ? `${lab(id)} control` : k === 2 ? 'reservation' : k === 4 ? 'auction receipt'
        : pool ? `${lab(pool.a0 === LEDGER_CHN ? pool.a1 : pool.a0)}/${lab(pool.a0 === LEDGER_CHN ? pool.a0 : pool.a1)} LP` : 'LP';
      return { kind: TOKEN_KINDS[k], id, label, amount: k === 0 ? fmt(amt, d(id)) : amt.toString() };
    };
    const txids = String(req.query.txids ?? '').split(',').filter(t => /^[0-9a-f]{64}$/.test(t)).slice(0, 50);
    const out: Record<string, any> = {};
    await Promise.all(txids.map(async (txid) => {
      const vout: Record<number, any> = {};
      for (const [n, t] of Object.entries(L.txTokens(txid))) { vout[Number(n)] = show(t); }
      const vin: Record<number, any> = {};
      const tx: any = await ctx.cached('txin:' + txid, 300000, () => ctx.node.getRawTransaction(txid, true)).catch(() => null);
      (tx?.vin ?? []).forEach((v: any, i: number) => {
        const t = v.txid ? L.txTokens(v.txid)[v.vout] : undefined;
        if (t) { vin[i] = show(t); }
      });
      if (Object.keys(vin).length || Object.keys(vout).length) { out[txid] = { vin, vout }; }
    }));
    res.json(out);
  }));

  /** GET tx-ops/:txid   what a transaction did to tokens, pools and auctions, with its real amounts */
  app.get(prefix + 'tx-ops/:txid', ctx.handler(async (req, res) => {
    if (!L.isReady()) { return notReady(req, res); }
    const txid = String(req.params.txid);
    res.json(await Promise.all(L.query(e => e.tx === txid, 20).reverse().map(event)));
  }));

  app.get(prefix + 'activity', ctx.handler(async (req, res) => {
    if (!L.isReady()) { return notReady(req, res); }
    const kind = typeof req.query.kind === 'string' ? req.query.kind : null;
    const limit = ctx.intParam(req.query.limit, 50, 1, 500) as number;
    const before = ctx.intParam(req.query.before, null, 0, 1e9);
    res.json(await Promise.all(L.query(e => !kind || e.kind === kind, limit, before ?? undefined).map(event)));
  }));

  app.get(prefix + 'markets', ctx.handler(async (req, res) => {
    if (!L.isReady()) { return notReady(req, res); }
    res.json(await ctx.cached('markets:' + L.height, 10000, async () => {
      const meta = await L.assetMeta();
      const d = (id: string) => (id === LEDGER_CHN ? 8 : meta.get(id)?.decimals ?? 0);
      const dayAgo = Math.floor(Date.now() / 1000) - 86400;
      const out: Record<string, any> = {};
      for (const [id, a] of meta) {
        if (id === LEDGER_CHN) { continue; }
        const chnPool = [...L.pools.values()].find(p => (p.a0 === id && p.a1 === LEDGER_CHN) || (p.a1 === id && p.a0 === LEDGER_CHN));
        let price: number | null = null, liquidity = 0;
        if (chnPool && chnPool.sh > 1000n) {
          const [ra, rc] = chnPool.a0 === id ? [chnPool.r0, chnPool.r1] : [chnPool.r1, chnPool.r0];
          const xa = Number(ra) / 10 ** d(id), xc = Number(rc) / 1e8;
          price = xa ? xc / xa : null;
          liquidity = 2 * xc;
        }
        let volume = 0n, trades = 0;
        for (let i = L.events.length - 1; i >= 0 && L.events[i].t >= dayAgo; i--) {
          const e = L.events[i];
          if ((e.kind === 'swap' || e.kind === 'route') && e.amounts.out) {
            if (e.ids.in === id) { volume += BigInt(e.amounts.in); trades++; } else if (e.ids.out === id) { volume += BigInt(e.amounts.out); trades++; }
          }
        }
        out[id] = {
          price, liquidity, holders: L.holders(0, id).length, pools: [...L.pools.values()].filter(p => p.a0 === id || p.a1 === id).length,
          volume24h: fmt(volume, d(id)), trades24h: trades, marketCap: price !== null ? price * Number(a.supply) : null,
        };
      }
      return out;
    }));
  }));
}

const bitassets: ChainModule = {
  profile: sidechainProfile('bitassets', 'BitAssets', 4, 'ba'),
  initRoutes(app, prefix, ctx) {
    bitassetsRoutes(app, prefix, ctx);
    ledgerRoutes(app, prefix, ctx);
  },
  start: (ctx) => getLedger().start(ctx),
  onNewBlock: () => getLedger().onNewBlock(),
  describeTx: bitassetsDescribeTx,
};

export default bitassets;
