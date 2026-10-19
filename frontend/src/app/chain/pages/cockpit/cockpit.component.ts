import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, Subscription, catchError, of, switchMap, timer, merge } from 'rxjs';
import { ChainApiService } from '@app/chain/chain-api.service';
import { PROFILE, PROFILES, explorerUrl, profileBySlot, sideBlockPath } from '@app/chain/profiles';
import { SeoService } from '@app/services/seo.service';
import { StateService } from '@app/services/state.service';

/**
 * The cockpit: the drivechain of Chains at a glance. On the Chains explorer (/drivechain) it covers every sidechain;
 * on a sidechain's explorer (/bmm) the same page shows that sidechain only.
 *
 * Live state from the node (escrows, supply locked in sidechains, pending bundles with their path to payout,
 * proposals), statistics over a window of blocks (BMM coverage and bids, miner revenue, flows, votes, miners) and
 * the event feeds, all from /api/v1/drivechain/cockpit and /api/v1/drivechain/events/*.
 */

const WINDOWS = [
  { label: '1h', blocks: 60 },
  { label: '1d', blocks: 1440 },
  { label: '1w', blocks: 10080 },
  { label: 'All', blocks: 0 },
];
const FEEDS = [
  { id: 'bmm', label: 'BMM' },
  { id: 'deposits', label: 'Deposits' },
  { id: 'withdrawals', label: 'Withdrawals' },
  { id: 'bundles', label: 'Bundles' },
  { id: 'proposals', label: 'Proposals' },
  { id: 'bmm-requests', label: 'BMM requests' },
];

