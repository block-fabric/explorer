import { Injectable } from '@angular/core';
import { Observable, ReplaySubject, catchError, map, of, shareReplay, take } from 'rxjs';
import { FlushApiService } from './flush-api.service';

/** A block's stake fields (GET /api/v1/flush/blocks, getblock's PosBlockFields) */
export interface FlushBlockMark {
  hash: string;
  height: number;
  kind: 'pos' | 'bmm' | null;
  slot: number | null;
  proposer: string | null;
  mainheight: number | null;
  ack: { ticket: string; anchored: string; payee: string; mainheight: number } | null;
  evidence: { slot: number; hashes: string[] }[];
  finality: { status: 'soft' | 'anchored' | 'final'; anchors: number } | null;
}

/** An eCash anchor of a block: the ticket (or BMM block) on eCash that anchored it, and the Flush block that acked it */
export interface FlushAnchor {
  kind: 'ticket' | 'bmm';
  mainheight: number;
  by: string;
  byHeight: number;
}

/**
 * The marks of Flush's blocks on upstream's block lists and pages (chain/components/block-marks): each block's stake
 * fields, asked once per block and page load (a soft block's finality is asked again after a minute). The blocks a page
 * asks for within BATCH_MS go in one request (GET /api/v1/flush/blocks, up to BATCH_MAX at once).
 */
const BATCH_MS = 50;
/** how many of the newest anchors anchored$ reads (getanchorinfo's own maximum is 100) */
const ANCHORS = 100;
const BATCH_MAX = 30;

@Injectable({ providedIn: 'root' })
export class FlushLiveService {
  private marks = new Map<string, { at: number; obs: Observable<FlushBlockMark | null> }>();
  private waiting = new Map<string, ReplaySubject<FlushBlockMark | null>>(); // replays: a late subscriber still gets its answer
  private timer: ReturnType<typeof setTimeout> | null = null;

  private anchors: { at: number; obs: Observable<Map<string, FlushAnchor>> } | null = null;

  constructor(private api: FlushApiService) {}

  /**
   * The blocks the newest eCash anchors made anchored (getanchorinfo's recent anchors, read once a minute): block hash ->
   * the eCash block of the ticket or BMM block that anchored it
   */
  anchored$(hash: string): Observable<FlushAnchor | null> {
    const now = Date.now();
    if (!this.anchors || now - this.anchors.at > 60000) {
      const obs = this.api.rpc$<any>('getanchorinfo', ANCHORS).pipe(
        map(info => new Map<string, FlushAnchor>((info?.recent ?? []).filter((a: any) => a?.anchored)
          .map((a: any) => [a.anchored, { kind: a.kind, mainheight: a.mainheight, by: a.block, byHeight: a.height }]))),
        catchError(() => of(new Map<string, FlushAnchor>())),
        shareReplay(1),
      );
      this.anchors = { at: now, obs };
    }
    return this.anchors.obs.pipe(map(m => m.get(hash) ?? null));
  }

  mark$(hash: string): Observable<FlushBlockMark | null> {
    const now = Date.now();
    const m = this.marks.get(hash);
    if (m && now - m.at < 60000) {
      return m.obs;
    }
    const subject = this.waiting.get(hash) ?? new ReplaySubject<FlushBlockMark | null>(1);
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
      this.api.blocks$<FlushBlockMark>(chunk.map(([h]) => h)).pipe(catchError(() => of({} as Record<string, FlushBlockMark | null>)))
        .subscribe(found => chunk.forEach(([h, s]) => s.next(found[h] ?? null)));
    }
  }
}
