import { AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { EMPTY, Observable, Subject, Subscription, catchError, expand, forkJoin, map, merge, of, reduce, switchMap, timer } from 'rxjs';
import { ChainApiService } from '@app/chain/chain-api.service';
import { NgxEchartsDirective, provideEchartsCore } from 'ngx-echarts';
import { SeoService } from '@app/services/seo.service';
import { PROFILE, slotColor } from '@app/chain/profiles';
import { escapeHtml } from '@app/chain/escape-html';
import { axisStyle, baseChart, cockpitCharts } from '@app/chain/pages/cockpit/cockpit-charts';
import { L2ApiService, l2Error } from '@app/chain/l2/l2-api.service';
import { L2BlockSummary, L2Error } from '@app/chain/l2/l2.interfaces';
import { ChainTableComponent, CxCellDirective, CxColumn, CxFilter } from '@app/chain/components/chain-table/chain-table.component';
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
/** BMM economics: the newest sidechain blocks read (in pages of 50) */
const ECON_BLOCKS = 200;
/** a node sidechain's (Flush, FreeBank): upstream's block list gives 15 a call */
const ECON_NODE_BLOCKS = 120;
/** the bid market's buckets (sats, upper bounds) */
const BID_BUCKETS = [250, 500, 1000, 2500, 5000, 10000, 50000, Infinity];

/** a sidechain block's BMM economics: the bid paid on eCash against the fees its producer took on the sidechain */
export interface EconRow {
  height: number;
  hash: string;
  time: number | null;
  mainHeight: number | null;
  txs: number;
  fees: number;
  bid: number | null;
  /** fees − bid (sats); null: no bid known */
  margin: number | null;
  contested: boolean;
}

export interface EconSummary {
  blocks: number;
  withBid: number;
  bids: number;
  fees: number;
  margin: number;
  /** blocks whose fees covered their bid, of those with a bid */
  covered: number;
  txs: number;
  bidMedian: number;
  feesMedian: number;
  from: number;
  to: number;
}

/** a sidechain explorer's block summary as a row */
const econRow = (b: L2BlockSummary): EconRow => {
  const bid = b.bmm?.bid ?? null;
  return {
    height: b.height, hash: b.hash, time: b.time, mainHeight: b.bmm?.mainHeight ?? b.mainBlock?.height ?? null,
    txs: b.txCount, fees: b.fees || 0, bid, margin: bid === null ? null : (b.fees || 0) - bid, contested: !!b.bmm?.contested,
  };
};

const median = (xs: number[]): number => {
  if (!xs.length) { return 0; }
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/** an eCash hash in Bitcoin display order as the nodes' order (and back) */
export function reverseHex(h: string): string {
  return (String(h).match(/../g) ?? []).reverse().join('');
}

@Component({
  selector: 'app-l2-bmm',
  standalone: true,
  imports: [...L2_PAGE_IMPORTS, NgxEchartsDirective, L2TransfersPage, ChainTableComponent, CxCellDirective],
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
  econRows: EconRow[] | null = null;
  econ: EconSummary | null = null;
  econCols: CxColumn<EconRow>[] = [
    { key: 'height', label: 'Block', sort: r => r.height },
    { key: 'mainHeight', label: 'eCash block', sort: r => r.mainHeight },
    { key: 'time', label: 'Age', sort: r => r.time, hide: 'md' },
    { key: 'txs', label: 'Txs', align: 'right', sort: r => r.txs },
    { key: 'fees', label: 'Fees earned', align: 'right', sort: r => r.fees, nowrap: true },
    { key: 'bid', label: 'Bid paid', align: 'right', sort: r => r.bid, nowrap: true },
    { key: 'margin', label: 'Margin', align: 'right', sort: r => r.margin, nowrap: true },
  ];
  econFilters: CxFilter<EconRow>[] = [{ options: [
    { label: 'Paid for itself', test: r => r.margin !== null && r.margin >= 0 },
    { label: 'At a loss', test: r => r.margin !== null && r.margin < 0 },
    { label: 'With transactions', test: r => r.txs > 0 },
    { label: 'Contested', test: r => r.contested },
  ] }];
  econSearch = (r: EconRow, q: string): boolean => String(r.height).includes(q) || String(r.mainHeight ?? '').includes(q) || r.hash.startsWith(q);
  minerCols: CxColumn[] = [
    { key: 'name', label: 'Miner', sort: m => (m.name || m.tag).toLowerCase() },
    { key: 'blocks', label: 'Blocks', align: 'right', sort: m => m.blocks },
    { key: 'accepts', label: 'Carried', align: 'right', sort: m => m.accepts, title: 'Its blocks that carried one of this sidechain' },
    { key: 'bids', label: 'Bids earned', align: 'right', sort: m => m.bids, nowrap: true },
  ];
  minerSearch = (m: any, q: string): boolean => (m.name || m.tag || '').toLowerCase().includes(q);

  private reload$ = new Subject<void>();
  private feedReload$ = new Subject<void>();
  private subs: Subscription[] = [];

  constructor(
    private api: L2ApiService,
    private chainApi: ChainApiService,
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
        this.buildBidMarket();
      }
      this.cd.markForCheck();
    }));
    // the economics: the newest sidechain blocks, their fees and their bids
    if (this.econAvailable) {
      this.subs.push(timer(0, 60000).pipe(
        switchMap(() => (this.sideLists ? this.newestBlocks$(ECON_BLOCKS).pipe(map(bs => bs.map(econRow))) : this.nodeRows$(ECON_NODE_BLOCKS))
          .pipe(catchError(() => of(null)))),
      ).subscribe(rows => {
        if (rows) {
          this.buildEconomics(rows);
        }
        this.cd.markForCheck();
      }));
    }
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
    const miners = this.data?.miners ?? null;
    if (miners !== this.carriersOf) {
      this.carriersOf = miners;
      this.carriersList = (miners ?? []).filter((m: any) => m.accepts > 0).sort((a: any, b: any) => b.accepts - a.accepts);
    }
    return this.carriersList;
  }
  private carriersOf: any[] | null = null;
  private carriersList: any[] = [];

  trackHeight = (_: number, b: any) => b.height;
  trackHeightRow = (r: EconRow): number => r.height;

  // --- BMM economics -------------------------------------------------------------------------------

  /** the economics need each block's fees: a sidechain explorer of its own blocks, or a node sidechain's block list */
  get econAvailable(): boolean {
    return this.sideLists || PROFILE.kind === 'freebank' || PROFILE.kind === 'flush';
  }

  /** the newest n sidechain blocks, newest first, in pages of 50 */
  private newestBlocks$(n: number): Observable<L2BlockSummary[]> {
    const page = (before: number | null) => this.api.blocks$(before, 50);
    return page(null).pipe(
      expand((blocks, i) => blocks.length === 50 && (i + 1) * 50 < n ? page(blocks[blocks.length - 1].height) : EMPTY),
      reduce((all: L2BlockSummary[], blocks) => all.concat(blocks), []),
      map(all => all.slice(0, n)),
    );
  }

  /**
   * A node sidechain's newest blocks (upstream's block list, 15 a call: fees, txs) with the eCash block each was merged-mined
   * in (its module's block fields: FreeBank names the eCash block hash, Flush its height) and that block's bid for the
   * slot (the drivechain index's BMM events). A Flush block of stake has no eCash block: no bid.
   */
  private nodeRows$(n: number): Observable<EconRow[]> {
    const page = (height: number | null) => this.chainApi.get<any[]>(height === null ? 'blocks' : 'blocks/' + height);
    const blocks$ = page(null).pipe(
      expand((bs, i) => bs.length && (i + 1) * 15 < n && bs[bs.length - 1].height > 0 ? page(bs[bs.length - 1].height - 1) : EMPTY),
      reduce((all: any[], bs) => all.concat(bs), []),
      map(all => all.slice(0, n)),
    );
    return blocks$.pipe(switchMap(blocks => {
      const chunks: string[][] = [];
      for (let i = 0; i < blocks.length; i += 30) {
        chunks.push(blocks.slice(i, i + 30).map(b => b.id));
      }
      const fields$ = chunks.length
        ? forkJoin(chunks.map(c => this.chainApi.get<Record<string, any>>(`${PROFILE.kind}/blocks`, { hashes: c.join(',') }).pipe(catchError(() => of({})))))
        : of([]);
      return forkJoin([fields$, this.api.bmmEvents$('bmm', null, 500).pipe(catchError(() => of([])))]).pipe(map(([parts, events]) => {
        const fields: Record<string, any> = Object.assign({}, ...parts);
        const byHash = new Map<string, any>(events.map((e: any) => [e.blockHash, e]));
        const byHeight = new Map<number, any>(events.map((e: any) => [e.height, e]));
        return blocks.map(b => {
          const f = fields[b.id] ?? null;
          const ev = (f?.mainblock && byHash.get(f.mainblock)) || (f?.kind === 'bmm' && f?.mainheight && byHeight.get(f.mainheight)) || null;
          const fees = b.extras?.totalFees ?? 0;
          const bid = ev?.bid ?? null;
          return {
            height: b.height, hash: b.id, time: b.timestamp ?? null, mainHeight: ev?.height ?? f?.mainheight ?? null,
            txs: Math.max(0, (b.tx_count ?? 1) - 1), fees, bid, margin: bid === null ? null : fees - bid, contested: false,
          } as EconRow;
        });
      }));
    }));
  }

  private buildEconomics(rows: EconRow[]): void {
    const withBid = rows.filter(r => r.bid !== null);
    const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);
    this.econRows = rows;
    this.econ = {
      blocks: rows.length, withBid: withBid.length,
      bids: sum(withBid.map(r => r.bid as number)), fees: sum(rows.map(r => r.fees)),
      margin: sum(withBid.map(r => r.margin as number)), covered: withBid.filter(r => (r.margin as number) >= 0).length,
      txs: sum(rows.map(r => r.txs)), bidMedian: median(withBid.map(r => r.bid as number)), feesMedian: median(rows.map(r => r.fees)),
      from: rows.length ? rows[rows.length - 1].height : 0, to: rows.length ? rows[0].height : 0,
    };
    // oldest first, block by block: the fees earned up, the bid paid down, and the running margin
    const asc = [...rows].reverse();
    let run = 0;
    const running = asc.map(r => (run += r.margin ?? 0));
    this.charts = {
      ...this.charts,
      economics: baseChart({
        grid: { left: 56, right: 56, top: 30, bottom: 28 },
        xAxis: { type: 'category', data: asc.map(r => r.height), ...axisStyle() },
        yAxis: [
          { type: 'value', name: 'sats', nameTextStyle: { color: '#ffffff88', fontSize: 10 }, ...axisStyle() },
          { type: 'value', name: 'running margin', nameTextStyle: { color: '#ffffff88', fontSize: 10 }, ...axisStyle(), splitLine: { show: false } },
        ],
        series: [
          { name: 'fees earned', type: 'bar', stack: 'e', itemStyle: { color: '#3bd16f' }, data: asc.map(r => r.fees) },
          { name: 'bid paid', type: 'bar', stack: 'e', itemStyle: { color: this.color }, data: asc.map(r => -(r.bid ?? 0)) },
          { name: 'running margin', type: 'line', yAxisIndex: 1, showSymbol: false, lineStyle: { width: 1.5, color: '#ffffffaa' }, data: running },
        ],
      }),
    };
    this.buildBidMarket();
  }

  /** the bids of the newest M8 requests by size: accepted and beaten */
  private buildBidMarket(): void {
    const reqs = this.requests ?? [];
    if (!reqs.length) {
      return;
    }
    const labels = BID_BUCKETS.map((b, i) => b === Infinity ? `> ${BID_BUCKETS[i - 1].toLocaleString()}` : `≤ ${b.toLocaleString()}`);
    const count = (accepted: boolean) => BID_BUCKETS.map((b, i) => reqs.filter(r => r.accepted === accepted && r.bid <= b && (i === 0 || r.bid > BID_BUCKETS[i - 1])).length);
    this.charts = {
      ...this.charts,
      bidMarket: baseChart({
        xAxis: { type: 'category', data: labels, name: 'sats', nameTextStyle: { color: '#ffffff88', fontSize: 10 }, ...axisStyle() },
        yAxis: { type: 'value', name: 'requests', nameTextStyle: { color: '#ffffff88', fontSize: 10 }, ...axisStyle() },
        series: [
          { name: 'accepted', type: 'bar', stack: 'm', itemStyle: { color: this.color, borderRadius: [0, 0, 0, 0] }, data: count(true) },
          { name: 'beaten', type: 'bar', stack: 'm', itemStyle: { color: '#ff6b6b', borderRadius: [3, 3, 0, 0] }, data: count(false) },
        ],
      }),
    };
  }

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
