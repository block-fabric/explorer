import { Application, Request, Response } from 'express';
import config from '../config';
import logger from '../logger';
import { handleError } from '../utils/api';
import bitcoinClient from '../api/bitcoin/bitcoin-client';
import { MODULE, PROFILE, SIDECHAIN_PROFILES, profileBySlot } from './profile';
import drivechain from './drivechain';
import { ChainModuleContext } from './module';
import { cockpit } from './cockpit';
import { anchorAckedIn, anchorOf, anchorOfTicket } from './anchors';

// Read-only JSON for the chain profiles. Rate limiting is nginx's, as for every /api/v1 route.
//
//   GET chain                          this explorer's profile: id, name, unit, slot, network, links to the others
//
// Mainchain profile (Chains):
//   GET drivechain/summary             getdrivechaininfo, the active sidechains (escrow, pending bundles), proposals,
//                                      withdrawal bundles with their scores, per-sidechain totals over the index
//   GET drivechain/blocks?to=&count=   per-block summaries (BMM, deposits, withdrawals, votes, proposals), newest first
//   GET drivechain/block/:hashOrHeight everything a block did for the drivechain (DrivechainBlock)
//   GET drivechain/events/:kind?slot=&before=&limit=
//                                      kind: bmm | bmm-requests | deposits | withdrawals | votes | proposals | bundles
//   GET drivechain/tx/:txid            what a transaction did for the drivechain (deposit / withdrawal / BMM request)
//
// Sidechain profiles:
//   GET sidechain/summary              this sidechain on the mainchain (escrow, bundles) and the node's own view
//   GET sidechain/block/:hash          the Chains block that committed to this block (BMM) and the bid
//   GET drivechain/events/:kind        as above, this sidechain's slot only
//
// Chain module hooks (chain/modules/<id>/), under /api/v1/sidechain/ (a sidechain) or /api/v1/chain/ (the mainchain):
//   GET <prefix>tx/:txid               the module's describeTx: what a transaction does on this chain
//   GET <prefix>block/:hash/features   the module's describeBlock
//   GET <prefix>...                    the module's own routes (initRoutes)

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

/** CHN issued up to a height: 50 CHN per block from height 1 (the genesis output cannot be spent), halving every 210,000 blocks */
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

class DrivechainRoutes {
  public initRoutes(app: Application): void {
    const prefix = config.MEMPOOL.API_URL_PREFIX;
    app
      .get(prefix + 'chain', wrap(this.$getChain))
      .get(prefix + 'drivechain/events/:kind', wrap(this.$getEvents))
      .get(prefix + 'drivechain/stats', wrap(async (req, res) => { res.json(drivechain.getStats()); }))
      .get(prefix + 'drivechain/cockpit', wrap(this.$getCockpit));

    if (PROFILE.mainchain) {
      app
        .get(prefix + 'drivechain/summary', wrap(this.$getSummary))
        .get(prefix + 'drivechain/blocks', wrap(this.$getBlocks))
        .get(prefix + 'drivechain/block/:id', wrap(this.$getBlock))
        .get(prefix + 'drivechain/tx/:txid', wrap(this.$getTx));
    } else {
      app
        .get(prefix + 'sidechain/summary', wrap(this.$getSidechainSummary))
        .get(prefix + 'sidechain/block/:hash', wrap(this.$getSidechainBlock))
        .get(prefix + 'sidechain/blocks', wrap(this.$getSidechainBlocks))
        // chains of stake: the block that acknowledged an anchor ticket (what a Chains block committed to)
        .get(prefix + 'sidechain/anchor/:ticket', wrap(async (req, res) => {
          const a = anchorOfTicket(String(req.params.ticket));
          return a ? res.json(a) : handleError(req, res, 404, 'No block acknowledged this ticket (yet)');
        }))
      if (MODULE.describeBlock) {
        // the module's block fields for several blocks at once (FastBlocks/Layers: kind, slot, proposer, finality)
        app.get(prefix + 'sidechain/blocks-features', wrap(async (req, res) => {
          const hashes = String(req.query.hashes ?? '').split(',').filter(h => /^[0-9a-f]{64}$/.test(h)).slice(0, 100);
          const out: Record<string, any> = {};
          await Promise.all(hashes.map(async (h) => {
            out[h] = await cached('bf:' + h, 15000, async () => MODULE.describeBlock!(await bitcoinClient.getBlock(h, 1), moduleCtx!)).catch(() => null);
          }));
          res.json(out);
        }));
      }
    }
    this.initModule(app, prefix + (PROFILE.mainchain ? 'chain/' : 'sidechain/'));
  }

