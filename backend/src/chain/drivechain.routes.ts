import { Application, Request, Response } from 'express';
import config from '../config';
import logger from '../logger';
import { handleError } from '../utils/api';
import bitcoinClient from '../api/bitcoin/bitcoin-client';
import { MODULE, PROFILE, SIDECHAIN_PROFILES, profileBySlot } from './profile';
import { NETWORK, NETWORKS } from './networks';
import drivechain, { subsidyAt } from './drivechain';
import enforcer, { ChainInfo, SidechainInfo } from './enforcer';
import { ChainModuleContext } from './module';
import { cockpit } from './cockpit';
import { miningStats } from './mining';

// Read-only JSON for the chain profiles. Rate limiting is nginx's, as for every /api/v1 route.
//
//   GET chain                          this explorer's profile: id, name, unit, network, links to the others
//   GET drivechain/summary             the BIP300 constants, the active sidechains (escrow, pending bundles), the
//                                      sidechain proposals, the pending withdrawal bundles with their votes,
//                                      per-sidechain totals over the index
//   GET drivechain/blocks?to=&count=   per-block summaries (BMM, deposits, withdrawals, votes, proposals), newest first
//   GET drivechain/block/:hashOrHeight everything a block did for the drivechain (DrivechainBlock)
//   GET drivechain/events/:kind?slot=&before=&limit=
//                                      kind: bmm | bmm-requests | deposits | withdrawals | votes | proposals | bundles
//   GET drivechain/tx/:txid            what a transaction did for the drivechain (deposit / withdrawal / BMM request)
//   GET drivechain/stats               per-sidechain totals over the index
//   GET drivechain/cockpit?window=&slot=   statistics over a window of blocks, and the live state
//   GET drivechain/mining?window=      pools by coinbase tag (DATUM miners), hashrate, difficulty, retarget, epochs
//
// Chain module hooks (chain/modules/<id>/), under /api/v1/chain/:
//   GET chain/tx/:txid                 the module's describeTx: what a transaction does on this chain
//   GET chain/block/:hash/features     the module's describeBlock
//   GET chain/...                      the module's own routes (initRoutes)

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

function explorerUrl(id: string): string | null {
  return config.CHAIN.EXPLORER_URLS?.[id] || null;
}

function intParam(v: any, def: number | null, min: number, max: number): number | null {
  if (v === undefined || v === '') {
    return def;
  }
  const n = parseInt(String(v), 10);
  if (!Number.isFinite(n)) {
    return def;
  }
  return Math.max(min, Math.min(max, n));
}

function wrap(fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (e) {
      const message = (e instanceof Error ? e.message : String(e)).slice(0, 200);
      logger.debug(`Chain API ${req.path}: ${message}`);
      handleError(req, res, 500, `Node error: ${message}`);
    }
  };
}

let moduleCtx: ChainModuleContext | null = null;

/** Tell the chain module about a new block of this chain */
export function moduleNewBlock(block: { id: string; height: number }): void {
  if (moduleCtx && MODULE.onNewBlock) {
    MODULE.onNewBlock(block, moduleCtx);
  }
}

/** ECX issued up to a height: Bitcoin's schedule (the genesis output cannot be spent) */
function issuedSupply(height: number): number {
  let total = -50 * 1e8;
  let reward = 50 * 1e8;
  let left = height + 1;
  while (left > 0 && reward >= 1) {
    const n = Math.min(left, 210000);
    total += n * reward;
    left -= n;
    reward = Math.floor(reward / 2);
  }
  return total;
}

/** The drivechain's live state, from the enforcer: what the index cannot know until the next block */
interface LiveState {
  height: number;
  chainInfo: ChainInfo;
  sidechains: (SidechainInfo & { escrow: { txid: string; vout: number; amount: number; sequence: number } | null; bundles: { m6id: string; voteCount: number; proposalHeight: number }[] })[];
  proposals: any[];
}

async function liveState(): Promise<LiveState> {
  return cached('live', 5000, async () => {
    const [tip, chainInfo, sidechains, proposals] = await Promise.all([
      enforcer.getChainTip(), enforcer.getChainInfo(), enforcer.getSidechains(), enforcer.getSidechainProposals(),
    ]);
    const withState: LiveState['sidechains'] = [];
    for (const s of sidechains.sort((a, b) => a.slot - b.slot)) {
      withState.push({ ...s, escrow: await enforcer.getCtip(s.slot), bundles: await enforcer.getBundleProposals(s.slot) });
    }
    return { height: tip.height, chainInfo, sidechains: withState, proposals };
  });
}

/** A pending bundle as the pages show it: its votes against the threshold, and the blocks it has left */
function bundleView(live: LiveState, slot: number, b: { m6id: string; voteCount: number; proposalHeight: number }): any {
  const c = live.chainInfo;
  const age = live.height - b.proposalHeight;
  return {
    slot, name: live.sidechains.find(s => s.slot === slot)?.title ?? profileBySlot(slot)?.name ?? `Slot ${slot}`,
    hash: b.m6id, score: b.voteCount, height: b.proposalHeight, threshold: c.bundleThreshold,
    blocksleft: Math.max(0, c.bundleMaxAge - age), payable: b.voteCount >= c.bundleThreshold,
  };
}

