import { Application, Request, Response } from 'express';
import config from '../../config';
import logger from '../../logger';
import { handleError } from '../../utils/api';
import enforcer from '../enforcer';
import { MODULE, PROFILE, SIDECHAIN_PROFILES } from '../profile';
import { NETWORK, NETWORKS } from '../networks';
import index from './index';
import rpc from './rpc';
import mainchain from './mainchain';
import { isAddress } from './codec';
import { BlockSummary, L2Chain, L2FeatureContext } from './types';

// Read-only JSON of a sidechain explorer (kind l2), chains/L2-API.md. Rate limiting is nginx's.
//
//   GET chain                          this explorer's profile (kind l2, slot, features, links)
//   GET l2/summary                     tip, index progress, totals, wealth, escrow, pending bundle, mempool
//   GET l2/blocks?before=&limit=       block summaries, newest first (limit <= 50)
//   GET l2/block/:hashOrHeight         a block: summary, coinbase, txs, deposits, bundle spends
//   GET l2/tx/:txid                    a tx of the index, or of the node's mempool
//   GET l2/address/:address?before=&limit=
//   GET l2/deposits?before=&limit=     GET l2/withdrawals?before=&limit=
//   GET l2/search/:query               a height, block hash, txid or address
//   GET l2/feature/<name>[/...]        the module's node features (names, assets, markets, shielded, swaps)
//   GET l2/bmm/cockpit?window=         the eCash explorer's drivechain cockpit for this slot (CHAIN.MAINCHAIN_API)
//   GET l2/bmm/events/:kind?before=&limit=   its drivechain events of this slot
// With CHAIN.MAINCHAIN_API, block summaries and blocks carry `bmm` (mainchain.ts) and the summary a BMM coverage.
//
// `before` is exclusive; see index.ts for the paging of lists with several rows per height.

const BUILDING = 'The index is still being built';
const HASH = /^[0-9a-f]{64}$/;

// Bounded: keys can come from request paths (ids), so the oldest entries go once there are CACHE_MAX of them
const CACHE_MAX = 1000;
const cache = new Map<string, { at: number; value: any }>();
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const c = cache.get(key);
  if (c && Date.now() - c.at < ttlMs) {
    return c.value;
  }
  const value = await fn();
  cache.delete(key);
  cache.set(key, { at: Date.now(), value });
  while (cache.size > CACHE_MAX) {
    cache.delete(cache.keys().next().value as string);
  }
  return value;
}

function intParam(v: any, def: number | null, min: number, max: number): number | null {
  if (v === undefined || v === '') {
    return def;
  }
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def;
}

function wrap(fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (e) {
      // the node's error text stays in the log: it can name hosts, ports and internals
      logger.warn(`L2 API ${req.path}: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`);
      handleError(req, res, 500, 'The sidechain node did not answer');
    }
  };
}

/** Not found: 404 once the index has caught up, 503 while it is still being built */
function missing(req: Request, res: Response, what: string): void {
  if (index.isReady()) {
    handleError(req, res, 404, what);
  } else {
    res.status(503).json({ error: BUILDING });
  }
}

const explorerUrl = (id: string): string | null => config.CHAIN.EXPLORER_URLS?.[id] || null;

/** eCash blocks over which the summary's BMM coverage is counted */
const COVERAGE_WINDOW = 144;
const BMM_EVENT_KINDS = ['bmm', 'bmm-requests', 'deposits', 'withdrawals', 'votes', 'proposals', 'bundles'];

/** A route of the eCash explorer's API: its errors stay in the log, the client gets a fixed text */
function wrapMain(fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    if (!mainchain.enabled()) {
      return handleError(req, res, 404, 'This explorer has no eCash drivechain index to read');
    }
    try {
      await fn(req, res);
    } catch (e) {
      logger.warn(`L2 API ${req.path}: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`);
      handleError(req, res, 502, 'The eCash explorer did not answer');
    }
  };
}

class L2Routes {
  private chain = MODULE.l2 as L2Chain;

  public initRoutes(app: Application): void {
    const prefix = config.MEMPOOL.API_URL_PREFIX;
    const l2 = prefix + 'l2/';
    app
      .get(prefix + 'chain', wrap(this.$getChain))
      .get(l2 + 'summary', wrap(this.$getSummary))
      .get(l2 + 'blocks', wrap(this.$getBlocks))
      .get(l2 + 'block/:id', wrap(this.$getBlock))
      .get(l2 + 'tx/:txid', wrap(this.$getTx))
      .get(l2 + 'address/:address', wrap(this.$getAddress))
      .get(l2 + 'deposits', wrap(this.$getDeposits))
      .get(l2 + 'withdrawals', wrap(this.$getWithdrawals))
      .get(l2 + 'search/:query', wrap(this.$search))
      .get(l2 + 'bmm/cockpit', wrapMain(this.$getBmmCockpit))
      .get(l2 + 'bmm/events/:kind', wrapMain(this.$getBmmEvents));
    this.initFeatures(app, l2 + 'feature/');
    index.start();
    if (typeof PROFILE.slot === 'number') {
      mainchain.start(PROFILE.slot);
    }
  }

