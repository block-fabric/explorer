import bitcoinClient from '../api/bitcoin/bitcoin-client';
import logger from '../logger';

/**
 * eCash's activity, from the newest WINDOW blocks read whole (getblock 2): each block's transactions, on-chain volume
 * (its non-coinbase outputs), fees (getblock's per-transaction fee) and fee rates; its PER_BLOCK largest transactions
 * (the console's "Big moves"); and what went to a labelled address (LABELS: exchanges, bridges). In memory: new blocks
 * every SCAN_EVERY, the older ones BACKFILL a pass until WINDOW is covered. A transaction's outputs include its change,
 * so a move is what left the inputs' owner at most.
 */

const WINDOW = 1008; // blocks: about a week of eCash's
const PER_BLOCK = 10;
const BACKFILL = 12; // older blocks read per pass (a block of 2,000 transactions is a few MB of JSON)
const SCAN_EVERY = 2 * 60_000;
const LABELLED_MIN = 1; // ECX: a payment to a labelled address kept from this much

/**
 * eCash addresses whose owner is known, by address: an exchange's deposit or hot wallets, a bridge's custody. Only
 * addresses their owner made public, or that were seen to be theirs; empty until some are known.
 */
export const LABELS: Record<string, { name: string; kind: 'exchange' | 'bridge' | 'pool' | 'other' }> = {};

export interface BigTx {
  txid: string; height: number; time: number;
  value: number; // ECX, the outputs' total
  largest: number; // ECX, its largest output
  to: string | null; // that output's address
  inputs: number; outputs: number;
}

export interface LabelledFlow { txid: string; height: number; time: number; address: string; name: string; kind: string; value: number }

interface BlockScan {
  height: number; time: number; txs: number; volume: number; top: BigTx[];
  fees: number; // ECX, its transactions' fees
  vsize: number; // its transactions' virtual size
  rates: number[]; // sat/vB of each transaction (sorted), for the percentiles
  flows: LabelledFlow[];
}

const scanned = new Map<number, BlockScan>();
let running = false;
let started = false;

/** @asyncUnsafe */
async function $scanBlock(height: number): Promise<BlockScan> {
  const hash: string = await bitcoinClient.getBlockHash(height);
  const b: any = await bitcoinClient.getBlock(hash, 2);
  const all: BigTx[] = [];
  const rates: number[] = [];
  const flows: LabelledFlow[] = [];
  let volume = 0;
  let fees = 0;
  let vsize = 0;
  for (const tx of (b.tx ?? []).slice(1)) { // (the coinbase is not a move)
    let value = 0;
    let largest = 0;
    let to: string | null = null;
    for (const o of tx.vout ?? []) {
      const v = Number(o.value) || 0;
      const address = typeof o.scriptPubKey?.address === 'string' ? o.scriptPubKey.address : null;
      value += v;
      if (v > largest) {
        largest = v;
        to = address;
      }
      const label = address ? LABELS[address] : undefined;
      if (label && v >= LABELLED_MIN) {
        flows.push({ txid: tx.txid, height, time: b.time, address: address as string, name: label.name, kind: label.kind, value: v });
      }
    }
    const fee = Number(tx.fee) || 0; // (BTC units, as getblock 2 gives it)
    const size = Number(tx.vsize) || 0;
    fees += fee;
    vsize += size;
    if (size > 0) {
      rates.push(fee * 1e8 / size);
    }
    volume += value;
    all.push({ txid: tx.txid, height, time: b.time, value, largest, to, inputs: tx.vin?.length ?? 0, outputs: tx.vout?.length ?? 0 });
  }
  return {
    height, time: b.time, txs: all.length, volume, fees, vsize, rates: rates.sort((x, y) => x - y), flows,
    top: all.sort((x, y) => y.value - x.value).slice(0, PER_BLOCK),
  };
}

/** the new blocks, then up to BACKFILL older ones @asyncSafe */
async function $scan(): Promise<void> {
  if (running) {
    return;
  }
  running = true;
  try {
    const tip: number = await bitcoinClient.getBlockCount();
    const low = tip - WINDOW + 1;
    for (const h of [...scanned.keys()]) {
      if (h < low || h > tip) {
        scanned.delete(h); // (out of the window, or above a tip a reorg lowered)
      }
    }
    const todo: number[] = [];
    for (let h = tip; h >= low && todo.length < BACKFILL + 6; h--) {
      if (!scanned.has(h)) {
        todo.push(h);
      }
    }
    for (const h of todo) {
      scanned.set(h, await $scanBlock(h));
    }
  } catch (e) {
    logger.debug(`Big moves scan: ${e instanceof Error ? e.message : e}`, 'Intel');
  } finally {
    running = false;
  }
}

