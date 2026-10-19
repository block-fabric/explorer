import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import config from '../../../config';
import logger from '../../../logger';
import { ChainModuleContext } from '../../module';
import { PROFILE } from '../../profile';
import { Reader, findMarkers } from '../../marker';

/**
 * The BitAssets token ledger (BitAssets, and Layers which runs the same asset rules on FastBlocks' chain).
 *
 * The node keeps which output carries which tokens to itself: no RPC tells the holders of an asset, the LP shares of
 * a pool, or what a swap paid out. This replays every block's BAST markers with the consensus rules
 * (bitassets/src/bitassets/state.cpp MakePlan/ApplyTx, amm.h; Layers' end-of-block DEX clearing, dex.cpp) to keep:
 *   tokens     outpoint -> { kind, id, amount, holder }  (assets, control coins, reservations, LP shares, receipts)
 *   pools      reserves, shares, volumes, swaps, with a point per block that changed them (price history)
 *   auctions   remaining, proceeds, bids
 *   events     every operation with the real amounts in and out
 * and checks itself against the node after every sync (listpools / listauctions): `verify` reports any difference.
 *
 * Amounts are integers in the asset's units (BigInt; CHN in sats). Ids are shown as the node's RPCs show them
 * (byte-reversed hex); the CHN asset id is 64 zeros.
 */

export const CHN = '0'.repeat(64);
const TAG = '42415354';
const MAX = (1n << 63n) - 1n;
const MIN_LIQUIDITY = 1000n;
const MIN_CHN_PAYOUT = 50000n;
const UNDO_DEPTH = 100;
const CACHE_VERSION = 5; // 5: logos and display names (marker kinds 32-35)

export const TOKEN_KINDS = ['asset', 'control', 'reservation', 'lp', 'receipt'];
export const OP_KINDS: Record<number, string> = {
  0: 'transfer', 1: 'reserve', 2: 'register', 3: 'mint', 4: 'update', 5: 'burn', 6: 'swap', 7: 'add-liquidity',
  8: 'remove-liquidity', 9: 'create-auction', 10: 'bid', 11: 'collect', 12: 'release', 13: 'route',
  14: 'register-oracle', 15: 'attest', 16: 'create-oracle-contract', 17: 'settle-oracle-contract',
  32: 'set-logo', 33: 'register', 34: 'set-display-name', 35: 'register',
};

export interface Token { k: number; id: string; a: bigint; s: string | null; h: number }
export interface Pool { id: string; a0: string; a1: string; r0: bigint; r1: bigint; sh: bigint; v0: bigint; v1: bigint; sw: number; created: number; ct: string }
export interface Auction { id: string; base: string; quote: string; amt: bigint; sp: bigint; ep: bigint; start: number; dur: number; rem: bigint; proc: bigint; bids: number; closed: boolean; created: number }
export interface Contract { id: string; asset: string; amount: bigint }
export interface LedgerEvent {
  h: number; t: number; tx: string; kind: string; actor: string | null;
  assets: string[];                 // every asset the event concerns (CHN included)
  pool?: string; auction?: string;
  amounts: Record<string, string>;  // raw integer amounts: in, out, a, b, shares, paid, bought, back, ...
  ids: Record<string, string>;      // asset ids by role: in, out, a, b, base, quote, asset
  note?: string;
}

interface OutSpec { n: number; k: number; id: string | null; a: bigint }
interface Marker { kind: number; op: any; outputs: OutSpec[] }
interface Order { txid: string; path: string[]; amountIn: bigint; minOut: bigint; resultN: number | null; actor: string | null; holder: string | null; h: number; t: number }

// --- marker parsing -------------------------------------------------------------------------------

function varint(r: Reader): bigint {
  let n = 0n;
  for (;;) {
    const b = r.u8();
    n = (n << 7n) | BigInt(b & 0x7f);
    if (b & 0x80) { n++; } else { return n; }
  }
}
const id32 = (r: Reader) => r.hash();
const script = (r: Reader) => r.varBytes().toString('hex');
const opt = <T>(r: Reader, f: () => T): T | null => (r.bool() ? f() : null);
const upd = (r: Reader, f: () => void) => { if (r.u8() === 2) { f(); } };

