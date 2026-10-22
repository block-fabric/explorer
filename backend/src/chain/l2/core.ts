import * as bitcoinjs from 'bitcoinjs-lib';
import { createHash } from 'crypto';
import bs58 from 'bs58';
import { L2Index, OutRef, TxEntry } from './index';
import { decodeAddress, outPoint, valueOf } from './codec';
import { Content, OutPoint } from './types';

/**
 * The sidechain index (index.ts) as Bitcoin Core would show it: blocks, transactions and outputs in the shapes of
 * Core's JSON-RPC (getblock, getrawtransaction, gettxout...), for the Core JSON-RPC facade (facade.ts) that upstream
 * mempool's backend reads as its node (CHAIN.L2_ROLE 'full', chains/L2-API.md "Core facade").
 *
 * - txids, block hashes and merkle roots are the chain's own (hex, not reversed);
 * - every output gets a P2PKH-shaped script 76a914<the address's 20 bytes>88ac (type pubkeyhash, `address` the chain's
 *   base58), its sats as `value` (0 for non-sats content) and, for any content but sats, the contract's Content as
 *   `content` (a withdrawal also as `withdrawal: {main_address, value, main_fee}`, its value counting the main fee);
 * - inputs name the output they spend by (txid, n) of the transaction that made it here (the coinbase's for Coinshift's
 *   merkle-root outpoints), with `prevout` inline; a deposit's input carries `deposit: true`, Hivemind's market funds
 *   and payouts their `kind`;
 * - what moves coins without a transaction gets a synthetic one (`peg`), placed after the block's transactions as the
 *   nodes apply it: a deposit tx per eCash deposit (txid = the eCash deposit txid, its output at the eCash vout, the
 *   lower ones zero-value OP_RETURN padding, a coinbase-shaped input), a withdrawal tx per bundle (txid = the M6 id,
 *   spending the bundled withdrawal outputs into one OP_RETURN output of their value) and a state tx per block on
 *   Hivemind (what the chain's state made and consumed). Bundles show as the index has them now: a bundle that later
 *   failed gave its outputs back and has no tx;
 * - the block header is a synthetic 80-byte Bitcoin header (version 1, prev hash, merkle root, time, bits, nonce 0,
 *   hashes byte-reversed so that a decoder shows them as here), `time` the BMM eCash block's time kept
 *   non-decreasing, difficulty 1; raw blocks and transactions are Bitcoin serializations of the same inputs and
 *   outputs (a transaction with no inputs, as some BitNames and zSide ones are, does not decode as Bitcoin);
 * - size: the chain's own tx size where the node gives one, else the serialization's; weight = 4 × size; fees from the
 *   index (inputs − outputs, or the node's for Hivemind's market spends).
 */

export const BITS = '1d00ffff';
export const DIFFICULTY = 1;
const WORK = 0x100010001n;          // the work of a block at difficulty 1
const SEQUENCE = 0xffffffff;
const VERSION = 1;

export type Peg = 'deposit' | 'withdrawal' | 'state';

export interface CoreScript {
  asm: string;
  hex: string;
  address?: string;
  type: string;
}

export interface CoreOut {
  value: number;                  // sats
  script: CoreScript;
  content: Content | null;        // null: sats
  memo: string | null;
}

export interface CoreIn {
  coinbase?: string;              // hex: a coinbase-shaped input (the coinbase, a deposit's, an empty state tx's)
  txid?: string;
  vout?: number;
  prevout: { generated: boolean; height: number; out: CoreOut } | null;
  deposit?: boolean;
  kind?: 'marketFunds' | 'payout';
}

export interface CoreTx {
  txid: string;
  size: number;
  ins: CoreIn[];
  outs: CoreOut[];
  fee: number;                    // sats
  hex: string;
  coinbase: boolean;              // the block's coinbase
  data: any;
  shielded: any;
  peg: Peg | null;
  mainTxid?: string;              // peg deposit: the eCash deposit
  m6id?: string;                  // peg withdrawal: the bundle
}

export interface CoreBlock {
  height: number;
  hash: string;
  prev: string | null;
  merkleRoot: string;
  time: number;
  mediantime: number;
  header: string;                 // 80 bytes, hex
  size: number;
  txs: CoreTx[];
}

export const coins = (sats: number): number => sats / 1e8;
const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex');
const rev = (h: string): Buffer => Buffer.from(h, 'hex').reverse();

