import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription, catchError, forkJoin, map, of, switchMap, timer } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { PROFILE } from '@app/chain/profiles';
import { L2ApiService, l2Error } from '@app/chain/l2/l2-api.service';
import { L2BlockSummary, L2Deposit, L2Error, L2Summary, L2Withdrawal } from '@app/chain/l2/l2.interfaces';
import { L2_PAGE_IMPORTS, shortId } from '@app/chain/l2/l2-common';
import { CxColumn, CxFilter } from '@app/chain/components/chain-table/chain-table.component';
import { L2BlockStripComponent } from '@app/chain/l2/l2-block-strip.component';

interface Dash {
  summary: L2Summary;
  blocks: L2BlockSummary[];
  deposits: L2Deposit[];
  withdrawals: L2Withdrawal[];
}

/** A sidechain explorer's dashboard (/): the block strip with BMM marks, the tip, counts, BMM coverage, wealth against the eCash escrow, the pending bundle, the latest blocks, deposits and withdrawals; every 15 s */
@Component({
  selector: 'app-l2-dashboard',
  standalone: true,
  imports: [...L2_PAGE_IMPORTS, L2BlockStripComponent],
  templateUrl: './dashboard.page.html',
  styleUrls: ['../../components/module-page.scss', './l2-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class L2DashboardPage implements OnInit, OnDestroy {
  profile = PROFILE;
  d: Dash | null = null;
  error: L2Error | null = null;
  shortId = shortId;
  blockCols: CxColumn<L2BlockSummary>[] = [
    { key: 'height', label: 'Height', sort: true },
    { key: 'hash', label: 'Hash', hide: 'md' },
    { key: 'time', label: 'Time', sort: r => r.time, nowrap: true },
    { key: 'main', label: 'eCash block (BMM)', sort: r => r.mainBlock?.height },
    { key: 'bid', label: 'Bid', align: 'right', sort: r => r.bmm?.bid, nowrap: true },
    { key: 'txCount', label: 'Txs', align: 'right', sort: true },
    { key: 'deposits', label: 'Deposits', align: 'right', sort: true, hide: 'md' },
    { key: 'volume', label: 'Volume', align: 'right', sort: true },
    { key: 'fees', label: 'Fees', align: 'right', sort: true, hide: 'md' },
  ];
  blockKey = (b: L2BlockSummary) => b.hash;
  depositCols: CxColumn<L2Deposit>[] = [
    { key: 'height', label: 'Block', sort: true },
    { key: 'mainTxid', label: 'eCash tx' },
    { key: 'address', label: 'To' },
    { key: 'amount', label: 'Amount', align: 'right', sort: true },
  ];
  depositMatches = (x: L2Deposit, q: string) => x.address.toLowerCase().includes(q) || x.mainTxid.toLowerCase().includes(q);
  withdrawalCols: CxColumn<L2Withdrawal>[] = [
    { key: 'height', label: 'Block', sort: true, nowrap: true },
    { key: 'mainAddress', label: 'To (eCash)' },
    { key: 'status', label: 'Status', sort: true },
    { key: 'amount', label: 'Amount', align: 'right', sort: true },
  ];
  withdrawalFilters: CxFilter<L2Withdrawal>[] = [{ options: (['pending', 'bundled', 'paid'] as const).map(st => ({ label: st, test: w => w.status === st })) }];
  withdrawalMatches = (w: L2Withdrawal, q: string) => w.mainAddress.toLowerCase().includes(q) || w.txid.toLowerCase().includes(q) || w.address.toLowerCase().includes(q);
  payoutCols: CxColumn<{ address: string; amount: number; fee: number }>[] = [
    { key: 'address', label: 'eCash address' },
    { key: 'amount', label: 'Amount', align: 'right', sort: true },
    { key: 'fee', label: 'Fee', align: 'right', sort: true },
  ];
  payoutMatches = (p: { address: string }, q: string) => p.address.toLowerCase().includes(q);
  private sub: Subscription;

  constructor(private api: L2ApiService, private cd: ChangeDetectorRef, private seo: SeoService) {}

  ngOnInit(): void {
    this.seo.resetTitle();
    this.sub = timer(0, 15000).pipe(
      switchMap(() => forkJoin({
        summary: this.api.summary$(),
        blocks: this.api.blocks$(null, 10),
        deposits: this.api.deposits$(null, 8),
        withdrawals: this.api.withdrawals$(null, 8),
      }).pipe(
        map(d => ({ d, e: null as L2Error | null })),
        catchError(e => of({ d: null as Dash | null, e: l2Error(e) })),
      )),
    ).subscribe(({ d, e }) => {
      // a failed refresh keeps what was there
      if (d) {
        this.d = d;
      }
      this.error = e;
      this.cd.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  /** the sidechain's wealth as a share of the eCash escrow */
  share(s: L2Summary): number {
    return s.escrow?.amount ? Math.min(1, s.wealth / s.escrow.amount) : 0;
  }
}
