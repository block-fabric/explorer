import { blake3 } from '@noble/hashes/blake3';
import { Content, Input, MarketView, Output, Shielded } from '../l2/types';
import { NAME_CANDIDATES } from './name-candidates';

/**
 * What the sidechain modules' feature views (assets, names, markets, the shielded pool, swaps, top addresses) read
 * of the index (chain/l2/index.ts), and the helpers they share. The views are derived from the whole index, so each
 * is built once per index generation (a new block, a reorg, filled content) and kept until the next one.
 */

export interface IndexTx {
  txid: string;
  height: number;
  time: number | null;
  index: number;
  inputs: Input[];
  outputs: Output[];
  fee: number;
  /** TxData, its variant lifted into `type` */
  data: any;
  shielded: Shielded | null;
  signers: (string | null)[];
  /** a market tx (Truthcoin) */
  market?: MarketView | null;
}

export interface IndexUtxo {
  outpoint: { kind: string; txid: string | null; vout: number | null; label: string };
  txid: string | null;
  height: number;
  address: string;
  content: Content;
  value: number;
}

export interface IndexAddress {
  address: string;
  balance: number;
  funded: { count: number; sum: number };
  spent: { count: number; sum: number };
  txs: number;
  utxos: number;
  first: number | null;
  last: number | null;
}

/** The index as the modules see it (ctx.index) */
export interface IndexView {
  isReady(): boolean;
  tipHeight(): number;
  timeAt(height: number): number | null;
  generation(): string;
  forEachTx(fn: (t: IndexTx) => void): void;
  forEachUtxo(fn: (u: IndexUtxo) => void): void;
  forEachAddress(fn: (a: IndexAddress) => void): void;
  ammPools(): [string, string][];
}

/** A view derived from the whole index, rebuilt when the index's generation changes */
export function derived<T>(build: (index: IndexView) => T): (index: IndexView) => T {
  let key: string | null = null;
  let value: T;
  return (index: IndexView) => {
    const g = index.generation();
    if (g !== key) {
      value = build(index);
      key = g;
    }
    return value;
  };
}

export function txsOf(index: IndexView): IndexTx[] {
  const out: IndexTx[] = [];
  index.forEachTx(t => out.push(t));
  return out;
}

export function utxosOf(index: IndexView): IndexUtxo[] {
  const out: IndexUtxo[] = [];
  index.forEachUtxo(u => out.push(u));
  return out;
}

export const HASH = /^[0-9a-f]{64}$/;

export const hexOf = (bytes: number[] | Uint8Array): string => Buffer.from(Uint8Array.from(bytes as any)).toString('hex');

/** blake3 of a plain name (BitNames' and BitAssets' name hash), hex */
export function nameHash(plain: string): string {
  return hexOf(blake3(Buffer.from(plain, 'utf8')));
}

/**
 * Plain names whose blake3 is one of `hashes`: the chains keep only a name's hash, so a name is shown only when
 * it is revealed on chain (BitNames' BatchIcann) or one of the module's candidates hashes to it
 */
export function revealNames(hashes: Iterable<string>, candidates: Iterable<string>): Map<string, string> {
  const want = new Set(hashes);
  const out = new Map<string, string>();
  for (const c of candidates) {
    if (!c || c.length > 256) {
      continue;
    }
    const h = nameHash(c);
    if (want.has(h) && !out.has(h)) {
      out.set(h, c);
    }
  }
  return out;
}

let candidates: Map<string, string> | null = null;

/** The plain name of a name hash, when one of the candidates (name-candidates.ts) hashes to it */
export function candidateName(hash: string): string | null {
  if (!candidates) {
    candidates = new Map();
    for (const c of NAME_CANDIDATES) {
      const h = nameHash(c);
      if (!candidates.has(h)) {
        candidates.set(h, c);
      }
    }
  }
  return candidates.get(hash) ?? null;
}

/** An id the index does not know: 404 once it has caught up, 503 while it is still being built (as routes.ts) */
export function notFound(index: IndexView, res: any, fail: () => void): void {
  if (index.isReady()) {
    fail();
  } else {
    res.status(503).json({ error: 'The index is still being built' });
  }
}

/** Newest first, at most n */
export function newest<T extends { height: number }>(rows: T[], n: number): T[] {
  return [...rows].sort((a, b) => b.height - a.height).slice(0, n);
}