function pushData(b: Buffer): string {
  const n = b.length;
  const len = n < 0x4c ? Buffer.from([n]) : n <= 0xff ? Buffer.from([0x4c, n]) : Buffer.from([0x4d, n & 0xff, n >> 8]);
  return Buffer.concat([len, b]).toString('hex');
}

/** P2PKH-shaped: OP_DUP OP_HASH160 <20 bytes> OP_EQUALVERIFY OP_CHECKSIG, the chain's base58 as its address */
export function scriptOf(address: string): CoreScript {
  const b = decodeAddress(address);
  if (b) {
    const h = Buffer.from(b).toString('hex');
    return { asm: `OP_DUP OP_HASH160 ${h} OP_EQUALVERIFY OP_CHECKSIG`, hex: `76a914${h}88ac`, address, type: 'pubkeyhash' };
  }
  return nulldata(Buffer.from(String(address), 'utf8').subarray(0, 80));
}

export function nulldata(data: Buffer): CoreScript {
  return { asm: data.length ? `OP_RETURN ${data.toString('hex')}` : 'OP_RETURN', hex: '6a' + (data.length ? pushData(data) : ''), type: 'nulldata' };
}

/** The address of a P2PKH-shaped script (decoderawtransaction) */
export function addressOfScript(hex: string): string | null {
  const m = /^76a914([0-9a-f]{40})88ac$/.exec(hex);
  return m ? bs58.encode(Buffer.from(m[1], 'hex')) : null;
}

/** The coinbase input's script: the height (BIP34) */
function bip34(height: number): string {
  if (height === 0) {
    return '0000';
  }
  const bytes: number[] = [];
  let n = height;
  while (n > 0) {
    bytes.push(n & 0xff);
    n = Math.floor(n / 256);
  }
  if (bytes[bytes.length - 1] & 0x80) {
    bytes.push(0);
  }
  return Buffer.concat([Buffer.from([bytes.length]), Buffer.from(bytes)]).toString('hex') + '00';
}

/** A Bitcoin serialization of the inputs and outputs: version 1, no witness, locktime 0 */
export function serialize(ins: CoreIn[], outs: CoreOut[]): string {
  const tx = new bitcoinjs.Transaction();
  tx.version = VERSION;
  tx.locktime = 0;
  for (const i of ins) {
    if (i.coinbase !== undefined) {
      tx.addInput(Buffer.alloc(32), 0xffffffff, SEQUENCE, Buffer.from(i.coinbase, 'hex'));
    } else {
      tx.addInput(rev(i.txid as string), i.vout as number, SEQUENCE, Buffer.alloc(0));
    }
  }
  for (const o of outs) {
    tx.addOutput(Buffer.from(o.script.hex, 'hex'), o.value);
  }
  return tx.toHex();
}

function varint(n: number): Buffer {
  return n < 0xfd ? Buffer.from([n])
    : n <= 0xffff ? Buffer.from([0xfd, n & 0xff, n >> 8]) : Buffer.from([0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24]);
}

/** version 1 | prev | merkle root | time | bits | nonce 0 */
export function header(prev: string | null, merkleRoot: string, time: number): string {
  const b = Buffer.alloc(80);
  b.writeInt32LE(VERSION, 0);
  if (prev) {
    rev(prev).copy(b, 4);
  }
  rev(merkleRoot).copy(b, 36);
  b.writeUInt32LE(time >>> 0, 68);
  b.writeUInt32LE(parseInt(BITS, 16), 72);
  b.writeUInt32LE(0, 76);
  return b.toString('hex');
}

export const chainwork = (height: number): string => ((BigInt(height) + 1n) * WORK).toString(16).padStart(64, '0');

const PAD: CoreOut = { value: 0, script: nulldata(Buffer.alloc(0)), content: null, memo: null };
// the script of a peg tx's coinbase-shaped input: a push of its text
const DEPOSIT_TAG = pushData(Buffer.from('eCash deposit', 'utf8'));
const STATE_TAG = pushData(Buffer.from('state', 'utf8'));
const CACHED_BLOCKS = 256;

/** What a Core JSON field of an output holds beyond Core's: content, withdrawal, memo */
function outExtras(o: CoreOut): any {
  const x: any = {};
  if (o.content) {
    x.content = o.content;
    if (o.content.type === 'withdrawal') {
      x.withdrawal = { main_address: o.content.mainAddress ?? null, value: o.content.value ?? 0, main_fee: o.content.mainFee ?? 0 };
    }
  }
  if (o.memo) {
    x.memo = o.memo;
  }
  return x;
}

