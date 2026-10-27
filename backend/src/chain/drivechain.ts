import * as fs from 'fs';
import * as path from 'path';
import * as bitcoinjs from 'bitcoinjs-lib';
import config from '../config';
import logger from '../logger';
import bitcoinClient from '../api/bitcoin/bitcoin-client';
import { PROFILE, profileBySlot } from './profile';
import { HALVING_INTERVAL } from './networks';
import { bitcoinPoolFor, normalizeTag, poolFor } from './pools';
import enforcer, { BundleEvent, ChainInfo, HeaderInfo, PegBlock, SidechainInfo } from './enforcer';
import { Bip300Message, VOTE_ABSTAIN, VOTE_DOWNVOTE, VOTE_FORMS, isDrivechainScript, parseBip300Script } from './bip300';

/**
 * The drivechain index: every eCash block from the BIP300 activation height on, decoded for BIP300/301. Sidechain
 * proposals (M1) and acks (M2), withdrawal bundles proposed (M3) and voted on (M4), BMM accepts (M7) and requests/bids
 * (M8), deposits into and withdrawals out of each sidechain's escrow, bundles paid or failed, and the pending bundles
 * with their vote counts after each block.
 *
 * Two sources, so that either a stock eCash node with a bip300301_enforcer or Backbone can serve it:
 * - the node (Core JSON-RPC): each block, raw (getblock verbosity 0), for the coinbase messages, the M8 requests and
 *   who mined it;
 * - the enforcer (chain/enforcer.ts): the active sidechains, the BIP300 constants, and per sidechain the deposits,
 *   withdrawal bundle events and accepted BMM commitments (GetTwoWayPegData).
 *
 * The pending bundles and their vote counts are replayed here the way the enforcer counts them
 * (lib/validator/task/mod.rs): an M3 adds a bundle with one vote, an upvote adds one to its bundle and takes one from
 * every other bundle of the sidechain with votes, an alarm takes one from all of them, a paid or failed bundle
 * leaves the list (keeping the order of the others, which upvotes index into). After each sync the replay is checked
 * against the enforcer's own counts (GetWithdrawalBundleProposals).
 *
 * In memory, saved to <CACHE_DIR>/chain/drivechain-<profile>-<network>.json; reorgs are found by comparing stored
 * hashes with the node's.
 */

const sats = (v: number | undefined | null): number => Math.round((v ?? 0) * 1e8);

export interface VoteEntry {
  slot: number;
  name: string;
  value: number;               // raw entry; 0xffff abstain, 0xfffe alarm (downvote all), else bundle index
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
  destination: string;         // the sidechain address, as text when it is printable, else hex
  sequence: number;            // the escrow's sequence number after the deposit
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

export interface PendingBundle {
  hash: string;                // M6 id
  score: number;               // vote count
  height: number;              // proposed at
}

/** Who mined a mainchain block and what it earned */
export interface MinerInfo {
  tag: string | null;          // the pool or miner, from the coinbase text
  name: string | null;         // the pool's display name from the mining-pools list, else the tag without slashes
  logo: string | null;         // the pool's logo file under /resources/pool-logos/, if the list has one
  coinbaseText: string;        // the readable parts of the coinbase
  reward: number;              // sats: everything the coinbase pays
  fees: number;                // sats: the block's transaction fees (BMM bids included): reward - subsidy
  subsidy: number;             // sats
  txCount: number;
  weight: number;
  difficulty: number;
  bits: string;
  minDifficulty: boolean;      // mined at the proof-of-work limit (a test network's min-difficulty rule)
  datum: boolean;              // a DATUM coinbase: pool tag and miner tag separated by 0x0f
  poolTag: string | null;      // the first coinbase tag (DATUM: the pool's)
  minerTag: string | null;     // DATUM: the miner's own tag
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
  pending: { [slot: number]: PendingBundle[] };                              // after this block
  miner: MinerInfo | null;
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
  miner: string | null;        // the pool's display name (the coinbase tag without slashes when it is not in the list)
  minerLogo: string | null;    // the pool's logo file under /resources/pool-logos/
  minerTag: string | null;
  datum: boolean;
  fees: number | null;
}

const CACHE_VERSION = 4; // 4: eCash, from the enforcer

/** Blocks read per step: the node's blocks are full Bitcoin-size blocks, and the node also serves a pool */
const STEP = 50;

/** Known coinbase tags of eCash miners and pools -> display name */
const KNOWN_TAGS: [RegExp, string][] = [
  [/BlockFab/i, 'BlockFabric'],
];

/** The compact proof-of-work limit (Bitcoin's, on every eCash network) */
const POW_LIMIT_BITS = 0x1d00ffff;

/** The readable runs (4+ printable characters) of a coinbase script, the block height push left out */
export function coinbaseText(hex: string): string[] {
  const b = Buffer.from(hex || '', 'hex');
  const runs: string[] = [];
  let cur = '';
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (c >= 0x20 && c < 0x7f && !'<>&"\''.includes(String.fromCharCode(c))) {
      cur += String.fromCharCode(c);
    } else {
      if (cur.length >= 4) { runs.push(cur.trim()); }
      cur = '';
    }
  }
  if (cur.length >= 4) { runs.push(cur.trim()); }
  return runs.filter(r => r.length >= 4);
}

