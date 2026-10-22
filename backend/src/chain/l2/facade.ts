import * as http from 'http';
import * as bitcoinjs from 'bitcoinjs-lib';
import logger from '../../logger';
import { PROFILE } from '../profile';
import { L2Index } from './index';
import rpc from './rpc';
import { isAddress } from './codec';
import {
  CoreBlock, CoreOut, CoreTx, CoreView, DIFFICULTY, addressOfScript, chainwork, coins, renderTx, scriptJson, scriptOf,
} from './core';

/**
 * A Bitcoin Core JSON-RPC view of the sidechain index (core.ts), for upstream mempool's backend running on a
 * sidechain (CHAIN.L2_ROLE 'full', CORE_RPC → 127.0.0.1:CHAIN.L2_RPC_PORT): the methods mempool calls with
 * MEMPOOL.BACKEND "none", in Core's shapes and error codes. Served by the index instance (CHAIN.L2_ROLE 'index'),
 * bound to 127.0.0.1, read-only: no wallet, no relay, no mining. JSON-RPC 1.0 or 2.0, one call or a batch per POST;
 * credentials are not checked (loopback only).
 *
 * The mempool is the node's list_mempool (chains that have one; Thunder and zSide do not), read at most every
 * MEMPOOL_TTL ms. Mining figures are neutral: difficulty 1, no hashrate, a fixed 1 sat/vB fee estimate.
 */

export class RpcError extends Error {
  constructor(public code: number, message: string) {
    super(message);
  }
}

const RPC_MISC_ERROR = -1;
const RPC_TYPE_ERROR = -3;
const RPC_INVALID_ADDRESS_OR_KEY = -5;
const RPC_INVALID_PARAMETER = -8;
const RPC_DESERIALIZATION_ERROR = -22;
const RPC_IN_WARMUP = -28;
const RPC_INVALID_REQUEST = -32600;
const RPC_METHOD_NOT_FOUND = -32601;
const RPC_PARSE_ERROR = -32700;

const MEMPOOL_TTL = 5000;
const HASH = /^[0-9a-f]{64}$/;
const MAX_BODY = 1 << 20;

interface PoolEntry {
  tx: CoreTx;
  time: number;
}

/** Core's verbosity argument: a number, or a boolean (true = 1) */
function verbosityOf(v: unknown, def: number): number {
  if (v === undefined || v === null) {
    return def;
  }
  if (typeof v === 'boolean') {
    return v ? 1 : 0;
  }
  if (typeof v === 'number' && Number.isInteger(v)) {
    return v;
  }
  throw new RpcError(RPC_TYPE_ERROR, 'Expected type number or bool');
}

function hashParam(v: unknown, name: string): string {
  if (typeof v !== 'string' || !HASH.test(v.toLowerCase())) {
    throw new RpcError(RPC_INVALID_PARAMETER, `${name} must be hexadecimal string (not '${String(v).slice(0, 80)}') and length 64`);
  }
  return v.toLowerCase();
}

export class CoreFacade {
  readonly view: CoreView;
  private pool = new Map<string, PoolEntry>();
  private poolAt = 0;
  private poolLoad: Promise<void> | null = null;
  private started = Date.now();

  constructor(readonly index: L2Index, private nodeRpc: { call<T = any>(method: string, ...params: unknown[]): Promise<T> } = rpc) {
    this.view = new CoreView(index);
  }

  /** Listen on 127.0.0.1:port */
  listen(port: number): http.Server {
    const server = http.createServer((req, res) => this.serve(req, res));
    server.listen(port, '127.0.0.1', () => {
      logger.notice(`Sidechain explorer (${PROFILE.id}): Core JSON-RPC view of the index on 127.0.0.1:${port}`);
    });
    server.keepAliveTimeout = 70 * 1000;
    return server;
  }