export function scriptJson(s: CoreScript): any {
  return s.address ? { asm: s.asm, hex: s.hex, address: s.address, type: s.type } : { asm: s.asm, hex: s.hex, type: s.type };
}

export interface RenderOptions {
  fee: boolean;                   // Core: getblock 2/3, getrawtransaction 2
  prevout: boolean;               // Core: getblock 3, getrawtransaction 2
  hex: boolean;
}

/** A tx as Core's JSON */
export function renderTx(t: CoreTx, o: RenderOptions): any {
  const vin = t.ins.map(i => {
    if (i.coinbase !== undefined) {
      return { coinbase: i.coinbase, sequence: SEQUENCE };
    }
    const v: any = { txid: i.txid, vout: i.vout, scriptSig: { asm: '', hex: '' }, sequence: SEQUENCE };
    if (i.deposit) {
      v.deposit = true;
    }
    if (i.kind) {
      v.kind = i.kind;
    }
    if (o.prevout && i.prevout) {
      const p = i.prevout;
      v.prevout = { generated: p.generated, height: p.height, value: coins(p.out.value), scriptPubKey: scriptJson(p.out.script), ...outExtras(p.out) };
    }
    return v;
  });
  const vout = t.outs.map((x, n) => ({ value: coins(x.value), n, scriptPubKey: scriptJson(x.script), ...outExtras(x) }));
  const j: any = { txid: t.txid, hash: t.txid, version: VERSION, size: t.size, vsize: t.size, weight: 4 * t.size, locktime: 0, vin, vout };
  if (o.fee && !t.coinbase) {
    j.fee = coins(t.fee);
  }
  if (o.hex) {
    j.hex = t.hex;
  }
  if (t.data) {
    j.data = t.data;
  }
  if (t.shielded) {
    j.shielded = t.shielded;
  }
  if (t.peg) {
    j.peg = t.peg;
    if (t.mainTxid) {
      j.mainTxid = t.mainTxid;
    }
    if (t.m6id) {
      j.m6id = t.m6id;
    }
  }
  return j;
}

export class CoreView {
  private gen = '';
  private times: number[] = [];
  private byOutpoint = new Map<string, OutRef>();               // "txid:n" (Core's view) -> output
  private stateRefs = new Map<string, [string, number]>();       // output key -> its place in a state tx
  private bundles = new Map<number, Map<string, OutRef[]>>();    // height -> m6id -> outputs it spent
  private stateMade = new Map<number, OutRef[]>();
  private stateSpent = new Map<number, OutRef[]>();
  private stateTxids = new Map<number, string>();
  private synthetic = new Map<string, number>();                 // txid of a peg tx -> height
  private blockCache = new Map<number, CoreBlock>();

  constructor(readonly index: L2Index) {}

  /** The tip of Core's view: the index's settled height (index.ts settledHeight) */
  tipHeight(): number {
    return this.index.settledHeight();
  }

  /** Rebuild what is derived from the index whenever it changed (a block, a reorg, filled content, state outputs) */
  private sync(): void {
    const g = this.index.generation();
    if (g === this.gen) {
      return;
    }
    this.gen = g;
    this.byOutpoint.clear();
    this.stateRefs.clear();
    this.bundles.clear();
    this.stateMade.clear();
    this.stateSpent.clear();
    this.stateTxids.clear();
    this.synthetic.clear();
    this.blockCache.clear();

    const n = this.index.tipHeight() + 1;
    let first = 0;
    for (let h = 0; h < n && !first; h++) {
      first = this.index.blockEntry(h)?.stored.main?.time ?? 0;
    }
    this.times = new Array(n);
    let prev = first;
    for (let h = 0; h < n; h++) {
      const e = this.index.blockEntry(h);
      prev = Math.max(prev, e?.stored.main?.time ?? prev);
      this.times[h] = prev;
      for (const d of e?.deposits ?? []) {
        this.synthetic.set(d.outpoint.txid as string, h);
      }
    }

    const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => {
      const a = m.get(k);
      if (a) {
        a.push(v);
      } else {
        m.set(k, [v]);
      }
    };
    this.index.forEachOutRef(r => {
      if (r.spent?.kind === 'bundle') {
        let m = this.bundles.get(r.spent.height);
        if (!m) {
          m = new Map();
          this.bundles.set(r.spent.height, m);
        }
        push(m, r.m6id ?? sha256Hex('bundle:' + r.key), r);
      } else if (r.spent?.kind === 'state') {
        push(this.stateSpent, r.spent.height, r);
      }
      if (r.txid === null && r.outpoint.kind !== 'deposit') {
        push(this.stateMade, r.height, r);
      }
    });
    const byKey = (a: OutRef, b: OutRef) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    for (const [h, m] of this.bundles) {
      for (const [m6id, refs] of m) {
        refs.sort(byKey);
        this.synthetic.set(m6id, h);
      }
    }
    for (const h of new Set([...this.stateMade.keys(), ...this.stateSpent.keys()])) {
      const e = this.index.blockEntry(h);
      if (!e) {
        continue;
      }
      const txid = sha256Hex('state:' + e.stored.hash);
      this.stateTxids.set(h, txid);
      this.synthetic.set(txid, h);
      (this.stateMade.get(h) ?? []).sort(byKey).forEach((r, i) => this.stateRefs.set(r.key, [txid, i]));
      this.stateSpent.get(h)?.sort(byKey);
    }
    this.index.forEachOutRef(r => {
      const [txid, vout] = this.outpointOf(r);
      this.byOutpoint.set(`${txid}:${vout}`, r);
    });
  }

