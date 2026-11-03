import bitcoinClient from '../api/bitcoin/bitcoin-client';
import logger from '../logger';

/**
 * eCash's large transactions (the console's "Big moves"): the newest WINDOW blocks read whole (getblock 2), each
 * transaction's output total kept when it is one of a block's PER_BLOCK largest; also each block's on-chain volume
 * (its non-coinbase outputs). In memory: new blocks every SCAN_EVERY, the older ones BACKFILL a pass until WINDOW is
 * covered. A transaction's outputs include its change, so a move is what left the inputs' owner at most.
 */

const WINDOW = 1008; // blocks: about a week of eCash's
const PER_BLOCK = 10;
const BACKFILL = 12; // older blocks read per pass (a block of 2,000 transactions is a few MB of JSON)
const SCAN_EVERY = 2 * 60_000;

export interface BigTx {
  txid: string; height: number; time: number;
  value: number; // ECX, the outputs' total
  largest: number; // ECX, its largest output
  to: string | null; // that output's address
  inputs: number; outputs: number;
}

interface BlockScan { height: number; time: number; txs: number; volume: number; top: BigTx[] }

const scanned = new Map<number, BlockScan>();
let running = false;
let started = false;

/** @asyncUnsafe */
async function $scanBlock(height: number): Promise<BlockScan> {
  const hash: string = await bitcoinClient.getBlockHash(height);
  const b: any = await bitcoinClient.getBlock(hash, 2);
  const all: BigTx[] = [];
  let volume = 0;
  for (const tx of (b.tx ?? []).slice(1)) { // (the coinbase is not a move)
    let value = 0;
    let largest = 0;
    let to: string | null = null;
    for (const o of tx.vout ?? []) {
      const v = Number(o.value) || 0;
      value += v;
      if (v > largest) {
        largest = v;
        to = typeof o.scriptPubKey?.address === 'string' ? o.scriptPubKey.address : null;
      }
    }
    volume += value;
    all.push({ txid: tx.txid, height, time: b.time, value, largest, to, inputs: tx.vin?.length ?? 0, outputs: tx.vout?.length ?? 0 });
  }
  return { height, time: b.time, txs: all.length, volume, top: all.sort((x, y) => y.value - x.value).slice(0, PER_BLOCK) };
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

/** the largest moves over the scanned blocks, and the on-chain volume per day */
export function getWhales(limit = 50): { blocks: number; from: number | null; to: number | null; moves: BigTx[]; daily: { day: number; volume: number; txs: number }[] } {
  const blocks = [...scanned.values()];
  const days = new Map<number, { volume: number; txs: number }>();
  for (const b of blocks) {
    const day = Math.floor(b.time / 86400) * 86400;
    const d = days.get(day) ?? { volume: 0, txs: 0 };
    d.volume += b.volume;
    d.txs += b.txs;
    days.set(day, d);
  }
  const heights = blocks.map(b => b.height);
  return {
    blocks: blocks.length, from: heights.length ? Math.min(...heights) : null, to: heights.length ? Math.max(...heights) : null,
    moves: blocks.flatMap(b => b.top).sort((x, y) => y.value - x.value).slice(0, Math.max(1, Math.min(200, limit))),
    daily: [...days.entries()].sort((a, b) => a[0] - b[0]).map(([day, d]) => ({ day, ...d })),
  };
}