export function parseMarker(payload: Buffer): Marker {
  const r = new Reader(payload);
  r.u8(); // version 0
  const kind = r.u8();
  const op: any = {};
  switch (kind) {
    case 1: op.commitment = r.hex(32); break;
    case 2:
    case 33:   // a registration with a logo: the registration, then the logo (bitassets/src/bitassets/state.cpp)
    case 35: { // ... with a display name: the registration, the logo (empty if none), then the display name
      op.asset = id32(r); r.bytes(32); op.supply = varint(r); op.decimals = r.u8();
      opt(r, () => r.bytes(32)); opt(r, () => r.bytes(6)); opt(r, () => r.bytes(18)); opt(r, () => r.bytes(33)); opt(r, () => r.bytes(32));
      op.info = opt(r, () => r.string());
      op.name = opt(r, () => r.string());
      if (kind === 33 || kind === 35) { op.logoBytes = r.varBytes().length; }
      if (kind === 35) { op.displayName = r.string(); }
      break;
    }
    case 32: op.asset = id32(r); op.logoBytes = r.varBytes().length; break;
    case 34: op.asset = id32(r); op.displayName = r.string(); break;
    case 3: op.asset = id32(r); op.amount = varint(r); break;
    case 4: op.asset = id32(r); upd(r, () => r.bytes(32)); upd(r, () => r.bytes(6)); upd(r, () => r.bytes(18)); upd(r, () => r.bytes(33)); upd(r, () => r.bytes(32)); upd(r, () => r.string()); break;
    case 5: op.tokens = r.vector(() => ({ k: r.u8(), id: id32(r), a: varint(r) })); break;
    case 6: op.in = id32(r); op.amountIn = varint(r); op.out = id32(r); op.minOut = varint(r); op.chnTo = script(r); break;
    case 7: op.a = id32(r); op.b = id32(r); op.amountA = varint(r); op.amountB = varint(r); op.minShares = varint(r); break;
    case 8: op.a = id32(r); op.b = id32(r); op.shares = varint(r); op.minA = varint(r); op.minB = varint(r); op.chnTo = script(r); break;
    case 9: op.base = id32(r); op.amount = varint(r); op.quote = id32(r); op.sp = varint(r); op.ep = varint(r); op.start = r.i32(); op.dur = r.i32(); break;
    case 10: op.auction = id32(r); op.quoteAmount = varint(r); op.minBase = varint(r); op.chnTo = script(r); break;
    case 11: op.auction = id32(r); op.chnTo = script(r); break;
    case 12: op.asset = id32(r); break;
    case 13: op.path = r.vector(() => id32(r)); op.amountIn = varint(r); op.minOut = varint(r); op.chnTo = script(r); break;
    case 14: op.name = r.string(); op.oracle = r.hex(32); r.bytes(64); break;
    case 15: op.oracle = r.hex(32); op.event = r.hex(32); op.value = r.i64(); op.height = r.i32(); r.bytes(64); break;
    case 16: op.oracle = r.hex(32); op.event = r.hex(32); op.asset = id32(r); op.amount = varint(r);
      op.outcomes = r.vector(() => ({ lo: r.i64(), hi: r.i64(), script: script(r) })); op.refund = script(r); op.expiry = r.i32(); break;
    case 17: op.contract = id32(r); break;
  }
  const outputs = r.vector(() => {
    const n = Number(varint(r));
    const k = r.u8();
    if (k === 0xff) { return { n, k, id: null, a: 0n }; }
    const id = id32(r);
    const a = (k === 0 || k === 3) ? varint(r) : 1n;
    return { n, k, id, a };
  });
  return { kind, op, outputs };
}

// --- maths (consensus) ----------------------------------------------------------------------------

const isChn = (id: string) => id === CHN;
const min = (a: bigint, b: bigint) => (a < b ? a : b);
const raw = (id: string) => Buffer.from(id, 'hex').reverse();

export function poolId(a: string, b: string): { id: string; a0: string; a1: string } {
  const ra = raw(a), rb = raw(b);
  const [lo, hi, a0, a1] = Buffer.compare(ra, rb) <= 0 ? [ra, rb, a, b] : [rb, ra, b, a];
  const h = createHash('sha256').update(Buffer.concat([Buffer.from([14]), Buffer.from('BitAssets pool'), lo, hi])).digest();
  return { id: Buffer.from(h).reverse().toString('hex'), a0, a1 };
}

function isqrt(n: bigint): bigint {
  if (n < 2n) { return n; }
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  while (x * x > n) { x--; }
  while ((x + 1n) * (x + 1n) <= n) { x++; }
  return x;
}

function priceAt(a: Auction, h: number): bigint {
  const end = a.start + a.dur - 1;
  if (a.dur <= 1 || h <= a.start) { return a.sp; }
  if (h >= end) { return a.ep; }
  return a.sp - (a.sp - a.ep) * BigInt(h - a.start) / BigInt(a.dur - 1);
}
export function auctionPriceAt(a: Auction, h: number): bigint { return priceAt(a, h); }

/** Layers' batch clearing of one pool (layers/src/bitassets/dex.cpp ClearPool): outputs per order, new reserves */
function clearPool(r0: bigint, r1: bigint, ins: { side: 0 | 1; a: bigint }[]): { outs: bigint[]; r0: bigint; r1: bigint } | null {
  if (r0 <= 0n || r1 <= 0n) { return null; }
  let in0 = 0n, in1 = 0n;
  for (const o of ins) { if (o.side === 0) { in0 += o.a; } else { in1 += o.a; } }
  if (in0 > MAX || in1 > MAX) { return null; }
  const num = r1 * 1000n + in1 * 997n;
  const den = r0 * 1000n + in0 * 997n;
  let out0 = 0n, out1 = 0n;
  const outs = ins.map(o => {
    if (o.side === 0) { const x = o.a * 997n * num / (den * 1000n); out1 += x; return x; }
    const x = o.a * 997n * den / (num * 1000n); out0 += x; return x;
  });
  if (out0 >= r0 + in0 || out1 >= r1 + in1) { return null; }
  const nr0 = r0 + in0 - out0, nr1 = r1 + in1 - out1;
  if (nr0 > MAX || nr1 > MAX || nr0 <= 0n || nr1 <= 0n) { return null; }
  return { outs, r0: nr0, r1: nr1 };
}