  /** Where Core's view has an output: (txid, n) of the transaction that made it */
  private outpointOf(r: OutRef): [string, number] {
    if (r.txid !== null) {
      return [r.txid, r.vout];
    }
    if (r.outpoint.kind === 'deposit') {
      return [r.outpoint.txid as string, r.outpoint.vout as number];
    }
    return this.stateRefs.get(r.key) ?? [sha256Hex('outpoint:' + r.key), 0];
  }

  /** The (txid, n) an input names: its output's, or for an output the index does not hold, the outpoint's own */
  private inputOutpoint(key: string, op: OutPoint): [string, number] {
    const r = this.index.outRef(key);
    if (r) {
      return this.outpointOf(r);
    }
    return [op.txid && /^[0-9a-f]{64}$/.test(op.txid) ? op.txid : sha256Hex('outpoint:' + key), op.vout ?? 0];
  }

  private outOf(r: OutRef): CoreOut {
    return { value: r.value, script: scriptOf(r.address), content: r.content.type === 'value' ? null : r.content, memo: r.memo };
  }

  private spending(r: OutRef): CoreIn {
    const [txid, vout] = this.outpointOf(r);
    const i: CoreIn = { txid, vout, prevout: { generated: r.outpoint.kind === 'coinbase', height: r.height, out: this.outOf(r) } };
    if (r.outpoint.kind === 'deposit') {
      i.deposit = true;
    }
    return i;
  }

  private finish(t: Omit<CoreTx, 'hex' | 'size'> & { size: number | null }): CoreTx {
    const hex = serialize(t.ins, t.outs);
    return { ...t, hex, size: t.size ?? hex.length / 2 };
  }

  private chainTx(t: TxEntry): CoreTx {
    const ins = t.inputs.map((inp, i): CoreIn => {
      const key = t.inKeys[i];
      const [txid, vout] = this.inputOutpoint(key, inp.outpoint);
      const ref = this.index.outRef(key);
      const c: CoreIn = {
        txid, vout,
        prevout: inp.address !== null ? {
          generated: inp.outpoint.kind === 'coinbase', height: ref?.height ?? t.height,
          out: { value: inp.value ?? 0, script: scriptOf(inp.address), content: inp.content && inp.content.type !== 'value' ? inp.content : null, memo: null },
        } : null,
      };
      if (inp.outpoint.kind === 'deposit') {
        c.deposit = true;
      } else if (inp.outpoint.kind === 'marketFunds' || inp.outpoint.kind === 'payout') {
        c.kind = inp.outpoint.kind;
      }
      return c;
    });
    return this.finish({
      txid: t.txid, size: t.size, ins, outs: t.outputs.map(r => this.outOf(r)), fee: t.fee, coinbase: false,
      data: this.index.dataOf(t.data), shielded: t.shielded, peg: null,
    });
  }