/**
 * The tags of a coinbase: the push after the block height. DATUM (OCEAN's protocol, BlockFabric) writes the pool's
 * tag and the miner's own tag in it, separated by 0x0f (as upstream's parseDATUMTemplateCreator reads it).
 */
export function coinbaseTags(hex: string): { datum: boolean; pool: string | null; miner: string | null } {
  const none = { datum: false, pool: null, miner: null };
  const b = Buffer.from(hex || '', 'hex');
  if (b.length < 2) { return none; }
  let i = 1 + b[0];                 // skip the height push
  if (i >= b.length) { return none; }
  let n = b[i];
  if (n === 0x4c) { i++; n = b[i]; }
  if (!n || i + 1 + n > b.length) { return none; }
  const raw = b.subarray(i + 1, i + 1 + n);
  // printable ASCII only, without HTML's special characters: a miner writes this, and pages show it
  const clean = (x: Buffer) => x.toString('latin1').replace(/[^\x20-\x7e]|[<>&"']/g, '').trim() || null;
  const sep = raw.indexOf(0x0f);
  if (sep >= 0) {
    return { datum: true, pool: clean(raw.subarray(0, sep)), miner: clean(raw.subarray(sep + 1)) };
  }
  return { datum: false, pool: clean(raw), miner: null };
}

/** The difficulty of a compact target, relative to the proof-of-work limit (as the node's RPCs report it) */
export function difficultyOf(bits: number): number {
  const target = (b: number) => (b & 0xffffff) * Math.pow(2, 8 * ((b >>> 24) - 3));
  return target(POW_LIMIT_BITS) / target(bits);
}

export function subsidyAt(height: number): number {
  const halvings = Math.floor(height / HALVING_INTERVAL);
  return halvings >= 64 ? 0 : Math.floor(50 * 1e8 / Math.pow(2, halvings));
}

/** A deposit's sidechain address: as text when every byte is printable, else hex */
export function destinationText(hex: string): string {
  const b = Buffer.from(hex, 'hex');
  return b.length && b.every(c => c >= 0x20 && c < 0x7f) ? b.toString('latin1') : hex;
}

function minerInfo(block: bitcoinjs.Block, height: number): MinerInfo {
  const cb = block.transactions![0];
  const script = cb.ins[0].script.toString('hex');
  const runs = coinbaseText(script);
  const text = runs.join(' · ');
  const tags = coinbaseTags(script);
  let tag: string | null = null;
  for (const [re, name] of KNOWN_TAGS) {
    if (re.test(text)) { tag = name; break; }
  }
  if (!tag && tags.pool && tags.pool.length >= 3) {
    tag = tags.pool.slice(0, 32);
  }
  if (!tag && runs.length) {
    tag = runs.reduce((a, r) => r.length > a.length ? r : a, '').slice(0, 32);
  }
  // a block eCash's list does not know: Bitcoin's pools (Bitcoin's history below the fork), named as upstream names them
  if (!poolFor(tag) && !KNOWN_TAGS.some(([, name]) => name === tag)) {
    const bitcoinPool = bitcoinPoolFor(runs.join(' '), payouts(cb));
    if (bitcoinPool) {
      tag = bitcoinPool.name;
    }
  }
  const pool = poolFor(tag);
  const reward = cb.outs.reduce((a, o) => a + o.value, 0);
  const subsidy = subsidyAt(height);
  return {
    tag, name: pool?.name ?? normalizeTag(tag), logo: pool?.logo ?? null,
    coinbaseText: text.slice(0, 120), reward, fees: Math.max(0, reward - subsidy), subsidy,
    txCount: block.transactions!.length, weight: block.weight(),
    difficulty: difficultyOf(block.bits), bits: block.bits.toString(16).padStart(8, '0'), minDifficulty: block.bits === POW_LIMIT_BITS,
    datum: tags.datum, poolTag: tags.pool, minerTag: normalizeTag(tags.miner),
  };
}

/** The addresses a coinbase pays (Bitcoin's formats, those of every eCash network but testnet's) */
function payouts(cb: bitcoinjs.Transaction): string[] {
  return cb.outs.flatMap(o => { try { return [bitcoinjs.address.fromOutputScript(o.script, bitcoinjs.networks.bitcoin)]; } catch { return []; } });
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

/** The pending bundles of every sidechain, as the enforcer keeps them; changed in place by the replay */
type PendingState = Map<number, PendingBundle[]>;

class Drivechain {
  private blocks: Map<number, DrivechainBlock> = new Map();
  private byHash: Map<string, number> = new Map();
  private byTxid: Map<string, number> = new Map();       // deposit / withdrawal / M8 txid -> mainchain height
  private sidechains: SidechainInfo[] = [];
  private chainInfo: ChainInfo | null = null;
  private genesis = '';
  private running = false;
  private again = false;
  private ready = false;
  private lastSave = 0;
  private maxH = -1;
  private minH = Infinity;

  isReady(): boolean {
    return this.ready;
  }

  getChainInfo(): ChainInfo | null {
    return this.chainInfo;
  }

  start(): void {
    this.loadCache();
    void this.run();
    setInterval(() => void this.run(), 30000);
  }

  onNewBlock(_block: any): void {
    void this.run();
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
        // the cache predates the mining-pools list: fill in the pool names and logos it lacks
        if (b.miner) {
          const pool = poolFor(b.miner.tag);
          b.miner.name = b.miner.name ?? pool?.name ?? normalizeTag(b.miner.tag);
          b.miner.logo = b.miner.logo === undefined ? (pool?.logo ?? null) : b.miner.logo;
          b.miner.minerTag = normalizeTag(b.miner.minerTag);
        }
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

  private add(b: DrivechainBlock): void {
    this.blocks.set(b.height, b);
    this.maxH = Math.max(this.maxH, b.height);
    this.minH = Math.min(this.minH, b.height);
    this.byHash.set(b.hash, b.height);
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
    if (!this.blocks.size) {
      this.maxH = -1;
      this.minH = Infinity;
    } else {
      while (this.maxH >= 0 && !this.blocks.has(this.maxH)) { this.maxH--; }
      while (!this.blocks.has(this.minH)) { this.minH++; }
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
    const genesis: string = await bitcoinClient.getBlockHash(0);
    if (this.genesis && this.genesis !== genesis) {
      logger.notice('Drivechain index: the node follows another chain; indexing again');
      for (const h of [...this.blocks.keys()]) { this.remove(h); }
    }
    this.genesis = genesis;
    this.chainInfo = await enforcer.getChainInfo();
    this.sidechains = (await enforcer.getSidechains()).sort((a, b) => a.slot - b.slot);
    // the enforcer's tip: its events go no further, and the node may be a block ahead of it
    const tip = (await enforcer.getChainTip()).height;

    // reorg: walk back from the highest stored block until its hash is the node's
    let top = this.blocks.size ? this.maxH : -1;
    while (top >= 0) {
      const b = this.blocks.get(top);
      if (b && top <= tip && b.hash === await bitcoinClient.getBlockHash(top)) {
        break;
      }
      this.remove(top);
      top--;
    }
    // from the activation, or HISTORY_BLOCKS before it (their coinbases only: the mining pages)
    const activation = this.chainInfo.activationHeight;
    const from = Math.max(0, activation - Math.max(0, config.CHAIN.HISTORY_BLOCKS || 0));
    if (top < from - 1) {
      for (const h of [...this.blocks.keys()]) { this.remove(h); } // the cache started elsewhere
      top = from - 1;
    }
    if (top >= tip) {
      return;
    }
    if (tip - top > 10) {
      logger.info(`Drivechain index: blocks ${top + 1} to ${tip}`);
    }
    // a range is either before the activation or not (scanRange asks the enforcer for the latter only)
    for (let h = top + 1; h <= tip;) {
      const last = Math.min(tip, h + STEP - 1, h < activation ? activation - 1 : Infinity);
      await this.scanRange(h, last);
      this.saveCache(last >= tip);
      h = last + 1;
    }
    await this.checkPending();
  }

  private name(slot: number): string {
    return this.sidechains.find(s => s.slot === slot)?.title || profileBySlot(slot)?.name || `Slot ${slot}`;
  }

  /** The pending bundles after block `height` (empty before the first indexed block) */
  private pendingAfter(height: number): PendingState {
    const b = this.blocks.get(height);
    return new Map(Object.entries(b?.pending ?? {}).map(([slot, list]) => [Number(slot), list.map(p => ({ ...p }))]));
  }

  private async scanRange(first: number, last: number): Promise<void> {
    const lastHash: string = await bitcoinClient.getBlockHash(last);
    // before the activation (HISTORY_BLOCKS): the node's blocks alone, the enforcer has nothing of them
    const before = last < (this.chainInfo?.activationHeight ?? 0);
    const headers: HeaderInfo[] = before ? [] : (await enforcer.getHeaders(lastHash, last - first + 2)).reverse(); // first - 1 .. last
    const prevHash = headers[0]?.height === first - 1 ? headers[0].hash : null;

    // per sidechain: deposits, bundle events, BMM; keyed by height then slot
    const peg = new Map<number, Map<number, PegBlock>>();
    for (const s of this.sidechains.filter(x => !before && x.activationHeight <= last)) {
      for (const p of await enforcer.getPegData(s.slot, prevHash, lastHash)) {
        if (!peg.has(p.header.height)) { peg.set(p.header.height, new Map()); }
        peg.get(p.header.height)!.set(s.slot, p);
      }
    }

    const raw = new Map<number, bitcoinjs.Block>();
    const byHeight = new Map(headers.map(h => [h.height, h]));
    const heights: number[] = [];
    for (let h = first; h <= last; h++) { heights.push(h); }
    await mapLimit(heights, Math.max(1, config.CHAIN.ENFORCER.MAX_CONCURRENT), async (h) => {
      const hash = byHeight.get(h)?.hash ?? await bitcoinClient.getBlockHash(h);
      raw.set(h, bitcoinjs.Block.fromHex(await bitcoinClient.getBlock(hash, 0)));
    });

    const state = this.pendingAfter(first - 1);
    let lastVotes: VoteEntry[] = this.blocks.get(first - 1)?.votes?.entries ?? [];
    for (const h of heights) {
      const block = raw.get(h)!;
      const b = await this.decode(h, block.getId(), byHeight.get(h)?.time ?? block.timestamp, block, peg.get(h) ?? new Map(), state, lastVotes);
      if (b.votes) {
        lastVotes = b.votes.entries;
      }
      this.add(b);
    }
  }

  private async decode(height: number, hash: string, time: number, block: bitcoinjs.Block, peg: Map<number, PegBlock>,
    state: PendingState, lastVotes: VoteEntry[]): Promise<DrivechainBlock> {
    const b: DrivechainBlock = {
      height, hash, time,
      proposals: [], acks: [], bundlesProposed: [], votes: null, bmm: [], bmmRequests: [],
      deposits: [], withdrawals: [], bundlesClosed: [], pending: {}, miner: minerInfo(block, height),
    };
    const txs = block.transactions!;
    const pendingOf = (slot: number): PendingBundle[] => {
      if (!state.has(slot)) { state.set(slot, []); }
      return state.get(slot)!;
    };
    // the sidechains M4 votes refer to: those active before this block, in slot order
    const votable = this.sidechains.filter(s => s.activationHeight < height);

    // coinbase messages, in output order (as the enforcer applies them)
    let m4 = false;
    for (const out of txs[0].outs) {
      const m = parseBip300Script(out.script.toString('hex'));
      if (!m) { continue; }
      switch (m.kind) {
        case 'M1':
          b.proposals.push({ slot: m.slot!, hash: m.hash!, title: m.title, description: m.description, version: m.version, hashId1: m.hashId1, hashId2: m.hashId2 });
          break;
        case 'M2':
          b.acks.push({ slot: m.slot!, hash: m.hash!, title: this.proposalTitle(m.hash!) ?? undefined });
          break;
        case 'M3':
          b.bundlesProposed.push({ slot: m.slot!, name: this.name(m.slot!), hash: m.hash! });
          pendingOf(m.slot!).push({ hash: m.hash!, score: 1, height });
          break;
        case 'M7':
          if (!b.bmm.some(a => a.slot === m.slot)) {
            b.bmm.push({ slot: m.slot!, name: this.name(m.slot!), sideBlock: m.hash! });
          }
          break;
        case 'M4':
          m4 = true;
          b.votes = this.applyVotes(m, votable, state, lastVotes);
          break;
      }
    }
    if (!m4) {
      b.votes = null; // no M4: every sidechain abstains
    }

    // BMM the enforcer accepted (the same as the M7s above, for a block it validated)
    for (const [slot, p] of peg) {
      if (p.bmmCommitment && !b.bmm.some(a => a.slot === slot)) {
        b.bmm.push({ slot, name: this.name(slot), sideBlock: p.bmmCommitment });
      }
    }

    // M8: BMM requests (output 0 of any transaction); the bid is the transaction's fee
    for (const tx of txs.slice(1)) {
      const m = parseBip300Script(tx.outs[0]?.script.toString('hex'));
      if (m && m.kind === 'M8') {
        const txid = tx.getId();
        const accepted = b.bmm.some(a => a.slot === m.slot && a.sideBlock === m.hash);
        const req: BmmRequest = { slot: m.slot!, name: this.name(m.slot!), sideBlock: m.hash!, prevMainBlock: m.prevMainBlock, txid, bid: await this.feeOf(txid, hash), accepted };
        b.bmmRequests.push(req);
        if (accepted) {
          const a = b.bmm.find(x => x.slot === m.slot && x.sideBlock === m.hash)!;
          a.requestTxid = txid;
          a.bid = req.bid;
        }
      }
    }

    // escrow changes and bundle outcomes, per sidechain
    for (const [slot, p] of peg) {
      const name = this.name(slot);
      for (const d of p.deposits) {
        b.deposits.push({ slot, name, txid: d.txid, amount: d.amount, destination: destinationText(d.address), sequence: d.sequence });
      }
      for (const e of p.bundleEvents) {
        await this.applyBundleEvent(b, slot, name, e, pendingOf(slot));
      }
    }

    // bundles past their maximum age fail
    const maxAge = this.chainInfo?.bundleMaxAge ?? Infinity;
    for (const [slot, list] of state) {
      for (const p of list.filter(x => height - x.height > maxAge)) {
        if (!b.bundlesClosed.some(c => c.hash === p.hash)) {
          b.bundlesClosed.push({ slot, name: this.name(slot), hash: p.hash, paid: false });
        }
      }
      state.set(slot, list.filter(x => height - x.height <= maxAge));
    }

    for (const [slot, list] of state) {
      if (list.length) {
        b.pending[slot] = list.map(p => ({ ...p }));
      }
    }
    return b;
  }

  /** An M4: what each entry votes for, and its effect on the vote counts (lib/validator/task/mod.rs handle_m4_*) */
  private applyVotes(m: Bip300Message, votable: SidechainInfo[], state: PendingState, lastVotes: VoteEntry[]): DrivechainBlock['votes'] {
    const form = m.form ?? 0;
    const pendingOf = (slot: number) => state.get(slot) ?? [];
    let entries: VoteEntry[] = [];
    if (form === 1 || form === 2) {
      entries = (m.votes ?? []).map((v, i) => {
        const s = votable[i];
        const e: VoteEntry = { slot: s ? s.slot : -1, name: s ? this.name(s.slot) : '?', value: v, vote: v === VOTE_ABSTAIN ? 'abstain' : v === VOTE_DOWNVOTE ? 'downvote' : 'upvote' };
        if (e.vote === 'upvote' && s) {
          e.bundle = pendingOf(s.slot)[v]?.hash;
        }
        return e;
      });
    } else if (form === 0) {
      // repeat the previous block's votes, against the bundles pending now
      entries = lastVotes.filter(e => e.vote !== 'upvote' || pendingOf(e.slot).some(p => p.hash === e.bundle)).map(e => ({ ...e }));
    } else if (form === 3) {
      for (const s of votable) {
        const pend = [...pendingOf(s.slot)].sort((x, y) => y.score - x.score);
        if (pend.length && pend[0].score - (pend[1]?.score ?? 0) >= 50) {
          entries.push({ slot: s.slot, name: this.name(s.slot), value: 0, vote: 'upvote', bundle: pend[0].hash });
        }
      }
    }
    for (const e of entries) {
      const list = pendingOf(e.slot);
      if (e.vote === 'upvote' && e.bundle) {
        for (const p of list) {
          if (p.hash === e.bundle) {
            p.score = Math.min(0xffff, p.score + 1);
          } else if (p.score > 0) {
            p.score--;
          }
        }
      } else if (e.vote === 'downvote') {
        for (const p of list) { p.score = Math.max(0, p.score - 1); }
      }
    }
    return { form, formName: VOTE_FORMS[form] ?? `form ${form}`, entries };
  }

  private async applyBundleEvent(b: DrivechainBlock, slot: number, name: string, e: BundleEvent, pending: PendingBundle[]): Promise<void> {
    const drop = () => {
      const i = pending.findIndex(p => p.hash === e.m6id);
      if (i >= 0) { pending.splice(i, 1); }
    };
    if (e.kind === 'submitted') {
      if (!b.bundlesProposed.some(p => p.hash === e.m6id)) {
        b.bundlesProposed.push({ slot, name, hash: e.m6id });
        pending.push({ hash: e.m6id, score: 1, height: b.height });
      }
    } else if (e.kind === 'failed') {
      b.bundlesClosed.push({ slot, name, hash: e.m6id, paid: false });
      drop();
    } else {
      b.bundlesClosed.push({ slot, name, hash: e.m6id, paid: true });
      drop();
      if (e.transaction) {
        b.withdrawals.push(await this.withdrawal(slot, name, e.m6id, e.transaction, b.hash));
      }
    }
  }

  /** A paid bundle's M6 transaction: its payouts, and what left the escrow (payouts and fee) */
  private async withdrawal(slot: number, name: string, bundle: string, txHex: string, blockHash: string): Promise<Withdrawal> {
    const tx = bitcoinjs.Transaction.fromHex(txHex);
    const txid = tx.getId();
    const escrowOut = tx.outs.find(o => isDrivechainScript(o.script.toString('hex')));
    const payouts = tx.outs
      .filter(o => o !== escrowOut && o.script[0] !== 0x6a)
      .map(o => ({ amount: o.value, script: o.script.toString('hex') }));
    let escrowDelta = 0;
    try {
      const verbose = await bitcoinClient.call('getrawtransaction', txid, 2, blockHash);
      escrowDelta = (escrowOut?.value ?? 0) - sats(verbose.vin?.[0]?.prevout?.value);
    } catch (e) {
      escrowDelta = -payouts.reduce((a, p) => a + p.amount, 0);
    }
    return { slot, name, txid, bundle, payouts, amount: payouts.reduce((a, p) => a + p.amount, 0), escrowDelta };
  }

  private async feeOf(txid: string, blockHash: string): Promise<number> {
    try {
      return sats((await bitcoinClient.call('getrawtransaction', txid, 2, blockHash)).fee);
    } catch (e) {
      return 0;
    }
  }

  /** The replayed vote counts against the enforcer's, at the tip */
  private async checkPending(): Promise<void> {
    const ours = this.pendingAfter(this.maxH);
    for (const s of this.sidechains) {
      const theirs = await enforcer.getBundleProposals(s.slot);
      const mine = ours.get(s.slot) ?? [];
      const same = theirs.length === mine.length && theirs.every(t => mine.some(p => p.hash === t.m6id && p.score === t.voteCount));
      if (!same) {
        logger.warn(`Drivechain index: the pending bundles of slot ${s.slot} differ from the enforcer's: `
          + `ours ${JSON.stringify(mine.map(p => [p.hash.slice(0, 12), p.score]))}, `
          + `the enforcer's ${JSON.stringify(theirs.map(t => [t.m6id.slice(0, 12), t.voteCount]))}`);
      }
    }
  }

  private proposalTitle(hash: string): string | null {
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
    return this.blocks.size ? this.maxH : -1;
  }

  firstHeight(): number {
    return this.blocks.size ? this.minH : 0;
  }

  /** The first indexed block from the BIP300 activation on (those before it, CHAIN.HISTORY_BLOCKS, carry no drivechain) */
  drivechainFirstHeight(): number {
    return Math.max(this.firstHeight(), this.chainInfo?.activationHeight ?? 0);
  }

  getSidechains(): SidechainInfo[] {
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
      miner: b.miner?.name ?? b.miner?.tag ?? null,
      minerLogo: b.miner?.logo ?? null,
      minerTag: b.miner?.minerTag ?? null,
      datum: b.miner?.datum ?? false,
      fees: b.miner?.fees ?? null,
    };
  }

  /** Summaries of the blocks at heights [to - count + 1, to] (newest first) */
  getSummaries(to: number | null, count: number): DrivechainBlockSummary[] {
    const top = to ?? this.tipHeight();
    const out: DrivechainBlockSummary[] = [];
    for (let h = top; h >= this.firstHeight() && out.length < count; h--) {
      const b = this.blocks.get(h);
      if (b) { out.push(this.summarize(b)); }
    }
    return out;
  }

  /** A flat list of one kind of event, newest first */
  getEvents(kind: string, slot: number | null, before: number | null, limit: number): any[] {
    const out: any[] = [];
    const top = before !== null ? before - 1 : this.tipHeight();
    for (let h = top; h >= this.firstHeight() && out.length < limit; h--) {
      const b = this.blocks.get(h);
      if (!b) {
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

  /** Totals over the indexed blocks, per slot */
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
}

export default new Drivechain();
