import fs from 'fs';
import path from 'path';
import config from '../../../config';
import logger from '../../../logger';
import { PROFILE } from '../../profile';
import bitcoinClient from '../../../api/bitcoin/bitcoin-client';
import {
  ASSET_GENESIS_VERSION, CreditFamily, Fields, ParsedTx, creditOpName, decodeCreditPayload, parseBlock,
} from './parser';

/**
 * FreeBank's credit history: every credit operation (tx versions 11-17) and asset genesis (v10) on the chain, behind GET
 * /api/v1/freebank/activity (chains/FREEBANK-API.md). As FreeBank's own explorer's credit-activity.ts
 * (mbdrivechains/freebank-explorer, AGPL-3.0), with these changes: the whole chain, not the last 2016 blocks; one
 * getblock <hash> 0 a block, read by parser.ts (the node is far: a call each tx or input would take hours a block); no
 * fees (they need every spent output); saved to <CACHE_DIR>/chain/freebank-activity-<network>.json.
 *
 * New blocks first (from the top of the index up to the node's tip), then back down to the genesis block in steps of
 * BACKFILL_CHUNK, one block at a time. Reorgs: each block keeps its hash and its parent's; a run first walks down from the
 * top until a block the node still has, and a new block whose parent is not the one indexed below it drops that one.
 */

const CACHE_VERSION = 1;
const BACKFILL_CHUNK = 25;
/** between two backfilled blocks, to leave the node's request slots to others */
const BACKFILL_PAUSE_MS = 250;
const RETRY_MS = 30000;

export type ActivityFamily = CreditFamily | 'asset';

export interface ActivityItem {
  txid: string;
  height: number;
  time: number;
  /** the tx's position in its block */
  index: number;
  family: ActivityFamily;
  op: number | null;
  opName: string;
  fields: Fields;
  /** the payload does not fit its layout: fields {} */
  error: string | null;
}

interface IndexedBlock {
  height: number;
  hash: string;
  prev: string;
  items: ActivityItem[];
}

export interface ActivityQuery {
  family?: ActivityFamily;
  house?: number;
  bill?: number;
  limit: number;
  /** items before this one, newest first: "<height>:<index>" from a page's next */
  before?: { height: number; index: number };
}

/** @asyncSafe */
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** Whether an item names this house: its own ops, its notes and pool, a settlement it is in */
function namesHouse(item: ActivityItem, house: number): boolean {
  const f = item.fields;
  return f.house_id === house || f.house_a_id === house || f.house_b_id === house
    || (Array.isArray(f.house_ids) && (f.house_ids as number[]).includes(house));
}

/** What a block's credit and asset txs did */
export function blockItems(height: number, time: number, txs: ParsedTx[]): ActivityItem[] {
  const items: ActivityItem[] = [];
  txs.forEach((tx, index) => {
    if (tx.family !== null && tx.op !== null && tx.payload !== null) {
      const opName = creditOpName(tx.family, tx.op);
      let fields: Fields = {};
      let error: string | null = null;
      try {
        fields = decodeCreditPayload(tx.family, tx.op, tx.payload);
      } catch {
        error = `The ${tx.family} ${opName} payload does not fit its layout`;
      }
      items.push({ txid: tx.txid, height, time, index, family: tx.family, op: tx.op, opName, fields, error });
    } else if (tx.version === ASSET_GENESIS_VERSION && tx.asset) {
      const { ticker, headline, decimals } = tx.asset;
      items.push({
        txid: tx.txid, height, time, index, family: 'asset', op: null, opName: 'genesis',
        fields: { ticker, headline, decimals, supply: tx.vout[1]?.value ?? null }, error: null,
      });
    }
  });
  return items;
}

export class FreebankActivity {
  private blocks = new Map<number, IndexedBlock>();
  /** the indexed range, inclusive; high -1: nothing yet */
  private high = -1;
  private low = 0;
  private tip = -1;
  private working = false;
  private again = false;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private lastSave = 0;

  start(): void {
    this.load();
    void this.run();
    setInterval(() => void this.run(), 60000);
  }

  onNewBlock(): void {
    void this.run();
  }

  /** The indexed range and whether it reaches the genesis block */
  status(): { low: number | null; high: number | null; tip: number; complete: boolean } {
    const any = this.high >= 0;
    return { low: any ? this.low : null, high: any ? this.high : null, tip: this.tip, complete: any && this.low === 0 };
  }

