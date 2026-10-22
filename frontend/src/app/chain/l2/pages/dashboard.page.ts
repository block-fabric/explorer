import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription, catchError, forkJoin, map, of, switchMap, timer } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { PROFILE } from '@app/chain/profiles';
import { L2ApiService, l2Error } from '@app/chain/l2/l2-api.service';
import { L2BlockSummary, L2Deposit, L2Error, L2Summary, L2Withdrawal } from '@app/chain/l2/l2.interfaces';
import { L2_PAGE_IMPORTS, shortId } from '@app/chain/l2/l2-common';

interface Dash {
  summary: L2Summary;
  blocks: L2BlockSummary[];
  deposits: L2Deposit[];
  withdrawals: L2Withdrawal[];
}

/** A sidechain explorer's dashboard (/): the tip, counts, wealth against the eCash escrow, the pending bundle, the latest blocks, deposits and withdrawals; every 15 s */
@Component({
  selector: 'app-l2-dashboard',
  standalone: true,
  imports: [...L2_PAGE_IMPORTS],
  templateUrl: './dashboard.page.html',
  styleUrls: ['../../components/module-page.scss', './l2-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class L2DashboardPage implements OnInit, OnDestroy {
  profile = PROFILE;
  d: Dash | null = null;
  error: L2Error | null = null;
  shortId = shortId;
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
