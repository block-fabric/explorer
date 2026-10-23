import { Injectable } from '@angular/core';
import { Observable, ReplaySubject, catchError, combineLatest, map, of, shareReplay, take, timer, switchMap } from 'rxjs';
import { FreebankApiService } from './freebank-api.service';
import { FreebankBlockMark } from './freebank.interfaces';

/** What the block lists show under a FreeBank block: the eCash block it was BMM'd in (its height when known), the bid */
export interface FreebankBmmMark {
  mark: FreebankBlockMark | null;
  /** the eCash block's height, from the eCash explorer's BMM events for the slot (null: not among the recent ones) */
  mainHeight: number | null;
  bid: number | null;
}

/**
 * The marks of FreeBank's blocks on upstream's block lists and pages (chain/components/block-marks): each block's BMM
 * fields (GET /api/v1/freebank/blocks, from its header: the eCash block it was mined in), asked once per block and page
 * load, the blocks a page asks for within BATCH_MS in one request (up to BATCH_MAX at once); and the heights and bids of
 * those eCash blocks, from the eCash explorer's BMM events for the slot (the newest EVENTS, read once a minute).
 */
const BATCH_MS = 50;
const BATCH_MAX = 30;
const EVENTS = 200;

@Injectable({ providedIn: 'root' })
export class FreebankLiveService {
  private marks = new Map<string, { at: number; obs: Observable<FreebankBlockMark | null> }>();
  private waiting = new Map<string, ReplaySubject<FreebankBlockMark | null>>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private bmm: { at: number; obs: Observable<Map<string, { height: number; bid: number | null }>> } | null = null;

  /** the tip of the FreeBank chain (getblockchaininfo), every 30 s */
  readonly tip$: Observable<number | null>;

  constructor(private api: FreebankApiService) {
    this.tip$ = timer(0, 30000).pipe(
      switchMap(() => this.api.rpc$<any>('getblockchaininfo').pipe(map(b => Number(b?.blocks) || null), catchError(() => of(null)))),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
  }

  /** a block's eCash BMM block, with its height and bid when the eCash explorer's recent BMM events have it */
  bmm$(hash: string): Observable<FreebankBmmMark> {
    return combineLatest([this.mark$(hash), this.bmmEvents$()]).pipe(map(([mark, events]) => {
      const e = mark?.mainblock ? events.get(mark.mainblock) : undefined;
      return { mark, mainHeight: e?.height ?? null, bid: e?.bid ?? null };
    }));
  }

  /** eCash block hash -> its height and the bid paid for FreeBank's block in it (the eCash explorer's BMM events) */
  private bmmEvents$(): Observable<Map<string, { height: number; bid: number | null }>> {
    const now = Date.now();
    if (!this.bmm || now - this.bmm.at > 60000) {
      const obs = this.api.drivechain$<any[]>('events/bmm', { limit: EVENTS }).pipe(
        map(list => new Map<string, { height: number; bid: number | null }>((list ?? [])
          .filter(e => e?.blockHash).map(e => [String(e.blockHash), { height: Number(e.height), bid: e.bid ?? null }]))),
        catchError(() => of(new Map<string, { height: number; bid: number | null }>())),
        shareReplay(1),
      );
      this.bmm = { at: now, obs };
    }
    return this.bmm.obs;
  }

  mark$(hash: string): Observable<FreebankBlockMark | null> {
    const now = Date.now();
    const m = this.marks.get(hash);
    if (m && now - m.at < 60000) {
      return m.obs;
    }
    const subject = this.waiting.get(hash) ?? new ReplaySubject<FreebankBlockMark | null>(1);
    this.waiting.set(hash, subject);
    const obs = subject.pipe(take(1), shareReplay(1));
    if (this.marks.size > 2000) {
      this.marks.clear();
    }
    this.marks.set(hash, { at: now, obs });
    this.timer ??= setTimeout(() => this.flush(), BATCH_MS);
    return obs;
  }

  /** ask for the waiting blocks, BATCH_MAX at a time */
  private flush(): void {
    this.timer = null;
    const waiting = [...this.waiting];
    this.waiting.clear();
    for (let i = 0; i < waiting.length; i += BATCH_MAX) {
      const chunk = waiting.slice(i, i + BATCH_MAX);
      this.api.blocks$<FreebankBlockMark>(chunk.map(([h]) => h)).pipe(catchError(() => of({} as Record<string, FreebankBlockMark | null>)))
        .subscribe(found => chunk.forEach(([h, s]) => s.next(found?.[h] ?? null)));
    }
  }
}
