import { AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, Subscription, catchError, merge, of, switchMap, timer } from 'rxjs';
import { NgxEchartsDirective, provideEchartsCore } from 'ngx-echarts';
import { SeoService } from '@app/services/seo.service';
import { PROFILE, slotColor } from '@app/chain/profiles';
import { escapeHtml } from '@app/chain/escape-html';
import { axisStyle, baseChart, cockpitCharts } from '@app/chain/pages/cockpit/cockpit-charts';
import { L2ApiService, l2Error } from '@app/chain/l2/l2-api.service';
import { L2Error } from '@app/chain/l2/l2.interfaces';
import { L2_PAGE_IMPORTS, shortId } from '@app/chain/l2/l2-common';
import { L2TransfersPage } from '@app/chain/l2/pages/transfers.page';

/**
 * /bmm: this sidechain on eCash, from the eCash explorer's drivechain index (GET /api/v1/l2/bmm/*): the eCash blocks
 * that carried its blocks and the bids paid for them (blind merged mining), BMM coverage and gaps, competition for the
 * slot, the escrow over time, deposits and withdrawals (with their full lists, the #peg section: /deposits and
 * /withdrawals open the page there), and the withdrawal bundles on their way to payout. The charts
 * are the eCash explorer's cockpit's (pages/cockpit/cockpit-charts.ts), for this slot only.
 */

const WINDOWS = [
  { label: '1h', blocks: 60 },
  { label: '1d', blocks: 1440 },
  { label: '1w', blocks: 10080 },
  { label: 'All', blocks: 0 },
];
const FEEDS = [
  { id: 'bmm', label: 'BMM' },
  { id: 'bmm-requests', label: 'BMM requests' },
  { id: 'deposits', label: 'Deposits' },
  { id: 'withdrawals', label: 'Withdrawals' },
  { id: 'bundles', label: 'Bundles' },
];
const FEED_PAGE = 40;

/** an eCash hash in Bitcoin display order as the nodes' order (and back) */
export function reverseHex(h: string): string {
  return (String(h).match(/../g) ?? []).reverse().join('');
}

