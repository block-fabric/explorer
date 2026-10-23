import * as fs from 'fs';
import * as path from 'path';
import * as bitcoinjs from 'bitcoinjs-lib';
import config from '../../config';
import logger from '../../logger';
import enforcer, { HeaderInfo, PegBlock } from '../enforcer';
import { MODULE, PROFILE } from '../profile';
import { NETWORK } from '../networks';
import rpc from './rpc';
import {
  BURN_ADDRESS, addressOfKey, coinbaseTxid, depositAddress, liftData, outPoint, outPointJson, reverseHex, txidOfCanonical,
  valueOf, zsideTxid,
} from './codec';
import {
  BlockSummary, Content, Input, L2Chain, MainBlockRef, MarketTerms, MarketView, OutPoint, Output, PayoutKind, Shielded, Spent,
} from './types';

/**
 * The sidechain index (kind l2): every block of the sidechain from genesis to the node's tip, walked with
 * get_block_hash / get_block(hash, true), and what the node does not say per block worked out here:
 * - txids (chains/L2-NODES.md: Thunder's blake3(canonical_bytes), zSide's own, or get_block_index's);
 * - the eCash block that carried each block (its BMM): the accepted commitments of the enforcer's peg data for this
 *   slot (GetTwoWayPegData), else get_bmm_inclusions and the enforcer's header; its time is the block's time;
 * - the two-way peg applied when block N connects: the deposits and withdrawal bundle events of the eCash blocks in
 *   (prev_main(N-1), prev_main(N)], after the block's transactions, as the nodes do (Thunder state.cpp
 *   connect_2wpd). Deposits and bundle spends come from get_block_index where the node has it, else from the
 *   enforcer's peg data (the deposit text read with the chain's rule, a submitted bundle's UTXOs from
 *   get_withdrawal_bundle); a failed bundle's UTXOs come back, a succeeded one is paid;
 * - every output with its spender, so inputs get their address, content and value, transactions their fee, and
 *   addresses their history and balance.
 *
 * - for a chain whose state moves sats without a tx (Truthcoin's markets), the UTXOs list_utxos has and no tx made,
 *   and the outputs it no longer has though no tx spent them, both at the height they were first seen; an input
 *   spending an output the index never saw is valued with get_stxos (made by the state at that height);
 * - a market tx (Truthcoin's Trade and AmplifyBeta, chain.market): whether its block applied it (its inputs spent by
 *   it, get_stxos) and the Payout outputs the state made for it (their outpoints are derived from the tx, their
 *   values read with get_utxos / get_stxos), so that its fee is the miner fee and the rest the cost in the market.
 *
 * Stored per block is only what the node gave (StoredBlock); the rest (outputs, spends, addresses) is replayed from
 * the stored blocks at startup and after a reorg, which takes moments for chains of thousands of blocks. In memory,
 * saved to <CACHE_DIR>/chain/l2-<profile>-<network>.json. Reorgs: the stored tip's hash is checked against
 * get_block_hash, and each new block must extend the stored tip; else blocks are dropped until they agree.
 */

const CACHE_VERSION = 2;   // 2: market txs and the values of state outputs (StoredTx market, prevouts)
const STEP = 25;          // blocks fetched per round
const POLL_MS = 10000;

export interface RawOutput {
  address: string;
  content: any;
  memo?: string | null;
}

export interface StoredTx {
  txid: string;
  size: number | null;
  inputs: any[];                  // OutPoint JSON
  outputs: RawOutput[];
  data: any;                      // TxData JSON
  signers: (string | null)[];     // per input
  shielded: Shielded | null;
  /** per input, the output it spends when no tx of the index made it (the chain's state did): from get_stxos */
  prevouts?: (RawOutput | null)[];
  /** a market tx: whether its block applied it, and the Payout outputs the state made for it */
  market?: { applied: boolean; payouts: { outpoint: any; output: RawOutput; kind: PayoutKind }[] };
}

export interface BundleEventRef {
  m6id: string;
  kind: 'submitted' | 'succeeded' | 'failed';
  mainHeight: number;
}

export interface MainBlock extends MainBlockRef {
  time: number;
}

export interface StoredBlock {
  height: number;
  hash: string;
  prevHash: string | null;
  merkleRoot: string;
  prevMainHash: string;
  prevMainHeight: number;
  main: MainBlock | null;
  coinbase: { txid: string; outputs: RawOutput[] };
  txs: StoredTx[];
  deposits: { outpoint: any; output: RawOutput }[];
  bundleSpends: { outpoint: any; m6id: string }[];
  events: BundleEventRef[];
}

/** An output, with what happened to it since */
export interface OutRef {
  key: string;
  outpoint: OutPoint;
  vout: number;
  txid: string | null;            // the tx that created it (null: a deposit)
  height: number;
  address: string;
  content: Content;
  value: number;
  memo: string | null;
  spent: Spent | null;
  m6id: string | null;            // spent by this bundle
}

export interface TxEntry {
  txid: string;
  height: number;
  index: number;
  size: number | null;
  inputs: Input[];
  inKeys: string[];               // the index's key of each input's outpoint
  outputs: OutRef[];
  fee: number;
  data: any;
  shielded: Shielded | null;
  signers: (string | null)[];
  /** a market tx: its terms, whether applied, its cost in the market (null: an input not valued) */
  market: { terms: MarketTerms; applied: boolean; cost: number | null; kinds: PayoutKind[] } | null;
  /** the outputs the chain's state made for it (a market tx's payouts), Core view vouts after its own outputs */
  payouts: OutRef[];
}

export interface BlockEntry {
  stored: StoredBlock;
  summary: BlockSummary;
  coinbase: TxEntry;
  txs: TxEntry[];
  deposits: OutRef[];
}

interface HistoryEntry {
  txid: string;
  height: number;
  delta: number;
  kind: 'tx' | 'coinbase' | 'deposit' | 'withdrawal' | 'bundle-return' | 'state';
}

interface AddressEntry {
  funded: { count: number; sum: number };
  spent: { count: number; sum: number };
  txs: HistoryEntry[];            // oldest first
  utxos: Set<string>;
}

