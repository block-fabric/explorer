import { Application, Request, Response } from 'express';
import config from '../../../config';
import logger from '../../../logger';
import { handleError } from '../../../utils/api';
import { PROFILE, SIDECHAIN_PROFILES } from '../../profile';
import { NETWORK, NETWORKS } from '../../networks';
import bitcoinClient from '../../../api/bitcoin/bitcoin-client';
import { ArgsError } from '../flush/allowlist';
import { BoundedCache } from '../flush/cache';
import { FlushError as RouteError, rpcFailure } from '../flush/routes';
import { RPC_METHODS, parseRpcArgs } from './allowlist';
import { describeTx } from './tx';

// The FreeBank explorer's own routes (chains/FREEBANK-API.md), next to upstream's API on the same FreeBank node
// (CORE_RPC). Read-only; every node method on an allowlist (allowlist.ts); the node's error text stays in the log;
// answers cached a few seconds in a cache bounded in entries and bytes, one request upstream per key at a time, a few
// at once (more: 503). As Flush's (chain/modules/flush/routes.ts), whose errors and cache it shares.
//
//   GET chain                     this explorer's profile (kind freebank, slot, features, links)
//   GET freebank/rpc/:method?args= an allowlisted read RPC of the node, args a JSON array
//   GET freebank/tx/:txid         what a transaction does on FreeBank: its credit operation, asset genesis, peg outputs
//   GET freebank/block/:hash      a block's BMM fields: the eCash block it was merged-mined in, its withdrawal bundle
//   GET freebank/blocks?hashes=   the same for up to 30 blocks at once (block strips, lists)

const HEX64 = /^[0-9a-f]{64}$/;
const ZERO = '0'.repeat(64);
/** The most blocks one freebank/blocks request asks for */
const MAX_BLOCKS = 30;
/** Requests upstream at once (cache misses); more answer 503 */
const SLOTS = 6;

interface Answer { type: string; body: string; length: number }

class FreebankRoutes {
  private cache = new BoundedCache<Answer>(1000, 32 * 1024 * 1024, 4 * 1024 * 1024);
  private inflight = new Map<string, Promise<Answer>>();
  private busy = 0;

  public initRoutes(app: Application): void {
    const prefix = config.MEMPOOL.API_URL_PREFIX;
    app
      .get(prefix + 'chain', this.wrap(this.$getChain))
      .get(prefix + 'freebank/rpc/:method', this.wrap(this.$getRpc))
      .get(prefix + 'freebank/tx/:txid', this.wrap(this.$getTx))
      .get(prefix + 'freebank/block/:hash', this.wrap(this.$getBlock))
      .get(prefix + 'freebank/blocks', this.wrap(this.$getBlocks));
  }

  private wrap(fn: (req: Request, res: Response) => Promise<unknown>): (req: Request, res: Response) => Promise<void> {
    return async (req: Request, res: Response): Promise<void> => {
      try {
        await fn(req, res);
      } catch (e) {
        if (e instanceof RouteError) {
          if (e.status >= 500) {
            logger.warn(`FreeBank API ${req.path}: ${e.message}`);
          }
          return handleError(req, res, e.status, e.publicMessage.replace('Flush', 'FreeBank'));
        }
        if (e instanceof ArgsError) {
          return handleError(req, res, 400, 'Invalid request');
        }
        logger.warn(`FreeBank API ${req.path}: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`);
        handleError(req, res, 502, 'The FreeBank node did not answer');
      }
    };
  }

  /** From the cache, or fetched once however many ask for it at the same time */
  /** @asyncUnsafe: wrap() answers its errors */
  private async cached(key: string, ttlMs: number, make: () => Promise<unknown>): Promise<Answer> {
    const hit = this.cache.get(key, ttlMs);
    if (hit) {
      return hit;
    }
    const pending = this.inflight.get(key);
    if (pending) {
      return pending;
    }
    if (this.busy >= SLOTS) {
      throw new RouteError(503, 'Busy: try again in a moment');
    }
    this.busy++;
    const p = (async () => {
      try {
        const value = await make();
        const body = JSON.stringify(value === undefined ? null : value);
        const a = { type: 'application/json', body, length: body.length };
        this.cache.set(key, a);
        return a;
      } finally {
        this.busy--;
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, p);
    return p;
  }

  /** @asyncUnsafe: wrap() answers its errors */
  private async node<T = any>(method: string, ...params: unknown[]): Promise<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      return await bitcoinClient.call(method, ...params);
    } catch (e) {
      throw rpcFailure(e);
    }
  }