  private initFeatures(app: Application, prefix: string): void {
    const ctx: L2FeatureContext = {
      rpc,
      cached: (key, ttl, fn) => cached('feature:' + key, ttl, fn),
      handler: wrap,
      fail: (req, res, status, message) => handleError(req, res, status, message),
      index,
      list: (path, method, map) => {
        app.get(prefix + path, wrap(async (req, res) => {
          const items = await cached('feature:' + path, 5000, () => rpc.call<any[]>(method));
          res.json({ items: map ? map(items ?? []) : (items ?? []) });
        }));
      },
      item: (path, method, id, param, map) => {
        app.get(prefix + path + '/:id', wrap(async (req, res) => {
          const v = String(req.params.id);
          if (!id.test(v)) {
            return handleError(req, res, 400, 'Invalid id');
          }
          // an id the node does not know is not cached (ids come from the request)
          const key = `feature:${path}:${v}`;
          const r = await cached(key, 5000, () => rpc.call(method, param ? param(v) : v).catch(() => null));
          if (r === null) {
            cache.delete(key);
          }
          if (r === null || r === undefined) {
            return handleError(req, res, 404, 'Unknown id');
          }
          res.json(map ? map(r) : r);
        }));
      },
    };
    this.chain.featureRoutes?.(app, prefix, ctx);
  }

  private $getChain = async (req: Request, res: Response): Promise<void> => {
    const siblings = SIDECHAIN_PROFILES.filter(p => p.id !== PROFILE.id);
    res.json({
      id: PROFILE.id,
      kind: PROFILE.kind,
      name: PROFILE.name,
      unit: PROFILE.unit,
      slot: PROFILE.slot,
      mainchain: PROFILE.mainchain,
      network: NETWORK.id,
      networkName: NETWORK.name,
      networks: Object.values(NETWORKS).map(n => ({ id: n.id, name: n.name, explorer: explorerUrl(n.id) })),
      // the eCash explorer (under 'ecash' and this network's id) and the other sidechains' explorers
      explorers: {
        ecash: explorerUrl('ecash') || config.CHAIN.MAINCHAIN_EXPLORER || null,
        [NETWORK.id]: explorerUrl(NETWORK.id) || config.CHAIN.MAINCHAIN_EXPLORER || null,
        ...Object.fromEntries(siblings.map(p => [p.id, explorerUrl(p.id)])),
      },
      sidechains: SIDECHAIN_PROFILES.map(p => ({ id: p.id, name: p.name, slot: p.slot })),
      module: { describeTx: false, describeBlock: false },
      activationHeight: null,
      indexReady: index.isReady(),
      features: this.chain.features,
      mainchainExplorer: config.CHAIN.MAINCHAIN_EXPLORER || null,
      // the BMM views (GET l2/bmm/*, `bmm` of blocks): this backend reads the eCash explorer's drivechain index
      bmm: mainchain.enabled(),
    });
  };

  private $getSummary = async (req: Request, res: Response): Promise<void> => {
    const live = await cached('summary', 5000, async () => {
      const [wealth, escrow, pendingBundle, mempool] = await Promise.all([
        rpc.call<number>('sidechain_wealth').catch(() => null),
        enforcer.getCtip(PROFILE.slot as number).catch(() => null),
        index.pendingBundle(),
        this.chain.mempool ? rpc.call<any[]>('list_mempool').then(m => ({ count: m.length })).catch(() => null) : Promise.resolve(null),
      ]);
      return { wealth, escrow, pendingBundle, mempool };
    });
    const bmm = await this.bmmCoverage();
    const tip = index.tipHeight();
    const top = tip >= 0 ? index.blockSummaries(tip + 1, 1)[0] : null;
    const c = index.counts();
    const p = live.pendingBundle;
    res.json({
      tip: top ? { height: top.height, hash: top.hash, time: top.time } : null,
      indexed: tip,
      ready: index.isReady() && tip >= index.nodeTipHeight(),
      blocks: c.blocks, txs: c.txs, addresses: c.addresses,
      wealth: live.wealth,
      escrow: live.escrow ? { amount: live.escrow.amount, txid: live.escrow.txid, sequence: live.escrow.sequence } : null,
      deposits: c.deposits, withdrawals: c.withdrawals,
      pendingBundle: p ? { m6id: p.m6id, payouts: p.payouts, total: p.total } : null,
      mempool: live.mempool,
      bmm,
    });
  };

  /** The share of the newest COVERAGE_WINDOW eCash blocks that carried a block of this sidechain (the L1 cockpit's) */
  private async bmmCoverage(): Promise<any> {
    if (!mainchain.enabled()) {
      return null;
    }
    try {
      const c = await this.l1Cockpit(COVERAGE_WINDOW);
      const s = (c?.slots ?? []).find((x: any) => x.slot === PROFILE.slot);
      return {
        window: c.totals.blocks, mainHeight: c.totals.to, accepts: s?.accepts ?? 0, coverage: s?.coverage ?? 0,
        lastMainHeight: s?.lastAcceptHeight ?? null, bidMedian: s?.bidMedian ?? 0,
      };
    } catch (e) {
      logger.debug(`L2 BMM coverage: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`);
      return null;
    }
  }