export interface PendingBundle {
  m6id: string | null;
  payouts: { address: string; amount: number; fee: number }[];
  total: number;
  keys: Set<string>;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

const FILLABLE = new Set(['bitname', 'bitnameReservation', 'bitasset', 'bitassetControl', 'bitassetReservation', 'ammLpToken', 'dutchAuctionReceipt']);

export class L2Index {
  /** the chain's module; the default is CHAIN.PROFILE's (tests give one) */
  constructor(readonly chain: L2Chain = MODULE.l2 as L2Chain) {}

  private stored: StoredBlock[] = [];
  private fills = new Map<string, any>();    // outpoint key -> the node's filled content
  private stateOutputs = new Map<string, { outpoint: any; output: RawOutput; height: number }>(); // stateUtxos: made by the state
  private stateSpent = new Map<string, number>();                                                 // consumed by the state, at height
  // replayed from `stored`
  private blocks: BlockEntry[] = [];
  private byHash = new Map<string, number>();
  private txs = new Map<string, TxEntry>();   // the latest occurrence of a txid (zero-input txs can recur)
  private outputs = new Map<string, OutRef>();
  private addresses = new Map<string, AddressEntry>();
  private depositList: { ref: OutRef; height: number }[] = [];
  private withdrawalList: OutRef[] = [];
  private paid = new Set<string>();
  private shieldedTotals = { txs: 0, actions: 0, shieldedIn: 0, shieldedOut: 0, valueBalance: 0 };
  // the enforcer's side
  private bmm = new Map<string, HeaderInfo>();          // sidechain block hash -> the eCash block that accepted it
  private peg = new Map<number, PegBlock>();            // eCash height -> deposits and bundle events for this slot
  private pegTip: HeaderInfo | null = null;
  private headers = new Map<string, HeaderInfo>();
  private running = false;
  private ready = false;
  private nodeTip = -1;
  private lastSave = 0;
  private dirtyFills = false;
  private fillTried = new Set<string>();     // outpoint keys asked for once already
  private settled = -1;                      // stateUtxos: the tip list_utxos was last followed at

  start(): void {
    this.loadCache();
    void this.run();
    setInterval(() => void this.run(), POLL_MS);
  }

  isReady(): boolean {
    return this.ready;
  }

  // ------------------------------------------------------------------ cache

  private cacheFile(): string {
    return path.join(config.MEMPOOL.CACHE_DIR, 'chain', `l2-${PROFILE.id}-${config.CHAIN.NETWORK}.json`);
  }