  /** A block of Core's view (null: not indexed) */
  block(height: number): CoreBlock | null {
    this.sync();
    const cached = this.blockCache.get(height);
    if (cached) {
      return cached;
    }
    const e = height <= this.tipHeight() ? this.index.blockEntry(height) : null;
    if (!e) {
      return null;
    }
    const s = e.stored;
    const txs: CoreTx[] = [];
    txs.push(this.finish({
      txid: e.coinbase.txid, size: null, ins: [{ coinbase: bip34(height), prevout: null }], outs: e.coinbase.outputs.map(r => this.outOf(r)),
      fee: 0, coinbase: true, data: null, shielded: null, peg: null,
    }));
    for (const t of e.txs) {
      txs.push(this.chainTx(t));
    }
    // the two-way peg, after the transactions: deposits by eCash tx, then the bundles, then the chain's state
    const deposits = new Map<string, OutRef[]>();
    for (const r of e.deposits) {
      const k = r.outpoint.txid as string;
      deposits.set(k, [...(deposits.get(k) ?? []), r]);
    }
    for (const [mainTxid, refs] of deposits) {
      const outs: CoreOut[] = new Array(Math.max(...refs.map(r => r.vout)) + 1).fill(PAD);
      for (const r of refs) {
        outs[r.vout] = this.outOf(r);
      }
      txs.push(this.finish({
        txid: mainTxid, size: null, ins: [{ coinbase: DEPOSIT_TAG, prevout: null }], outs, fee: 0, coinbase: false,
        data: null, shielded: null, peg: 'deposit', mainTxid,
      }));
    }
    for (const [m6id, refs] of this.bundles.get(height) ?? []) {
      const total = refs.reduce((a, r) => a + r.value, 0);
      txs.push(this.finish({
        txid: m6id, size: null, ins: refs.map(r => this.spending(r)),
        outs: [{ value: total, script: nulldata(/^[0-9a-f]{64}$/.test(m6id) ? Buffer.from(m6id, 'hex') : Buffer.alloc(0)), content: null, memo: null }],
        fee: 0, coinbase: false, data: null, shielded: null, peg: 'withdrawal', m6id,
      }));
    }
    const stateTxid = this.stateTxids.get(height);
    if (stateTxid) {
      const spent = this.stateSpent.get(height) ?? [];
      txs.push(this.finish({
        txid: stateTxid, size: null, ins: spent.length ? spent.map(r => this.spending(r)) : [{ coinbase: STATE_TAG, prevout: null }],
        outs: (this.stateMade.get(height) ?? []).map(r => this.outOf(r)), fee: 0, coinbase: false, data: null, shielded: null, peg: 'state',
      }));
    }
    const time = this.times[height];
    const median = this.times.slice(Math.max(0, height - 10), height + 1).sort((a, b) => a - b);
    const b: CoreBlock = {
      height, hash: s.hash, prev: s.prevHash, merkleRoot: s.merkleRoot, time, mediantime: median[Math.floor(median.length / 2)],
      header: header(s.prevHash, s.merkleRoot, time), size: 80 + varint(txs.length).length + txs.reduce((a, t) => a + t.size, 0), txs,
    };
    this.blockCache.set(height, b);
    while (this.blockCache.size > CACHED_BLOCKS) {
      this.blockCache.delete(this.blockCache.keys().next().value as number);
    }
    return b;
  }

  heightOf(hash: string): number | null {
    const h = this.index.heightOfHash(hash);
    return h !== null && h <= this.tipHeight() ? h : null;
  }

  /** A confirmed tx and its block: the latest occurrence of the txid, or the one in `blockHash` */
  tx(txid: string, blockHash?: string): { tx: CoreTx; block: CoreBlock } | null {
    this.sync();
    let h: number | null;
    if (blockHash) {
      h = this.heightOf(blockHash);
    } else {
      h = this.index.txEntry(txid)?.height ?? this.synthetic.get(txid) ?? null;
    }
    const b = h === null ? null : this.block(h);
    const t = b?.txs.find(x => x.txid === txid);
    return b && t ? { tx: t, block: b } : null;
  }

  /** An output of Core's view by (txid, n) */
  output(txid: string, n: number): { ref: OutRef; out: CoreOut } | null {
    this.sync();
    const r = this.byOutpoint.get(`${txid}:${n}`);
    return r && r.height <= this.tipHeight() ? { ref: r, out: this.outOf(r) } : null;
  }