export function startWhales(): void {
  if (started) {
    return;
  }
  started = true;
  void $scan();
  setInterval(() => { void $scan(); }, SCAN_EVERY);
}

function percentile(sorted: number[], q: number): number | null {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null;
}

/** the blocks' activity summed: transactions, ECX moved, fees, fee rates (the percentiles over every transaction) */
function activity(blocks: BlockScan[]): { blocks: number; txs: number; volume: number; fees: number; vsize: number; largest: BigTx | null;
  feeRate: { p10: number | null; p50: number | null; p90: number | null; avg: number | null }; feePerTx: number | null; emptyBlocks: number } {
  const rates = blocks.flatMap(b => b.rates).sort((x, y) => x - y);
  const txs = blocks.reduce((s, b) => s + b.txs, 0);
  const fees = blocks.reduce((s, b) => s + b.fees, 0);
  const vsize = blocks.reduce((s, b) => s + b.vsize, 0);
  const largest = blocks.flatMap(b => b.top).sort((x, y) => y.value - x.value)[0] ?? null;
  return {
    blocks: blocks.length, txs, volume: blocks.reduce((s, b) => s + b.volume, 0), fees, vsize, largest,
    feeRate: { p10: percentile(rates, 0.1), p50: percentile(rates, 0.5), p90: percentile(rates, 0.9), avg: vsize ? fees * 1e8 / vsize : null },
    feePerTx: txs ? fees / txs : null, emptyBlocks: blocks.filter(b => b.txs === 0).length,
  };
}

/**
 * The largest moves over the scanned blocks; the last 24 hours' activity; each day's (UTC) transactions, volume and
 * fees; the payments to labelled addresses (exchanges, bridges)
 */
type Whales = {
  blocks: number; from: number | null; to: number | null; moves: BigTx[];
  read: number; // the blocks read (WINDOW once caught up): the days', today's and the last 24 hours'
  window: ReturnType<typeof activity>; // the newest `window` blocks' activity (the moves are theirs too)
  last24h: ReturnType<typeof activity>; today: ReturnType<typeof activity>;
  daily: { day: number; volume: number; txs: number; fees: number }[]; flows: LabelledFlow[]; labels: number;
};
const answers = new Map<string, { at: number; value: Whales }>();
/** the windows asked for (the console's): any other is WINDOW, so the answers kept stay few */
const WINDOWS = [144, 432, 1008];

/**
 * The moves of the newest `window` blocks (at most WINDOW: the blocks read) (the answer per limit and window, for 30 s:
 * the fee percentiles sort every transaction of the week)
 */
export function getWhales(limit = 50, window = WINDOW): Whales {
  const n = Math.max(1, Math.min(200, Math.floor(limit)));
  const w = WINDOWS.includes(window) ? window : WINDOW;
  const key = `${n}:${w}`;
  const c = answers.get(key);
  if (c && Date.now() - c.at < 30_000) {
    return c.value;
  }
  const value = computeWhales(n, w);
  for (const [k, a] of answers) {
    if (Date.now() - a.at >= 30_000) {
      answers.delete(k); // (an answer past its time is not asked again)
    }
  }
  answers.set(key, { at: Date.now(), value });
  return value;
}

function computeWhales(limit: number, window: number): Whales {
  const all = [...scanned.values()];
  const newest = all.reduce((m, b) => Math.max(m, b.height), -1);
  const blocks = all.filter(b => b.height > newest - window);
  const days = new Map<number, { volume: number; txs: number; fees: number }>();
  for (const b of all) {
    const day = Math.floor(b.time / 86400) * 86400;
    const d = days.get(day) ?? { volume: 0, txs: 0, fees: 0 };
    d.volume += b.volume;
    d.txs += b.txs;
    d.fees += b.fees;
    days.set(day, d);
  }
  const heights = blocks.map(b => b.height);
  // (the days, today and the last 24 hours: every block read, whatever the window)
  const now = Math.floor(Date.now() / 1000);
  const midnight = Math.floor(now / 86400) * 86400;
  return {
    blocks: blocks.length, read: all.length, from: heights.length ? Math.min(...heights) : null, to: heights.length ? Math.max(...heights) : null,
    moves: blocks.flatMap(b => b.top).sort((x, y) => y.value - x.value).slice(0, Math.max(1, Math.min(200, limit))),
    window: activity(blocks),
    last24h: activity(all.filter(b => b.time >= now - 86400)), today: activity(all.filter(b => b.time >= midnight)),
    daily: [...days.entries()].sort((a, b) => a[0] - b[0]).map(([day, d]) => ({ day, ...d })),
    flows: all.flatMap(b => b.flows).sort((x, y) => y.time - x.time).slice(0, 100), labels: Object.keys(LABELS).length,
  };
}
