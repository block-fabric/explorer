import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, catchError, combineLatest, debounceTime, filter, map, merge, of, shareReplay, switchMap, timer } from 'rxjs';
import { ChainApiService } from '@app/chain/chain-api.service';
import { DrivechainBlockSummary, SidechainCarrier } from '@app/chain/chain.interfaces';
import { PROFILE } from '@app/chain/profiles';
import { StateService } from '@app/services/state.service';

/** What the block cubes and tables show for a block: its drivechain summary (Chains) or its carrier (a sidechain) */
export interface BlockMark {
  summary?: DrivechainBlockSummary;
  carrier?: SidechainCarrier | null;
  /** blocks of stake (FastBlocks, Layers): kind (pos | bmm), slot, proposer, ack, finality */
  pos?: { kind: string; slot?: number; proposer?: string; finality?: { status: string; anchors: number }; ack?: any; mainheight?: number } | null;
}

/**
 * Live drivechain data shared by the dashboard widgets, the block cubes and the blocks tables: one request per new
 * block (or every 30 s), whatever the number of components showing it.
 */
@Injectable({ providedIn: 'root' })
export class DrivechainLiveService {
  private marks = new Map<string, BlockMark>();
  /** block hash -> mark, for the blocks the site shows */
  marks$ = new BehaviorSubject<Map<string, BlockMark>>(this.marks);

  /** the cockpit over the newest 144 blocks, live */
  cockpit$: Observable<any>;
  /** the latest deposits and withdrawals, newest first */
  peg$: Observable<any[]>;

  private wantHashes = new Set<string>();
  private retries = new Map<string, number>();

  constructor(private api: ChainApiService, private stateService: StateService) {
    const tick$ = merge(timer(0, 30000), this.stateService.blocks$.pipe(filter(b => !!b?.length), debounceTime(1500)));

    this.cockpit$ = tick$.pipe(
      switchMap(() => this.api.get<any>('drivechain/cockpit', { window: 144 }).pipe(catchError(() => of(null)))),
      filter(d => !!d),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    this.peg$ = tick$.pipe(
      switchMap(() => merge(
        this.api.events$('deposits', null, null, 8).pipe(map(xs => xs.map(x => ({ ...x, kind: 'deposit' })))),
        this.api.events$('withdrawals', null, null, 8).pipe(map(xs => xs.map(x => ({ ...x, kind: 'withdrawal' })))),
      ).pipe(
        catchError(() => of([])),
      )),
      // merge the two lists as they come
      map((() => {
        let acc: Record<string, any[]> = {};
        return (xs: any[]) => {
          if (xs.length) { acc[xs[0].kind] = xs; }
          return [...(acc.deposit ?? []), ...(acc.withdrawal ?? [])].sort((a, b) => b.height - a.height).slice(0, 10);
        };
      })()),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    // block marks for the blocks in view (the block strip pushes them through stateService.blocks$)
    this.stateService.blocks$.pipe(
      filter(b => !!b?.length),
      debounceTime(300),
      switchMap((blocks) => {
        for (const b of blocks) { this.wantHashes.add(b.id); }
        return this.fetchMarks(blocks.map(b => ({ hash: b.id, height: b.height })));
      }),
    ).subscribe();
  }

  private asked = new Set<string>();

  /** a mark for one block, wherever it is shown (block and transaction pages, old blocks) */
  requestHash(hash: string): void {
    if (!hash || this.marks.has(hash) || this.asked.has(hash)) {
      return;
    }
    this.asked.add(hash);
    // batched: every hash asked in the same tick goes in one request
    this.batch.add(hash);
    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        const hashes = [...this.batch].slice(0, 100);
        this.batch.clear();
        this.batchTimer = null;
        const req$ = PROFILE.mainchain
          ? this.api.get<DrivechainBlockSummary[]>('drivechain/blocks', { hashes: hashes.join(',') }).pipe(
            map((sums) => { for (const s of sums) { this.marks.set(s.hash, { summary: s }); } }))
          : this.fetchMarks(hashes.map(h => ({ hash: h, height: 0 })));
        req$.pipe(catchError(() => of(null))).subscribe(() => this.marks$.next(this.marks));
      }, 50);
    }
  }
  private batch = new Set<string>();
  private batchTimer: any = null;

  /** marks for blocks shown elsewhere (the blocks list page) */
  request(blocks: { hash: string; height: number }[]): void {
    const missing = blocks.filter(b => !this.marks.has(b.hash));
    if (missing.length) {
      this.fetchMarks(missing).subscribe();
    }
  }

  private fetchMarks(blocks: { hash: string; height: number }[]): Observable<void> {
    if (!blocks.length) {
      return of(undefined);
    }
    if (PROFILE.mainchain) {
      const top = Math.max(...blocks.map(b => b.height));
      const bottom = Math.min(...blocks.map(b => b.height));
      return this.api.drivechainBlocks$(top, Math.min(100, top - bottom + 1)).pipe(
        catchError(() => of([] as DrivechainBlockSummary[])),
        map((sums) => {
          for (const s of sums) { this.marks.set(s.hash, { summary: s }); }
          this.marks$.next(this.marks);
          // the drivechain index can be a few seconds behind the block strip: ask again for what it did not have yet
          const missing = blocks.filter(b => !this.marks.has(b.hash));
          if (missing.length && (this.retries.get(missing[0].hash) ?? 0) < 6) {
            this.retries.set(missing[0].hash, (this.retries.get(missing[0].hash) ?? 0) + 1);
            setTimeout(() => this.fetchMarks(missing).subscribe(), 5000);
          }
        }),
      );
    }
    // every time: the carrier of a new block comes a little later, and finality moves (soft, anchored, final)
    const hashes = blocks.map(b => b.hash).slice(0, 100);
    return combineLatest([
      this.api.carriers$(hashes).pipe(catchError(() => of({} as Record<string, SidechainCarrier | null>))),
      PROFILE.pos ? this.api.get<Record<string, any>>('sidechain/blocks-features', { hashes: hashes.join(',') }).pipe(catchError(() => of({}))) : of({} as Record<string, any>),
    ]).pipe(
      map(([carriers, features]) => {
        for (const h of hashes) {
          this.marks.set(h, { carrier: carriers[h] ?? null, pos: features[h] ?? this.marks.get(h)?.pos ?? null });
        }
        this.marks$.next(this.marks);
      }),
    );
  }

  mark$(hash: string): Observable<BlockMark | undefined> {
    return this.marks$.pipe(map(m => m.get(hash)));
  }
}
