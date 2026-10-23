import { Injectable } from '@angular/core';
import { Observable, ReplaySubject, catchError, of, shareReplay, take } from 'rxjs';
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

/**
 * The marks of Flush's blocks on upstream's block lists and pages (chain/components/block-marks): each block's stake
 * fields, asked once per block and page load (a soft block's finality is asked again after a minute). The blocks a page
 * asks for within BATCH_MS go in one request (GET /api/v1/flush/blocks, up to BATCH_MAX at once).
 */
const BATCH_MS = 50;
const BATCH_MAX = 30;

@Injectable({ providedIn: 'root' })
export class FlushLiveService {
  private marks = new Map<string, { at: number; obs: Observable<FlushBlockMark | null> }>();
  private waiting = new Map<string, ReplaySubject<FlushBlockMark | null>>(); // replays: a late subscriber still gets its answer
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private api: FlushApiService) {}

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
