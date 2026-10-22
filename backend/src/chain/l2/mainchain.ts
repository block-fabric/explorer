import axios from 'axios';
import config from '../../config';
import logger from '../../logger';
import { reverseHex } from './codec';

/**
 * The eCash explorer's drivechain index, as a sidechain explorer sees it (CHAIN.MAINCHAIN_API: the eCash explorer
 * backend's base URL, on the pool server http://127.0.0.1:<its port>; empty = no BMM views).
 *
 * - get(): a GET of its /api/v1/drivechain/* JSON, cached (bounded, short TTL). Its errors stay in the log: the
 *   callers answer with a fixed text.
 * - the BMM of this slot, kept in memory: every accepted BMM (M7) with its bid and M8 request, and the M8 requests per
 *   eCash block, from GET drivechain/events/bmm and drivechain/events/bmm-requests (paged, refreshed every POLL_MS,
 *   the newest REORG_DEPTH heights fetched again each time). A sidechain block's BMM is found by its hash: the eCash
 *   index gives the committed sidechain block hash (sideBlock) in Bitcoin display order (reversed), the sidechain
 *   nodes' hashes are not, so sideBlock is reversed here.
 */

const PAGE = 500;          // drivechain/events caps limit at 500
const POLL_MS = 30000;
const REORG_DEPTH = 12;    // eCash blocks fetched again on each refresh
const CACHE_MAX = 1000;

export class MainchainApiError extends Error {}

export interface BmmAcceptRef {
  mainHeight: number;
  mainHash: string;
  time: number;
  bid: number | null;
  requestTxid: string | null;
  sideBlock: string;         // the sidechain block hash, the nodes' order (not reversed)
}

export interface BmmRequestRef {
  txid: string;
  bid: number;
  sideBlock: string;         // the nodes' order
  accepted: boolean;
}

/** What the API says of a sidechain block's BMM (chains/L2-API.md) */
export interface BlockBmm {
  mainHeight: number;
  mainHash: string;
  bid: number | null;
  requestTxid: string | null;
  /** M8 requests for this slot in that eCash block */
  requests: number;
  /** more than one request for this slot in that eCash block */
  contested: boolean;
}

export class Mainchain {
  private cache = new Map<string, { at: number; value: any }>();
  private slot: number | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  // per eCash height: the accepted BMM of this slot, the M8 requests for this slot
  private acceptsAt = new Map<number, BmmAcceptRef>();
  private requestsAt = new Map<number, BmmRequestRef[]>();
  private bySideBlock = new Map<string, BmmAcceptRef>();
  private acceptsTop = -1;
  private requestsTop = -1;
  private synced = false;

  enabled(): boolean {
    return !!config.CHAIN.MAINCHAIN_API;
  }

  /** GET <MAINCHAIN_API>/api/v1/<path>, cached ttlMs */
  async get<T = any>(path: string, params: Record<string, string | number | null | undefined> = {}, ttlMs = 10000): Promise<T> {
    if (!this.enabled()) {
      throw new MainchainApiError('MAINCHAIN_API is not set');
    }
    const q = Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
    const key = path + (q ? '?' + q : '');
    const c = this.cache.get(key);
    if (c && Date.now() - c.at < ttlMs) {
      return c.value;
    }
    const url = config.CHAIN.MAINCHAIN_API.replace(/\/+$/, '') + '/api/v1/' + key;
    const res = await axios.get(url, { timeout: 30000, validateStatus: () => true });
    if (res.status !== 200) {
      throw new MainchainApiError(`eCash explorer API ${path}: HTTP ${res.status}`);
    }
    this.cache.delete(key);
    this.cache.set(key, { at: Date.now(), value: res.data });
    while (this.cache.size > CACHE_MAX) {
      this.cache.delete(this.cache.keys().next().value as string);
    }
    return res.data as T;
  }

  /** Follow the BMM of a slot */
  start(slot: number): void {
    if (!this.enabled() || this.timer) {
      return;
    }
    this.slot = slot;
    const tick = () => {
      this.sync().catch(e => logger.warn(`L2 BMM: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`))
        .finally(() => { this.timer = setTimeout(tick, POLL_MS); });
    };
    this.timer = setTimeout(tick, 0);
  }

  /** the BMM index has been read once */
  isSynced(): boolean {
    return this.synced;
  }