  private loadCache(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.cacheFile(), 'utf8'));
      if (raw.version !== CACHE_VERSION) {
        return;
      }
      this.stored = raw.blocks;
      this.fills = new Map(Object.entries(raw.fills ?? {}));
      this.stateOutputs = new Map(Object.entries(raw.stateOutputs ?? {}));
      this.stateSpent = new Map(Object.entries(raw.stateSpent ?? {}).map(([k, v]) => [k, Number(v)]));
      this.rebuild();
      logger.info(`L2 index: ${this.stored.length} blocks from the cache`);
    } catch (e) {
      // no cache yet
    }
  }

  private saveCache(force = false): void {
    if (!force && Date.now() - this.lastSave < 60000) {
      return;
    }
    this.lastSave = Date.now();
    try {
      fs.mkdirSync(path.dirname(this.cacheFile()), { recursive: true });
      const tmp = this.cacheFile() + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ version: CACHE_VERSION, blocks: this.stored, fills: Object.fromEntries(this.fills),
        stateOutputs: Object.fromEntries(this.stateOutputs), stateSpent: Object.fromEntries(this.stateSpent) }));
      fs.renameSync(tmp, this.cacheFile());
    } catch (e) {
      logger.warn(`L2 index: cannot save the cache: ${e instanceof Error ? e.message : e}`);
    }
  }

  // ------------------------------------------------------------------ sync

  private async run(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      await this.sync();
      await this.fill();
      await this.reconcile();
    } catch (e) {
      logger.warn(`L2 index: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.running = false;
    }
  }

  private async sync(): Promise<void> {
    const tip = (await rpc.call<number>('getblockcount')) - 1;
    this.nodeTip = tip;
    // reorg: drop stored blocks until the top one is the node's
    let dropped = false;
    while (this.stored.length) {
      const top = this.stored[this.stored.length - 1];
      if (top.height <= tip && await rpc.call<string | null>('get_block_hash', top.height) === top.hash) {
        break;
      }
      this.stored.pop();
      dropped = true;
    }
    if (dropped) {
      logger.notice(`L2 index: reorg, back to height ${this.stored.length - 1}`);
      this.resetPeg();
      this.rebuild();
    }
    if (this.stored.length > tip) {
      this.ready = true;
      return;
    }
    await this.syncPeg();
    if (tip - this.stored.length > 10) {
      logger.info(`L2 index: blocks ${this.stored.length} to ${tip}`);
    }
    while (this.stored.length <= tip) {
      const first = this.stored.length;
      const heights = Array.from({ length: Math.min(STEP, tip - first + 1) }, (_, i) => first + i);
      const fetched = await mapLimit(heights, Math.max(1, config.CHAIN.SIDECHAIN_RPC.MAX_CONCURRENT), h => this.fetch(h));
      for (const f of fetched) {
        const top = this.stored[this.stored.length - 1];
        if (!f || (top ? f.block.header.prev_side_hash !== top.hash : f.block.header.prev_side_hash !== null)) {
          this.saveCache(true);
          return; // the node moved on: the next round checks for a reorg
        }
        const b = await this.build(f.height, f.hash, f.block, f.index);
        if (!b) {
          this.saveCache(true);
          return; // the enforcer has not seen the eCash blocks this block needs yet
        }
        this.stored.push(b);
        this.apply(b);
      }
      this.saveCache(this.stored.length > tip);
    }
    this.ready = true;
  }

  private async fetch(height: number): Promise<{ height: number; hash: string; block: any; index: any } | null> {
    const hash = await rpc.call<string | null>('get_block_hash', height);
    if (!hash) {
      return null;
    }
    const block = await rpc.call('get_block', hash, true);
    const index = this.chain.blockIndex || this.chain.txids === 'index' ? await rpc.call('get_block_index', hash) : null;
    return block ? { height, hash, block, index } : null;
  }

  private resetPeg(): void {
    this.bmm.clear();
    this.peg.clear();
    this.pegTip = null;
  }

  /** The enforcer's peg data for this slot, from the eCash block the stored tip builds on (exclusive) to its tip */
  private async syncPeg(): Promise<void> {
    const tip = await enforcer.getChainTip();
    if (this.pegTip?.hash === tip.hash) {
      return;
    }
    if (this.pegTip) {
      const gap = tip.height - this.pegTip.height;
      const still = gap > 0 && gap <= 500 && (await enforcer.getHeaders(tip.hash, gap + 1)).pop()?.hash === this.pegTip.hash;
      if (!still) {
        this.resetPeg();
      }
    }
    const start = this.pegTip?.hash ?? this.stored[this.stored.length - 1]?.prevMainHash ?? null;
    let blocks: PegBlock[];
    try {
      blocks = await enforcer.getPegData(PROFILE.slot as number, start, tip.hash);
    } catch (e) {
      if (!start) {
        throw e;
      }
      this.resetPeg(); // the start is no longer on the eCash chain
      blocks = await enforcer.getPegData(PROFILE.slot as number, null, tip.hash);
    }
    for (const b of blocks) {
      this.headers.set(b.header.hash, b.header);
      if (b.bmmCommitment) {
        this.bmm.set(reverseHex(b.bmmCommitment), b.header); // enforcer.ts gives it reversed; sidechain hashes are not
      }
      if (b.deposits.length || b.bundleEvents.length) {
        this.peg.set(b.header.height, b);
      }
    }
    this.pegTip = tip;
  }

  private async header(hash: string): Promise<HeaderInfo> {
    let h = this.headers.get(hash);
    if (!h) {
      [h] = await enforcer.getHeaders(hash, 1);
      if (!h) {
        throw new Error(`the enforcer does not know eCash block ${hash}`);
      }
      this.headers.set(hash, h);
    }
    return h;
  }

  /** The eCash block that carried a sidechain block: the enforcer's accepted BMM, else get_bmm_inclusions */
  private async mainBlockOf(hash: string): Promise<HeaderInfo | null> {
    const m = this.bmm.get(hash);
    if (m) {
      return m;
    }
    const inclusions = await rpc.call<string[]>('get_bmm_inclusions', hash).catch(() => []);
    for (const h of inclusions ?? []) {
      try {
        return await this.header(h);
      } catch (e) {
        // an eCash block the enforcer has not seen
      }
    }
    return null;
  }

  /** Everything the index keeps of a block, or null when the enforcer is behind the eCash blocks it needs */
  private async build(height: number, hash: string, block: any, index: any): Promise<StoredBlock | null> {
    const h = block.header;
    const main = await this.mainBlockOf(hash);
    const prevMainHeight = main && main.prevHash === h.prev_main_hash ? main.height - 1 : (await this.header(h.prev_main_hash)).height;
    if (!this.pegTip || prevMainHeight > this.pegTip.height) {
      return null;
    }
    const lo = height ? this.stored[height - 1].prevMainHeight : -1;
    const pegBlocks = [...this.peg.values()].filter(p => p.header.height > lo && p.header.height <= prevMainHeight)
      .sort((a, b) => a.header.height - b.header.height);
    const events: BundleEventRef[] = pegBlocks.flatMap(p => p.bundleEvents.map(e => ({ m6id: e.m6id, kind: e.kind, mainHeight: p.header.height })));

    const body = block.body;
    const raw: any[] = body.transactions ?? [];
    if (this.chain.txids === 'index' && (index?.txs?.length ?? -1) !== raw.length) {
      throw new Error(`block ${height}: get_block_index has ${index?.txs?.length} txs, get_block ${raw.length}`);
    }
    const auths: any[] = body.authorizations ?? [];
    let k = 0;
    const txs: StoredTx[] = [];
    const earlier = new Set<string>(); // txids of this block so far: their outputs are known once the block applies
    for (let i = 0; i < raw.length; i++) {
      const t = raw[i];
      const inputs = (t.inputs ?? []).map((x: any) => this.chain.inputPairs ? x[0] : x);
      let txid: string;
      let size: number | null;
      if (this.chain.txids === 'index') {
        txid = index.txs[i].txid;
        size = index.txs[i].size ?? null;
      } else {
        const bytes = String(t.canonical_bytes ?? '').replace(/^0x/, '');
        txid = this.chain.txids === 'zside' ? zsideTxid(bytes, t.orchard_bundle?.actions?.length ?? 0) : txidOfCanonical(bytes);
        size = bytes.length / 2;
      }
      const signers = inputs.map(() => addressOfKey(auths[k++]?.verifying_key));
      const tx: StoredTx = {
        txid, size, inputs, outputs: (t.outputs ?? []).map(o => ({ address: o.address, content: o.content, memo: o.memo ?? null })),
        data: t.data ?? null, signers, shielded: this.chain.shielded?.(t) ?? null,
      };
      await this.stateOfTx(tx, earlier);
      earlier.add(txid);
      txs.push(tx);
    }

    let deposits: StoredBlock['deposits'];
    let bundleSpends: StoredBlock['bundleSpends'];
    if (this.chain.blockIndex) {
      deposits = (index?.deposits ?? []).map(d => ({ outpoint: d.outpoint, output: { address: d.output.address, content: d.output.content, memo: d.output.memo ?? null } }));
      bundleSpends = (index?.bundle_spends ?? []).map(s => ({ outpoint: s.outpoint, m6id: s.m6id }));
    } else {
      deposits = pegBlocks.flatMap(p => p.deposits.map(d => ({
        outpoint: { Deposit: `${d.txid}:${d.vout}` },
        output: { address: depositAddress(d.address, this.chain.depositRule, PROFILE.slot as number), content: { Value: d.amount }, memo: null },
      })));
      bundleSpends = [];
      for (const e of events.filter(x => x.kind === 'submitted')) {
        if (!this.chain.withdrawalBundleRpc) {
          continue;
        }
        const b = await rpc.call('get_withdrawal_bundle', e.m6id).catch(() => null);
        for (const [op] of b?.info?.Known?.spend_utxos ?? []) {
          bundleSpends.push({ outpoint: op, m6id: e.m6id });
        }
      }
    }

    const cbid = coinbaseTxid(h.merkle_root, h.prev_main_hash, h.prev_side_hash);
    return {
      height, hash, prevHash: h.prev_side_hash, merkleRoot: h.merkle_root, prevMainHash: h.prev_main_hash, prevMainHeight,
      main: main ? { hash: main.hash, height: main.height, time: main.time } : null,
      // the coinbase is {memo, outputs}, or Coinshift's bare list of outputs
      coinbase: { txid: cbid, outputs: ((Array.isArray(body.coinbase) ? body.coinbase : body.coinbase?.outputs) ?? []).map(o => ({ address: o.address, content: o.content, memo: o.memo ?? null })) },
      txs, deposits, bundleSpends, events,
    };
  }

  /**
   * What the chain's state did with a tx, from the node's UTXOs and STXOs of its signers (and payees): the values of
   * inputs spending outputs no tx made (stateUtxos), and for a market tx whether its block applied it (its inputs
   * spent by it: a skipped one leaves them unspent) and the Payout outputs made for it. Throws when the node does not
   * answer: the block is fetched again next round.
   */
  /** @asyncUnsafe */
  private async stateOfTx(tx: StoredTx, earlier: Set<string>): Promise<void> {
    const terms = this.chain.market?.terms(tx.data) ?? null;
    const unknown = tx.inputs.map(o => {
      const p = outPoint(o);
      return !!this.chain.stateUtxos && !this.outputs.has(p.key) && !(p.kind === 'regular' && earlier.has(p.txid as string));
    });
    if (!terms && !unknown.some(x => x)) {
      return;
    }
    const specs = terms ? (this.chain.market as NonNullable<L2Chain['market']>).payouts(tx.txid, terms) : [];
    const node = await this.nodeOutputs([...tx.signers.filter((x): x is string => !!x), ...specs.map(s => s.address)]);
    if (unknown.some(x => x)) {
      tx.prevouts = tx.inputs.map((o, i) => (unknown[i] ? node.get(outPoint(o).key)?.output ?? null : null));
    }
    if (terms) {
      const skipped = tx.inputs.some(o => {
        const n = node.get(outPoint(o).key);
        return !!n && n.spentBy !== tx.txid;
      });
      tx.market = {
        applied: !skipped,
        payouts: skipped ? [] : specs.flatMap(s => {
          const n = node.get(outPoint(s.outpoint).key);
          return n ? [{ outpoint: s.outpoint, output: n.output, kind: s.kind }] : [];
        }),
      };
    }
  }

  /** The node's UTXOs and STXOs of these addresses: outpoint key -> the output and, if spent, the tx that spent it */
  /** @asyncUnsafe */
  private async nodeOutputs(addresses: string[]): Promise<Map<string, { output: RawOutput; spentBy: string | null }>> {
    const out = new Map<string, { output: RawOutput; spentBy: string | null }>();
    const raw = (o: any): RawOutput => ({ address: o?.address, content: o?.content, memo: o?.memo ?? null });
    const list = [...new Set(addresses)];
    for (let i = 0; i < list.length; i += 20) {
      const chunk = list.slice(i, i + 20);
      const utxos = await rpc.call<any[]>('get_utxos', chunk);
      const stxos = await rpc.call<any[]>('get_stxos', chunk);
      for (const u of utxos ?? []) {
        out.set(outPoint(u.outpoint).key, { output: raw(u.output), spentBy: null });
      }
      for (const x of stxos ?? []) {
        const inpoint = x.output?.inpoint ?? {};
        out.set(outPoint(x.outpoint).key, { output: raw(x.output?.output), spentBy: inpoint.Regular?.txid ?? `(${Object.keys(inpoint)[0] ?? 'spent'})` });
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ replay

  private rebuild(): void {
    this.blocks = [];
    this.byHash.clear();
    this.txs.clear();
    this.outputs.clear();
    this.addresses.clear();
    this.depositList = [];
    this.withdrawalList = [];
    this.paid.clear();
    this.shieldedTotals = { txs: 0, actions: 0, shieldedIn: 0, shieldedOut: 0, valueBalance: 0 };
    for (const b of this.stored) {
      this.apply(b);
    }
  }

  private addr(a: string): AddressEntry {
    let e = this.addresses.get(a);
    if (!e) {
      e = { funded: { count: 0, sum: 0 }, spent: { count: 0, sum: 0 }, txs: [], utxos: new Set() };
      this.addresses.set(a, e);
    }
    return e;
  }

  private content(raw: any): Content {
    return this.chain.content(raw);
  }

  private create(opJson: any, o: RawOutput, vout: number, txid: string | null, height: number): OutRef {
    const op = outPoint(opJson);
    const old = this.outputs.get(op.key);
    if (old && !old.spent) {
      // the same outpoint again (a recurring zero-input tx): the node overwrites the UTXO
      const a = this.addr(old.address);
      a.funded.count--;
      a.funded.sum -= old.value;
      a.utxos.delete(old.key);
    }
    const { key, ...outpoint } = op;
    const content = this.content(this.fills.get(key) ?? o.content);
    const ref: OutRef = {
      key, outpoint, vout, txid, height, address: o.address, content, value: valueOf(content), memo: o.memo || null, spent: null, m6id: null,
    };
    this.outputs.set(key, ref);
    const a = this.addr(ref.address);
    a.funded.count++;
    a.funded.sum += ref.value;
    a.utxos.add(key);
    if (content.type === 'withdrawal' && txid) {
      this.withdrawalList.push(ref);
    }
    return ref;
  }

  private spend(ref: OutRef, spent: Spent): void {
    ref.spent = spent;
    const a = this.addr(ref.address);
    a.spent.count++;
    a.spent.sum += ref.value;
    a.utxos.delete(ref.key);
  }

  private apply(b: StoredBlock): void {
    const deltas = (entries: [string, number][], txid: string, kind: HistoryEntry['kind']) => {
      const m = new Map<string, number>();
      for (const [a, v] of entries) {
        m.set(a, (m.get(a) ?? 0) + v);
      }
      for (const [a, delta] of m) {
        this.addr(a).txs.push({ txid, height: b.height, delta, kind });
      }
    };
    const cbKey = this.chain.coinbaseOutPoint === 'merkleRoot' ? 'merkle_root' : 'txid';
    const cbOutputs = b.coinbase.outputs.map((o, vout) =>
      this.create(outPointJson('Coinbase', cbKey === 'txid' ? b.coinbase.txid : b.merkleRoot, vout, cbKey), o, vout, b.coinbase.txid, b.height));
    deltas(cbOutputs.map(r => [r.address, r.value]), b.coinbase.txid, 'coinbase');
    const coinbase: TxEntry = {
      txid: b.coinbase.txid, height: b.height, index: -1, size: null, inputs: [], inKeys: [], outputs: cbOutputs, fee: 0, data: null, shielded: null,
      signers: [], market: null, payouts: [],
    };
    this.txs.set(coinbase.txid, coinbase);

    const summary: BlockSummary = {
      height: b.height, hash: b.hash, prevHash: b.prevHash, time: b.main?.time ?? null,
      mainBlock: b.main ? { hash: b.main.hash, height: b.main.height } : null,
      txCount: b.txs.length, outputs: 0, inputs: 0, fees: 0, deposits: 0, volume: 0,
    };
    const txs: TxEntry[] = [];
    b.txs.forEach((t, index) => {
      const moves: [string, number][] = [];
      let resolved = true;
      let inSum = 0;
      const inKeys: string[] = [];
      const terms = this.chain.market?.terms(t.data) ?? null;
      const applied = !terms || t.market?.applied !== false; // a skipped market tx spends nothing
      const inputs: Input[] = t.inputs.map((opJson, vin) => {
        const op = outPoint(opJson);
        const { key, ...outpoint } = op;
        inKeys.push(key);
        let ref = this.outputs.get(key);
        const prev = t.prevouts?.[vin];
        if (!ref && prev) {
          // an output of the chain's state the index never saw (made and spent between two looks at list_utxos)
          ref = this.create(opJson, prev, op.vout ?? 0, null, b.height);
          this.addr(ref.address).txs.push({ txid: ref.outpoint.txid ?? key, height: b.height, delta: ref.value, kind: 'state' });
        }
        if (!ref) {
          resolved = false;
          return { outpoint, address: null, content: null, value: null };
        }
        if (applied && !ref.spent) {
          this.spend(ref, { txid: t.txid, vin, height: b.height, kind: 'tx' });
        }
        inSum += ref.value;
        moves.push([ref.address, applied ? -ref.value : 0]);
        return { outpoint, address: ref.address, content: ref.content, value: ref.value };
      });
      const outputs = t.outputs.map((o, vout) => this.create(outPointJson('Regular', t.txid, vout), o, vout, t.txid, b.height));
      const payouts = applied ? (t.market?.payouts ?? []).map((p, i) => this.create(p.outpoint, p.output, outputs.length + i, t.txid, b.height)) : [];
      const outSum = outputs.reduce((s, r) => s + r.value, 0);
      const payoutSum = payouts.reduce((s, r) => s + r.value, 0);
      for (const r of [...outputs, ...payouts]) {
        moves.push([r.address, r.value]);
      }
      const shieldedIn = t.shielded ? t.shielded.valueBalance : 0; // > 0 leaves the pool
      let fee: number;
      let market: TxEntry['market'] = null;
      if (terms) {
        fee = applied ? (this.chain.market as NonNullable<L2Chain['market']>).fee : 0;
        market = {
          terms, applied, cost: !applied ? 0 : resolved ? inSum - outSum - payoutSum - fee : null, kinds: applied ? (t.market?.payouts ?? []).map(p => p.kind) : [],
        };
      } else {
        fee = resolved ? Math.max(0, inSum + shieldedIn - outSum) : 0;
      }
      if (t.shielded) {
        const s = this.shieldedTotals;
        s.txs++;
        s.actions += t.shielded.actions;
        s.valueBalance += t.shielded.valueBalance;
        if (t.shielded.valueBalance < 0) {
          s.shieldedIn -= t.shielded.valueBalance;
        } else {
          s.shieldedOut += t.shielded.valueBalance;
        }
      }
      deltas(moves, t.txid, 'tx');
      const e: TxEntry = {
        txid: t.txid, height: b.height, index, size: t.size, inputs, inKeys, outputs, fee, data: t.data, shielded: t.shielded, signers: t.signers,
        market, payouts,
      };
      this.txs.set(t.txid, e);
      txs.push(e);
      summary.outputs += outputs.length;
      summary.inputs += inputs.length;
      summary.fees += fee;
      summary.volume += outSum + payoutSum;
    });

    // the two-way peg, after the transactions
    const deposits: OutRef[] = [];
    for (const d of b.deposits) {
      const op = outPoint(d.outpoint);
      const ref = this.create(d.outpoint, d.output, op.vout ?? 0, null, b.height);
      deposits.push(ref);
      this.depositList.push({ ref, height: b.height });
      summary.deposits += ref.value;
      this.addr(ref.address).txs.push({ txid: op.txid as string, height: b.height, delta: ref.value, kind: 'deposit' });
    }
    for (const s of b.bundleSpends) {
      const ref = this.outputs.get(outPoint(s.outpoint).key);
      if (ref && !ref.spent) {
        this.spend(ref, { txid: null, vin: null, height: b.height, kind: 'bundle' });
        ref.m6id = s.m6id;
        this.addr(ref.address).txs.push({ txid: s.m6id, height: b.height, delta: -ref.value, kind: 'withdrawal' });
      }
    }
    for (const e of b.events) {
      if (e.kind === 'succeeded') {
        this.paid.add(e.m6id);
      } else if (e.kind === 'failed') {
        // the bundle's UTXOs come back
        for (const ref of this.withdrawalList) {
          if (ref.m6id === e.m6id && ref.spent?.kind === 'bundle') {
            ref.spent = null;
            ref.m6id = null;
            const a = this.addr(ref.address);
            a.spent.count--;
            a.spent.sum -= ref.value;
            a.utxos.add(ref.key);
            a.txs.push({ txid: e.m6id, height: b.height, delta: ref.value, kind: 'bundle-return' });
          }
        }
      }
    }
    // what the chain's state made and consumed without a tx, as first seen at this height
    for (const [key, x] of this.stateOutputs) {
      if (x.height === b.height && !this.outputs.has(key)) {
        const ref = this.create(x.outpoint, x.output, outPoint(x.outpoint).vout ?? 0, null, b.height);
        this.addr(ref.address).txs.push({ txid: ref.outpoint.txid ?? key, height: b.height, delta: ref.value, kind: 'state' });
      }
    }
    for (const [key, height] of this.stateSpent) {
      const ref = this.outputs.get(key);
      if (height === b.height && ref && !ref.spent) {
        this.spend(ref, { txid: null, vin: null, height, kind: 'state' });
        this.addr(ref.address).txs.push({ txid: ref.txid ?? key, height, delta: -ref.value, kind: 'state' });
      }
    }
    this.blocks[b.height] = { stored: b, summary, coinbase, txs, deposits };
    this.byHash.set(b.hash, b.height);
  }

  /** The ids of names and assets, which only the node's UTXO RPCs give (filled content) */
  private async fill(): Promise<void> {
    if (!this.chain.fill || !this.ready) {
      return;
    }
    const want = new Map<string, OutRef[]>(); // address -> outputs to fill
    for (const ref of this.outputs.values()) {
      if (FILLABLE.has(ref.content.type) && !this.fills.has(ref.key) && !this.fillTried.has(ref.key)) {
        this.fillTried.add(ref.key);
        want.set(ref.address, [...(want.get(ref.address) ?? []), ref]);
      }
    }
    const addrs = [...want.keys()];
    for (let i = 0; i < addrs.length; i += 20) {
      const chunk = addrs.slice(i, i + 20);
      const utxos: any[] = await rpc.call('get_utxos', chunk).catch(() => []);
      const stxos: any[] = await rpc.call('get_stxos', chunk).catch(() => []);
      for (const u of [...utxos.map(x => [x.outpoint, x.output]), ...stxos.map(x => [x.outpoint, x.output?.output])]) {
        if (u[1]?.content !== undefined) {
          this.fills.set(outPoint(u[0]).key, u[1].content);
          this.dirtyFills = true;
        }
      }
    }
    if (this.dirtyFills) {
      this.dirtyFills = false;
      this.rebuild(); // outputs and the inputs spending them take the filled content
      this.saveCache(true);
    }
  }

  /** stateUtxos: follow list_utxos for the outputs the chain's state makes and consumes without a tx */
  private async reconcile(): Promise<void> {
    const tip = this.tipHeight();
    if (!this.chain.stateUtxos || !this.ready || tip < 0 || tip !== this.nodeTip) {
      return;
    }
    const list = await rpc.call<any[]>('list_utxos');
    if (this.tipHeight() !== tip || (await rpc.call<number>('getblockcount')) - 1 !== tip) {
      return; // a block came in meanwhile: next round
    }
    const live = new Map<string, any>(list.map(u => [outPoint(u.outpoint).key, u]));
    let changed = false;
    for (const ref of this.outputs.values()) {
      if (!ref.spent && !live.has(ref.key)) {
        this.stateSpent.set(ref.key, tip);
        changed = true;
      }
    }
    for (const [key, u] of live) {
      if (!this.outputs.has(key) && !this.stateOutputs.has(key)) {
        this.stateOutputs.set(key, { outpoint: u.outpoint, output: { address: u.output.address, content: u.output.content, memo: u.output.memo ?? null }, height: tip });
        changed = true;
      }
    }
    if (changed) {
      this.rebuild();
      this.saveCache(true);
    }
    this.settled = tip;
  }

  /**
   * The highest block whose outputs are final in the index: the tip, but on a chain whose state moves sats without a
   * tx (stateUtxos), the tip list_utxos was last followed at (state outputs are filed under the tip they were first
   * seen at). The Core view (core.ts) shows no block above it, so that its blocks do not change once read.
   */
  settledHeight(): number {
    const tip = this.tipHeight();
    return this.chain.stateUtxos ? Math.min(tip, this.settled) : tip;
  }

  // ------------------------------------------------------------------ queries
  // Paging: `before` is exclusive (rows strictly below that height). Lists with several rows per height (deposits,
  // withdrawals, address txs) end a page only between heights: the rows of the last height all come in the same
  // page, even past `limit`, so paging on with the last row's height skips none.

  tipHeight(): number {
    return this.blocks.length - 1;
  }

  nodeTipHeight(): number {
    return this.nodeTip;
  }

  timeAt(height: number): number | null {
    return this.blocks[height]?.stored.main?.time ?? null;
  }

  counts(): { blocks: number; txs: number; addresses: number; deposits: { count: number; amount: number }; withdrawals: { count: number; amount: number } } {
    return {
      // distinct txids (BitNames' zero-input txs recur in several blocks), coinbases left out
      blocks: this.blocks.length, txs: this.txs.size - this.blocks.length, addresses: this.addresses.size,
      deposits: { count: this.depositList.length, amount: this.depositList.reduce((s, d) => s + d.ref.value, 0) },
      withdrawals: { count: this.withdrawalList.length, amount: this.withdrawalList.reduce((s, w) => s + (w.content.value ?? 0), 0) },
    };
  }

  /** The pending withdrawal bundle as the node builds it (not yet submitted); its m6id is the blinded M6 txid */
  async pendingBundle(): Promise<PendingBundle | null> {
    const b = await rpc.call('pending_withdrawal_bundle').catch(() => null);
    if (!b || !b.tx) {
      return null;
    }
    const net = { ...bitcoinjs.networks.bitcoin, bech32: NETWORK.bech32 };
    const tx = new bitcoinjs.Transaction();
    tx.version = b.tx.version ?? 2;
    tx.locktime = b.tx.lock_time ?? 0;
    const fees = new Map<string, number>();
    const keys = new Set<string>();
    for (const [op, out] of b.spend_utxos ?? []) {
      keys.add(outPoint(op).key);
      const c = this.content(out.content);
      if (c.mainAddress) {
        fees.set(c.mainAddress, (fees.get(c.mainAddress) ?? 0) + (c.mainFee ?? 0));
      }
    }
    const payouts: PendingBundle['payouts'] = [];
    for (const o of b.tx.output ?? []) {
      const script = Buffer.from(o.script_pubkey, 'hex');
      tx.addOutput(script, Number(o.value));
      if (script[0] === 0x6a) {
        continue; // OP_RETURN: the bundle's fee and hash
      }
      let address: string;
      try {
        address = bitcoinjs.address.fromOutputScript(script, net);
      } catch (e) {
        address = o.script_pubkey;
      }
      payouts.push({ address, amount: Number(o.value), fee: fees.get(address) ?? 0 });
    }
    return { m6id: tx.getId(), payouts, total: payouts.reduce((s, p) => s + p.amount, 0), keys };
  }

  shielded(): any {
    return { ...this.shieldedTotals };
  }

  /** AMM pools seen in the index: the asset pairs of LP tokens (filled content) */
  ammPools(): [string, string][] {
    const seen = new Map<string, [string, string]>();
    for (const ref of this.outputs.values()) {
      const r = ref.content.raw?.AmmLpToken;
      if (ref.content.type === 'ammLpToken' && r?.asset0 !== undefined) {
        seen.set(`${r.asset0}:${r.asset1}`, [r.asset0, r.asset1]);
      }
    }
    return [...seen.values()];
  }

  private outputView(r: OutRef): Output {
    return { vout: r.vout, address: r.address, content: r.content, value: r.value, memo: r.memo, spent: r.spent };
  }

  private txView(t: TxEntry): any {
    return {
      txid: t.txid, index: t.index, inputs: t.inputs, outputs: t.outputs.map(r => this.outputView(r)), fee: t.fee, size: t.size,
      data: this.chain.data ? this.chain.data(t.data) : liftData(t.data), shielded: t.shielded, signers: t.signers,
      market: this.marketOf(t),
    };
  }

  /** A market tx's `market` (L2-API.md), else null */
  marketOf(t: TxEntry): MarketView | null {
    if (!t.market) {
      return null;
    }
    const { trader, ...terms } = t.market.terms;
    return {
      ...terms, applied: t.market.applied, cost: t.market.cost,
      payouts: t.payouts.map((r, i) => ({
        kind: t.market?.kinds[i] ?? 'buyChange', outpoint: r.outpoint, vout: r.vout, address: r.address, value: r.value, spent: r.spent,
      })),
    };
  }

  /** A tx of the index (the coinbase too, with index -1), or null */
  tx(txid: string): any {
    const t = this.txs.get(txid);
    if (!t) {
      return null;
    }
    const b = this.blocks[t.height];
    return {
      txid: t.txid,
      status: { confirmed: true, height: t.height, hash: b.stored.hash, time: b.stored.main?.time ?? null },
      ...this.txView(t),
    };
  }

  /** A mempool tx (list_mempool's entry) in the contract's shape: inputs resolved against the index */
  mempoolTx(entry: any): any {
    const t = entry.tx ?? {};
    let inSum = 0;
    let resolved = true;
    const inputs: Input[] = (t.inputs ?? []).map((x: any) => {
      const { key, ...outpoint } = outPoint(this.chain.inputPairs ? x[0] : x);
      const ref = this.outputs.get(key);
      if (!ref) {
        resolved = false;
        return { outpoint, address: null, content: null, value: null };
      }
      inSum += ref.value;
      return { outpoint, address: ref.address, content: ref.content, value: ref.value };
    });
    const outputs: Output[] = (t.outputs ?? []).map((o: any, vout: number) => {
      const content = this.content(o.content);
      return { vout, address: o.address, content, value: valueOf(content), memo: o.memo || null, spent: null };
    });
    const outSum = outputs.reduce((s, o) => s + o.value, 0);
    const terms = this.chain.market?.terms(t.data ?? null) ?? null;
    let market: MarketView | null = null;
    if (terms) {
      const { trader, ...rest } = terms;
      market = { ...rest, applied: null as any, cost: null, payouts: [] }; // the block decides
    }
    return {
      txid: entry.txid, status: { confirmed: false }, index: null, inputs, outputs,
      // a market tx pays the fixed miner fee; the rest goes to the market and back as payouts once mined
      fee: terms ? (this.chain.market as NonNullable<L2Chain['market']>).fee : resolved ? Math.max(0, inSum - outSum) : 0,
      size: entry.size ?? null, data: this.chain.data ? this.chain.data(t.data ?? null) : liftData(t.data ?? null), shielded: null,
      signers: (entry.authorizations ?? []).map((a: any) => addressOfKey(a?.verifying_key)),
      market,
    };
  }

  /**
   * An address's unconfirmed txs among list_mempool's entries: those with an input it owns or an output to it, and
   * their net effect on its balance (a market tx counts its inputs only: what comes back is known once mined)
   */
  addressMempool(a: string, entries: any[]): { txs: any[]; delta: number } {
    const txs: any[] = [];
    let delta = 0;
    for (const e of entries ?? []) {
      if (typeof e?.txid !== 'string' || this.txs.has(e.txid)) {
        continue;
      }
      const t = this.mempoolTx(e);
      const mine = t.inputs.some((i: Input) => i.address === a) || t.outputs.some((o: Output) => o.address === a);
      if (!mine) {
        continue;
      }
      const d = t.outputs.filter((o: Output) => o.address === a).reduce((s: number, o: Output) => s + o.value, 0)
        - t.inputs.filter((i: Input) => i.address === a).reduce((s: number, i: Input) => s + (i.value ?? 0), 0);
      txs.push({ ...t, delta: d });
      delta += d;
    }
    return { txs, delta };
  }

  heightOf(id: string): number | null {
    if (/^\d{1,10}$/.test(id)) { // a height; a 64-digit id is a hash
      const h = Number(id);
      return h < this.blocks.length ? h : null;
    }
    return this.byHash.get(id) ?? null;
  }

  /** The height of a block hash (never a height: a hash can be all digits) */
  heightOfHash(hash: string): number | null {
    return this.byHash.get(hash) ?? null;
  }

  hasTx(txid: string): boolean {
    return this.txs.has(txid);
  }

  hasAddress(a: string): boolean {
    return this.addresses.has(a);
  }

  blockSummaries(before: number | null, limit: number): BlockSummary[] {
    const out: BlockSummary[] = [];
    for (let h = Math.min(before ?? this.blocks.length, this.blocks.length) - 1; h >= 0 && out.length < limit; h--) {
      out.push(this.blocks[h].summary);
    }
    return out;
  }

  block(height: number): any {
    const b = this.blocks[height];
    const s = b.stored;
    return {
      ...b.summary,
      merkleRoot: s.merkleRoot, prevMainHash: s.prevMainHash, nextHash: this.blocks[height + 1]?.stored.hash ?? null,
      coinbase: { txid: s.coinbase.txid, outputs: b.coinbase.outputs.map(r => this.outputView(r)) },
      txs: b.txs.map(t => this.txView(t)),
      deposits: b.deposits.map(r => this.depositView(r, height)),
      bundleSpends: s.bundleSpends.map(x => { const { key, ...op } = outPoint(x.outpoint); return { outpoint: op, m6id: x.m6id }; }),
    };
  }

  private depositView(r: OutRef, height: number): any {
    const b = this.blocks[height].stored;
    return {
      outpoint: r.outpoint, mainTxid: r.outpoint.txid, address: r.address, burned: r.address === BURN_ADDRESS, amount: r.value,
      height, hash: b.hash, time: b.main?.time ?? null, spent: r.spent,
    };
  }

  deposits(before: number | null, limit: number): any[] {
    const out: any[] = [];
    let last = -1;
    for (let i = this.depositList.length - 1; i >= 0 && !(out.length >= limit && this.depositList[i].height !== last); i--) {
      const d = this.depositList[i];
      if (before === null || d.height < before) {
        out.push(this.depositView(d.ref, d.height));
        last = d.height;
      }
    }
    return out;
  }

  withdrawals(before: number | null, limit: number, pending: PendingBundle | null): any[] {
    const out: any[] = [];
    let last = -1;
    for (let i = this.withdrawalList.length - 1; i >= 0 && !(out.length >= limit && this.withdrawalList[i].height !== last); i--) {
      const r = this.withdrawalList[i];
      if (before !== null && r.height >= before) {
        continue;
      }
      last = r.height;
      let status: 'pending' | 'bundled' | 'paid' = 'pending';
      let m6id: string | null = null;
      if (r.spent?.kind === 'bundle') {
        m6id = r.m6id;
        status = m6id && this.paid.has(m6id) ? 'paid' : 'bundled';
      } else if (!r.spent && pending?.keys.has(r.key)) {
        m6id = pending.m6id;
        status = 'bundled';
      }
      out.push({
        txid: r.txid, vout: r.vout, height: r.height, time: this.timeAt(r.height), address: r.address, mainAddress: r.content.mainAddress ?? null,
        amount: r.content.value ?? 0, mainFee: r.content.mainFee ?? 0, status, m6id,
      });
    }
    return out;
  }

  address(a: string, before: number | null, limit: number): any {
    const e = this.addresses.get(a);
    if (!e) {
      return null;
    }
    const txs: any[] = [];
    let last = -1;
    for (let i = e.txs.length - 1; i >= 0 && !(txs.length >= limit && e.txs[i].height !== last); i--) {
      const x = e.txs[i];
      if (before === null || x.height < before) {
        txs.push({ txid: x.txid, height: x.height, time: this.timeAt(x.height), delta: x.delta, kind: x.kind });
        last = x.height;
      }
    }
    const utxos = [...e.utxos].map(k => this.outputs.get(k) as OutRef).filter(r => !!r)
      .sort((x, y) => y.height - x.height).slice(0, 500)
      .map(r => ({ outpoint: r.outpoint, content: r.content, value: r.value, height: r.height }));
    return {
      address: a, funded: { ...e.funded }, spent: { ...e.spent }, balance: e.funded.sum - e.spent.sum, txs, utxos,
    };
  }

  // ------------------------------------------------------------------ for the modules' feature views
  // (chain/modules/<chain>/: assets, names, markets, the shielded pool, swaps, top addresses, derived from the index)

  /** Changes whenever what the index holds does (a block, a reorg, filled content, state outputs): a cache key */
  generation(): string {
    const top = this.blocks[this.blocks.length - 1];
    return [this.blocks.length, top?.stored.hash ?? '', this.fills.size, this.stateOutputs.size, this.stateSpent.size].join(':');
  }

  /** Every tx of the index, oldest first, coinbases left out: inputs and outputs resolved, TxData lifted */
  forEachTx(fn: (t: { txid: string; height: number; time: number | null; index: number; inputs: Input[]; outputs: Output[]; fee: number;
    data: any; shielded: Shielded | null; signers: (string | null)[] }) => void): void {
    for (const b of this.blocks) {
      const time = b.stored.main?.time ?? null;
      for (const t of b.txs) {
        fn({ ...this.txView(t), height: t.height, time });
      }
    }
  }

  /** Every unspent output, with the tx that made it (null: a deposit or the chain's state) */
  forEachUtxo(fn: (u: { outpoint: OutPoint; txid: string | null; height: number; address: string; content: Content; value: number }) => void): void {
    for (const r of this.outputs.values()) {
      if (!r.spent) {
        fn({ outpoint: r.outpoint, txid: r.txid, height: r.height, address: r.address, content: r.content, value: r.value });
      }
    }
  }

  /** Every address with its balance and counts */
  forEachAddress(fn: (a: { address: string; balance: number; funded: { count: number; sum: number }; spent: { count: number; sum: number };
    txs: number; utxos: number; first: number | null; last: number | null }) => void): void {
    for (const [address, e] of this.addresses) {
      fn({
        address, balance: e.funded.sum - e.spent.sum, funded: { ...e.funded }, spent: { ...e.spent }, txs: e.txs.length, utxos: e.utxos.size,
        first: e.txs[0]?.height ?? null, last: e.txs[e.txs.length - 1]?.height ?? null,
      });
    }
  }

  // ------------------------------------------------------------------ for the Core facade (core.ts)

  /** The index's entry of a block (null: not indexed) */
  blockEntry(height: number): BlockEntry | null {
    return this.blocks[height] ?? null;
  }

  /** The latest occurrence of a txid (coinbases too) */
  txEntry(txid: string): TxEntry | null {
    return this.txs.get(txid) ?? null;
  }

  /** An output by its key (outPoint(json).key) */
  outRef(key: string): OutRef | null {
    return this.outputs.get(key) ?? null;
  }

  /** Every output the index holds, spent or not */
  forEachOutRef(fn: (r: OutRef) => void): void {
    for (const r of this.outputs.values()) {
      fn(r);
    }
  }

  /** A tx's TxData as the contract's data */
  dataOf(raw: any): any {
    return this.chain.data ? this.chain.data(raw ?? null) : liftData(raw ?? null);
  }

  /** Tests: replace what the index holds with these blocks (as the cache would) */
  loadBlocks(stored: StoredBlock[]): void {
    this.stored = stored;
    this.rebuild();
    this.ready = true;
    this.settled = stored.length - 1;
    this.nodeTip = stored.length - 1;
  }

  /** Σ of address balances (for checks against sidechain_wealth) */
  balanceSum(): number {
    let s = 0;
    for (const e of this.addresses.values()) {
      s += e.funded.sum - e.spent.sum;
    }
    return s;
  }
}

export default new L2Index();