  private l1Cockpit(window: number): Promise<any> {
    return mainchain.get('drivechain/cockpit', { window, slot: PROFILE.slot as number }, 15000);
  }

  /** a block summary with its BMM (null: none known, or no eCash index to read) */
  private withBmm<T extends { hash: string }>(b: T): T & { bmm: any } {
    return { ...b, bmm: mainchain.enabled() ? mainchain.blockBmm(b.hash) : null };
  }

  private $getBmmCockpit = async (req: Request, res: Response): Promise<void> => {
    const window = intParam(req.query.window, 1440, 0, 1e7) as number;
    res.json(await this.l1Cockpit(window));
  };

  private $getBmmEvents = async (req: Request, res: Response): Promise<void> => {
    const kind = String(req.params.kind);
    if (!BMM_EVENT_KINDS.includes(kind)) {
      return handleError(req, res, 400, 'Unknown event kind');
    }
    const before = intParam(req.query.before, null, 0, 1e9);
    const limit = intParam(req.query.limit, 50, 1, 500) as number;
    res.json(await mainchain.get('drivechain/events/' + kind, { slot: PROFILE.slot as number, before, limit }, 10000));
  };

  private $getBlocks = async (req: Request, res: Response): Promise<void> => {
    const before = intParam(req.query.before, null, 0, 1e9);
    const limit = intParam(req.query.limit, 15, 1, 50) as number;
    res.json(index.blockSummaries(before, limit).map((b: BlockSummary) => this.withBmm(b)));
  };

  private $getBlock = async (req: Request, res: Response): Promise<void> => {
    const id = String(req.params.id);
    if (!/^(\d{1,10}|[0-9a-f]{64})$/.test(id)) {
      return handleError(req, res, 400, 'Invalid block hash or height');
    }
    const h = index.heightOf(id);
    if (h === null) {
      return missing(req, res, 'Unknown block');
    }
    const block = this.withBmm(index.block(h));
    if (block.bmm) {
      // the M8 requests for this slot in the carrying eCash block: the accepted one and those it beat
      block.bmm = { ...block.bmm, requestList: mainchain.requestsIn(block.bmm.mainHeight) };
    }
    res.json(block);
  };

  private $getTx = async (req: Request, res: Response): Promise<void> => {
    const txid = String(req.params.txid);
    if (!HASH.test(txid)) {
      return handleError(req, res, 400, 'Invalid txid');
    }
    const tx = index.tx(txid);
    if (tx) {
      res.json(tx);
      return;
    }
    if (this.chain.mempool) {
      const pool = await cached('mempool', 3000, () => rpc.call<any[]>('list_mempool').catch(() => []));
      const entry = (pool ?? []).find(e => e.txid === txid);
      if (entry) {
        res.json(index.mempoolTx(entry));
        return;
      }
    }
    missing(req, res, 'Unknown transaction');
  };

  private $getAddress = async (req: Request, res: Response): Promise<void> => {
    const a = String(req.params.address);
    if (!isAddress(a)) {
      return handleError(req, res, 400, 'Invalid address');
    }
    const before = intParam(req.query.before, null, 0, 1e9);
    const limit = intParam(req.query.limit, 25, 1, 100) as number;
    const r = index.address(a, before, limit);
    if (!r) {
      return missing(req, res, 'Unknown address');
    }
    res.json(r);
  };

  private $getDeposits = async (req: Request, res: Response): Promise<void> => {
    const before = intParam(req.query.before, null, 0, 1e9);
    const limit = intParam(req.query.limit, 25, 1, 100) as number;
    res.json(index.deposits(before, limit));
  };

  private $getWithdrawals = async (req: Request, res: Response): Promise<void> => {
    const before = intParam(req.query.before, null, 0, 1e9);
    const limit = intParam(req.query.limit, 25, 1, 100) as number;
    const pending = await cached('pendingBundle', 5000, () => index.pendingBundle());
    res.json(index.withdrawals(before, limit, pending));
  };

  private $search = async (req: Request, res: Response): Promise<void> => {
    const q = String(req.params.query).trim();
    if (/^\d{1,10}$/.test(q)) {
      return void res.json(index.heightOf(q) !== null ? { type: 'block', id: q } : { type: null, id: q });
    }
    const h = q.toLowerCase();
    if (HASH.test(h)) {
      if (index.heightOf(h) !== null) {
        return void res.json({ type: 'block', id: h });
      }
      if (index.hasTx(h)) {
        return void res.json({ type: 'tx', id: h });
      }
      return void res.json({ type: null, id: q });
    }
    res.json(isAddress(q) ? { type: 'address', id: q } : { type: null, id: q });
  };
}

export default new L2Routes();