  /** The chain module's hooks and its own routes */
  private initModule(app: Application, modulePrefix: string): void {
    const ctx: ChainModuleContext = {
      node: bitcoinClient,
      mainchain: drivechain.mainchainClient,
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
      network: config.CHAIN.NETWORK,
      explorers: {
        chains: explorerUrl('chains'),
        ...Object.fromEntries(SIDECHAIN_PROFILES.map(p => [p.id, explorerUrl(p.id)])),
      },
      sidechains: SIDECHAIN_PROFILES.map(p => ({ id: p.id, name: p.name, slot: p.slot })),
      module: { describeTx: !!MODULE.describeTx, describeBlock: !!MODULE.describeBlock },
      indexReady: drivechain.isReady(),
    });
  };

  /**
   * The cockpit: statistics over a window of mainchain blocks (cockpit.ts) and the live state from the node.
   * window = number of blocks (0 = everything indexed); slot = one sidechain (a sidechain explorer: always its own)
   */
  private $getCockpit = async (req: Request, res: Response): Promise<void> => {
    const window = intParam(req.query.window, 144, 0, 1e7) as number;
    const slot = PROFILE.mainchain ? intParam(req.query.slot, null, 0, 255) : PROFILE.slot;
    const main = drivechain.mainchainClient;
    const live = await cached('cockpit-live', 5000, async () => {
      const [info, active, proposals, bundles, mining, chainInfo] = await Promise.all([
        main.call('getdrivechaininfo'),
        main.call('listactivesidechains'),
        main.call('listsidechainproposals').catch(() => null),
        main.call('listwithdrawalbundles'),
        main.call('getmininginfo').catch(() => null),
        main.call('getblockchaininfo').catch(() => null),
      ]);
      return { info, active, proposals, bundles, mining, chainInfo };
    });
    const escrowNow: Record<number, number> = {};
    for (const s of live.active) {
      escrowNow[s.slot] = Math.round((s.escrow?.amount ?? 0) * 1e8);
    }
    const stats = cockpit(window, slot, escrowNow);
    const height = live.info.height;
    const supply = issuedSupply(height);
    const escrowTotal = Object.entries(escrowNow).filter(([s]) => slot === null || Number(s) === slot).reduce((a, [, v]) => a + v, 0);
    res.json({
      ...stats,
      live: {
        height,
        info: live.info,
        mining: live.mining ? { difficulty: live.mining.difficulty, networkhashps: live.mining.networkhashps, pooledtx: live.mining.pooledtx } : null,
        chainwork: live.chainInfo?.chainwork ?? null,
        supply,
        subsidy: Math.floor(50 * 1e8 / Math.pow(2, Math.floor(height / 210000))),
        nextHalving: (Math.floor(height / 210000) + 1) * 210000,
        escrowTotal,
        escrowShareOfSupply: supply ? escrowTotal / supply : 0,
        allSidechains: live.active.map((s: any) => ({ slot: s.slot, title: s.title, profile: profileBySlot(s.slot)?.id ?? null })),
        sidechains: live.active.filter((s: any) => slot === null || s.slot === slot).map((s: any) => {
          const p = profileBySlot(s.slot);
          return {
            slot: s.slot, title: s.title, description: s.description, activationheight: s.activationheight,
            escrow: escrowNow[s.slot] ?? 0, escrowTxid: s.escrow?.txid ?? null, pendingbundles: s.pendingbundles,
            profile: p?.id ?? null, explorer: p ? explorerUrl(p.id) : null,
          };
        }),
        proposals: live.proposals,
        bundles: live.bundles.filter((b: any) => slot === null || b.slot === slot).map((b: any) => ({
          ...b,
          name: live.active.find((s: any) => s.slot === b.slot)?.title ?? profileBySlot(b.slot)?.name ?? `Slot ${b.slot}`,
          fee: Math.round((b.fee ?? 0) * 1e8),
          payouts: (b.payouts ?? []).map((p: any) => ({ ...p, amount: Math.round(p.amount * 1e8) })),
          total: (b.payouts ?? []).reduce((a: number, p: any) => a + Math.round(p.amount * 1e8), 0),
        })),
      },
      indexReady: drivechain.isReady(),
    });
  };

  private $getSummary = async (req: Request, res: Response): Promise<void> => {
    const summary = await cached('summary', 5000, async () => {
      const [info, active, proposals, bundles, avgFee] = await Promise.all([
        bitcoinClient.call('getdrivechaininfo'),
        bitcoinClient.call('listactivesidechains'),
        bitcoinClient.call('listsidechainproposals'),
        bitcoinClient.call('listwithdrawalbundles'),
        bitcoinClient.call('getaveragefee').catch(() => null),
      ]);
      const stats = drivechain.getStats();
      return {
        info,
        averageFee: avgFee,
        sidechains: active.map((s: any) => {
          const p = profileBySlot(s.slot);
          return {
            ...s,
            escrow: s.escrow ? { ...s.escrow, amount: Math.round(s.escrow.amount * 1e8) } : null,
            profile: p?.id ?? null,
            explorer: p ? explorerUrl(p.id) : null,
            stats: stats.slots.find((x: any) => x.slot === s.slot) ?? null,
          };
        }),
        proposals,
        bundles: bundles.map((b: any) => ({
          ...b,
          name: active.find((s: any) => s.slot === b.slot)?.title ?? profileBySlot(b.slot)?.name ?? `Slot ${b.slot}`,
          fee: Math.round((b.fee ?? 0) * 1e8),
          payouts: (b.payouts ?? []).map((p: any) => ({ ...p, amount: Math.round(p.amount * 1e8) })),
          total: (b.payouts ?? []).reduce((a: number, p: any) => a + Math.round(p.amount * 1e8), 0),
        })),
        indexed: { from: stats.from, to: stats.to },
      };
    });
    res.json(summary);
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

  // --- sidechain profiles ---------------------------------------------------------------------------

  private $getSidechainSummary = async (req: Request, res: Response): Promise<void> => {
    const summary = await cached('sc-summary', 5000, async () => {
      const main = drivechain.mainchainClient;
      const [onMain, bundles, mainInfo, state, bmmInfo] = await Promise.all([
        main.call('getsidechain', PROFILE.slot).catch(() => null),
        main.call('listwithdrawalbundles', PROFILE.slot).catch(() => []),
        bitcoinClient.call('getmainchaininfo').catch(() => null),
        bitcoinClient.call('getsidechainstate').catch(() => null),
        bitcoinClient.call('getbmminfo').catch(() => null),
      ]);
      const stats = drivechain.getStats();
      return {
        slot: PROFILE.slot,
        name: PROFILE.name,
        onMainchain: onMain ? { ...onMain, escrow: onMain.escrow ? { ...onMain.escrow, amount: Math.round(onMain.escrow.amount * 1e8) } : null } : null,
        bundles: (bundles ?? []).map((b: any) => ({
          ...b,
          fee: Math.round((b.fee ?? 0) * 1e8),
          payouts: (b.payouts ?? []).map((p: any) => ({ ...p, amount: Math.round(p.amount * 1e8) })),
          total: (b.payouts ?? []).reduce((a: number, p: any) => a + Math.round(p.amount * 1e8), 0),
        })),
        mainchainInfo: mainInfo,
        state,
        bmmInfo,
        stats: stats.slots.find((x: any) => x.slot === PROFILE.slot) ?? null,
        indexed: { from: stats.from, to: stats.to },
        mainchainExplorer: explorerUrl('chains'),
      };
    });
    res.json(summary);
  };

  /**
   * The Chains block behind a sidechain block. Chains of stake: a block that acknowledges an anchor gets the Chains
   * block that committed to the ticket (role 'ticket'), and a block that was anchored gets the one that anchored it.
   */
  private carrierOf(hash: string): any {
    const direct = drivechain.getCarrier(hash);
    if (direct) { return direct; }
    const acked = anchorAckedIn(hash);
    if (acked) {
      const c = drivechain.getCarrier(acked.ticket);
      return { ...(c ?? { height: acked.mainheight, hash: null, time: null, bid: null, requestTxid: null }), role: 'ticket', ticket: acked.ticket, anchored: acked.anchored };
    }
    const by = anchorOf(hash);
    if (by) {
      const c = drivechain.getCarrier(by.ticket);
      return { ...(c ?? { height: by.mainheight, hash: null, time: null, bid: null, requestTxid: null }), role: 'anchored', ticket: by.ticket, ackBlock: by.block, ackHeight: by.height };
    }
    return null;
  }

  private $getSidechainBlock = async (req: Request, res: Response): Promise<void> => {
    const hash = String(req.params.hash);
    if (!/^[0-9a-f]{64}$/.test(hash)) {
      return handleError(req, res, 400, 'Invalid block hash');
    }
    res.json({ carrier: this.carrierOf(hash), mainchainExplorer: explorerUrl('chains') });
  };

  /** Carriers of several sidechain blocks at once (the block strip and the blocks table) */
  private $getSidechainBlocks = async (req: Request, res: Response): Promise<void> => {
    const hashes = String(req.query.hashes ?? '').split(',').filter(h => /^[0-9a-f]{64}$/.test(h)).slice(0, 100);
    res.json(Object.fromEntries(hashes.map(h => [h, this.carrierOf(h)])));
  };
}

export default new DrivechainRoutes();