  private serve(req: http.IncomingMessage, res: http.ServerResponse): void {
    const send = (status: number, body: any) => {
      const s = JSON.stringify(body);
      res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(s) });
      res.end(s);
    };
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' });
      res.end();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', async () => {
      let body: any;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch (e) {
        return send(500, { result: null, error: { code: RPC_PARSE_ERROR, message: 'Parse error' }, id: null });
      }
      if (Array.isArray(body)) {
        const replies: any[] = [];
        for (const b of body.slice(0, 1000)) {
          replies.push(await this.reply(b));
        }
        send(200, replies);
      } else {
        const r = await this.reply(body);
        // Core: HTTP 500 for an error of a JSON-RPC 1.0 call (404 for an unknown method), 200 for 2.0
        send(r.error && body?.jsonrpc !== '2.0' ? (r.error.code === RPC_METHOD_NOT_FOUND ? 404 : 500) : 200, r);
      }
    });
  }

  /** @asyncSafe */
  private async reply(req: any): Promise<any> {
    const v2 = req?.jsonrpc === '2.0';
    const id = req?.id ?? null;
    const wrap = (result: any, error: any) => (v2 ? (error ? { jsonrpc: '2.0', error, id } : { jsonrpc: '2.0', result, id }) : { result, error, id });
    if (!req || typeof req !== 'object' || typeof req.method !== 'string') {
      return wrap(null, { code: RPC_INVALID_REQUEST, message: 'Invalid Request object' });
    }
    try {
      const params = Array.isArray(req.params) ? req.params : req.params && typeof req.params === 'object' ? Object.values(req.params) : [];
      return wrap(await this.call(req.method, params), null);
    } catch (e) {
      if (e instanceof RpcError) {
        return wrap(null, { code: e.code, message: e.message });
      }
      logger.warn(`L2 Core facade ${req.method}: ${e instanceof Error ? e.message : e}`);
      return wrap(null, { code: RPC_MISC_ERROR, message: 'Internal error' });
    }
  }

  private warm(): number {
    const tip = this.view.tipHeight();
    if (tip < 0) {
      throw new RpcError(RPC_IN_WARMUP, 'Loading block index...');
    }
    return tip;
  }

  private blockAt(height: number): CoreBlock {
    const b = this.view.block(height);
    if (!b) {
      throw new RpcError(RPC_INVALID_PARAMETER, 'Block height out of range');
    }
    return b;
  }

  private blockByHash(hash: unknown): CoreBlock {
    const h = this.view.heightOf(hashParam(hash, 'blockhash'));
    const b = h === null ? null : this.view.block(h);
    if (!b) {
      throw new RpcError(RPC_INVALID_ADDRESS_OR_KEY, 'Block not found');
    }
    return b;
  }

  // ------------------------------------------------------------------ the mempool (list_mempool)

  /** @asyncUnsafe */
  private async mempool(): Promise<Map<string, PoolEntry>> {
    if (!this.index.chain.mempool) {
      return this.pool;
    }
    if (Date.now() - this.poolAt < MEMPOOL_TTL) {
      return this.pool;
    }
    if (!this.poolLoad) {
      this.poolLoad = this.loadMempool().finally(() => {
        this.poolLoad = null;
      });
    }
    await this.poolLoad;
    return this.pool;
  }

  /** @asyncSafe */
  private async loadMempool(): Promise<void> {
    let entries: any[];
    try {
      entries = await this.nodeRpc.call<any[]>('list_mempool');
    } catch (e) {
      logger.debug(`L2 Core facade: list_mempool: ${e instanceof Error ? e.message : e}`);
      this.poolAt = Date.now();
      return; // keep the last one
    }
    entries = (entries ?? []).filter(e => typeof e?.txid === 'string' && !this.index.hasTx(e.txid));
    const outs = new Map<string, CoreOut>();
    for (const e of entries) {
      this.view.mempoolOutputs(e).forEach((o, n) => outs.set(`${e.txid}:${n}`, o));
    }
    const now = Math.floor(Date.now() / 1000);
    const next = new Map<string, PoolEntry>();
    for (const e of entries) {
      next.set(e.txid, { tx: this.view.mempoolTx(e, outs), time: this.pool.get(e.txid)?.time ?? now });
    }
    this.pool = next;
    this.poolAt = Date.now();
  }

  private mempoolEntry(p: PoolEntry, pool: Map<string, PoolEntry>): any {
    const t = p.tx;
    const fee = coins(t.fee);
    const depends = [...new Set(t.ins.filter(i => i.txid && pool.has(i.txid)).map(i => i.txid as string))];
    const spentby = [...pool.values()].filter(q => q.tx.ins.some(i => i.txid === t.txid)).map(q => q.tx.txid);
    return {
      vsize: t.size, weight: 4 * t.size, time: p.time, height: this.view.tipHeight(),
      descendantcount: 1, descendantsize: t.size, ancestorcount: 1, ancestorsize: t.size, wtxid: t.txid,
      fees: { base: fee, modified: fee, ancestor: fee, descendant: fee },
      depends, spentby, 'bip125-replaceable': false, unbroadcast: false,
    };
  }

  // ------------------------------------------------------------------ methods

  /** @asyncUnsafe: Core's errors as RpcError */
  async call(method: string, p: any[]): Promise<any> {
    switch (method) {
      case 'getnetworkinfo':
        return {
          version: 270000, subversion: `/${PROFILE.name}:index/`, protocolversion: 70016, localservices: '0000000000000000',
          localservicesnames: [], localrelay: false, timeoffset: 0, networkactive: true, connections: 0, connections_in: 0,
          connections_out: 0, networks: [], relayfee: 0.00001, incrementalfee: 0.00001, localaddresses: [], warnings: '',
        };
      case 'uptime':
        return Math.floor((Date.now() - this.started) / 1000);
      case 'getindexinfo': {
        const tip = this.view.tipHeight();
        const state = { synced: this.index.isReady() && tip >= 0, best_block_height: Math.max(0, tip) };
        const all: any = { txindex: state, txospenderindex: state };
        return typeof p[0] === 'string' ? (all[p[0]] ? { [p[0]]: all[p[0]] } : {}) : all;
      }
      case 'getzmqnotifications':
        return [];
    }

    const tip = this.warm();
    switch (method) {
      case 'getblockcount':
        return tip;
      case 'getbestblockhash':
        return this.blockAt(tip).hash;
      case 'getblockhash': {
        const h = p[0];
        if (typeof h !== 'number' || !Number.isInteger(h) || h < 0 || h > tip) {
          throw new RpcError(RPC_INVALID_PARAMETER, 'Block height out of range');
        }
        return this.blockAt(h).hash;
      }
      case 'getblockchaininfo': {
        const b = this.blockAt(tip);
        const headers = Math.max(tip, this.index.nodeTipHeight());
        return {
          chain: 'main', blocks: tip, headers, bestblockhash: b.hash, difficulty: DIFFICULTY, time: b.time, mediantime: b.mediantime,
          verificationprogress: 1, initialblockdownload: false, chainwork: chainwork(tip), size_on_disk: 0, pruned: false, warnings: '',
        };
      }
      case 'getchaintips': {
        const b = this.blockAt(tip);
        return [{ height: tip, hash: b.hash, branchlen: 0, status: 'active' }];
      }
      case 'getblockheader': {
        const b = this.blockByHash(p[0]);
        return p[1] === false ? b.header : this.view.headerJson(b);
      }
      case 'getblock': {
        const b = this.blockByHash(p[0]);
        return this.view.blockJson(b, verbosityOf(p[1], 1));
      }
      case 'getblockstats': {
        const b = typeof p[0] === 'number' ? this.blockAt(p[0]) : this.blockByHash(p[0]);
        const stats = this.view.blockStats(b);
        return Array.isArray(p[1]) && p[1].length ? Object.fromEntries(p[1].filter(k => k in stats).map(k => [k, stats[k]])) : stats;
      }
      case 'getrawtransaction': {
        const txid = hashParam(p[0], 'parameter 1');
        const verbosity = verbosityOf(p[1], 0);
        const blockHash = p[2] !== undefined && p[2] !== null ? hashParam(p[2], 'parameter 3') : undefined;
        if (blockHash && this.view.heightOf(blockHash) === null) {
          throw new RpcError(RPC_INVALID_ADDRESS_OR_KEY, 'Block hash not found');
        }
        const found = this.view.tx(txid, blockHash);
        if (found) {
          return verbosity ? { ...(blockHash ? { in_active_chain: true } : {}), ...this.view.txJson(found.tx, found.block, verbosity) } : found.tx.hex;
        }
        const m = blockHash ? undefined : (await this.mempool()).get(txid);
        if (m) {
          return verbosity ? this.view.txJson(m.tx, null, verbosity) : m.tx.hex;
        }
        throw new RpcError(RPC_INVALID_ADDRESS_OR_KEY, blockHash ? 'No such transaction found in the provided block.'
          : 'No such mempool or blockchain transaction. Use gettransaction for wallet transactions.');
      }
      case 'decoderawtransaction':
        return this.decode(p[0]);
      case 'gettxout': {
        const txid = hashParam(p[0], 'txid');
        const n = p[1];
        if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
          throw new RpcError(RPC_TYPE_ERROR, 'Expected type number');
        }
        const includeMempool = p[2] !== false;
        const pool = includeMempool ? await this.mempool() : null;
        const o = this.view.output(txid, n);
        const best = this.blockAt(tip).hash;
        if (o) {
          if ((o.ref.spent && o.ref.spent.height <= tip) || (pool && [...pool.values()].some(q => q.tx.ins.some(i => i.txid === txid && i.vout === n)))) {
            return null;
          }
          return {
            bestblock: best, confirmations: this.view.confirmations(o.ref.height), value: coins(o.out.value),
            scriptPubKey: scriptJson(o.out.script), coinbase: o.ref.outpoint.kind === 'coinbase',
          };
        }
        const m = pool?.get(txid);
        const out = m?.tx.outs[n];
        if (m && out && ![...pool!.values()].some(q => q.tx.ins.some(i => i.txid === txid && i.vout === n))) {
          return { bestblock: best, confirmations: 0, value: coins(out.value), scriptPubKey: scriptJson(out.script), coinbase: false };
        }
        return null;
      }
      case 'gettxspendingprevout': {
        if (!Array.isArray(p[0])) {
          throw new RpcError(RPC_TYPE_ERROR, 'Expected type array');
        }
        const mempoolOnly = !!(p[1] && typeof p[1] === 'object' && p[1].mempool_only);
        const pool = await this.mempool();
        return p[0].map((x: any) => {
          const txid = hashParam(x?.txid, 'txid');
          const vout = Number(x?.vout);
          const r: any = { txid, vout };
          const inPool = [...pool.values()].find(q => q.tx.ins.some(i => i.txid === txid && i.vout === vout));
          if (inPool) {
            r.spendingtxid = inPool.tx.txid;
            return r;
          }
          const o = mempoolOnly ? null : this.view.output(txid, vout);
          const s = o ? this.view.spender(o.ref) : null;
          if (s) {
            r.spendingtxid = s.txid;
            r.blockhash = this.view.block(s.height)?.hash;
          }
          return r;
        });
      }
      case 'getrawmempool': {
        const pool = await this.mempool();
        if (!p[0]) {
          return [...pool.keys()];
        }
        return Object.fromEntries([...pool.values()].map(q => [q.tx.txid, this.mempoolEntry(q, pool)]));
      }
      case 'getmempoolentry': {
        const txid = hashParam(p[0], 'parameter 1');
        const pool = await this.mempool();
        const q = pool.get(txid);
        if (!q) {
          throw new RpcError(RPC_INVALID_ADDRESS_OR_KEY, 'Transaction not in mempool');
        }
        return this.mempoolEntry(q, pool);
      }
      case 'getmempoolancestors':
      case 'getmempooldescendants': {
        const txid = hashParam(p[0], 'parameter 1');
        if (!(await this.mempool()).has(txid)) {
          throw new RpcError(RPC_INVALID_ADDRESS_OR_KEY, 'Transaction not in mempool');
        }
        return p[1] ? {} : [];
      }
      case 'getmempoolinfo': {
        const pool = await this.mempool();
        const bytes = [...pool.values()].reduce((a, q) => a + q.tx.size, 0);
        return {
          loaded: true, size: pool.size, bytes, usage: bytes * 4, total_fee: coins([...pool.values()].reduce((a, q) => a + q.tx.fee, 0)),
          maxmempool: 300000000, mempoolminfee: 0.00001, minrelaytxfee: 0.00001, incrementalrelayfee: 0.00001,
          unbroadcastcount: 0, fullrbf: false,
        };
      }
      case 'getmininginfo':
        return {
          blocks: tip, difficulty: DIFFICULTY, networkhashps: 0, pooledtx: (await this.mempool()).size, chain: 'main', warnings: '',
        };
      case 'getnetworkhashps':
        return 0;
      case 'getdifficulty':
        return DIFFICULTY;
      case 'estimatesmartfee':
        return { feerate: 0.00001, blocks: Math.max(1, Number(p[0]) || 1) };
      case 'validateaddress': {
        const a = String(p[0] ?? '');
        if (!isAddress(a)) {
          return { isvalid: false, error_locations: [], error: 'Invalid address' };
        }
        return { isvalid: true, address: a, scriptPubKey: scriptOf(a).hex, isscript: false, iswitness: false };
      }
      case 'gettxoutsetinfo': {
        const t = this.view.utxoTotals();
        const b = this.blockAt(tip);
        return { height: tip, bestblock: b.hash, txouts: t.count, bogosize: t.count * 50, total_amount: coins(t.amount), transactions: t.count };
      }
    }
    throw new RpcError(RPC_METHOD_NOT_FOUND, 'Method not found');
  }

  /** decoderawtransaction: a tx this facade serialized (its txid, if known, is the chain's) */
  private decode(hex: unknown): any {
    if (typeof hex !== 'string' || !/^([0-9a-f]{2})+$/i.test(hex)) {
      throw new RpcError(RPC_DESERIALIZATION_ERROR, 'TX decode failed');
    }
    let tx: bitcoinjs.Transaction;
    try {
      tx = bitcoinjs.Transaction.fromHex(hex);
    } catch (e) {
      throw new RpcError(RPC_DESERIALIZATION_ERROR, 'TX decode failed');
    }
    const t: CoreTx = {
      txid: tx.getId(), size: hex.length / 2, fee: 0, hex: hex.toLowerCase(), coinbase: false, data: null, shielded: null, peg: null,
      ins: tx.ins.map(i => (i.index === 0xffffffff && i.hash.every(x => x === 0) ? { coinbase: i.script.toString('hex'), prevout: null }
        : { txid: Buffer.from(i.hash).reverse().toString('hex'), vout: i.index, prevout: null })),
      outs: tx.outs.map(o => {
        const s = o.script.toString('hex');
        const address = addressOfScript(s);
        return {
          value: o.value, content: null, memo: null,
          script: address ? scriptOf(address) : { asm: s.startsWith('6a') ? 'OP_RETURN' : '', hex: s, type: s.startsWith('6a') ? 'nulldata' : 'nonstandard' },
        };
      }),
    };
    const { hex: _, ...j } = renderTx(t, { fee: false, prevout: false, hex: false });
    return j;
  }
}