  /** A sidechain block's BMM (its hash in the nodes' order), null when the eCash index has no accept for it */
  blockBmm(hash: string): BlockBmm | null {
    const a = this.bySideBlock.get(hash);
    if (!a) {
      return null;
    }
    const requests = this.requestsAt.get(a.mainHeight)?.length ?? 0;
    return { mainHeight: a.mainHeight, mainHash: a.mainHash, bid: a.bid, requestTxid: a.requestTxid, requests, contested: requests > 1 };
  }

  /** The M8 requests for this slot in an eCash block */
  requestsIn(mainHeight: number): BmmRequestRef[] {
    return this.requestsAt.get(mainHeight) ?? [];
  }

  /** accepts with an eCash height in [from, to] */
  acceptsBetween(from: number, to: number): number {
    let n = 0;
    for (const h of this.acceptsAt.keys()) {
      if (h >= from && h <= to) {
        n++;
      }
    }
    return n;
  }

  async sync(): Promise<void> {
    if (this.running || this.slot === null) {
      return;
    }
    this.running = true;
    try {
      const accepts = await this.fetchSince('bmm', this.acceptsTop - REORG_DEPTH);
      for (const h of [...this.acceptsAt.keys()]) {
        if (h >= accepts.from) {
          this.acceptsAt.delete(h);
        }
      }
      for (const e of accepts.items) {
        this.acceptsAt.set(e.height, {
          mainHeight: e.height, mainHash: e.blockHash, time: e.time, bid: e.bid ?? null, requestTxid: e.requestTxid ?? null,
          sideBlock: reverseHex(e.sideBlock),
        });
        this.acceptsTop = Math.max(this.acceptsTop, e.height);
      }
      this.bySideBlock = new Map([...this.acceptsAt.values()].map(a => [a.sideBlock, a]));

      const requests = await this.fetchSince('bmm-requests', this.requestsTop - REORG_DEPTH);
      for (const h of [...this.requestsAt.keys()]) {
        if (h >= requests.from) {
          this.requestsAt.delete(h);
        }
      }
      for (const e of requests.items) {
        const list = this.requestsAt.get(e.height) ?? [];
        list.push({ txid: e.txid, bid: e.bid, sideBlock: reverseHex(e.sideBlock), accepted: !!e.accepted });
        this.requestsAt.set(e.height, list);
        this.requestsTop = Math.max(this.requestsTop, e.height);
      }
      if (!this.synced) {
        logger.info(`L2 BMM: ${this.acceptsAt.size} accepted BMM and ${[...this.requestsAt.values()].reduce((a, l) => a + l.length, 0)} requests of slot ${this.slot} from the eCash explorer`);
      }
      this.synced = true;
    } finally {
      this.running = false;
    }
  }

  /**
   * The events of this slot from the newest down to below `stopBelow` (all of them when it is < 0), and the lowest
   * height they cover completely (`from`): the heights >= from are replaced by `items`.
   */
  private async fetchSince(kind: 'bmm' | 'bmm-requests', stopBelow: number): Promise<{ from: number; items: any[] }> {
    const items: any[] = [];
    let before: number | null = null;
    for (;;) {
      const page = await this.get<any[]>('drivechain/events/' + kind, { slot: this.slot, before, limit: PAGE }, 0);
      if (!Array.isArray(page)) {
        throw new MainchainApiError(`eCash explorer API drivechain/events/${kind}: not a list`);
      }
      const mine = page.filter(e => e.slot === this.slot && typeof e.sideBlock === 'string' && /^[0-9a-f]{64}$/.test(e.sideBlock));
      if (page.length < PAGE) {
        items.push(...mine);
        return { from: 0, items };
      }
      // a full page can end in the middle of an eCash block: its lowest height comes again with the next page
      const lowest = page[page.length - 1].height;
      const whole = mine.filter(e => e.height > lowest);
      if (whole.length === 0) {
        // a page of one eCash block (500 requests in a block): take it and go below it
        items.push(...mine);
        before = lowest;
      } else {
        items.push(...whole);
        before = lowest + 1;
      }
      if (lowest <= stopBelow) {
        return { from: whole.length === 0 ? lowest : lowest + 1, items };
      }
    }
  }
}

export default new Mainchain();
