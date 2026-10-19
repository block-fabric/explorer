import * as fs from 'fs';
import * as path from 'path';
import config from '../config';
import logger from '../logger';
import bitcoinClient from '../api/bitcoin/bitcoin-client';
import { PROFILE, SIDECHAIN_PROFILES, profileBySlot } from './profile';
import { Bip300Message, VOTE_ABSTAIN, VOTE_DOWNVOTE, VOTE_FORMS, parseBip300Script } from './bip300';
const rpcApi = require('../rpc-api/index');

/**
 * The drivechain index.
 *
 * Mainchain profile ('chains'): every block of the Chains chain, decoded for BIP300/301: sidechain proposals (M1)
 * and acks (M2), withdrawal bundles proposed (M3) and voted on (M4), BMM accepts (M7) and requests/bids (M8),
 * deposits into and withdrawals out of each sidechain's escrow, bundles closed, and the pending bundles with
 * their scores. Coinbase messages are decoded here; escrow changes and bundle state come from the node's
 * getsidechainevents (one call per active slot per 2000 blocks).
 *
 * Sidechain profiles: the same scan of the mainchain, for this sidechain's slot only. It maps each sidechain
 * block to the Chains block that committed to it (M7) and the bid paid for it (M8), and lists the deposits
 * and withdrawals of this sidechain.
 *
 * In memory, saved to <CACHE_DIR>/chain/drivechain-<profile>.json; reorgs are found by comparing stored hashes
 * with the node's.
 */

const sats = (v: number | undefined | null): number => Math.round((v ?? 0) * 1e8);

export interface VoteEntry {
  slot: number;
  name: string;
  value: number;               // raw entry; 0xffff abstain, 0xfffe downvote, else bundle index
  vote: 'abstain' | 'downvote' | 'upvote';
  bundle?: string;             // the bundle an upvote names
}

export interface BmmAccept {
  slot: number;
  name: string;
  sideBlock: string;
  requestTxid?: string;
  bid?: number;                // sats: the fee of the M8 transaction
}

export interface BmmRequest {
  slot: number;
  name: string;
  sideBlock: string;
  prevMainBlock?: string;
  txid: string;
  bid: number;
  accepted: boolean;
}

export interface Deposit {
  slot: number;
  name: string;
  txid: string;
  amount: number;              // sats added to the escrow
  destination: string;
  burnindex: number;
}

export interface Withdrawal {
  slot: number;
  name: string;
  txid: string;
  bundle: string;
  amount: number;              // sats paid out (sum of payouts)
  escrowDelta: number;         // sats: the change of the escrow (negative: what left it, payouts + fee)
  payouts: { amount: number; script: string }[];
}

/** Who mined a mainchain block and what it earned */
export interface MinerInfo {
  tag: string | null;          // the pool or miner, from the coinbase text
  coinbaseText: string;        // the readable parts of the coinbase
  reward: number;              // sats: everything the coinbase pays
  fees: number;                // sats: the block's transaction fees (BMM bids included)
  subsidy: number;             // sats: reward - fees
  txCount: number;
  weight: number;
}

export interface DrivechainBlock {
  height: number;
  hash: string;
  time: number;
  proposals: { slot: number; hash: string; title?: string; description?: string; version?: number; hashId1?: string; hashId2?: string }[]; // M1
  acks: { slot: number; hash: string; title?: string }[];                     // M2
  bundlesProposed: { slot: number; name: string; hash: string }[];            // M3
  votes: { form: number; formName: string; entries: VoteEntry[] } | null;    // M4
  bmm: BmmAccept[];                                                           // M7
  bmmRequests: BmmRequest[];                                                  // M8
  deposits: Deposit[];
  withdrawals: Withdrawal[];
  bundlesClosed: { slot: number; name: string; hash: string; paid: boolean }[];
  pending: { [slot: number]: { hash: string; score: number }[] };
  miner: MinerInfo | null;     // mainchain profile only
  scanned: boolean;            // the block itself was read (coinbase + M8); false = only the node's events
}