  /** The tx of Core's view that spent an output (gettxspendingprevout) */
  spender(r: OutRef): { txid: string; height: number } | null {
    this.sync();
    const s = r.spent;
    if (!s || s.height > this.tipHeight()) {
      return null;
    }
    if (s.kind === 'tx' && s.txid) {
      return { txid: s.txid, height: s.height };
    }
    if (s.kind === 'bundle') {
      for (const [m6id, refs] of this.bundles.get(s.height) ?? []) {
        if (refs.includes(r)) {
          return { txid: m6id, height: s.height };
        }
      }
    }
    if (s.kind === 'state') {
      const txid = this.stateTxids.get(s.height);
      return txid ? { txid, height: s.height } : null;
    }
    return null;
  }

  /** The unspent outputs (gettxoutsetinfo) */
  utxoTotals(): { count: number; amount: number } {
    this.sync();
    let count = 0;
    let amount = 0;
    const tip = this.tipHeight();
    for (const r of this.byOutpoint.values()) {
      if (r.height <= tip && (!r.spent || r.spent.height > tip)) {
        count++;
        amount += r.value;
      }
    }
    return { count, amount };
  }

  /**
   * A mempool tx (list_mempool's entry) in Core's view: inputs resolved against the index and the other mempool
   * txs' outputs (`pool`: "txid:n" -> output)
   */
  mempoolTx(entry: any, pool: Map<string, CoreOut>): CoreTx {
    this.sync();
    const t = entry.tx ?? {};
    const chain = this.index.chain;
    const tip = this.tipHeight();
    let inSum = 0;
    let resolved = true;
    const ins: CoreIn[] = (t.inputs ?? []).map((x: any): CoreIn => {
      const op = outPoint(chain.inputPairs ? x[0] : x);
      const { key, ...outpoint } = op;
      const r = this.index.outRef(key);
      if (r) {
        inSum += r.value;
        const i = this.spending(r);
        if (outpoint.kind === 'marketFunds' || outpoint.kind === 'payout') {
          i.kind = outpoint.kind;
        }
        return i;
      }
      const [txid, vout] = this.inputOutpoint(key, outpoint);
      const m = pool.get(`${txid}:${vout}`);
      if (m) {
        inSum += m.value;
        return { txid, vout, prevout: { generated: false, height: tip + 1, out: m } };
      }
      resolved = false;
      const i: CoreIn = { txid, vout, prevout: null };
      if (outpoint.kind === 'deposit') {
        i.deposit = true;
      } else if (outpoint.kind === 'marketFunds' || outpoint.kind === 'payout') {
        i.kind = outpoint.kind;
      }
      return i;
    });
    const outs = this.mempoolOutputs(entry);
    const outSum = outs.reduce((a, o) => a + o.value, 0);
    return this.finish({
      txid: entry.txid, size: typeof entry.size === 'number' ? entry.size : null, ins, outs, fee: resolved ? Math.max(0, inSum - outSum) : 0,
      coinbase: false, data: this.index.dataOf(t.data), shielded: chain.shielded?.(t) ?? null, peg: null,
    });
  }

  mempoolOutputs(entry: any): CoreOut[] {
    const chain = this.index.chain;
    return (entry.tx?.outputs ?? []).map((o: any): CoreOut => {
      const content = chain.content(o.content);
      return { value: valueOf(content), script: scriptOf(o.address), content: content.type === 'value' ? null : content, memo: o.memo || null };
    });
  }

  // ------------------------------------------------------------------ Core's JSON

  confirmations(height: number): number {
    return this.tipHeight() - height + 1;
  }

  headerJson(b: CoreBlock): any {
    const j: any = {
      hash: b.hash, confirmations: this.confirmations(b.height), height: b.height, version: VERSION, versionHex: '00000001',
      merkleroot: b.merkleRoot, time: b.time, mediantime: b.mediantime, nonce: 0, bits: BITS, difficulty: DIFFICULTY,
      chainwork: chainwork(b.height), nTx: b.txs.length,
    };
    if (b.prev) {
      j.previousblockhash = b.prev;
    }
    const next = b.height < this.tipHeight() ? this.index.blockEntry(b.height + 1) : null;
    if (next) {
      j.nextblockhash = next.stored.hash;
    }
    return j;
  }

  /** getblock: 0 raw hex, 1 txids, 2 txs with fees, 3 and their prevouts */
  blockJson(b: CoreBlock, verbosity: number): any {
    if (verbosity <= 0) {
      return b.header + varint(b.txs.length).toString('hex') + b.txs.map(t => t.hex).join('');
    }
    const { nTx, ...h } = this.headerJson(b);
    const tx = verbosity === 1 ? b.txs.map(t => t.txid)
      : b.txs.map(t => renderTx(t, { fee: true, prevout: verbosity >= 3, hex: true }));
    return { ...h, nTx, strippedsize: b.size, size: b.size, weight: 4 * b.size, tx };
  }