  private send(res: Response, a: Answer, maxAge = 5): void {
    res.setHeader('Cache-Control', `public, max-age=${maxAge}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type(a.type).send(a.body);
  }

  /** @asyncUnsafe: wrap() answers its errors */
  private $getChain = async (req: Request, res: Response): Promise<void> => {
    const explorerUrl = (id: string): string | null => config.CHAIN.EXPLORER_URLS?.[id] || null;
    const siblings = SIDECHAIN_PROFILES.filter(p => p.id !== PROFILE.id);
    const mainchainExplorer = config.CHAIN.MAINCHAIN_EXPLORER || null;
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
      explorers: {
        ecash: explorerUrl('ecash') || mainchainExplorer,
        [NETWORK.id]: explorerUrl(NETWORK.id) || mainchainExplorer,
        ...Object.fromEntries(siblings.map(p => [p.id, explorerUrl(p.id)])),
      },
      sidechains: SIDECHAIN_PROFILES.map(p => ({ id: p.id, name: p.name, slot: p.slot })),
      module: { describeTx: false, describeBlock: false },
      activationHeight: null,
      indexReady: true,
      features: ['houses', 'bills', 'peg', 'pools', 'assets', 'gold'],
      addressIndex: false,
      mainchainExplorer,
      rpcMethods: Object.keys(RPC_METHODS),
    });
  };

  /** @asyncUnsafe: wrap() answers its errors */
  private $getRpc = async (req: Request, res: Response): Promise<void> => {
    const method = String(req.params.method);
    const args = parseRpcArgs(method, req.query.args);
    this.send(res, await this.cached(`rpc:${method}:${JSON.stringify(args)}`, 10000, () => this.node(method, ...args)), 10);
  };

  /** @asyncUnsafe: wrap() answers its errors */
  private $getTx = async (req: Request, res: Response): Promise<void> => {
    const txid = String(req.params.txid);
    if (!HEX64.test(txid)) {
      throw new RouteError(400, 'Invalid txid');
    }
    this.send(res, await this.cached('tx:' + txid, 10000, /** @asyncUnsafe: cached() passes its errors on */ async () => {
      const tx = await this.node('getrawtransaction', txid, true);
      return { txid, confirmed: (tx.confirmations ?? 0) > 0, ...describeTx(tx) };
    }));
  };

  /** @asyncUnsafe: wrap() answers its errors */
  private $getBlock = async (req: Request, res: Response): Promise<void> => {
    const hash = String(req.params.hash);
    if (!HEX64.test(hash)) {
      throw new RouteError(400, 'Invalid block hash');
    }
    this.send(res, await this.blockFields(hash));
  };

  /** GET freebank/blocks?hashes=a,b,…: the BMM fields of up to MAX_BLOCKS blocks at once, by hash */
  /** @asyncUnsafe: wrap() answers its errors */
  private $getBlocks = async (req: Request, res: Response): Promise<void> => {
    const hashes = [...new Set(String(req.query.hashes ?? '').split(',').filter(h => HEX64.test(h)))];
    if (!hashes.length || hashes.length > MAX_BLOCKS) {
      throw new RouteError(400, `From 1 to ${MAX_BLOCKS} block hashes`);
    }
    const out: Record<string, unknown> = {};
    for (const h of hashes) { // one at a time: each is cached, and the node's request slots stay for others
      try {
        out[h] = JSON.parse((await this.blockFields(h)).body);
      } catch (e) {
        out[h] = null;
      }
    }
    res.setHeader('Cache-Control', 'public, max-age=5');
    res.json(out);
  };

  /**
   * A block's BMM fields, from its 136-byte header (freebank primitives/block.h: version, prev, merkle root, time,
   * hashWithdrawalBundle, hashMainBlock; getblockheader's JSON leaves hashMainBlock out, getblock has it but lists
   * thousands of txids): the eCash block whose BMM commitment it is, and the withdrawal bundle it commits to (null:
   * none)
   */
  /** @asyncUnsafe: cached() passes its errors on */
  private blockFields(hash: string): Promise<Answer> {
    return this.cached('block:' + hash, 30000, /** @asyncUnsafe: cached() passes its errors on */ async () => {
      const [b, raw] = [await this.node('getblockheader', hash, true), await this.node('getblockheader', hash, false)];
      const bytes = typeof raw === 'string' && /^[0-9a-f]{272}$/.test(raw) ? Buffer.from(raw, 'hex') : null;
      const display = (from: number): string | null => {
        const h = bytes ? Buffer.from(bytes.subarray(from, from + 32)).reverse().toString('hex') : null;
        return h && h !== ZERO ? h : null;
      };
      return { hash, height: b.height, mainblock: display(104), withdrawalbundle: display(72), onChain: b.confirmations !== -1 };
    });
  }
}

export default new FreebankRoutes();