export interface DrivechainBlockSummary {
  height: number;
  hash: string;
  bmm: { slot: number; name: string; bid?: number }[];
  bmmRequests: number;
  deposits: number;
  depositAmount: number;
  withdrawals: number;
  withdrawalAmount: number;
  votes: { slot: number; name: string; vote: string }[];
  proposals: number;
  acks: number;
  bundlesProposed: number;
  bundlesClosed: number;
  bids: number;
  miner: string | null;
  fees: number | null;
}

interface SlotInfo {
  slot: number;
  title: string;
  activationheight: number;
}

const CACHE_VERSION = 2;

function slotName(slot: number, sidechains: SlotInfo[]): string {
  return sidechains.find(s => s.slot === slot)?.title || profileBySlot(slot)?.name || `Slot ${slot}`;
}

/** Known coinbase tags of Chains miners and pools -> display name */
const KNOWN_TAGS: [RegExp, string][] = [
  [/BlockFab/i, 'BlockFabric'],
  [/chains-qt|chains-app|chainsd/i, 'Chains node (solo)'],
];

/** The readable runs (4+ printable characters) of a coinbase script, the block height push left out */
export function coinbaseText(hex: string): string[] {
  const b = Buffer.from(hex || '', 'hex');
  const runs: string[] = [];
  let cur = '';
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (c >= 0x20 && c < 0x7f) {
      cur += String.fromCharCode(c);
    } else {
      if (cur.length >= 4) { runs.push(cur.trim()); }
      cur = '';
    }
  }
  if (cur.length >= 4) { runs.push(cur.trim()); }
  return runs.filter(r => r.length >= 4);
}