@Component({
  selector: 'app-chain-cockpit',
  templateUrl: './cockpit.component.html',
  styleUrls: ['./cockpit.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChainCockpitComponent implements OnInit, OnDestroy {
  sideBlockPath = sideBlockPath;
  profile = PROFILE;
  mainchain = PROFILE.mainchain;
  windows = WINDOWS;
  feeds = FEEDS;
  window = 1440;
  slot: number | null = PROFILE.mainchain ? null : PROFILE.slot;
  feed = 'bmm';

  data: any = null;
  error: string | null = null;
  feedItems: any[] | null = null;
  slotList: { slot: number; name: string; color: string }[] = [];

  charts: Record<string, any> = {};
  chartInitOptions = { renderer: 'svg' };

  private reload$ = new Subject<void>();
  private feedReload$ = new Subject<void>();
  private subs: Subscription[] = [];

  constructor(
    private api: ChainApiService,
    private cd: ChangeDetectorRef,
    private route: ActivatedRoute,
    private router: Router,
    private seo: SeoService,
    public stateService: StateService,
  ) {}

  ngOnInit(): void {
    this.seo.setTitle(PROFILE.mainchain ? 'Drivechain cockpit' : `${PROFILE.name}: BMM and peg`);
    const q = this.route.snapshot.queryParamMap;
    if (q.get('window') !== null) { this.window = Number(q.get('window')); }
    if (PROFILE.mainchain && q.get('slot') !== null) { this.slot = Number(q.get('slot')); }
    if (q.get('feed')) { this.feed = q.get('feed') as string; }

    this.subs.push(merge(timer(0, 30000), this.reload$, this.stateService.blocks$.pipe()).pipe(
      switchMap(() => this.api.get<any>('drivechain/cockpit', { window: this.window, slot: this.slot }).pipe(
        catchError((e) => { this.error = e?.error?.error || e?.message || 'unavailable'; return of(null); }),
      )),
    ).subscribe((d) => {
      if (d) {
        this.data = d;
        this.error = null;
        if (PROFILE.mainchain && this.slot === null) {
          this.slotList = d.live.sidechains.map((s: any) => ({ slot: s.slot, name: s.title, color: this.colorOf(s.slot) }));
        }
        this.buildCharts();
      }
      this.cd.markForCheck();
    }));
    this.subs.push(merge(timer(0, 30000), this.feedReload$).pipe(
      switchMap(() => this.api.events$(this.feed, this.slot, null, 40).pipe(catchError(() => of([])))),
    ).subscribe((items) => {
      this.feedItems = items;
      this.cd.markForCheck();
    }));
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
  }

  private syncUrl(): void {
    void this.router.navigate([], {
      queryParams: { window: this.window, slot: PROFILE.mainchain ? this.slot : null, feed: this.feed },
      queryParamsHandling: 'merge', replaceUrl: true,
    });
  }

  setWindow(w: number): void {
    this.window = w;
    this.syncUrl();
    this.reload$.next();
  }

  setSlot(slot: number | null): void {
    if (!PROFILE.mainchain) { return; }
    this.slot = slot;
    this.syncUrl();
    this.reload$.next();
    this.feedReload$.next();
  }

  setFeed(f: string): void {
    this.feed = f;
    this.feedItems = null;
    this.syncUrl();
    this.feedReload$.next();
  }

  // --- helpers for the template ---------------------------------------------------------------------

  colorOf(slot: number): string {
    return profileBySlot(slot)?.color ?? PROFILE.color;
  }

  nameOf(slot: number): string {
    return this.data?.live?.sidechains?.find((s: any) => s.slot === slot)?.title ?? profileBySlot(slot)?.name ?? `Slot ${slot}`;
  }

  sideUrl(slot: number, path: string): string | null {
    const p = profileBySlot(slot);
    return p ? explorerUrl(p.id, path) : null;
  }

  mainUrl(path: string): string | null {
    return PROFILE.mainchain ? null : explorerUrl('chains', path);
  }

  pct(x: number, digits = 1): string {
    return (x * 100).toFixed(digits) + '%';
  }

  short(h: string): string {
    return h ? h.slice(0, 8) + '…' + h.slice(-6) : '';
  }

  slotStats(slot: number): any {
    return this.data?.slots?.find((s: any) => s.slot === slot);
  }

  /** a bundle's path to payout: score / min score, and whether it can still make it in the blocks it has left */
  bundleProgress(b: any): { pct: number; needed: number; canMake: boolean; eta: number | null } {
    const min = this.data?.live?.info?.withdrawalminscore ?? 1;
    const needed = Math.max(0, min - b.score);
    return { pct: Math.min(1, b.score / min), needed, canMake: needed <= b.blocksleft, eta: needed <= b.blocksleft ? needed : null };
  }

  hashrate(h: number): string {
    if (!h) { return '0 H/s'; }
    const u = ['H/s', 'kH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s', 'EH/s'];
    let i = 0;
    while (h >= 1000 && i < u.length - 1) { h /= 1000; i++; }
    return h.toFixed(h < 10 ? 2 : 1) + ' ' + u[i];
  }

  windowLabel(): string {
    const w = WINDOWS.find(x => x.blocks === this.window);
    return w ? (w.blocks ? `last ${w.label}` : 'everything indexed') : `last ${this.window} blocks`;
  }

  /** the coverage grid: for each of the newest blocks, a cell per sidechain */
  accepted(block: any, slot: number): any {
    return block.accepts.find((a: any) => a.slot === slot);
  }

  trackSlot = (_: number, s: any) => s.slot;
  trackHeight = (_: number, b: any) => b.height;

  // --- charts ---------------------------------------------------------------------------------------

  private axisStyle() {
    return {
      axisLine: { lineStyle: { color: '#ffffff33' } },
      axisLabel: { color: '#ffffff99', fontSize: 11 },
      splitLine: { lineStyle: { color: '#ffffff12' } },
    };
  }

  private base(extra: any = {}): any {
    return {
      animation: false,
      backgroundColor: 'transparent',
      grid: { left: 52, right: 16, top: 30, bottom: 28 },
      tooltip: { trigger: 'axis', backgroundColor: 'rgba(17,19,31,0.95)', borderColor: '#000', textStyle: { color: '#fff', fontSize: 12 }, confine: true },
      legend: { top: 0, textStyle: { color: '#ffffffcc', fontSize: 11 }, icon: 'roundRect', itemWidth: 10, itemHeight: 10 },
      ...extra,
    };
  }

  private buildCharts(): void {
    const d = this.data;
    const series: any[] = d.series ?? [];
    const x = series.map(b => b.from === b.to ? `${b.to}` : `${b.from}-${b.to}`);
    const slots: any[] = d.slots ?? [];
    const sats = (v: number) => v / 1e8;
    const xAxis = { type: 'category', data: x, ...this.axisStyle(), axisLabel: { color: '#ffffff99', fontSize: 10, hideOverlap: true } };
    const yAxis = (name = '') => ({ type: 'value', name, nameTextStyle: { color: '#ffffff88', fontSize: 10 }, ...this.axisStyle() });

    // BMM bids paid to miners, stacked per sidechain
    this.charts.bids = this.base({
      xAxis, yAxis: yAxis('CHN'),
      tooltip: { ...this.base().tooltip, valueFormatter: (v: number) => (v ?? 0).toFixed(8) + ' CHN' },
      series: slots.map(s => ({
        name: s.name, type: 'bar', stack: 'bids', barMaxWidth: 18, itemStyle: { color: this.colorOf(s.slot) },
        data: series.map(b => sats(b.bids[s.slot] ?? 0)),
      })),
    });

    // BMM coverage: the share of blocks carrying a block of each sidechain
    this.charts.coverage = this.base({
      xAxis, yAxis: { ...yAxis('%'), max: 100 },
      tooltip: { ...this.base().tooltip, valueFormatter: (v: number) => (v ?? 0).toFixed(0) + '%' },
      series: slots.map(s => ({
        name: s.name, type: 'line', smooth: true, symbol: 'none', lineStyle: { width: 2, color: this.colorOf(s.slot) }, itemStyle: { color: this.colorOf(s.slot) },
        data: series.map(b => b.blocks ? Math.round(100 * (b.accepts[s.slot] ?? 0) / b.blocks) : 0),
      })),
    });

    // escrow (supply locked in each sidechain), stacked area
    this.charts.escrow = this.base({
      xAxis, yAxis: yAxis('CHN'),
      tooltip: { ...this.base().tooltip, valueFormatter: (v: number) => (v ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' CHN' },
      series: slots.filter(s => series.some(b => b.escrow?.[s.slot] !== undefined)).map(s => ({
        name: s.name, type: 'line', stack: 'escrow', symbol: 'none', smooth: true, lineStyle: { width: 1, color: this.colorOf(s.slot) },
        areaStyle: { opacity: 0.35, color: this.colorOf(s.slot) }, itemStyle: { color: this.colorOf(s.slot) },
        data: series.map(b => sats(b.escrow?.[s.slot] ?? 0)),
      })),
    });

    // peg flows: deposits up, withdrawals down
    const flowSlots = slots.filter(s => s.deposits || s.withdrawals);
    this.charts.flows = this.base({
      xAxis, yAxis: yAxis('CHN'),
      tooltip: { ...this.base().tooltip, valueFormatter: (v: number) => (v ?? 0).toLocaleString(undefined, { maximumFractionDigits: 4 }) + ' CHN' },
      series: [
        ...flowSlots.map(s => ({
          name: s.name + ' in', type: 'bar', stack: 'flow', barMaxWidth: 18, itemStyle: { color: this.colorOf(s.slot) },
          data: series.map(b => sats(b.deposits[s.slot] ?? 0)),
        })),
        ...flowSlots.map(s => ({
          name: s.name + ' out', type: 'bar', stack: 'flow', barMaxWidth: 18, itemStyle: { color: this.colorOf(s.slot), opacity: 0.5, decal: { symbol: 'rect', dashArrayX: [1, 0], dashArrayY: [2, 3], rotation: -0.8 } },
          data: series.map(b => -sats(b.withdrawals[s.slot] ?? 0)),
        })),
      ],
      legend: { show: false },
    });

    // miner revenue: subsidy, fees (of which BMM bids)
    this.charts.revenue = this.base({
      xAxis, yAxis: [yAxis('CHN'), { ...yAxis('bids %'), position: 'right', splitLine: { show: false }, max: 100 }],
      grid: { left: 52, right: 44, top: 30, bottom: 28 },
      tooltip: { ...this.base().tooltip },
      series: [
        { name: 'Other fees', type: 'bar', stack: 'rev', barMaxWidth: 18, itemStyle: { color: '#5b6b85' }, data: series.map(b => sats(Math.max(0, b.fees - b.bidsTotal))) },
        { name: 'BMM bids', type: 'bar', stack: 'rev', barMaxWidth: 18, itemStyle: { color: PROFILES.chains.color }, data: series.map(b => sats(b.bidsTotal)) },
        { name: 'Bids share of fees', type: 'line', yAxisIndex: 1, symbol: 'none', smooth: true, lineStyle: { color: '#ffd166', width: 2 }, itemStyle: { color: '#ffd166' },
          data: series.map(b => b.fees ? Math.round(100 * b.bidsTotal / b.fees) : 0) },
      ],
    });

    // miners: share of blocks
    const miners: any[] = d.miners ?? [];
    const palette = ['#b5f27e', '#5aa6ff', '#ff8a3d', '#f26b9c', '#a585ff', '#2bc79a', '#f5b83d', '#9aa4b2'];
    this.charts.miners = {
      animation: false, backgroundColor: 'transparent',
      tooltip: { trigger: 'item', backgroundColor: 'rgba(17,19,31,0.95)', borderColor: '#000', textStyle: { color: '#fff', fontSize: 12 },
        formatter: (p: any) => `${p.name}<br>${p.value} blocks (${p.percent}%)` },
      series: [{
        type: 'pie', radius: ['48%', '78%'], center: ['50%', '52%'], avoidLabelOverlap: true,
        label: { color: '#ffffffcc', fontSize: 11, formatter: '{b}\n{d}%' }, labelLine: { lineStyle: { color: '#ffffff55' } },
        itemStyle: { borderColor: '#11131f', borderWidth: 2 },
        data: miners.slice(0, 8).map((m, i) => ({ name: m.tag, value: m.blocks, itemStyle: { color: palette[i % palette.length] } })),
      }],
    };

    // bid distribution per sidechain: min / median / avg / max
    this.charts.bidRange = this.base({
      grid: { left: 90, right: 20, top: 24, bottom: 28 },
      xAxis: { type: 'log', name: 'sats', nameTextStyle: { color: '#ffffff88', fontSize: 10 }, ...this.axisStyle() },
      yAxis: { type: 'category', data: slots.map(s => s.name), ...this.axisStyle() },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: 'rgba(17,19,31,0.95)', textStyle: { color: '#fff', fontSize: 12 } },
      series: [
        { name: 'min', type: 'scatter', symbolSize: 8, itemStyle: { color: '#ffffff66' }, data: slots.map(s => s.bidMin || null) },
        { name: 'median', type: 'scatter', symbol: 'diamond', symbolSize: 13, data: slots.map(s => ({ value: s.bidMedian || null, itemStyle: { color: this.colorOf(s.slot) } })) },
        { name: 'average', type: 'scatter', symbol: 'triangle', symbolSize: 11, itemStyle: { color: '#ffd166' }, data: slots.map(s => s.bidAvg || null) },
        { name: 'max', type: 'scatter', symbolSize: 8, itemStyle: { color: '#ff5d5d' }, data: slots.map(s => s.bidMax || null) },
      ],
    });

    // withdrawal bundles: score over time against the threshold
    const hist = d.bundleHistory ?? {};
    const min = d.live?.info?.withdrawalminscore ?? 0;
    const bundleSeries = Object.entries(hist).map(([hash, h]: [string, any]) => ({
      name: `${this.nameOf(h.slot)} ${hash.slice(0, 6)}`, type: 'line', symbol: 'none', smooth: false,
      lineStyle: { width: 2, color: this.colorOf(h.slot) }, itemStyle: { color: this.colorOf(h.slot) },
      data: h.points,
    }));
    if (bundleSeries.length) {
      (bundleSeries[0] as any).markLine = {
        symbol: 'none', silent: true, lineStyle: { color: '#ff5d5d', type: 'dashed' },
        label: { color: '#ff5d5d', formatter: `payout at ${min}`, position: 'insideEndTop' }, data: [{ yAxis: min }],
      };
    }
    this.charts.bundles = this.base({
      xAxis: { type: 'value', min: 'dataMin', max: 'dataMax', name: 'height', nameTextStyle: { color: '#ffffff88', fontSize: 10 }, ...this.axisStyle() },
      yAxis: { ...yAxis('score'), max: (v: any) => Math.max(v.max, min) * 1.05 },
      series: bundleSeries,
    });
  }
}
