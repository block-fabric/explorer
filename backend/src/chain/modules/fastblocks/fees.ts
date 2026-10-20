import * as fs from 'fs';
import * as path from 'path';
import config from '../../../config';
import logger from '../../../logger';
import { ChainModuleContext } from '../../module';
import { PROFILE } from '../../profile';
import { opReturnPayload } from '../../bip300';

/**
 * The fee flows of a chain of stake (FastBlocks, Layers), block by block (fastblocks/src/pos/feesplit.cpp, hooks.cpp).
 *
 * Fees in a block: P = fees of peg transactions (a withdrawal or a refund request: the BMM bidder's whole) and
 * F = ordinary fees, split into the bidder's share B and the validators' V = F - B. The split follows a curve of the
 * mainchain's median block spacing S, so it is read from the block rather than assumed: consensus makes
 *   a block of stake:  POT output = P + B (the fee pot, paid to the payee of the next anchor), POOL output = V
 *   a BMM block:       POOL output = V; the merged miner's output 0 takes at most P + B (the rest is burned)
 * At each anchor (a block of stake acknowledging a BMM ticket, or a BMM block) the pot accrued up to the anchored
 * block goes to the ticket's payee (with a share of the reserve), and the pools of past epochs to the validators by
 * stake (behind a VPS marker). This index keeps all of it, and the pot it expects each anchor to pay.
 */

const CACHE_VERSION = 1;
const sats = (v: number | undefined) => Math.round((v ?? 0) * 1e8);

const POT = '6a04de504f54';
const POOL = '6a04de56504c';
const SHARES = '6a08de565053';
const WITNESS = '6a24aa21a9ed';
const TAG_WITHDRAWAL = 'd8574452';
const TAG_REFUND = 'd952464e';

export interface FeeBlock {
  h: number; t: number; hash: string; kind: 'pos' | 'bmm'; slot: number | null; proposer: string | null;
  anchor: boolean;                 // took the peg step: an acknowledging block of stake, or a BMM block
  anchoredHeight: number | null;   // the block it anchored
  payee: string | null;            // who the pot is paid to (the ticket's payee, or the BMM miner)
  txs: number; peg: number; ordinary: number;   // P and F (sats)
  bidder: number; validators: number;            // B and V
  pot: number;                     // into the fee pot (blocks of stake: P + B)
  miner: number;                   // BMM: what the merged miner took (output 0)
  burned: number;                  // BMM: P + B the miner did not take
  potPaid: number | null;          // anchor: the payout found to the payee
  potExpected: number | null;      // anchor: the pot accrued up to the anchored block, not paid yet
  shares: { address: string | null; amount: number }[];   // anchor: the validators' pool shares
  otherPayouts: number;            // anchor: deposits, refunds, unbonds, rewards (sats)
}

const curveBps = (S: number, curve: number): number => {
  if (S <= 60) { return 5000; }
  if (curve === 1) { return Math.max(1000, Math.floor(5000 * 60 / S)); }
  return S >= 420 ? 2000 : 5000 - Math.ceil(500 * (S - 60) / 60);
};

function payload(hex: string): Buffer | null {
  return hex?.startsWith('6a') ? opReturnPayload(Buffer.from(hex, 'hex')) : null;
}

function isPegTx(tx: any): boolean {
  return (tx.vout ?? []).some((o: any) => {
    const p = payload(o.scriptPubKey?.hex);
    if (!p || p.length < 4) { return false; }
    const tag = p.subarray(0, 4).toString('hex');
    return tag === TAG_WITHDRAWAL || (tag === TAG_REFUND && p.length === 4 + 101);
  });
}

export class FeeLedger {
  blocks: FeeBlock[] = [];
  private hashes: string[] = [];
  private pendingPot: [number, number][] = [];   // [height, amount] put in the pot, not paid yet
  private ctx!: ChainModuleContext;
  private genesis = '';
  private running = false;
  private again = false;
  private ready = false;
  private lastSave = 0;

  isReady(): boolean { return this.ready; }

  start(ctx: ChainModuleContext): void {
    this.ctx = ctx;
    this.load();
    void this.run();
    setInterval(() => void this.run(), 10000);
  }