// --- the ledger -----------------------------------------------------------------------------------

type UndoOp = ['out', string] | ['tok', string, Token | undefined] | ['pool', string, Pool | undefined] | ['auc', string, Auction | undefined] | ['con', string, Contract | undefined];

const reviver = (_k: string, v: any) => (typeof v === 'string' && /^-?\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v);
const replacer = (_k: string, v: any) => (typeof v === 'bigint' ? v.toString() + 'n' : v);

export class BitassetsLedger {
  tokens = new Map<string, Token>();
  /** what every output was created with, spent or not: txid -> vout -> [kind, id, amount] (token transfers on tx pages) */
  outs = new Map<string, Record<number, [number, string, bigint]>>();
  pools = new Map<string, Pool>();
  auctions = new Map<string, Auction>();
  contracts = new Map<string, Contract>();
  events: LedgerEvent[] = [];
  series = new Map<string, [number, number, bigint, bigint, bigint][]>(); // pool -> [height, time, r0, r1, shares]
  hashes: string[] = [];
  verify: { at: number; ok: boolean; pools: number; auctions: number; issues: string[] } | null = null;
  dexHeight: number | null = null;

  private undo = new Map<number, { ops: UndoOp[]; events: number; series: string[] }>();
  private cur: { ops: UndoOp[]; touchedPools: Set<string>; seen: Set<string> } | null = null;
  private ctx!: ChainModuleContext;
  private genesis = '';
  private running = false;
  private again = false;
  private ready = false;
  private lastSave = 0;

  isReady(): boolean { return this.ready; }
  get height(): number { return this.hashes.length - 1; }

  start(ctx: ChainModuleContext): void {
    this.ctx = ctx;
    this.load();
    void this.run();
    setInterval(() => void this.run(), 10000);
  }

  onNewBlock(): void { if (this.ctx) { void this.run(); } }

  // --- persistence

  private file(): string {
    return path.join(config.MEMPOOL.CACHE_DIR, 'chain', `bitassets-ledger-${PROFILE.id}-${config.CHAIN.NETWORK}.json`);
  }

  private load(): void {
    try {
      const d = JSON.parse(fs.readFileSync(this.file(), 'utf8'), reviver);
      if (d.version !== CACHE_VERSION) { return; }
      this.genesis = d.genesis; this.hashes = d.hashes; this.events = d.events;
      this.tokens = new Map(d.tokens); this.pools = new Map(d.pools); this.auctions = new Map(d.auctions);
      this.contracts = new Map(d.contracts); this.series = new Map(d.series); this.outs = new Map(d.outs);
      logger.info(`BitAssets ledger: ${this.tokens.size} token outputs, ${this.pools.size} pools up to block ${this.height} from the cache`);
    } catch (e) { /* none yet */ }
  }