class DrivechainRoutes {
  public initRoutes(app: Application): void {
    const prefix = config.MEMPOOL.API_URL_PREFIX;
    app
      .get(prefix + 'chain', wrap(this.$getChain))
      .get(prefix + 'drivechain/summary', wrap(this.$getSummary))
      .get(prefix + 'drivechain/blocks', wrap(this.$getBlocks))
      .get(prefix + 'drivechain/block/:id', wrap(this.$getBlock))
      .get(prefix + 'drivechain/events/:kind', wrap(this.$getEvents))
      .get(prefix + 'drivechain/tx/:txid', wrap(this.$getTx))
      .get(prefix + 'drivechain/stats', wrap(async (req, res) => { res.json(drivechain.getStats()); }))
      .get(prefix + 'drivechain/cockpit', wrap(this.$getCockpit))
      .get(prefix + 'drivechain/mining', wrap(this.$getMining));
    this.initModule(app, prefix + 'chain/');
  }

  /** The chain module's hooks and its own routes */
  private initModule(app: Application, modulePrefix: string): void {
    const ctx: ChainModuleContext = {
      node: bitcoinClient,
      cached: (key, ttl, fn) => cached(PROFILE.id + ':' + key, ttl, fn),
      handler: wrap,
      fail: (req, res, status, message) => handleError(req, res, status, message),
      intParam,
    };
    if (MODULE.describeTx) {
      app.get(modulePrefix + 'tx/:txid', wrap(async (req, res) => {
        const txid = String(req.params.txid);
        if (!/^[0-9a-f]{64}$/.test(txid)) {
          return handleError(req, res, 400, 'Invalid txid');
        }
        res.json(await cached('describe:' + txid, 60000, async () => {
          const tx = await bitcoinClient.getRawTransaction(txid, true);
          return MODULE.describeTx!(tx, ctx);
        }));
      }));
    }
    if (MODULE.describeBlock) {
      app.get(modulePrefix + 'block/:hash/features', wrap(async (req, res) => {
        const hash = String(req.params.hash);
        if (!/^[0-9a-f]{64}$/.test(hash)) {
          return handleError(req, res, 400, 'Invalid block hash');
        }
        const block = await bitcoinClient.getBlock(hash, 1);
        res.json(await MODULE.describeBlock!(block, ctx));
      }));
    }
    MODULE.initRoutes?.(app, modulePrefix, ctx);
    MODULE.start?.(ctx);
    moduleCtx = ctx;
  }

  private $getChain = async (req: Request, res: Response): Promise<void> => {
    res.json({
      id: PROFILE.id,
      name: PROFILE.name,
      unit: PROFILE.unit,
      slot: PROFILE.slot,
      mainchain: PROFILE.mainchain,
      network: NETWORK.id,
      networkName: NETWORK.name,
      networks: Object.values(NETWORKS).map(n => ({ id: n.id, name: n.name, explorer: explorerUrl(n.id) })),
      explorers: Object.fromEntries(SIDECHAIN_PROFILES.map(p => [p.id, explorerUrl(p.id)])),
      sidechains: SIDECHAIN_PROFILES.map(p => ({ id: p.id, name: p.name, slot: p.slot })),
      module: { describeTx: !!MODULE.describeTx, describeBlock: !!MODULE.describeBlock },
      activationHeight: drivechain.getChainInfo()?.activationHeight ?? null,
      indexReady: drivechain.isReady(),
    });
  };

  private $getSummary = async (req: Request, res: Response): Promise<void> => {
    const live = await liveState();
    const stats = drivechain.getStats();
    res.json({
      info: { ...live.chainInfo, height: live.height, network: NETWORK.id, enforcerNetwork: live.chainInfo.network },
      sidechains: live.sidechains.map(s => {
        const p = profileBySlot(s.slot);
        return {
          slot: s.slot, title: s.title ?? `Slot ${s.slot}`, description: s.description, hashId1: s.hashId1, hashId2: s.hashId2,
          proposalHeight: s.proposalHeight, activationHeight: s.activationHeight, voteCount: s.voteCount,
          escrow: s.escrow, pendingbundles: s.bundles.length,
          profile: p?.id ?? null, explorer: p ? explorerUrl(p.id) : null,
          stats: stats.slots.find((x: any) => x.slot === s.slot) ?? null,
        };
      }),
      proposals: live.proposals,
      bundles: live.sidechains.flatMap(s => s.bundles.map(b => bundleView(live, s.slot, b))),
      indexed: { from: stats.from, to: stats.to },
    });
  };