  onNewBlock(): void { if (this.ctx) { void this.run(); } }

  private file(): string {
    return path.join(config.MEMPOOL.CACHE_DIR, 'chain', `fees-${PROFILE.id}-${config.CHAIN.NETWORK}.json`);
  }

  private load(): void {
    try {
      const d = JSON.parse(fs.readFileSync(this.file(), 'utf8'));
      if (d.version !== CACHE_VERSION) { return; }
      Object.assign(this, { genesis: d.genesis, blocks: d.blocks, hashes: d.hashes, pendingPot: d.pendingPot });
      logger.info(`Fee ledger: ${this.blocks.length} blocks from the cache`);
    } catch (e) { /* none yet */ }
  }

  private save(force = false): void {
    if (!force && Date.now() - this.lastSave < 60000) { return; }
    this.lastSave = Date.now();
    try {
      fs.mkdirSync(path.dirname(this.file()), { recursive: true });
      fs.writeFileSync(this.file() + '.tmp', JSON.stringify({ version: CACHE_VERSION, genesis: this.genesis, blocks: this.blocks, hashes: this.hashes, pendingPot: this.pendingPot }));
      fs.renameSync(this.file() + '.tmp', this.file());
    } catch (e) {
      logger.warn(`Fee ledger: cannot save: ${e instanceof Error ? e.message : e}`);
    }
  }

  private reset(): void {
    this.blocks = []; this.hashes = []; this.pendingPot = [];
  }

