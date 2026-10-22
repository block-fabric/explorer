import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subject, catchError, debounceTime, filter, map, merge, of, shareReplay, switchMap, timer } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { L2ApiService } from '@app/chain/l2/l2-api.service';
import { L2BlockSummary, L2Deposit, L2Summary, L2Withdrawal } from '@app/chain/l2/l2.interfaces';

/** What a block cube, row or page shows of a sidechain block's BMM: the eCash block that carried it, the bid */
export type L2Mark = Pick<L2BlockSummary, 'height' | 'hash' | 'mainBlock' | 'bmm' | 'deposits'>;

/**
 * A sidechain explorer on upstream's UI (CHAIN_UI 'full'): the sidechain data upstream's pages show next to their
 * own, from /api/v1/l2/* (chain/l2/l2-api.service.ts), once per new block (or every 30 s) whatever the number of
 * components showing it: the summary (dashboard widgets) and the BMM marks of the blocks in view.
 */
@Injectable({ providedIn: 'root' })
export class L2LiveService {
  /** GET /api/v1/l2/summary, live */
  readonly summary$: Observable<L2Summary | null>;
  /** the latest deposits and withdrawals, live */
  readonly deposits$: Observable<L2Deposit[]>;
  readonly withdrawals$: Observable<L2Withdrawal[]>;
  /** the newest blocks with their BMM, live */
  readonly blocks$: Observable<L2BlockSummary[]>;

  private marks = new Map<string, L2Mark | null>();
  private marks$ = new BehaviorSubject<Map<string, L2Mark | null>>(this.marks);
  private asked = new Set<string>();
  private retries = new Map<string, number>();

  constructor(private api: L2ApiService, private stateService: StateService) {
    const tick$ = merge(timer(0, 30000), this.stateService.blocks$.pipe(filter(b => !!b?.length), debounceTime(1500)));
    const live = <T>(req: () => Observable<T>, fallback: T): Observable<T> => tick$.pipe(
      switchMap(() => req().pipe(catchError(() => of(fallback)))),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
    this.summary$ = live<L2Summary | null>(() => this.api.summary$(), null);
    this.deposits$ = live<L2Deposit[]>(() => this.api.deposits$(null, 8), []);
    this.withdrawals$ = live<L2Withdrawal[]>(() => this.api.withdrawals$(null, 8), []);
    this.blocks$ = live<L2BlockSummary[]>(() => this.api.blocks$(null, 48), []);

    // the marks of the blocks in the block strip (stateService.blocks$): one request for all of them, matched by
    // height as well as by hash (upstream's ids and the index's are the same hex, but the height is what is sure)
    this.stateService.blocks$.pipe(
      filter(b => !!b?.length),
      debounceTime(300),
    ).subscribe(blocks => this.fetchRange(blocks.map(b => ({ hash: b.id, height: b.height }))));
  }

  /** txid -> its inputs that spend a deposit from eCash: input index -> the eCash deposit txid (null: being asked) */
  private txDeposits = new Map<string, Map<number, string> | null>();
  /** a transaction's deposits came in */
  readonly txDeposits$ = new Subject<string>();

  /**
   * The eCash deposit transaction an input spends, for upstream's inputs list, where a deposit's outpoint is an eCash
   * txid that is not on the sidechain (GET /api/v1/l2/tx/:txid, once per transaction): undefined until known
   */
  depositOf(txid: string, vin: number): string | null | undefined {
    if (!txid) {
      return null;
    }
    if (!this.txDeposits.has(txid)) {
      this.txDeposits.set(txid, null);
      this.api.tx$(txid).pipe(catchError(() => of(null))).subscribe((tx) => {
        const m = new Map<number, string>();
        tx?.inputs?.forEach((i, n) => {
          if (i.outpoint?.kind === 'deposit' && i.outpoint.txid) {
            m.set(n, i.outpoint.txid);
          }
        });
        this.txDeposits.set(txid, m);
        if (this.txDeposits.size > 2000) {
          this.txDeposits.delete(this.txDeposits.keys().next().value);
        }
        this.txDeposits$.next(txid);
      });
    }
    const m = this.txDeposits.get(txid);
    return m ? (m.get(vin) ?? null) : undefined;
  }

  mark$(hash: string): Observable<L2Mark | null | undefined> {
    return this.marks$.pipe(map(m => m.get(hash)));
  }

  /** the mark of one block (block and transaction pages, older blocks): GET /api/v1/l2/block/:hash */
  requestHash(hash: string): void {
    if (!hash || this.marks.has(hash) || this.asked.has(hash)) {
      return;
    }
    this.asked.add(hash);
    this.api.block$(hash).pipe(catchError(() => of(null))).subscribe((b) => {
      if (b) {
        this.set(hash, { height: b.height, hash: b.hash, mainBlock: b.mainBlock, bmm: b.bmm ?? null, deposits: b.deposits?.length ?? 0 });
      } else {
        // not indexed yet (a new block): ask again a little later
        const n = this.retries.get(hash) ?? 0;
        if (n < 6) {
          this.retries.set(hash, n + 1);
          setTimeout(() => { this.asked.delete(hash); this.requestHash(hash); }, 5000);
        }
      }
    });
  }

  private fetchRange(blocks: { hash: string; height: number }[]): void {
    const missing = blocks.filter(b => !this.marks.get(b.hash));
    if (!missing.length) {
      return;
    }
    const top = Math.max(...missing.map(b => b.height));
    const bottom = Math.min(...missing.map(b => b.height));
    this.api.blocks$(top + 1, Math.min(100, top - bottom + 1)).pipe(catchError(() => of([] as L2BlockSummary[]))).subscribe((sums) => {
      const byHeight = new Map(sums.map(s => [s.height, s]));
      for (const b of missing) {
        const s = byHeight.get(b.height);
        if (s) {
          this.set(b.hash, s);
        }
      }
      // the index can be a few seconds behind the block strip: ask again for what it did not have yet
      const still = missing.filter(b => !this.marks.get(b.hash));
      const key = still[0]?.hash;
      if (key && (this.retries.get(key) ?? 0) < 6) {
        this.retries.set(key, (this.retries.get(key) ?? 0) + 1);
        setTimeout(() => this.fetchRange(still), 5000);
      }
    });
  }

  private set(hash: string, s: L2Mark): void {
    this.marks.set(hash, { height: s.height, hash: s.hash, mainBlock: s.mainBlock, bmm: s.bmm ?? null, deposits: s.deposits });
    this.marks$.next(this.marks);
  }
}
