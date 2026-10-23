import { Application, Request, Response } from 'express';
import axios from 'axios';
import config from '../../../config';
import logger from '../../../logger';
import { handleError } from '../../../utils/api';
import { PROFILE, SIDECHAIN_PROFILES } from '../../profile';
import { NETWORK, NETWORKS } from '../../networks';
import * as bitcoin from 'bitcoinjs-lib';
import bitcoinClient from '../../../api/bitcoin/bitcoin-client';
import { ArgsError, RPC_METHODS, logoAsset, logoMime, marketPath, marketQuery, parseRpcArgs } from './allowlist';
import { BoundedCache } from './cache';
import { AddressContext, decodeMarkers, hasAssetMarker } from './markers';

// The Flush explorer's own routes (chains/FLUSH-API.md), next to upstream's API on the same Flush node (CORE_RPC).
// Read-only; every node method and public API path on an allowlist (allowlist.ts); the node's and the API's error
// text stays in the log; answers cached a few seconds in a cache bounded in entries and bytes, one request upstream
// per key at a time, a few at once (more: 503).
//
//   GET chain                    this explorer's profile (kind flush, slot, features, links)
//   GET flush/rpc/:method?args=  an allowlisted read RPC of the node, args a JSON array
//   GET flush/logo/:asset        an asset's logo (PNG or JPEG), as getassetlogo has it
//   GET flush/tx/:txid           what a transaction does on Flush: its asset operation, peg and stake markers
//   GET flush/block/:hash        a block's stake fields (getblock's PosBlockFields)
//   GET flush/blocks?hashes=     the same for up to 30 blocks at once (block strips)
//   GET flush/market/<path>      an allowlisted GET of the public DEX API's /api/v1/<path> (CHAIN.FLUSH.PUBLIC_API):
//                                its JSON as is, or a logo (launches/{id}/logo, assets/{id}/logo) as a PNG or JPEG

/** An error with the status the visitor gets and a fixed text (the cause stays in the log) */
export class FlushError extends Error {
  constructor(public status: number, public publicMessage: string, cause?: string) {
    super(cause ?? publicMessage);
  }
}

/** A node RPC error as the visitor sees it: unknown 404, malformed 400, anything else 502 */
export function rpcFailure(e: any): FlushError {
  const code = typeof e?.code === 'number' ? e.code : null;
  const message = String(e?.message ?? e).slice(0, 300);
  // the RPC client's own codes for an answer that is not JSON-RPC (401, 503...): the node is not usable
  if (/^Invalid params, response status code|^Problem parsing JSON/.test(message)) {
    return new FlushError(502, 'The Flush node did not answer', message);
  }
  switch (code) {
    case -5: // RPC_INVALID_ADDRESS_OR_KEY
    case -8: // RPC_INVALID_PARAMETER: also what an unknown asset, pool or launch gives
      return new FlushError(404, 'Not found', message);
    case -32601: // the node does not have the method (an older node)
      return new FlushError(404, 'This node does not have that method', message);
    case -1: // RPC_MISC_ERROR: the help text of a wrong call
    case -3: // RPC_TYPE_ERROR
    case -32602:
      return new FlushError(400, 'Invalid arguments', message);
    default:
      return new FlushError(502, 'The Flush node did not answer', message);
  }
}

const HEX64 = /^[0-9a-f]{64}$/;
/** The most blocks one flush/blocks request asks for */
const MAX_BLOCKS = 30;
/** Requests upstream at once (cache misses) per kind; more answer 503 */
const SLOTS = { node: 8, quote: 2, market: 8 };
/** The node's network (getblockchaininfo.chain) -> Flush's bech32 prefix there */
const FLUSH_HRP: Record<string, string> = { ecash: 'flx', ecashbeta: 'bflx', ecashtest: 'tflx', regtest: 'rsc' };
/** JSON replies of the API are at most 4 MiB (doc/public-api.md, row 9); a logo far less */
const MAX_REPLY = 4 * 1024 * 1024;
const MAX_LOGO = 64 * 1024;
const TTL_JSON = 5000;
const TTL_LOGO = 300000;

interface Answer { type: string; body: string | Buffer; length: number }

class FlushRoutes {
  private cache = new BoundedCache<Answer>(1000, 32 * 1024 * 1024, 2 * 1024 * 1024);
  private inflight = new Map<string, Promise<Answer>>();
  private busy = { node: 0, quote: 0, market: 0 };
  private addressCtx: { at: number; ctx: AddressContext } | null = null;