  /** Items newest first, and the cursor of the next page (null: none) */
  query(q: ActivityQuery): { items: ActivityItem[]; next: string | null } {
    const out: ActivityItem[] = [];
    const startH = q.before ? Math.min(q.before.height, this.high) : this.high;
    for (let h = startH; h >= this.low && h >= 0; h--) {
      const items = this.blocks.get(h)?.items ?? [];
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (q.before && h === q.before.height && it.index >= q.before.index) {
          continue;
        }
        if ((q.family && it.family !== q.family) || (q.house !== undefined && !namesHouse(it, q.house))
          || (q.bill !== undefined && !(it.family === 'bill' && it.fields.bill_id === q.bill))) {
          continue;
        }
        if (out.length === q.limit) {
          const last = out[out.length - 1];
          return { items: out, next: `${last.height}:${last.index}` };
        }
        out.push(it);
      }
    }
    return { items: out, next: null };
  }

  /** One run at a time; a call while one runs makes it run once more */
  /** @asyncSafe: errors are logged and retried */
  private async run(): Promise<void> {
    if (this.working) {
      this.again = true;
      return;
    }
    this.working = true;
    try {
      do {
        this.again = false;
        await this.sync();
      } while (this.again);
    } catch (e) {
      logger.warn(`FreeBank activity: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}; again in ${RETRY_MS / 1000} s`);
      if (!this.retry) {
        this.retry = setTimeout(() => { this.retry = null; void this.run(); }, RETRY_MS);
      }
    } finally {
      this.working = false;
      this.save();
    }
  }

  /** @asyncUnsafe: run() catches */
  private async sync(): Promise<void> {
    for (;;) {
      this.tip = await bitcoinClient.call('getblockcount');
      // a reorg: down to a block the node still has
      while (this.high >= 0
        && (this.high > this.tip || await bitcoinClient.call('getblockhash', this.high) !== this.blocks.get(this.high)?.hash)) {
        this.drop(this.high);
      }
      // new blocks (none indexed: from the tip)
      let reorg = false;
      for (let h = this.high < 0 ? this.tip : this.high + 1; h <= this.tip && !reorg; h++) {
        const hash: string = await bitcoinClient.call('getblockhash', h);
        const b = await this.fetch(h, hash);
        if (this.high >= 0 && b.prev !== this.blocks.get(h - 1)?.hash) {
          this.drop(this.high);
          reorg = true;
        } else {
          if (this.high < 0) {
            this.low = h;
          }
          this.blocks.set(h, b);
          this.high = h;
        }
      }
      if (reorg) {
        continue;
      }
      if (this.high < 0 || this.low === 0) {
        return;
      }
      // a step down: each block by its child's parent hash
      for (let n = 0; n < BACKFILL_CHUNK && this.low > 0; n++) {
        const h = this.low - 1;
        const hash = this.blocks.get(this.low)?.prev;
        if (!hash) {
          throw new Error(`no parent hash at ${this.low}`);
        }
        this.blocks.set(h, await this.fetch(h, hash));
        this.low = h;
        await sleep(BACKFILL_PAUSE_MS);
      }
      this.save();
      if (this.low === 0) {
        logger.info(`FreeBank activity: indexed from the genesis block to ${this.high}, ${this.count()} items`);
      }
    }
  }

  /** @asyncUnsafe: run() catches */
  private async fetch(height: number, hash: string): Promise<IndexedBlock> {
    const hex: string = await bitcoinClient.call('getblock', hash, 0);
    const block = parseBlock(hex);
    return { height, hash, prev: block.prev, items: blockItems(height, block.time, block.txs) };
  }

  private drop(height: number): void {
    this.blocks.delete(height);
    this.high = height - 1;
    if (this.high < this.low) {
      this.high = -1;
      this.low = 0;
      this.blocks.clear();
    }
  }

  private count(): number {
    let n = 0;
    for (const b of this.blocks.values()) {
      n += b.items.length;
    }
    return n;
  }

  private file(): string {
    return path.join(config.MEMPOOL.CACHE_DIR, 'chain', `freebank-activity-${config.CHAIN.NETWORK}.json`);
  }

  private load(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file(), 'utf8'));
      if (raw.version !== CACHE_VERSION || raw.profile !== PROFILE.id) {
        return;
      }
      for (const b of raw.blocks as IndexedBlock[]) {
        this.blocks.set(b.height, b);
      }
      this.low = raw.low;
      this.high = raw.high;
      logger.info(`FreeBank activity: blocks ${this.low} to ${this.high} from the cache, ${this.count()} items`);
    } catch (e) {
      // no cache yet
    }
  }

  private save(): void {
    if (Date.now() - this.lastSave < 60000 && this.low !== 0) {
      return;
    }
    this.lastSave = Date.now();
    try {
      fs.mkdirSync(path.dirname(this.file()), { recursive: true });
      const tmp = this.file() + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({
        version: CACHE_VERSION, profile: PROFILE.id, low: this.low, high: this.high, blocks: [...this.blocks.values()],
      }));
      fs.renameSync(tmp, this.file());
    } catch (e) {
      logger.warn(`FreeBank activity: cannot save the cache: ${e instanceof Error ? e.message : e}`);
    }
  }
}

export default new FreebankActivity();