  /** getrawtransaction verbose: 1 as Core, 2 with fee and prevouts; the block's hash, height and time */
  txJson(t: CoreTx, b: CoreBlock | null, verbosity: number): any {
    const j = renderTx(t, { fee: verbosity >= 2, prevout: verbosity >= 2, hex: true });
    if (b) {
      j.blockhash = b.hash;
      j.confirmations = this.confirmations(b.height);
      j.time = b.time;
      j.blocktime = b.time;
      j.height = b.height; // not Core's: the backend need not work it out from confirmations
    }
    return j;
  }

  /** getblockstats, Core's fields; the peg txs count as txs and outputs but not in fee or input stats */
  blockStats(b: CoreBlock): any {
    let ins = 0;
    let outs = 0;
    let totalOut = 0;
    let totalSize = 0;
    let fees = 0;
    let utxoSizeInc = 0;
    const rated: { rate: number; weight: number; fee: number; size: number }[] = [];
    b.txs.forEach((t, i) => {
      outs += t.outs.length;
      utxoSizeInc += t.outs.filter(o => o.script.type !== 'nulldata').length * 50;
      if (i === 0) {
        return;
      }
      ins += t.ins.filter(x => x.coinbase === undefined).length;
      utxoSizeInc -= t.ins.filter(x => x.coinbase === undefined).length * 50;
      totalOut += t.outs.reduce((a, o) => a + o.value, 0);
      if (t.peg) {
        return;
      }
      totalSize += t.size;
      fees += t.fee;
      rated.push({ rate: t.fee / t.size, weight: 4 * t.size, fee: t.fee, size: t.size });
    });
    const n = rated.length;
    const byRate = [...rated].sort((x, y) => x.rate - y.rate);
    const totalWeight = rated.reduce((a, r) => a + r.weight, 0);
    const percentiles = [0.1, 0.25, 0.5, 0.75, 0.9].map(p => {
      if (!n) {
        return 0;
      }
      let w = 0;
      for (const r of byRate) {
        w += r.weight;
        if (w >= totalWeight * p) {
          return Math.round(r.rate);
        }
      }
      return Math.round(byRate[n - 1].rate);
    });
    const median = (a: number[]) => (a.length ? a.sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)] : 0);
    return {
      avgfee: n ? Math.floor(fees / n) : 0,
      avgfeerate: totalWeight ? Math.floor(fees * 4 / totalWeight) : 0,
      avgtxsize: n ? Math.floor(totalSize / n) : 0,
      blockhash: b.hash,
      feerate_percentiles: percentiles,
      height: b.height,
      ins,
      maxfee: n ? Math.max(...rated.map(r => r.fee)) : 0,
      maxfeerate: n ? Math.round(Math.max(...rated.map(r => r.rate))) : 0,
      maxtxsize: n ? Math.max(...rated.map(r => r.size)) : 0,
      medianfee: median(rated.map(r => r.fee)),
      mediantime: b.mediantime,
      mediantxsize: median(rated.map(r => r.size)),
      minfee: n ? Math.min(...rated.map(r => r.fee)) : 0,
      minfeerate: n ? Math.round(Math.min(...rated.map(r => r.rate))) : 0,
      mintxsize: n ? Math.min(...rated.map(r => r.size)) : 0,
      outs,
      subsidy: 0,
      swtotal_size: 0,
      swtotal_weight: 0,
      swtxs: 0,
      time: b.time,
      total_out: totalOut,
      total_size: totalSize,
      total_weight: 4 * totalSize,
      totalfee: fees,
      txs: b.txs.length,
      utxo_increase: outs - ins,
      utxo_size_inc: utxoSizeInc,
      utxo_increase_actual: outs - ins - b.txs.reduce((a, t) => a + t.outs.filter(o => o.script.type === 'nulldata').length, 0),
      utxo_size_inc_actual: utxoSizeInc,
    };
  }

  /** The median time of the tip and the times (non-decreasing BMM times) */
  tipTime(): { time: number; mediantime: number } {
    const tip = this.tipHeight();
    const b = tip >= 0 ? this.block(tip) : null;
    return { time: b?.time ?? 0, mediantime: b?.mediantime ?? 0 };
  }
}