  public initRoutes(app: Application): void {
    const prefix = config.MEMPOOL.API_URL_PREFIX;
    app
      .get(prefix + 'chain', this.wrap(this.$getChain))
      .get(prefix + 'flush/rpc/:method', this.wrap(this.$getRpc))
      .get(prefix + 'flush/logo/:asset', this.wrap(this.$getLogo))
      .get(prefix + 'flush/tx/:txid', this.wrap(this.$getTx))
      .get(prefix + 'flush/block/:hash', this.wrap(this.$getBlock))
      .get(prefix + 'flush/blocks', this.wrap(this.$getBlocks))
      .get(prefix + 'flush/market/*', this.wrap(this.$getMarket));
  }

  private wrap(fn: (req: Request, res: Response) => Promise<unknown>) {
    return async (req: Request, res: Response): Promise<void> => {
      try {
        await fn(req, res);
      } catch (e) {
        if (e instanceof FlushError) {
          if (e.status >= 500) {
            logger.warn(`Flush API ${req.path}: ${e.message}`);
          }
          return handleError(req, res, e.status, e.publicMessage);
        }
        if (e instanceof ArgsError) {
          return handleError(req, res, 400, 'Invalid request');
        }
        logger.warn(`Flush API ${req.path}: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`);
        handleError(req, res, 502, 'The Flush API did not answer');
      }
    };
  }

  /** From the cache, or fetched once however many ask for it at the same time */
  /** @asyncUnsafe: wrap() answers its errors */
  private async cached(key: string, ttlMs: number, slot: 'node' | 'quote' | 'market', fetch: () => Promise<Answer>): Promise<Answer> {
    const hit = this.cache.get(key, ttlMs);
    if (hit) {
      return hit;
    }
    const pending = this.inflight.get(key);
    if (pending) {
      return pending;
    }
    if (this.busy[slot] >= SLOTS[slot]) {
      throw new FlushError(503, 'Busy: try again in a moment');
    }
    this.busy[slot]++;
    const p = (async () => {
      try {
        const a = await fetch();
        this.cache.set(key, a);
        return a;
      } finally {
        this.busy[slot]--;
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, p);
    return p;
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
      // the eCash explorer (under 'ecash' and this network's id) and the other sidechains' explorers
      explorers: {
        ecash: explorerUrl('ecash') || mainchainExplorer,
        [NETWORK.id]: explorerUrl(NETWORK.id) || mainchainExplorer,
        ...Object.fromEntries(siblings.map(p => [p.id, explorerUrl(p.id)])),
      },
      sidechains: SIDECHAIN_PROFILES.map(p => ({ id: p.id, name: p.name, slot: p.slot })),
      module: { describeTx: false, describeBlock: false },
      activationHeight: null,
      indexReady: true,
      // market: /api/v1/flush/market/* answers (CHAIN.FLUSH.PUBLIC_API is set)
      features: ['assets', 'dex', 'launches', 'stake', 'peg', ...(config.CHAIN.FLUSH?.PUBLIC_API ? ['market'] : [])],
      mainchainExplorer,
      rpcMethods: Object.keys(RPC_METHODS),
    });
  };

  /** @asyncUnsafe: wrap() answers its errors */
  private async node<T = any>(method: string, ...params: unknown[]): Promise<T> {
    try {
      return await bitcoinClient.call(method, ...params);
    } catch (e) {
      throw rpcFailure(e);
    }
  }

  /** @asyncUnsafe: wrap() answers its errors */
  private nodeJson(key: string, ttlMs: number, slot: 'node' | 'quote', make: () => Promise<unknown>): Promise<Answer> {
    return this.cached(key, ttlMs, slot, /** @asyncUnsafe: cached() passes its errors on */ async () => {
      const value = await make();
      const body = JSON.stringify(value === undefined ? null : value);
      return { type: 'application/json', body, length: body.length };
    });
  }