@Component({
  selector: 'app-l2-bmm',
  standalone: true,
  imports: [...L2_PAGE_IMPORTS, NgxEchartsDirective, L2TransfersPage],
  providers: [provideEchartsCore({ echarts: () => import('@app/graphs/echarts').then(m => m.echarts) })],
  templateUrl: './bmm.page.html',
  styleUrls: ['../../pages/cockpit/cockpit.component.scss', './l2-page.scss', './bmm.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class L2BmmPage implements OnInit, AfterViewInit, OnDestroy {
  profile = PROFILE;
  slot = PROFILE.slot as number;
  /** a sidechain explorer of its own blocks and peg lists (kind 'l2'); Flush (chain/modules/flush) reuses this page for
   * its BMM, with the peg on its /peg page, and its block links by the hash the BMM commitment names */
  sideLists = PROFILE.kind === 'l2';
  windows = WINDOWS;
  feeds = FEEDS;
  window = 1440;
  feed = 'bmm';
  /** the peg list's first tab; set when the page was opened as /deposits or /withdrawals */
  pegKind: 'deposits' | 'withdrawals' = 'deposits';
  private pegFirst = false;
  feedBefore: number | null = null;
  feedPage = FEED_PAGE;
  shortId = shortId;
  reverseHex = reverseHex;

  data: any = null;
  error: L2Error | null = null;
  feedItems: any[] | null = null;
  requests: any[] = [];
  charts: Record<string, any> = {};
  chartInitOptions = { renderer: 'svg' };

  private reload$ = new Subject<void>();
  private feedReload$ = new Subject<void>();
  private subs: Subscription[] = [];

  constructor(
    private api: L2ApiService,
    private cd: ChangeDetectorRef,
    private route: ActivatedRoute,
    private router: Router,
    private seo: SeoService,
  ) {}

  ngOnInit(): void {
    this.seo.setTitle(`${PROFILE.name}: drivechain on eCash`);
    const peg = this.route.snapshot.data['peg'];
    if (peg === 'deposits' || peg === 'withdrawals') {
      this.pegKind = peg;
      this.pegFirst = true;
    }
    const q = this.route.snapshot.queryParamMap;
    if (q.get('window') !== null && /^\d+$/.test(q.get('window') as string)) { this.window = Number(q.get('window')); }
    if (q.get('feed') && FEEDS.some(f => f.id === q.get('feed'))) { this.feed = q.get('feed') as string; }

    this.subs.push(merge(timer(0, 30000), this.reload$).pipe(
      switchMap(() => this.api.bmmCockpit$(this.window).pipe(catchError(e => { this.error = l2Error(e); return of(null); }))),
    ).subscribe(d => {
      if (d) {
        this.data = d;
        this.error = null;
        this.buildCharts();
      }
      this.cd.markForCheck();
    }));
    // the competition: the newest M8 requests for the slot, accepted or not
    this.subs.push(timer(0, 60000).pipe(
      switchMap(() => this.api.bmmEvents$('bmm-requests', null, 500).pipe(catchError(() => of(null)))),
    ).subscribe(r => {
      if (r) {
        this.requests = r;
        this.buildCompetition();
      }
      this.cd.markForCheck();
    }));
    this.subs.push(merge(timer(0, 30000), this.feedReload$).pipe(
      switchMap(() => this.api.bmmEvents$(this.feed, this.feedBefore, FEED_PAGE).pipe(catchError(() => of([])))),
    ).subscribe(items => {
      this.feedItems = items;
      this.cd.markForCheck();
    }));
  }

  ngAfterViewInit(): void {
    if (this.pegFirst) {
      setTimeout(() => document.getElementById('peg')?.scrollIntoView({ block: 'start' }));
    }
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
  }

  private syncUrl(): void {
    void this.router.navigate([], { queryParams: { window: this.window, feed: this.feed }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  setWindow(w: number): void {
    this.window = w;
    this.syncUrl();
    this.reload$.next();
  }

  setFeed(f: string): void {
    this.feed = f;
    this.feedBefore = null;
    this.feedItems = null;
    this.syncUrl();
    this.feedReload$.next();
  }

  /** the feed's older events (before = the lowest eCash height shown), or its newest (null) */
  pageFeed(before: number | null): void {
    this.feedBefore = before;
    this.feedItems = null;
    this.feedReload$.next();
  }

  // --- helpers for the template ---------------------------------------------------------------------

  get color(): string {
    return slotColor(this.slot);
  }

  get stats(): any {
    return this.data?.slots?.find((s: any) => s.slot === this.slot) ?? null;
  }

  get live(): any {
    return this.data?.live?.sidechains?.find((s: any) => s.slot === this.slot) ?? null;
  }

  accepted(block: any): any {
    return block.accepts.find((a: any) => a.slot === this.slot);
  }

  pct(x: number, digits = 1): string {
    return ((x || 0) * 100).toFixed(digits) + '%';
  }

  windowLabel(): string {
    const w = WINDOWS.find(x => x.blocks === this.window);
    return w ? (w.blocks ? `last ${w.label}` : 'everything indexed') : `last ${this.window} blocks`;
  }

  /** a bundle's path to payout: votes / threshold, and whether it can still make it in the blocks it has left */
  bundleProgress(b: any): { pct: number; needed: number; canMake: boolean } {
    const min = b.threshold || 1;
    const needed = Math.max(0, min - b.score);
    return { pct: Math.min(1, b.score / min), needed, canMake: needed <= b.blocksleft };
  }

  /** the miners that carried this sidechain in the window, most accepts first */
  carriers(): any[] {
    return (this.data?.miners ?? []).filter((m: any) => m.accepts > 0).sort((a: any, b: any) => b.accepts - a.accepts).slice(0, 10);
  }

  trackHeight = (_: number, b: any) => b.height;

  // --- charts ---------------------------------------------------------------------------------------

  private buildCharts(): void {
    const name = this.data?.live?.sidechains?.[0]?.title ?? PROFILE.name;
    this.charts = {
      ...cockpitCharts(this.data, { colorOf: s => slotColor(s), nameOf: () => name, unit: 'ECX' }),
      competition: this.charts.competition,
    };
  }

  /** the bids of the newest M8 requests for the slot, accepted and beaten, over the eCash height */
  private buildCompetition(): void {
    const reqs = this.requests ?? [];
    const point = (r: any) => ({ value: [r.height, r.bid], txid: r.txid, accepted: r.accepted });
    const tooltip = (p: any) => `eCash block ${escapeHtml(p.value[0])}<br>bid ${escapeHtml(p.value[1])} sats · ${p.data.accepted ? 'accepted' : 'beaten'}<br>`
      + `<span style="font-family:monospace">${escapeHtml(shortId(p.data.txid))}</span>`;
    this.charts = {
      ...this.charts,
      competition: baseChart({
        tooltip: { ...baseChart().tooltip, trigger: 'item', formatter: tooltip },
        xAxis: { type: 'value', min: 'dataMin', max: 'dataMax', name: 'eCash height', nameTextStyle: { color: '#ffffff88', fontSize: 10 }, ...axisStyle() },
        yAxis: { type: 'value', name: 'sats', nameTextStyle: { color: '#ffffff88', fontSize: 10 }, ...axisStyle() },
        series: [
          { name: 'accepted', type: 'scatter', symbolSize: 6, itemStyle: { color: this.color }, data: reqs.filter(r => r.accepted).map(point) },
          { name: 'beaten', type: 'scatter', symbolSize: 7, symbol: 'diamond', itemStyle: { color: '#ff6b6b' }, data: reqs.filter(r => !r.accepted).map(point) },
        ],
      }),
    };
  }
}