  /**
   * The cockpit: statistics over a window of mainchain blocks (cockpit.ts) and the live state from the enforcer.
   * window = number of blocks (0 = everything indexed); slot = one sidechain
   */
  private $getCockpit = async (req: Request, res: Response): Promise<void> => {
    const window = intParam(req.query.window, 144, 0, 1e7) as number;
    const slot = intParam(req.query.slot, null, 0, 255);
    const live = await liveState();
    const mining: any = await cached('mininginfo', 10000, () => bitcoinClient.getMiningInfo().catch(() => null));
    const chainTip: any = await cached('blockchaininfo', 10000, () => bitcoinClient.getBlockchainInfo().catch(() => null));
    const escrowNow: Record<number, number> = Object.fromEntries(live.sidechains.map(s => [s.slot, s.escrow?.amount ?? 0]));
    const height = live.height;
    const supply = issuedSupply(height);
    const escrowTotal = Object.entries(escrowNow).filter(([s]) => slot === null || Number(s) === slot).reduce((a, [, v]) => a + v, 0);
    res.json({
      ...cockpit(window, slot, escrowNow),
      live: {
        height,
        info: live.chainInfo,
        mining: mining ? { difficulty: mining.difficulty, networkhashps: mining.networkhashps, pooledtx: mining.pooledtx } : null,
        chainwork: chainTip?.chainwork ?? null,
        supply,
        subsidy: subsidyAt(height),
        nextHalving: (Math.floor(height / 210000) + 1) * 210000,
        escrowTotal,
        escrowShareOfSupply: supply ? escrowTotal / supply : 0,
        allSidechains: live.sidechains.map(s => ({ slot: s.slot, title: s.title, profile: profileBySlot(s.slot)?.id ?? null })),
        sidechains: live.sidechains.filter(s => slot === null || s.slot === slot).map(s => {
          const p = profileBySlot(s.slot);
          return {
            slot: s.slot, title: s.title, description: s.description, activationHeight: s.activationHeight,
            escrow: escrowNow[s.slot] ?? 0, escrowTxid: s.escrow?.txid ?? null, pendingbundles: s.bundles.length,
            profile: p?.id ?? null, explorer: p ? explorerUrl(p.id) : null,
          };
        }),
        proposals: live.proposals,
        bundles: live.sidechains.filter(s => slot === null || s.slot === slot).flatMap(s => s.bundles.map(b => bundleView(live, s.slot, b))),
      },
      indexReady: drivechain.isReady(),
    });
  };

  /** GET drivechain/mining?window=   pools by coinbase tag (DATUM miners), hashrate, difficulty, retarget, epochs */
  private $getMining = async (req: Request, res: Response): Promise<void> => {
    const window = intParam(req.query.window, 1008, 0, 1e7) as number;
    res.json(await cached('mining:' + window + ':' + drivechain.tipHeight(), 10000, async () => {
      const stats = miningStats(window, { minDifficultyBlocks: NETWORK.minDifficultyBlocks });
      const mining: any = await cached('mininginfo', 10000, () => bitcoinClient.getMiningInfo().catch(() => null));
      return { ...stats, node: mining ? { difficulty: mining.difficulty, networkhashps: mining.networkhashps } : null, indexReady: drivechain.isReady() };
    }));
  };

  private $getBlocks = async (req: Request, res: Response): Promise<void> => {
    if (req.query.hashes) {
      const hashes = String(req.query.hashes).split(',').filter(h => /^[0-9a-f]{64}$/.test(h)).slice(0, 100);
      res.json(hashes.map(h => drivechain.getBlock(h)).filter(b => !!b).map(b => drivechain.summarize(b!)));
      return;
    }
    const to = intParam(req.query.to, null, 0, 1e9);
    const count = intParam(req.query.count, 15, 1, 100) as number;
    res.json(drivechain.getSummaries(to, count));
  };

  private $getBlock = async (req: Request, res: Response): Promise<void> => {
    const id = String(req.params.id);
    if (!/^([0-9a-f]{64}|\d+)$/.test(id)) {
      return handleError(req, res, 400, 'Invalid block hash or height');
    }
    const b = drivechain.getBlock(id);
    if (!b) {
      return handleError(req, res, 404, drivechain.isReady() ? 'Block not indexed' : 'The drivechain index is still being built');
    }
    res.json(b);
  };

  private $getEvents = async (req: Request, res: Response): Promise<void> => {
    const kind = String(req.params.kind);
    if (!['bmm', 'bmm-requests', 'deposits', 'withdrawals', 'votes', 'proposals', 'bundles'].includes(kind)) {
      return handleError(req, res, 400, 'Unknown event kind');
    }
    const slot = intParam(req.query.slot, null, 0, 255);
    const before = intParam(req.query.before, null, 0, 1e9);
    const limit = intParam(req.query.limit, 50, 1, 500) as number;
    res.json(drivechain.getEvents(kind, slot, before, limit));
  };

  private $getTx = async (req: Request, res: Response): Promise<void> => {
    const txid = String(req.params.txid);
    if (!/^[0-9a-f]{64}$/.test(txid)) {
      return handleError(req, res, 400, 'Invalid txid');
    }
    res.json(drivechain.getTx(txid));
  };
}

export default new DrivechainRoutes();