  private send(res: Response, a: Answer, maxAge = 5): void {
    res.setHeader('Cache-Control', `public, max-age=${maxAge}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type(a.type).send(a.body);
  }

  /** @asyncUnsafe: wrap() answers its errors */
  private $getRpc = async (req: Request, res: Response): Promise<void> => {
    const method = String(req.params.method);
    const args = parseRpcArgs(method, req.query.args);
    const quote = !!RPC_METHODS[method].quote;
    this.send(res, await this.nodeJson(`rpc:${method}:${JSON.stringify(args)}`, quote ? 3000 : 5000, quote ? 'quote' : 'node',
      () => this.node(method, ...args)));
  };

  /** @asyncUnsafe: wrap() answers its errors */
  private $getLogo = async (req: Request, res: Response): Promise<void> => {
    const asset = logoAsset(String(req.params.asset));
    if (!asset) {
      throw new FlushError(400, 'Invalid asset');
    }
    const a = await this.cached('logo:' + asset, 300000, 'node', /** @asyncUnsafe: cached() passes its errors on */ async () => {
      const r: any = await this.node('getassetlogo', asset);
      const text = typeof r?.base64 === 'string' ? r.base64 : '';
      if (text.length > Math.ceil(MAX_LOGO / 3) * 4) {
        throw new FlushError(502, 'The logo is not an image this explorer shows', `logo of ${asset}: ${text.length} base64 characters`);
      }
      const bytes = Buffer.from(text, 'base64');
      const mime = logoMime(r?.mime, bytes);
      if (!mime || bytes.length > MAX_LOGO) {
        throw new FlushError(502, 'The logo is not an image this explorer shows', `logo of ${asset}: ${r?.mime}, ${bytes.length} bytes`);
      }
      return { type: mime, body: bytes, length: bytes.length };
    });
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    this.send(res, a, 300);
  };

  /** The prefixes of the addresses markers name, after the node's network (cached ten minutes) */
  /** @asyncUnsafe: wrap() answers its errors */
  private async addresses(): Promise<AddressContext> {
    if (this.addressCtx && Date.now() - this.addressCtx.at < 600000) {
      return this.addressCtx.ctx;
    }
    const info = await this.node('getblockchaininfo').catch(() => null);
    const chain: string = typeof info?.chain === 'string' ? info.chain : NETWORK.id;
    const ctx: AddressContext = {
      flushHrp: FLUSH_HRP[chain] ?? FLUSH_HRP[NETWORK.id] ?? null,
      // regtest: the mainchain is Backbone's eCash regtest (-testecash), whose addresses are rchn1…
      main: chain === 'regtest' ? { ...bitcoin.networks.regtest, bech32: 'rchn' }
        : { ...(NETWORK.bech32 === 'tb' ? bitcoin.networks.testnet : bitcoin.networks.bitcoin), bech32: NETWORK.bech32 },
    };
    if (info) {
      this.addressCtx = { at: Date.now(), ctx };
    }
    return ctx;
  }

  /** @asyncUnsafe: wrap() answers its errors */
  private $getTx = async (req: Request, res: Response): Promise<void> => {
    const txid = String(req.params.txid);
    if (!HEX64.test(txid)) {
      throw new FlushError(400, 'Invalid txid');
    }
    this.send(res, await this.nodeJson('tx:' + txid, 10000, 'node', /** @asyncUnsafe: cached() passes its errors on */ async () => {
      const tx = await this.node('getrawtransaction', txid, true);
      const { peg, stake } = decodeMarkers(tx, await this.addresses());
      let asset: any = null;
      if (hasAssetMarker(tx)) {
        const d = await this.node('decodeassettx', tx.hex);
        asset = d?.marker ? { operation: d.operation ?? null, outputs: d.outputs ?? [], error: d.error ?? null } : null;
      }
      return { txid, confirmed: (tx.confirmations ?? 0) > 0, asset, peg: peg.length ? peg : null, stake: stake.length ? stake : null };
    }));
  };

  /** @asyncUnsafe: wrap() answers its errors */
  private $getBlock = async (req: Request, res: Response): Promise<void> => {
    const hash = String(req.params.hash);
    if (!HEX64.test(hash)) {
      throw new FlushError(400, 'Invalid block hash');
    }
    this.send(res, await this.blockFields(hash));
  };

  /** GET flush/blocks?hashes=a,b,…: the stake fields of up to MAX_BLOCKS blocks at once (block strips, lists), by hash */
  /** @asyncUnsafe: wrap() answers its errors */
  private $getBlocks = async (req: Request, res: Response): Promise<void> => {
    const hashes = [...new Set(String(req.query.hashes ?? '').split(',').filter(h => HEX64.test(h)))];
    if (!hashes.length || hashes.length > MAX_BLOCKS) {
      throw new FlushError(400, `From 1 to ${MAX_BLOCKS} block hashes`);
    }
    const out: Record<string, any> = {};
    for (const h of hashes) { // one at a time: each is cached, and the node's request slots stay for others
      try {
        out[h] = JSON.parse(String((await this.blockFields(h)).body));
      } catch (e) {
        out[h] = null; // unknown here, or the node did not answer: that block shows without its stake fields
      }
    }
    res.setHeader('Cache-Control', 'public, max-age=5');
    res.json(out);
  };

  /** A block's stake fields, from getblock (verbosity 1; src/rpc/pos.cpp PushPosBlockInfo), cached */
  /** @asyncUnsafe: cached() passes its errors on */
  private blockFields(hash: string): Promise<Answer> {
    return this.nodeJson('block:' + hash, 5000, 'node', async () => {
      const b = await this.node('getblock', hash, 1);
      return {
        hash, height: b.height, kind: b.kind ?? null, slot: b.slot ?? null, proposer: b.proposer ?? null, mainheight: b.mainheight ?? null,
        ack: b.ack ?? null, evidence: b.evidence ?? [], finality: b.finality ?? null,
      };
    });
  }

  /** @asyncUnsafe: wrap() answers its errors */
  private $getMarket = async (req: Request, res: Response): Promise<void> => {
    const base = (config.CHAIN.FLUSH?.PUBLIC_API || '').replace(/\/+$/, '');
    if (!base) {
      throw new FlushError(404, 'This explorer has no Flush API to read');
    }
    const root = config.MEMPOOL.API_URL_PREFIX + 'flush/market/';
    const path = req.path.startsWith(root) ? req.path.slice(root.length) : '';
    const kind = marketPath(path);
    if (!kind) {
      throw new FlushError(404, 'Not found');
    }
    const query = kind === 'logo' ? '' : marketQuery(req.query as Record<string, unknown>);
    const a = await this.cached(`${path}?${query}`, kind === 'logo' ? TTL_LOGO : TTL_JSON, 'market', () => this.fetch(path, query, kind));
    res.setHeader('Cache-Control', `public, max-age=${kind === 'logo' ? 300 : 5}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (kind === 'logo') {
      res.setHeader('Content-Security-Policy', "default-src 'none'");
    }
    res.type(a.type).send(a.body);
  };

  /** @asyncUnsafe: wrap() answers its errors */
  private async fetch(path: string, query: string, kind: 'json' | 'logo'): Promise<Answer> {
    const base = (config.CHAIN.FLUSH?.PUBLIC_API || '').replace(/\/+$/, '');
    const host = config.CHAIN.FLUSH?.PUBLIC_API_HOST;
    let r;
    try {
      r = await axios.get(`${base}/api/v1/${path}${query ? '?' + query : ''}`, {
        timeout: config.CHAIN.FLUSH?.PUBLIC_API_TIMEOUT || 10000,
        headers: { ...(host ? { Host: host } : {}), Accept: kind === 'logo' ? 'image/png, image/jpeg' : 'application/json' },
        responseType: 'arraybuffer', maxRedirects: 0, maxContentLength: kind === 'logo' ? MAX_LOGO : MAX_REPLY,
        validateStatus: () => true,
      });
    } catch (e) {
      throw new FlushError(502, 'The Flush API did not answer', `${path}: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
    }
    const data = Buffer.from(r.data);
    if (r.status === 400 || r.status === 404) {
      throw new FlushError(r.status, r.status === 404 ? 'Not found' : 'Invalid request', `${path}: ${data.toString('utf8', 0, 200)}`);
    }
    if (r.status === 429) { // the API's budget for this server (all our visitors are one client to it)
      throw new FlushError(503, 'Busy: try again in a moment', `${path}: HTTP 429`);
    }
    if (r.status !== 200) {
      throw new FlushError(502, 'The Flush API did not answer', `${path}: HTTP ${r.status} ${data.toString('utf8', 0, 200)}`);
    }
    if (kind === 'logo') {
      const mime = logoMime(String(r.headers['content-type'] ?? '').split(';')[0].trim(), data);
      if (!mime) {
        throw new FlushError(502, 'The Flush API did not answer', `${path}: not a PNG or JPEG`);
      }
      return { type: mime, body: data, length: data.length };
    }
    // JSON only, written again by us: nothing but JSON reaches the page
    let body: string;
    try {
      body = JSON.stringify(JSON.parse(data.toString('utf8')));
    } catch (e) {
      throw new FlushError(502, 'The Flush API did not answer', `${path}: not JSON`);
    }
    return { type: 'application/json', body, length: body.length };
  }
}

export default new FlushRoutes();
