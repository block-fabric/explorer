import { Application, Request, Response } from 'express';
import config from '../../config';
import logger from '../../logger';
import { handleError } from '../../utils/api';
import enforcer from '../enforcer';
import { MODULE, PROFILE, SIDECHAIN_PROFILES } from '../profile';
import { NETWORK, NETWORKS } from '../networks';
import index from './index';
import rpc from './rpc';
import { isAddress } from './codec';
import { L2Chain, L2FeatureContext } from './types';

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
//
// `before` is exclusive; see index.ts for the paging of lists with several rows per height.

const BUILDING = 'The index is still being built';
const HASH = /^[0-9a-f]{64}$/;

const cache = new Map<string, { at: number; value: any }>();
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const c = cache.get(key);
  if (c && Date.now() - c.at < ttlMs) {
    return c.value;
  }
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
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
      const message = (e instanceof Error ? e.message : String(e)).slice(0, 200);
      logger.debug(`L2 API ${req.path}: ${message}`);
      handleError(req, res, 500, `Node error: ${message}`);
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
      .get(l2 + 'search/:query', wrap(this.$search));
    this.initFeatures(app, l2 + 'feature/');
    index.start();
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
          const r = await cached(`feature:${path}:${v}`, 5000, () => rpc.call(method, param ? param(v) : v).catch(() => null));
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
    });
  };

  private $getBlocks = async (req: Request, res: Response): Promise<void> => {
    const before = intParam(req.query.before, null, 0, 1e9);
    const limit = intParam(req.query.limit, 15, 1, 50) as number;
    res.json(index.blockSummaries(before, limit));
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
    res.json(index.block(h));
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