  private save(force = false): void {
    if (!force && Date.now() - this.lastSave < 60000) { return; }
    this.lastSave = Date.now();
    try {
      fs.mkdirSync(path.dirname(this.file()), { recursive: true });
      const tmp = this.file() + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({
        version: CACHE_VERSION, genesis: this.genesis, hashes: this.hashes, events: this.events,
        tokens: [...this.tokens], pools: [...this.pools], auctions: [...this.auctions], contracts: [...this.contracts], series: [...this.series], outs: [...this.outs],
      }, replacer));
      fs.renameSync(tmp, this.file());
    } catch (e) {
      logger.warn(`BitAssets ledger: cannot save: ${e instanceof Error ? e.message : e}`);
    }
  }

  private reset(): void {
    this.tokens.clear(); this.outs.clear(); this.pools.clear(); this.auctions.clear(); this.contracts.clear();
    this.events = []; this.series.clear(); this.hashes = []; this.undo.clear();
  }

  // --- state changes, recorded for undo

  private setTok(key: string, t: Token | undefined): void {
    this.cur!.ops.push(['tok', key, this.tokens.get(key)]);
    if (t) {
      this.tokens.set(key, t);
      const [txid, n] = key.split(':');
      if (!this.outs.has(txid)) { this.outs.set(txid, {}); }
      this.outs.get(txid)![Number(n)] = [t.k, t.id, t.a];
      this.cur!.ops.push(['out', key]);
    } else {
      this.tokens.delete(key);
    }
  }

  private touch<T>(kind: 'pool' | 'auc' | 'con', map: Map<string, T>, id: string): void {
    const k = kind + ':' + id;
    if (this.cur!.seen.has(k)) { return; }
    this.cur!.seen.add(k);
    const v = map.get(id);
    this.cur!.ops.push([kind, id, v ? { ...(v as any) } : undefined] as UndoOp);
    if (kind === 'pool') { this.cur!.touchedPools.add(id); }
  }

  private pool(id: string): Pool {
    this.touch('pool', this.pools, id);
    const p = this.pools.get(id);
    if (!p) { throw new Error(`unknown pool ${id}`); }
    return p;
  }

  private undoBlock(height: number): void {
    const u = this.undo.get(height);
    if (!u) { return; }
    for (const op of u.ops.reverse()) {
      if (op[0] === 'out') {
        const [txid, n] = op[1].split(':');
        const o = this.outs.get(txid);
        if (o) { delete o[Number(n)]; if (!Object.keys(o).length) { this.outs.delete(txid); } }
        continue;
      }
      const map: Map<string, any> = op[0] === 'tok' ? this.tokens : op[0] === 'pool' ? this.pools : op[0] === 'auc' ? this.auctions : this.contracts;
      if (op[2] === undefined) { map.delete(op[1]); } else { map.set(op[1], op[2] as any); }
    }
    this.events.length = u.events;
    for (const id of u.series) { this.series.get(id)?.pop(); }
    this.undo.delete(height);
    this.hashes.pop();
  }

  // --- sync

  private async run(): Promise<void> {
    if (this.running) { this.again = true; return; }
    this.running = true;
    try {
      do { this.again = false; await this.sync(); } while (this.again);
      if (!this.ready) { logger.info(`BitAssets ledger: ready at block ${this.height}`); }
      this.ready = true;
      await this.check();
    } catch (e) {
      logger.warn(`BitAssets ledger: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.running = false;
    }
  }

  private async sync(): Promise<void> {
    const node = this.ctx.node;
    if (this.dexHeight === null) {
      const info = await node.call('getbitassetsinfo');
      this.dexHeight = typeof info?.dex_height === 'number' && info.dex_height >= 0 ? info.dex_height : Infinity;
    }
    const genesis: string = await node.call('getblockhash', 0);
    if (this.genesis && this.genesis !== genesis) { logger.notice('BitAssets ledger: new chain, indexing again'); this.reset(); }
    this.genesis = genesis;
    const tip: number = await node.call('getblockcount');
    while (this.hashes.length) {
      const h = this.hashes.length - 1;
      if (h <= tip && this.hashes[h] === await node.call('getblockhash', h)) { break; }
      if (!this.undo.has(h)) { logger.notice(`BitAssets ledger: reorg below the undo depth at ${h}, indexing again`); this.reset(); break; }
      this.undoBlock(h);
    }
    const start = this.hashes.length;
    if (start > tip) { return; }
    if (tip - start > 20) { logger.info(`BitAssets ledger: blocks ${start} to ${tip}`); }
    for (let h = start; h <= tip; h += 8) {
      const heights = Array.from({ length: Math.min(8, tip - h + 1) }, (_, i) => h + i);
      const blocks = await Promise.all(heights.map(async x => node.call('getblock', await node.call('getblockhash', x), 3)));
      for (const b of blocks) {
        if (b.height !== this.hashes.length || (b.height > 0 && b.previousblockhash !== this.hashes[b.height - 1])) { return; }
        this.applyBlock(b);
      }
      this.save();
    }
    this.save(true);
  }

  private applyBlock(block: any): void {
    this.cur = { ops: [], touchedPools: new Set(), seen: new Set() };
    const eventsBefore = this.events.length;
    const orders: Order[] = [];
    for (const tx of block.tx.slice(1)) {
      try {
        this.applyTx(tx, block.height, block.time, orders);
      } catch (e) {
        logger.warn(`BitAssets ledger: tx ${tx.txid} at ${block.height}: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (orders.length) { this.clearOrders(orders, block.height, block.time); }
    const seriesTouched: string[] = [];
    for (const id of this.cur.touchedPools) {
      const p = this.pools.get(id);
      if (!p) { continue; }
      if (!this.series.has(id)) { this.series.set(id, []); }
      this.series.get(id)!.push([block.height, block.time, p.r0, p.r1, p.sh]);
      seriesTouched.push(id);
    }
    this.undo.set(block.height, { ops: this.cur.ops, events: eventsBefore, series: seriesTouched });
    this.undo.delete(block.height - UNDO_DEPTH);
    this.hashes.push(block.hash);
    this.cur = null;
  }

  private applyTx(tx: any, h: number, t: number, orders: Order[]): void {
    const addr = (n: number): string | null => tx.vout[n]?.scriptPubKey?.address ?? null;
    const spent: [string, Token][] = [];
    for (const v of tx.vin) {
      if (v.coinbase) { continue; }
      const key = `${v.txid}:${v.vout}`;
      const tok = this.tokens.get(key);
      if (tok) { spent.push([key, tok]); }
    }
    const m = findMarkers(tx, TAG)[0];
    if (!m && !spent.length) { return; }
    for (const [key] of spent) { this.setTok(key, undefined); }
    if (!m) { return; }
    const { kind, op, outputs } = parseMarker(m.payload);
    const actor = tx.vin[0]?.prevout?.scriptPubKey?.address ?? null;
    for (const o of outputs) {
      if (o.k === 0xff) { continue; }
      const id = o.id === CHN && (o.k === 2 || o.k === 4) ? tx.txid : o.id!;
      this.setTok(`${tx.txid}:${o.n}`, { k: o.k, id, a: o.a, s: addr(o.n), h });
    }
    const results = outputs.filter(o => o.k === 0xff).map(o => o.n);
    const put = (slot: number, tok: { k: number; id: string; a: bigint } | null) => {
      const n = results[slot];
      if (tok && n !== undefined && tok.a > 0n) { this.setTok(`${tx.txid}:${n}`, { ...tok, s: addr(n), h }); }
    };
    const ev = (e: Partial<LedgerEvent>) => {
      const ids = e.ids ?? {};
      this.events.push({ h, t, tx: tx.txid, kind: OP_KINDS[kind] ?? `kind ${kind}`, actor, assets: [...new Set(Object.values(ids))], amounts: {}, ...e, ids } as LedgerEvent);
    };
    const s = (x: bigint) => x.toString();

    switch (kind) {
      case 0: {
        const moved = new Set(outputs.filter(o => o.k === 0).map(o => o.id!));
        if (moved.size) { ev({ ids: Object.fromEntries([...moved].map((id, i) => [i ? `asset${i}` : 'asset', id])), note: `${outputs.length} outputs` }); }
        break;
      }
      case 1: ev({}); break;
      case 2:
      case 33:
      case 35: ev({ ids: { asset: op.asset }, amounts: { supply: s(op.supply) }, note: op.displayName ?? op.name ?? undefined }); break;
      case 32: ev({ ids: { asset: op.asset }, note: op.logoBytes ? `${op.logoBytes} bytes` : 'removed' }); break;
      case 34: ev({ ids: { asset: op.asset }, note: op.displayName }); break;
      case 3: ev({ ids: { asset: op.asset }, amounts: { amount: s(op.amount) } }); break;
      case 4: ev({ ids: { asset: op.asset } }); break;
      case 5: {
        const ids: Record<string, string> = {}, amounts: Record<string, string> = {};
        op.tokens.forEach((x: any, i: number) => { if (x.k === 0) { ids[i ? `asset${i}` : 'asset'] = x.id; amounts[i ? `amount${i}` : 'amount'] = s(x.a); } });
        ev({ ids, amounts, note: op.tokens.map((x: any) => TOKEN_KINDS[x.k]).join(', ') });
        break;
      }
      case 6:
      case 13: {
        const pathIds: string[] = kind === 6 ? [op.in, op.out] : op.path;
        if (h >= (this.dexHeight ?? Infinity)) {
          orders.push({ txid: tx.txid, path: pathIds, amountIn: op.amountIn, minOut: op.minOut, resultN: results[0] ?? null, actor, holder: results[0] !== undefined ? addr(results[0]) : null, h, t });
          break;
        }
        // before Layers' DEX: an immediate trade in one pool
        const pid = poolId(op.in, op.out);
        const p = this.pool(pid.id);
        const inIs0 = p.a0 === op.in;
        const rin = inIs0 ? p.r0 : p.r1, rout = inIs0 ? p.r1 : p.r0;
        const out = op.amountIn * 997n * rout / (rin * 1000n + op.amountIn * 997n);
        if (inIs0) { p.r0 += op.amountIn; p.r1 -= out; p.v0 = min(p.v0 + op.amountIn, MAX); } else { p.r1 += op.amountIn; p.r0 -= out; p.v1 = min(p.v1 + op.amountIn, MAX); }
        p.sw++;
        if (!isChn(op.out)) { put(0, { k: 0, id: op.out, a: out }); }
        ev({ pool: pid.id, ids: { in: op.in, out: op.out }, amounts: { in: s(op.amountIn), out: s(out), minOut: s(op.minOut) } });
        break;
      }
      case 7: {
        const pid = poolId(op.a, op.b);
        if (!this.pools.has(pid.id)) {
          this.touch('pool', this.pools, pid.id);
          this.pools.set(pid.id, { id: pid.id, a0: pid.a0, a1: pid.a1, r0: 0n, r1: 0n, sh: 0n, v0: 0n, v1: 0n, sw: 0, created: h, ct: tx.txid });
        }
        const p = this.pool(pid.id);
        const aIs0 = p.a0 === op.a;
        const amount0: bigint = aIs0 ? op.amountA : op.amountB, amount1: bigint = aIs0 ? op.amountB : op.amountA;
        let shares: bigint, take0 = amount0, take1 = amount1;
        if (p.sh <= MIN_LIQUIDITY) {
          shares = isqrt((p.r0 + amount0) * (p.r1 + amount1)) - MIN_LIQUIDITY;
          p.sh = shares + MIN_LIQUIDITY;
        } else {
          const s0 = amount0 * p.sh / p.r0, s1 = amount1 * p.sh / p.r1;
          shares = min(s0, s1);
          if (s0 <= s1) { take1 = (shares * p.r1 + p.sh - 1n) / p.sh; } else { take0 = (shares * p.r0 + p.sh - 1n) / p.sh; }
          if (isChn(p.a0) && amount0 - take0 < MIN_CHN_PAYOUT) { take0 = amount0; }
          if (isChn(p.a1) && amount1 - take1 < MIN_CHN_PAYOUT) { take1 = amount1; }
          p.sh += shares;
        }
        p.r0 += take0; p.r1 += take1;
        const back0 = amount0 - take0, back1 = amount1 - take1;
        put(0, { k: 3, id: p.id, a: shares });
        const backAsset = back0 > 0n ? p.a0 : back1 > 0n ? p.a1 : null;
        const back = back0 > 0n ? back0 : back1;
        if (backAsset && !isChn(backAsset)) { put(1, { k: 0, id: backAsset, a: back }); }
        ev({ pool: p.id, ids: { a: p.a0, b: p.a1 }, amounts: { a: s(take0), b: s(take1), shares: s(shares), ...(back > 0n ? { back: s(back) } : {}) }, note: backAsset ? `back:${backAsset}` : undefined });
        break;
      }
      case 8: {
        const pid = poolId(op.a, op.b);
        const p = this.pool(pid.id);
        let out0 = p.r0 * op.shares / p.sh, out1 = p.r1 * op.shares / p.sh;
        if (isChn(p.a0) && out0 < MIN_CHN_PAYOUT) { out0 = 0n; }
        if (isChn(p.a1) && out1 < MIN_CHN_PAYOUT) { out1 = 0n; }
        p.r0 -= out0; p.r1 -= out1; p.sh -= op.shares;
        const aIs0 = p.a0 === op.a;
        const pairs: [string, bigint][] = aIs0 ? [[p.a0, out0], [p.a1, out1]] : [[p.a1, out1], [p.a0, out0]];
        let slot = 0;
        for (const [id, x] of pairs) {
          if (x > 0n && !isChn(id)) { put(slot++, { k: 0, id, a: x }); }
        }
        ev({ pool: p.id, ids: { a: p.a0, b: p.a1 }, amounts: { a: s(out0), b: s(out1), shares: s(op.shares) } });
        break;
      }
      case 9: {
        this.touch('auc', this.auctions, tx.txid);
        this.auctions.set(tx.txid, { id: tx.txid, base: op.base, quote: op.quote, amt: op.amount, sp: op.sp, ep: op.ep, start: op.start, dur: op.dur, rem: op.amount, proc: 0n, bids: 0, closed: false, created: h });
        ev({ auction: tx.txid, ids: { base: op.base, quote: op.quote }, amounts: { amount: s(op.amount), startPrice: s(op.sp), endPrice: s(op.ep) }, note: `blocks ${op.start}-${op.start + op.dur - 1}` });
        break;
      }
      case 10: {
        this.touch('auc', this.auctions, op.auction);
        const a = this.auctions.get(op.auction);
        if (!a) { throw new Error('unknown auction'); }
        const price = priceAt(a, h);
        let bought = min(MAX, op.quoteAmount * a.amt / price);
        const boughtOutputs = isChn(a.base) ? 0 : 1;
        const backOutput = !isChn(a.quote) && results.length === boughtOutputs + 1;
        const givesBack = isChn(a.quote) ? op.chnTo.length > 0 : backOutput;
        let paid: bigint = op.quoteAmount, back = 0n;
        if (bought > a.rem && a.rem > 0n && givesBack) {
          paid = min(MAX, (a.rem * price + a.amt - 1n) / a.amt);
          bought = a.rem; back = op.quoteAmount - paid;
          if (isChn(a.quote) && back < MIN_CHN_PAYOUT) { paid += back; back = 0n; }
        }
        a.rem -= bought; a.proc += paid; a.bids++;
        let slot = 0;
        if (!isChn(a.base)) { put(slot++, { k: 0, id: a.base, a: bought }); }
        if (backOutput) { put(slot++, back > 0n ? { k: 0, id: a.quote, a: back } : null); }
        ev({ auction: a.id, ids: { base: a.base, quote: a.quote }, amounts: { paid: s(paid), bought: s(bought), price: s(price), ...(back > 0n ? { back: s(back) } : {}) } });
        break;
      }
      case 11: {
        this.touch('auc', this.auctions, op.auction);
        const a = this.auctions.get(op.auction);
        if (!a) { throw new Error('unknown auction'); }
        let slot = 0;
        for (const [id, x] of [[a.base, a.rem], [a.quote, a.proc]] as [string, bigint][]) {
          if (x > 0n && !isChn(id)) { put(slot++, { k: 0, id, a: x }); }
        }
        ev({ auction: a.id, ids: { base: a.base, quote: a.quote }, amounts: { remaining: s(a.rem), proceeds: s(a.proc) } });
        a.rem = 0n; a.proc = 0n; a.closed = true;
        break;
      }
      case 12: {
        for (const p of [...this.pools.values()]) {
          if (p.a0 === op.asset || p.a1 === op.asset) { this.touch('pool', this.pools, p.id); this.pools.delete(p.id); }
        }
        ev({ ids: { asset: op.asset } });
        break;
      }
      case 14: ev({ note: op.name }); break;
      case 15: ev({ note: `oracle ${op.oracle.slice(0, 8)} value ${op.value}` }); break;
      case 16: {
        this.touch('con', this.contracts, tx.txid);
        this.contracts.set(tx.txid, { id: tx.txid, asset: op.asset, amount: op.amount });
        ev({ ids: { asset: op.asset }, amounts: { amount: s(op.amount) }, note: `${op.outcomes.length} outcomes` });
        break;
      }
      case 17: {
        const c = this.contracts.get(op.contract);
        if (c && !isChn(c.asset)) { put(0, { k: 0, id: c.asset, a: c.amount }); }
        if (c) { this.touch('con', this.contracts, c.id); this.contracts.delete(c.id); }
        ev({ ids: c ? { asset: c.asset } : {}, amounts: c ? { amount: s(c.amount) } : {} });
        break;
      }
    }
  }

  /** Layers' end-of-block clearing of the swap and route orders (layers/src/bitassets/state.cpp ClearOrders) */
  private clearOrders(orders: Order[], h: number, t: number): void {
    const involved = new Set<string>();
    for (const o of orders) { for (let k = 0; k + 1 < o.path.length; k++) { involved.add(poolId(o.path[k], o.path[k + 1]).id); } }
    const base = new Map<string, Pool>();
    for (const id of involved) { const p = this.pools.get(id); if (p) { base.set(id, { ...p }); } }

    const attempt = (active: Order[], start: Map<string, Pool>): { pools: Map<string, Pool>; outs: Map<Order, bigint>; missed: Set<Order>; hops: [string, 0 | 1, bigint][] } => {
      const pools = new Map([...start].map(([k, v]) => [k, { ...v }]));
      const cur = new Map<Order, bigint>(active.map(o => [o, o.amountIn]));
      const missed = new Set<Order>();
      const hops: [string, 0 | 1, bigint][] = [];
      for (let k = 0; k < 4; k++) {
        const byPool = new Map<string, { o: Order; side: 0 | 1 }[]>();
        for (const o of active) {
          if (missed.has(o) || o.path.length <= k + 1) { continue; }
          const pid = poolId(o.path[k], o.path[k + 1]).id;
          const p = pools.get(pid);
          if (!p) { missed.add(o); continue; }
          const side: 0 | 1 = p.a0 === o.path[k] ? 0 : 1;
          if (!byPool.has(pid)) { byPool.set(pid, []); }
          byPool.get(pid)!.push({ o, side });
        }
        for (const [pid, list] of byPool) {
          const p = pools.get(pid)!;
          const res = clearPool(p.r0, p.r1, list.map(x => ({ side: x.side, a: cur.get(x.o)! })));
          if (!res) { list.forEach(x => missed.add(x.o)); continue; }
          list.forEach((x, i) => {
            hops.push([pid, x.side, cur.get(x.o)!]);
            if (res.outs[i] <= 0n) { missed.add(x.o); }
            cur.set(x.o, res.outs[i]);
          });
          p.r0 = res.r0; p.r1 = res.r1;
        }
      }
      for (const o of active) {
        if (missed.has(o)) { continue; }
        const out = cur.get(o)!;
        if (out < o.minOut || (isChn(o.path[o.path.length - 1]) && out < MIN_CHN_PAYOUT)) { missed.add(o); }
      }
      return { pools, outs: cur, missed, hops };
    };

    const commit = (r: ReturnType<typeof attempt>, filled: Order[]) => {
      for (const [id, p] of r.pools) {
        const live = this.pool(id);
        live.r0 = p.r0; live.r1 = p.r1;
      }
      for (const [pid, side, x] of r.hops) {
        const p = this.pool(pid);
        if (side === 0) { p.v0 = min(p.v0 + x, MAX); } else { p.v1 = min(p.v1 + x, MAX); }
        p.sw++;
      }
      for (const o of filled) { this.orderResult(o, r.outs.get(o)!, true, h, t); }
    };

    let active = orders.slice();
    for (let pass = 0; pass < 8; pass++) {
      const r = attempt(active, base);
      if (!r.missed.size) {
        commit(r, active);
        orders.filter(o => !active.includes(o)).forEach(o => this.orderResult(o, o.amountIn, false, h, t));
        return;
      }
      active = active.filter(o => !r.missed.has(o));
      if (!active.length) { break; }
    }
    // fallback: each order alone, in block order, against the running pools
    let running = new Map([...base].map(([k, v]) => [k, { ...v }]));
    for (const o of orders) {
      const r = attempt([o], running);
      if (!r.missed.size) {
        commit(r, [o]);
        running = new Map([...r.pools].map(([k, v]) => [k, { ...v }]));
        for (const [k, v] of this.pools) { if (running.has(k)) { running.set(k, { ...v }); } }
      } else {
        this.orderResult(o, o.amountIn, false, h, t);
      }
    }
  }

  private orderResult(o: Order, amount: bigint, filled: boolean, h: number, t: number): void {
    const asset = filled ? o.path[o.path.length - 1] : o.path[0];
    if (o.resultN !== null && !isChn(asset) && amount > 0n) {
      this.setTok(`${o.txid}:${o.resultN}`, { k: 0, id: asset, a: amount, s: o.holder, h });
    }
    const first = poolId(o.path[0], o.path[1]).id;
    this.events.push({
      h, t, tx: o.txid, kind: o.path.length > 2 ? 'route' : 'swap', actor: o.actor, pool: first,
      assets: [...new Set(o.path)], ids: { in: o.path[0], out: o.path[o.path.length - 1] },
      amounts: filled ? { in: o.amountIn.toString(), out: amount.toString(), minOut: o.minOut.toString() } : { in: o.amountIn.toString(), refunded: amount.toString() },
      note: filled ? (o.path.length > 2 ? `via ${o.path.length - 1} pools` : 'batch cleared') : 'not filled: refunded',
    });
  }

  // --- self check against the node

  private async check(): Promise<void> {
    if (this.verify && this.verify.at === this.height) { return; }
    const node = this.ctx.node;
    const issues: string[] = [];
    const assets = await this.assetMeta();
    const dec = (id: string) => (isChn(id) ? 8 : assets.get(id)?.decimals ?? 0);
    const close = (ours: bigint, theirs: number, d: number) => Math.abs(Number(ours) / 10 ** d - Number(theirs)) <= 10 ** -d;
    let nodePools: any[] = [];
    for (let skip = 0; ; skip += 1000) {
      const page = await node.call('listpools', '', 1000, skip).catch(() => node.call('listpools'));
      nodePools = nodePools.concat(page);
      if (page.length < 1000) { break; }
    }
    if (await node.call('getblockcount') !== this.height) { return; } // moved on: check next time
    for (const np of nodePools) {
      const p = this.pools.get(np.pool);
      if (!p) { issues.push(`pool ${np.pool.slice(0, 8)} (${np.asset_a}/${np.asset_b}) unknown to the ledger`); continue; }
      const aId = np.asset_a_id ?? CHN;
      const [ra, rb] = p.a0 === aId ? [p.r0, p.r1] : [p.r1, p.r0];
      if (!close(ra, np.reserve_a, dec(aId)) || !close(rb, np.reserve_b, dec(np.asset_b_id ?? CHN))) {
        issues.push(`pool ${np.asset_a}/${np.asset_b}: reserves ${ra}/${rb} vs node ${np.reserve_a}/${np.reserve_b}`);
      }
      if (BigInt(np.shares) !== p.sh) { issues.push(`pool ${np.asset_a}/${np.asset_b}: shares ${p.sh} vs node ${np.shares}`); }
      if (np.swaps !== p.sw) { issues.push(`pool ${np.asset_a}/${np.asset_b}: swaps ${p.sw} vs node ${np.swaps}`); }
    }
    if (nodePools.length !== this.pools.size) { issues.push(`${this.pools.size} pools in the ledger, ${nodePools.length} on the node`); }
    const nodeAuctions: any[] = await node.call('listauctions', true, 1000, 0).catch(() => []);
    for (const na of nodeAuctions) {
      const a = this.auctions.get(na.auction);
      if (!a) { issues.push(`auction ${na.auction.slice(0, 8)} unknown to the ledger`); continue; }
      if (na.bids !== a.bids || (na.status === 'closed') !== a.closed || !close(a.rem, na.remaining, dec(a.base))) {
        issues.push(`auction ${na.auction.slice(0, 8)}: bids ${a.bids}/${na.bids}, remaining ${a.rem}/${na.remaining}, closed ${a.closed}/${na.status}`);
      }
    }
    this.verify = { at: this.height, ok: !issues.length, pools: nodePools.length, auctions: nodeAuctions.length, issues: issues.slice(0, 50) };
    if (issues.length) {
      logger.warn(`BitAssets ledger: ${issues.length} difference(s) with the node at ${this.height}: ${issues.slice(0, 3).join('; ')}`);
    }
  }

  // --- asset metadata (names, decimals) from the node, refreshed per block

  private meta: { at: number; map: Map<string, any> } | null = null;

  async assetMeta(): Promise<Map<string, any>> {
    if (this.meta && this.meta.at === this.height) { return this.meta.map; }
    const map = new Map<string, any>();
    for (let skip = 0; ; skip += 100) {
      const page: any[] = await this.ctx.node.call('listassets', 100, skip);
      for (const a of page) { map.set(a.asset, a); }
      if (page.length < 100) { break; }
    }
    map.set(CHN, { asset: CHN, label: 'CHN', name: 'CHN', decimals: 8 });
    this.meta = { at: this.height, map };
    return map;
  }

  // --- queries

  /** balances per holder of a token (kind, id), largest first */
  holders(k: number, id: string): { address: string | null; amount: bigint; outputs: number }[] {
    const m = new Map<string | null, { amount: bigint; outputs: number }>();
    for (const t of this.tokens.values()) {
      if (t.k !== k || t.id !== id) { continue; }
      const e = m.get(t.s) ?? { amount: 0n, outputs: 0 };
      e.amount += t.a; e.outputs++;
      m.set(t.s, e);
    }
    return [...m].map(([address, e]) => ({ address, ...e })).sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
  }

  /** every token an address holds */
  balances(address: string): { k: number; id: string; amount: bigint; outputs: string[] }[] {
    const m = new Map<string, { k: number; id: string; amount: bigint; outputs: string[] }>();
    for (const [key, t] of this.tokens) {
      if (t.s !== address) { continue; }
      const k = `${t.k}:${t.id}`;
      const e = m.get(k) ?? { k: t.k, id: t.id, amount: 0n, outputs: [] };
      e.amount += t.a; e.outputs.push(key);
      m.set(k, e);
    }
    return [...m.values()];
  }

  /** the tokens the outputs of a transaction were created with (spent or not) */
  txTokens(txid: string): Record<number, [number, string, bigint]> {
    return this.outs.get(txid) ?? {};
  }

  query(filter: (e: LedgerEvent) => boolean, limit: number, before?: number): LedgerEvent[] {
    const out: LedgerEvent[] = [];
    for (let i = this.events.length - 1; i >= 0 && out.length < limit; i--) {
      const e = this.events[i];
      if (before !== undefined && e.h >= before) { continue; }
      if (filter(e)) { out.push(e); }
    }
    return out;
  }
}

let ledger: BitassetsLedger | null = null;
export function getLedger(): BitassetsLedger {
  if (!ledger) { ledger = new BitassetsLedger(); }
  return ledger;
}