function minerInfo(block: any): MinerInfo {
  const cb = block.tx[0];
  const runs = coinbaseText(cb.vin?.[0]?.coinbase);
  const text = runs.join(' · ');
  let tag: string | null = null;
  for (const [re, name] of KNOWN_TAGS) {
    if (re.test(text)) { tag = name; break; }
  }
  if (!tag && runs.length) {
    tag = runs.reduce((a, r) => r.length > a.length ? r : a, '').slice(0, 32);
  }
  const reward = (cb.vout as any[]).reduce((a, o) => a + sats(o.value), 0);
  const fees = (block.tx as any[]).slice(1).reduce((a, t) => a + sats(t.fee), 0);
  return { tag, coinbaseText: text.slice(0, 120), reward, fees, subsidy: reward - fees, txCount: block.tx.length, weight: block.weight };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

class Drivechain {
  private blocks: Map<number, DrivechainBlock> = new Map();
  private byHash: Map<string, number> = new Map();
  private bySideBlock: Map<string, number> = new Map(); // sidechain block hash -> mainchain height (sidechain profiles)
  private byTxid: Map<string, number> = new Map();       // deposit / withdrawal / M8 txid -> mainchain height
  private sidechains: SlotInfo[] = [];
  private genesis = '';
  private running = false;
  private again = false;
  private ready = false;
  private client: any;
  private lastSave = 0;

  constructor() {
    if (PROFILE.mainchain) {
      this.client = bitcoinClient;
    } else {
      const r = config.CHAIN.MAINCHAIN_RPC;
      this.client = new rpcApi.Client({
        host: r.HOST, port: r.PORT, user: r.USERNAME, pass: r.PASSWORD, timeout: r.TIMEOUT,
        cookie: r.COOKIE ? r.COOKIE_PATH : undefined,
      });
    }
  }

  get enabled(): boolean {
    return true;
  }

  get mainchainClient(): any {
    return this.client;
  }

  isReady(): boolean {
    return this.ready;
  }

  start(): void {
    if (!this.enabled) {
      return;
    }
    this.loadCache();
    void this.run();
    // the sidechain profiles follow the mainchain on their own: a sidechain block can come long after the
    // mainchain block that carried it
    setInterval(() => void this.run(), PROFILE.mainchain ? 30000 : 10000);
  }

  onNewBlock(_block: any): void {
    if (this.enabled) {
      void this.run();
    }
  }

  private cacheFile(): string {
    return path.join(config.MEMPOOL.CACHE_DIR, 'chain', `drivechain-${PROFILE.id}-${config.CHAIN.NETWORK}.json`);
  }

  private loadCache(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.cacheFile(), 'utf8'));
      if (raw.version !== CACHE_VERSION) {
        return;
      }
      this.genesis = raw.genesis;
      for (const b of raw.blocks as DrivechainBlock[]) {
        this.add(b);
      }
      logger.info(`Drivechain index: ${this.blocks.size} blocks from the cache`);
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
      fs.writeFileSync(tmp, JSON.stringify({ version: CACHE_VERSION, genesis: this.genesis, blocks: [...this.blocks.values()] }));
      fs.renameSync(tmp, this.cacheFile());
    } catch (e) {
      logger.warn(`Drivechain index: cannot save the cache: ${e instanceof Error ? e.message : e}`);
    }
  }

  private maxH = -1;
  private minH = Infinity;

  private top(): number {
    return this.maxH;
  }

  private bottom(): number {
    return this.minH === Infinity ? 0 : this.minH;
  }

  private add(b: DrivechainBlock): void {
    this.blocks.set(b.height, b);
    this.maxH = Math.max(this.maxH, b.height);
    this.minH = Math.min(this.minH, b.height);
    this.byHash.set(b.hash, b.height);
    for (const a of b.bmm) {
      if (PROFILE.slot === a.slot) {
        this.bySideBlock.set(a.sideBlock, b.height);
      }
    }
    for (const d of b.deposits) { this.byTxid.set(d.txid, b.height); }
    for (const w of b.withdrawals) { this.byTxid.set(w.txid, b.height); }
    for (const r of b.bmmRequests) { this.byTxid.set(r.txid, b.height); }
  }

  private remove(height: number): void {
    const b = this.blocks.get(height);
    if (!b) {
      return;
    }
    this.blocks.delete(height);
    this.byHash.delete(b.hash);
    if (height === this.maxH) {
      while (this.maxH >= 0 && !this.blocks.has(this.maxH)) { this.maxH--; }
    }
    if (!this.blocks.size) {
      this.maxH = -1;
      this.minH = Infinity;
    } else if (height === this.minH) {
      while (!this.blocks.has(this.minH)) { this.minH++; }
    }
    for (const a of b.bmm) {
      if (this.bySideBlock.get(a.sideBlock) === height) { this.bySideBlock.delete(a.sideBlock); }
    }
    for (const t of [...b.deposits, ...b.withdrawals, ...b.bmmRequests]) {
      if (this.byTxid.get(t.txid) === height) { this.byTxid.delete(t.txid); }
    }
  }

  private async run(): Promise<void> {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.again = false;
        await this.sync();
      } while (this.again);
      this.ready = true;
    } catch (e) {
      logger.warn(`Drivechain index: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.running = false;
    }
  }

  private async sync(): Promise<void> {
    const genesis: string = await this.client.getBlockHash(0);
    if (this.genesis && this.genesis !== genesis) {
      logger.notice('Drivechain index: the mainchain was started over; indexing again');
      for (const h of [...this.blocks.keys()]) { this.remove(h); }
    }
    this.genesis = genesis;
    const tip: number = await this.client.getBlockCount();

    const active: any[] = await this.client.call('listactivesidechains');
    this.sidechains = active.map(s => ({ slot: s.slot, title: s.title, activationheight: s.activationheight }));

    // reorg: walk back from the highest stored block until its hash is the node's
    let top = this.blocks.size ? this.top() : -1;
    while (top >= 0) {
      const b = this.blocks.get(top);
      if (b && top <= tip && b.hash === await this.client.getBlockHash(top)) {
        break;
      }
      this.remove(top);
      top--;
    }
    // drop anything below the backfill window
    const from = Math.max(0, tip - config.CHAIN.BACKFILL_BLOCKS + 1);
    if (top < from - 1) {
      top = from - 1;
    }
    if (top >= tip) {
      return;
    }
    const start = top + 1;
    if (tip - start > 10) {
      logger.info(`Drivechain index: blocks ${start} to ${tip}`);
    }
    for (let h = start; h <= tip; h += 500) {
      await this.scanRange(h, Math.min(tip, h + 499));
      this.saveCache(h + 500 > tip);
    }
  }

  /** getsidechainevents for the slots this profile follows, heights first..last; keyed by height then slot */
  private async events(first: number, last: number): Promise<Map<number, Map<number, any>>> {
    const out = new Map<number, Map<number, any>>();
    const slots = PROFILE.mainchain ? this.sidechains.map(s => s.slot) : [PROFILE.slot as number];
    for (const slot of slots) {
      for (let h = first; h <= last; h += 2000) {
        let evs: any[] = [];
        try {
          evs = await this.client.call('getsidechainevents', slot, h, Math.min(2000, last - h + 1));
        } catch (e) {
          continue; // the slot is not active (yet)
        }
        for (const ev of evs) {
          if (!out.has(ev.height)) { out.set(ev.height, new Map()); }
          out.get(ev.height)!.set(slot, ev);
        }
      }
    }
    return out;
  }

  private async scanRange(first: number, last: number): Promise<void> {
    const evFirst = Math.max(0, first - 1); // the pending bundles before `first`, for its votes
    const events = await this.events(evFirst, last);
    const heights: number[] = [];
    for (let h = first; h <= last; h++) { heights.push(h); }

    // the blocks themselves: every block on the mainchain profile; on a sidechain profile only those that
    // carried one of its blocks (to find the bid)
    const wanted = PROFILE.mainchain ? heights : heights.filter(h => events.get(h)?.get(PROFILE.slot as number)?.bmm);
    const raw = new Map<number, any>();
    await mapLimit(wanted, 4, async (h) => {
      const hash = await this.client.getBlockHash(h);
      raw.set(h, await this.client.getBlock(hash, 2));
    });

    let lastVotes: VoteEntry[] = this.blocks.get(first - 1)?.votes?.entries ?? [];
    for (const h of heights) {
      const ev = events.get(h) ?? new Map();
      const prevEv = events.get(h - 1) ?? new Map();
      let hash: string | undefined = raw.get(h)?.hash ?? [...ev.values()][0]?.hash;
      if (!hash) {
        hash = await this.client.getBlockHash(h);
      }
      const time = raw.get(h)?.time ?? [...ev.values()][0]?.time ?? 0;
      const b = this.decode(h, hash as string, time, raw.get(h), ev, prevEv, lastVotes);
      if (b.votes) {
        lastVotes = b.votes.entries;
      }
      this.add(b);
    }
  }

  private decode(height: number, hash: string, time: number, block: any, ev: Map<number, any>, prevEv: Map<number, any>,
    lastVotes: VoteEntry[]): DrivechainBlock {
    const sc = this.sidechains;
    const b: DrivechainBlock = {
      height, hash, time,
      proposals: [], acks: [], bundlesProposed: [], votes: null, bmm: [], bmmRequests: [],
      deposits: [], withdrawals: [], bundlesClosed: [], pending: {}, miner: null, scanned: !!block,
    };
    const pendingBefore = (slot: number): { hash: string; score: number }[] => prevEv.get(slot)?.pending ?? this.blocks.get(height - 1)?.pending?.[slot] ?? [];

    // escrow changes and bundle state, per slot
    for (const [slot, e] of ev) {
      const name = slotName(slot, sc);
      if (e.bmm) {
        b.bmm.push({ slot, name, sideBlock: e.bmm });
      }
      for (const d of e.deposits ?? []) {
        if (d.destination === 'D' && d.bundle) {
          const payouts = (d.payouts ?? []).map((p: any) => ({ amount: sats(p.amount), script: p.script }));
          b.withdrawals.push({ slot, name, txid: d.txid, bundle: d.bundle, payouts, amount: payouts.reduce((a: number, p: any) => a + p.amount, 0), escrowDelta: sats(d.amount) });
        } else {
          b.deposits.push({ slot, name, txid: d.txid, amount: sats(d.amount), destination: d.destination, burnindex: d.burnindex });
        }
      }
      for (const c of e.bundles ?? []) {
        b.bundlesClosed.push({ slot, name, hash: c.hash, paid: !!c.paid });
      }
      if (!block) {
        for (const p of e.proposed ?? []) {
          b.bundlesProposed.push({ slot, name, hash: p });
        }
      }
      if ((e.pending ?? []).length) {
        b.pending[slot] = e.pending;
      }
    }

    if (!block) {
      return b;
    }

    if (PROFILE.mainchain) {
      b.miner = minerInfo(block);
      if (height === 0) {
        b.miner.tag = 'Genesis';
      }
    }

    // coinbase messages
    let msgs: Bip300Message[] = [];
    for (const out of block.tx[0].vout) {
      const m = parseBip300Script(out.scriptPubKey?.hex);
      if (m) { msgs.push(m); }
    }
    for (const m of msgs) {
      switch (m.kind) {
        case 'M1':
          b.proposals.push({ slot: m.slot!, hash: m.hash!, title: m.title, description: m.description, version: m.version, hashId1: m.hashId1, hashId2: m.hashId2 });
          break;
        case 'M2':
          b.acks.push({ slot: m.slot!, hash: m.hash! });
          break;
        case 'M3':
          b.bundlesProposed.push({ slot: m.slot!, name: slotName(m.slot!, sc), hash: m.hash! });
          break;
        case 'M7':
          if (!b.bmm.some(a => a.slot === m.slot)) {
            b.bmm.push({ slot: m.slot!, name: slotName(m.slot!, sc), sideBlock: m.hash! });
          }
          break;
        case 'M4': {
          // votes refer to the sidechains active before this block, in slot order, and to their pending bundles then
          const votable = sc.filter(s => s.activationheight < height).sort((x, y) => x.slot - y.slot);
          const form = m.form ?? 0;
          let entries: VoteEntry[] = [];
          if (form === 1 || form === 2) {
            entries = (m.votes ?? []).map((v, i) => {
              const s = votable[i];
              const slot = s ? s.slot : -1;
              const e: VoteEntry = { slot, name: s ? s.title : '?', value: v, vote: v === VOTE_ABSTAIN ? 'abstain' : v === VOTE_DOWNVOTE ? 'downvote' : 'upvote' };
              if (e.vote === 'upvote' && s) {
                e.bundle = pendingBefore(slot)[v]?.hash;
              }
              return e;
            });
          } else if (form === 0) {
            entries = lastVotes.map(e => ({ ...e }));
          } else if (form === 3) {
            for (const s of votable) {
              const pend = [...pendingBefore(s.slot)].sort((x, y) => y.score - x.score);
              if (pend.length && pend[0].score >= (pend[1]?.score ?? 0) + 50) {
                entries.push({ slot: s.slot, name: s.title, value: 0, vote: 'upvote', bundle: pend[0].hash });
              }
            }
          }
          b.votes = { form, formName: VOTE_FORMS[form] ?? `form ${form}`, entries };
          break;
        }
      }
    }
    for (const a of b.acks) {
      a.title = this.blocksProposalTitle(a.hash) ?? undefined;
    }

    // M8: BMM requests in this block (output 0 of any transaction); the bid is the transaction's fee
    for (const tx of block.tx.slice(1)) {
      const m = parseBip300Script(tx.vout?.[0]?.scriptPubKey?.hex);
      if (m && m.kind === 'M8') {
        const accepted = b.bmm.some(a => a.slot === m.slot && a.sideBlock === m.hash);
        const req: BmmRequest = { slot: m.slot!, name: slotName(m.slot!, sc), sideBlock: m.hash!, prevMainBlock: m.prevMainBlock, txid: tx.txid, bid: sats(tx.fee), accepted };
        b.bmmRequests.push(req);
        if (accepted) {
          const a = b.bmm.find(x => x.slot === m.slot && x.sideBlock === m.hash)!;
          a.requestTxid = tx.txid;
          a.bid = req.bid;
        }
      }
    }
    if (!PROFILE.mainchain) {
      // a sidechain profile keeps only its own slot
      const own = (x: { slot: number }) => x.slot === PROFILE.slot;
      b.bmmRequests = b.bmmRequests.filter(own);
      b.bmm = b.bmm.filter(own);
      b.proposals = b.proposals.filter(own);
      b.acks = b.acks.filter(own);
      b.bundlesProposed = b.bundlesProposed.filter(own);
      if (b.votes) {
        b.votes.entries = b.votes.entries.filter(own);
      }
    }
    return b;
  }

  private blocksProposalTitle(hash: string): string | null {
    for (const b of this.blocks.values()) {
      const p = b.proposals.find(x => x.hash === hash);
      if (p) { return p.title ?? null; }
    }
    return null;
  }

  // --- queries ---------------------------------------------------------------------------------------

  /** The indexed blocks at heights [from, to], oldest first (missing heights skipped) */
  range(from: number, to: number): DrivechainBlock[] {
    const out: DrivechainBlock[] = [];
    for (let h = Math.max(0, from); h <= to; h++) {
      const b = this.blocks.get(h);
      if (b) { out.push(b); }
    }
    return out;
  }

  tipHeight(): number {
    return this.blocks.size ? this.top() : -1;
  }

  firstHeight(): number {
    return this.blocks.size ? this.bottom() : 0;
  }

  getSidechains(): SlotInfo[] {
    return this.sidechains;
  }

  getBlock(hashOrHeight: string): DrivechainBlock | null {
    const h = /^\d+$/.test(hashOrHeight) ? parseInt(hashOrHeight, 10) : this.byHash.get(hashOrHeight);
    return h === undefined ? null : this.blocks.get(h) ?? null;
  }

  summarize(b: DrivechainBlock): DrivechainBlockSummary {
    return {
      height: b.height,
      hash: b.hash,
      bmm: b.bmm.map(a => ({ slot: a.slot, name: a.name, bid: a.bid })),
      bmmRequests: b.bmmRequests.length,
      deposits: b.deposits.length,
      depositAmount: b.deposits.reduce((a, d) => a + d.amount, 0),
      withdrawals: b.withdrawals.length,
      withdrawalAmount: b.withdrawals.reduce((a, w) => a + w.amount, 0),
      votes: (b.votes?.entries ?? []).filter(e => e.vote !== 'abstain').map(e => ({ slot: e.slot, name: e.name, vote: e.vote })),
      proposals: b.proposals.length,
      acks: b.acks.length,
      bundlesProposed: b.bundlesProposed.length,
      bundlesClosed: b.bundlesClosed.length,
      bids: b.bmm.reduce((a, x) => a + (x.bid ?? 0), 0),
      miner: b.miner?.tag ?? null,
      fees: b.miner?.fees ?? null,
    };
  }

  /** Summaries of the blocks at heights [to - count + 1, to] (newest first) */
  getSummaries(to: number | null, count: number): DrivechainBlockSummary[] {
    const top = to ?? (this.blocks.size ? this.top() : -1);
    const out: DrivechainBlockSummary[] = [];
    for (let h = top; h >= 0 && out.length < count; h--) {
      const b = this.blocks.get(h);
      if (b) { out.push(this.summarize(b)); }
    }
    return out;
  }

  /** A flat list of one kind of event, newest first */
  getEvents(kind: string, slot: number | null, before: number | null, limit: number): any[] {
    const out: any[] = [];
    const top = before !== null ? before - 1 : (this.blocks.size ? this.top() : -1);
    for (let h = top; h >= 0 && out.length < limit; h--) {
      const b = this.blocks.get(h);
      if (!b) {
        if (this.blocks.size && h < this.bottom()) { break; }
        continue;
      }
      const at = { height: b.height, blockHash: b.hash, time: b.time };
      let items: any[] = [];
      switch (kind) {
        case 'bmm': items = b.bmm; break;
        case 'bmm-requests': items = b.bmmRequests; break;
        case 'deposits': items = b.deposits; break;
        case 'withdrawals': items = b.withdrawals; break;
        case 'votes': items = b.votes ? [{ slot: -1, ...b.votes }] : []; break;
        case 'proposals': items = [...b.proposals.map(p => ({ type: 'M1', ...p })), ...b.acks.map(a => ({ type: 'M2', ...a }))]; break;
        case 'bundles': items = [...b.bundlesProposed.map(p => ({ type: 'proposed', ...p })), ...b.bundlesClosed.map(c => ({ type: c.paid ? 'paid' : 'failed', ...c }))]; break;
      }
      for (const it of items) {
        if (slot === null || it.slot === slot || it.slot === -1) {
          out.push({ ...at, ...it });
          if (out.length >= limit) { break; }
        }
      }
    }
    return out;
  }

  /** Totals over the indexed window, per slot */
  getStats(): any {
    const per: Record<number, any> = {};
    const get = (slot: number, name: string) => per[slot] ??= { slot, name, bmmBlocks: 0, bids: 0, deposits: 0, depositAmount: 0, withdrawals: 0, withdrawalAmount: 0, lastBmmHeight: null };
    let first = Infinity, last = -1;
    for (const b of this.blocks.values()) {
      first = Math.min(first, b.height); last = Math.max(last, b.height);
      for (const a of b.bmm) { const s = get(a.slot, a.name); s.bmmBlocks++; s.bids += a.bid ?? 0; s.lastBmmHeight = Math.max(s.lastBmmHeight ?? 0, b.height); }
      for (const d of b.deposits) { const s = get(d.slot, d.name); s.deposits++; s.depositAmount += d.amount; }
      for (const w of b.withdrawals) { const s = get(w.slot, w.name); s.withdrawals++; s.withdrawalAmount += w.amount; }
    }
    return { from: first === Infinity ? null : first, to: last, slots: Object.values(per) };
  }

  /** What a mainchain transaction did for the drivechain (deposit, withdrawal, BMM request), if anything */
  getTx(txid: string): any | null {
    const h = this.byTxid.get(txid);
    if (h === undefined) {
      return null;
    }
    const b = this.blocks.get(h)!;
    return {
      height: b.height,
      blockHash: b.hash,
      deposit: b.deposits.find(d => d.txid === txid) ?? null,
      withdrawal: b.withdrawals.find(w => w.txid === txid) ?? null,
      bmmRequest: b.bmmRequests.find(r => r.txid === txid) ?? null,
    };
  }

  /** Sidechain profiles: the mainchain block that committed to a sidechain block */
  getCarrier(sideBlockHash: string): any | null {
    const h = this.bySideBlock.get(sideBlockHash);
    if (h === undefined) {
      return null;
    }
    const b = this.blocks.get(h)!;
    const a = b.bmm.find(x => x.sideBlock === sideBlockHash);
    return { height: b.height, hash: b.hash, time: b.time, bid: a?.bid ?? null, requestTxid: a?.requestTxid ?? null };
  }

  static sidechainProfiles() {
    return SIDECHAIN_PROFILES;
  }
}

export default new Drivechain();