  private async run(): Promise<void> {
    if (this.running) { this.again = true; return; }
    this.running = true;
    try {
      do { this.again = false; await this.sync(); } while (this.again);
      this.ready = true;
    } catch (e) {
      logger.warn(`Fee ledger: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.running = false;
    }
  }

  private async sync(): Promise<void> {
    const node = this.ctx.node;
    const genesis: string = await node.call('getblockhash', 0);
    if (this.genesis && this.genesis !== genesis) { this.reset(); }
    this.genesis = genesis;
    const tip: number = await node.call('getblockcount');
    // a reorg: start over from the fork (the pot ledger is replayed from the blocks kept)
    let fork = this.hashes.length;
    while (fork > 0 && (fork - 1 > tip || this.hashes[fork - 1] !== await node.call('getblockhash', fork - 1))) { fork--; }
    if (fork < this.hashes.length) {
      const keep = this.blocks.filter(b => b.h < fork);
      this.reset();
      this.genesis = genesis;
      for (const b of keep) { this.hashes[b.h] = b.hash; this.replayPot(b); this.blocks.push(b); }
      this.hashes.length = fork;
    }
    const start = this.hashes.length;
    if (start > tip) { return; }
    if (tip - start > 50) { logger.info(`Fee ledger: blocks ${start} to ${tip}`); }
    for (let h = start; h <= tip; h += 8) {
      const heights = Array.from({ length: Math.min(8, tip - h + 1) }, (_, i) => h + i);
      const blocks = await Promise.all(heights.map(async x => node.call('getblock', await node.call('getblockhash', x), 2)));
      for (const b of blocks) {
        if (b.height !== this.hashes.length) { return; }
        this.apply(b);
      }
      this.save();
    }
    this.save(true);
  }

  /** the pot ledger only (for a replay of the blocks kept) */
  private replayPot(b: FeeBlock): void {
    if (b.anchor && b.anchoredHeight !== null) {
      this.pendingPot = this.pendingPot.filter(([h]) => h > b.anchoredHeight!);
    }
    if (b.pot) { this.pendingPot.push([b.h, b.pot]); }
  }

  private apply(block: any): void {
    const cb = block.tx[0];
    const kind: 'pos' | 'bmm' = block.kind === 'bmm' ? 'bmm' : 'pos';
    let peg = 0, ordinary = 0;
    for (const tx of block.tx.slice(1)) {
      const fee = sats(tx.fee);
      if (isPegTx(tx)) { peg += fee; } else { ordinary += fee; }
    }
    let pot = 0, poolOut = 0, markerAt = -1, shareCount = 0;
    cb.vout.forEach((o: any, i: number) => {
      const hex: string = o.scriptPubKey?.hex ?? '';
      if (hex === POT) { pot += sats(o.value); }
      else if (hex === POOL) { poolOut += sats(o.value); }
      else if (hex.startsWith(SHARES) && hex.length === SHARES.length + 8) {
        markerAt = i;
        shareCount = Buffer.from(hex.slice(SHARES.length), 'hex').readUInt32LE(0);
      }
    });
    const validators = poolOut;
    const bidder = Math.max(0, ordinary - validators);
    const miner = kind === 'bmm' ? sats(cb.vout[0]?.value) : 0;
    const anchor = kind === 'bmm' || !!block.ack;
    let anchoredHeight: number | null = null;
    let payee: string | null = null;
    if (block.ack) {
      anchoredHeight = this.hashes.indexOf(block.ack.anchored);
      if (anchoredHeight < 0) { anchoredHeight = null; }
      payee = block.ack.payee ?? null;
    } else if (kind === 'bmm') {
      anchoredHeight = block.height - 1;
      payee = cb.vout[0]?.scriptPubKey?.hex ?? null;
    }

    const rec: FeeBlock = {
      h: block.height, t: block.time, hash: block.hash, kind, slot: block.slot ?? null, proposer: block.proposer ?? null,
      anchor, anchoredHeight, payee: null, txs: block.tx.length - 1, peg, ordinary, bidder, validators,
      pot, miner, burned: kind === 'bmm' ? Math.max(0, peg + bidder - miner) : 0,
      potPaid: null, potExpected: null, shares: [], otherPayouts: 0,
    };

    if (anchor) {
      // the pot this anchor owes: what blocks up to the anchored one put in it, and was not paid yet
      if (anchoredHeight !== null) {
        rec.potExpected = this.pendingPot.filter(([h]) => h <= anchoredHeight!).reduce((a, [, v]) => a + v, 0);
        this.pendingPot = this.pendingPot.filter(([h]) => h > anchoredHeight!);
      }
      const payouts = cb.vout.map((o: any, i: number) => ({ i, o })).filter(({ i, o }: any) => {
        const hex: string = o.scriptPubKey?.hex ?? '';
        return i > 0 && sats(o.value) > 0 && !hex.startsWith('6a');
      });
      const shareIdx = new Set<number>();
      if (markerAt >= 0) {
        for (let i = markerAt + 1; i <= markerAt + shareCount && i < cb.vout.length; i++) {
          shareIdx.add(i);
          rec.shares.push({ address: cb.vout[i].scriptPubKey?.address ?? null, amount: sats(cb.vout[i].value) });
        }
      }
      // the pot payout: the last payout to the payee before the shares (as pos/income.cpp reads it)
      const potOut = payouts.filter(({ i, o }: any) => !shareIdx.has(i) && (markerAt < 0 || i < markerAt) && payee && o.scriptPubKey?.hex === payee).pop();
      if (potOut) { rec.potPaid = sats(potOut.o.value); }
      rec.payee = (potOut?.o.scriptPubKey?.address) ?? (block.ack ? null : cb.vout[0]?.scriptPubKey?.address ?? null);
      rec.otherPayouts = payouts.filter(({ i }: any) => !shareIdx.has(i) && i !== potOut?.i).reduce((a: number, { o }: any) => a + sats(o.value), 0);
    }
    if (pot) { this.pendingPot.push([block.height, pot]); }
    this.hashes.push(block.hash);
    this.blocks.push(rec);
  }

  // --- the route's figures

  summary(window: number, info: any, validators: any[]): any {
    const all = this.blocks;
    const tip = all.length ? all[all.length - 1].h : 0;
    const from = window > 0 ? Math.max(0, tip - window + 1) : 0;
    const bl = all.filter(b => b.h >= from);
    const sum = (f: (b: FeeBlock) => number) => bl.reduce((a, b) => a + f(b), 0);
    const ordinary = sum(b => b.ordinary), bidder = sum(b => b.bidder), validatorsShare = sum(b => b.validators);
    const anchors = bl.filter(b => b.anchor);

    // per validator: blocks made, pool shares received (by bond owner address)
    const ownerOf = new Map<string, string>();
    for (const v of validators) { if (v.owner) { ownerOf.set(v.owner, v.pubkey); } }
    const perVal = new Map<string, any>();
    const get = (pubkey: string) => perVal.get(pubkey) ?? perVal.set(pubkey, { pubkey, blocks: 0, feesInBlocks: 0, poolShares: 0, payouts: 0 }).get(pubkey);
    for (const b of bl) {
      if (b.proposer) { const v = get(b.proposer); v.blocks++; v.feesInBlocks += b.peg + b.ordinary; }
      for (const s of b.shares) {
        const k = (s.address && ownerOf.get(s.address)) || ('owner:' + (s.address ?? '?'));
        const v = get(k); v.poolShares += s.amount; v.payouts++;
        if (!v.owner) { v.owner = s.address; }
      }
    }
    for (const v of validators) { const x = get(v.pubkey); Object.assign(x, { owner: v.owner, stake: v.stake, slots: v.slots }); }

    // where the bidder's share went: payees of the pot (block of stake anchors) and BMM miners
    const payees = new Map<string, { address: string; potPaid: number; anchors: number; bmmMiner: number }>();
    for (const b of anchors) {
      if (!(b.potPaid ?? 0) && !b.miner) { continue; } // nothing to pay at this anchor
      const a = b.payee ?? '(not an address: to the reserve)';
      const e = payees.get(a) ?? { address: a, potPaid: 0, anchors: 0, bmmMiner: 0 };
      e.potPaid += b.potPaid ?? 0; e.anchors++; e.bmmMiner += b.miner;
      payees.set(a, e);
    }

    const recent = all.filter(b => b.peg || b.ordinary || b.anchor && (b.potPaid || b.shares.length)).slice(-40).reverse();
    const fs = info?.feesplit ?? {};
    const S = fs.spacing ?? 60;
    return {
      ready: this.ready, from, to: tip, blocks: bl.length,
      totals: {
        fees: sum(b => b.peg + b.ordinary), peg: sum(b => b.peg), ordinary, bidder, validators: validatorsShare,
        bidderShareEffective: ordinary ? bidder / ordinary : null,
        toPot: sum(b => b.pot), toBmmMiners: sum(b => b.miner), burned: sum(b => b.burned),
        potPaid: anchors.reduce((a, b) => a + (b.potPaid ?? 0), 0), potExpected: anchors.reduce((a, b) => a + (b.potExpected ?? 0), 0),
        poolDistributed: sum(b => b.shares.reduce((a, s) => a + s.amount, 0)),
        anchors: anchors.length, posBlocks: bl.filter(b => b.kind === 'pos').length, bmmBlocks: bl.filter(b => b.kind === 'bmm').length,
        blocksWithFees: bl.filter(b => b.peg || b.ordinary).length,
      },
      now: {
        curve: fs.curve ?? 2, active: fs.active ?? true, spacing: S, mainheight: fs.mainheight, bidderbps: fs.bidderbps, validatorsbps: fs.validatorsbps,
        bmmSpacing: fs.bmmspacing, bmmBidderbps: fs.bmmbidderbps, bmmMainheight: fs.bmmmainheight,
        pool: sats(fs.pool), poolEpochs: (fs.poolepochs ?? []).map((e: any) => ({ epoch: e.epoch, amount: sats(e.amount) })),
        pot: { accrued: sats(info?.pot?.accrued), paid: sats(info?.pot?.paid), reserve: sats(info?.pot?.reserve), outstanding: sats(info?.pot?.accrued) - sats(info?.pot?.paid) },
      },
      // the bidder's share of ordinary fees against S, for both curves (S from 0 to 480 s)
      curves: Array.from({ length: 49 }, (_, i) => [i * 10, curveBps(i * 10, 1), curveBps(i * 10, 2)]),
      validators: [...perVal.values()].sort((a, b) => (b.poolShares - a.poolShares) || (b.blocks - a.blocks)),
      payees: [...payees.values()].sort((a, b) => b.potPaid + b.bmmMiner - a.potPaid - a.bmmMiner),
      recent,
    };
  }
}

let ledger: FeeLedger | null = null;
export function getFeeLedger(): FeeLedger {
  if (!ledger) { ledger = new FeeLedger(); }
  return ledger;
}
