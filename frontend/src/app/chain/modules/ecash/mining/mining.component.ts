import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, Subscription, catchError, merge, of, switchMap, timer } from 'rxjs';
import { ChainApiService } from '@app/chain/chain-api.service';
import { RetargetState } from '@app/chain/chain.interfaces';
import { PROFILE } from '@app/chain/profiles';
import { escapeHtml } from '@app/chain/escape-html';
import { CxColumn, CxFilter } from '@app/chain/components/chain-table/chain-table.component';
import { SeoService } from '@app/services/seo.service';
import { StateService } from '@app/services/state.service';

// at 10 minutes per block
const WINDOWS = [{ label: '1d', blocks: 144 }, { label: '1w', blocks: 1008 }, { label: '4w', blocks: 4032 }, { label: 'All', blocks: 0 }];
const PALETTE = [PROFILE.color, '#5aa6ff', '#ff8a3d', '#f26b9c', '#a585ff', '#2bc79a', '#f5b83d', '#9aa4b2'];

/**
 * eCash mining (/mining): pools by coinbase tag with DATUM pools split into their miners, hashrate and difficulty,
 * the retarget (Bitcoin's 2016 blocks, the fork's reset, mainnet's dampened 288) and the estimated next difficulty,
 * block times, halving epochs
 * (GET /api/v1/drivechain/mining).
 */
@Component({
  selector: 'app-chain-mining',
  templateUrl: './mining.component.html',
  styleUrls: ['./mining.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChainMiningComponent implements OnInit, OnDestroy {
  profile = PROFILE;
  windows = WINDOWS;
  window = 1008;
  data: any = null;
  error: string | null = null;
  charts: Record<string, any> = {};
  chartInitOptions = { renderer: 'svg' };
  /** the pool dominance chart's legend (the page's own), the pools hidden there, and the chart */
  domLegend: { name: string; color: string }[] = [];
  domHidden = new Set<string>();
  dominanceChart: any = null;
  private reload$ = new Subject<void>();
  private sub: Subscription;

  /** the pools table: a DATUM pool's miners are lines inside its row, so sorting keeps them under their pool */
  poolCols: CxColumn[] = [
    { key: 'name', label: 'Pool', sort: p => (p.name || p.tag || '').toLowerCase() },
    { key: 'blocks', label: 'Blocks', align: 'right', sort: true },
    { key: 'share', label: 'Share', sort: true, nowrap: true },
    { key: 'hashrate', label: 'Hashrate', align: 'right', sort: true, nowrap: true },
    { key: 'fees', label: 'Fees', align: 'right', sort: true, hide: 'sm' },
    { key: 'empty', label: 'Empty', align: 'right', sort: true, hide: 'md' },
    { key: 'bmmPerBlock', label: 'Sidechains / block', align: 'right', sort: true, hide: 'md' },
    { key: 'lastHeight', label: 'Last block', align: 'right', sort: true },
  ];
  poolFilters: CxFilter[] = [{ options: [{ label: 'DATUM', test: p => !!p.datum }, { label: 'pooled', test: p => !p.datum }] }];
  matchPool = (p: any, q: string) => [p.name, p.tag, ...(p.miners ?? []).flatMap((m: any) => [m.name, m.tag])]
    .some(x => typeof x === 'string' && x.toLowerCase().includes(q));
  trackTag = (p: any) => p.tag;

  constructor(private api: ChainApiService, private cd: ChangeDetectorRef, private route: ActivatedRoute, private router: Router,
    private seo: SeoService, public stateService: StateService) {}

  ngOnInit(): void {
    this.seo.setTitle('Mining');
    const w = this.route.snapshot.queryParamMap.get('window');
    if (w !== null) { this.window = Number(w); }
    this.sub = merge(timer(0, 30000), this.reload$, this.stateService.blocks$).pipe(
      switchMap(() => this.api.get<any>('drivechain/mining', { window: this.window }).pipe(catchError((e) => { this.error = e?.error?.error || 'unavailable'; return of(null); }))),
    ).subscribe((d) => {
      if (d) { this.data = d; this.error = null; this.build(); }
      this.cd.markForCheck();
    });
  }

  ngOnDestroy(): void { this.sub?.unsubscribe(); }

  setWindow(w: number): void {
    this.window = w;
    void this.router.navigate([], { queryParams: { window: w }, replaceUrl: true });
    this.reload$.next();
  }

  colorOf(tag: string): string {
    const i = this.data?.topTags?.indexOf(tag) ?? -1;
    return i >= 0 ? PALETTE[i % PALETTE.length] : '#5b6b85';
  }

  /** the pool's display name from the mining-pools list, else its tag without the slashes */
  nameOf(tag: string): string {
    return this.data?.pools?.find((p: any) => p.tag === tag)?.name || tag.replace(/^\/+|\/+$/g, '');
  }

  logoUrl(logo: string): string {
    return `/resources/pool-logos/${logo}`;
  }

  hideLogo(event: Event): void {
    (event.target as HTMLElement).style.display = 'none';
  }

  /** the pool dominance chart's own legend: a pool's band shown or hidden (the chart's legend action) */
  toggleDominance(name: string): void {
    this.dominanceChart?.dispatchAction({ type: 'legendToggleSelect', name });
    if (this.domHidden.has(name)) {
      this.domHidden.delete(name);
    } else {
      this.domHidden.add(name);
    }
  }

  hashrate(h: number): string {
    if (!h) { return '0 H/s'; }
    const u = ['H/s', 'kH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s', 'EH/s'];
    let i = 0;
    while (h >= 1000 && i < u.length - 1) { h /= 1000; i++; }
    return h.toFixed(h < 10 ? 2 : 1) + ' ' + u[i];
  }

  diff(d: number): string {
    if (d === null || d === undefined) { return '–'; }
    if (d >= 1e12) { return (d / 1e12).toFixed(2) + ' T'; }
    if (d >= 1e9) { return (d / 1e9).toFixed(2) + ' G'; }
    if (d >= 1e6) { return (d / 1e6).toFixed(2) + ' M'; }
    if (d >= 1e3) { return (d / 1e3).toFixed(2) + ' k'; }
    return d.toFixed(d < 10 ? 3 : 1);
  }

  pct(x: number, d = 1): string { return ((x || 0) * 100).toFixed(d) + '%'; }

  /** The difficulty rule in force, in words (chain/retarget.ts on the backend) */
  algorithm(r: RetargetState | null): string {
    const dampened = 'eCash\'s: every 288 blocks, towards 10 min per block, dampened: the new target is (6 × the old one + the measured one) / 7, from about −30% to +12% each time';
    if (r?.rule === 'dampened') {
      return dampened;
    }
    if (r?.rule === 'fork') {
      return `Bitcoin's until the fork: block ${r.nextRetarget.toLocaleString()} resets the difficulty to ${this.diff(r.nextDifficulty)}`
        + (r.nextInterval && r.nextInterval !== 2016 ? `; then ${dampened.charAt(0).toLowerCase()}${dampened.slice(1)}` : '; then Bitcoin\'s');
    }
    return 'Bitcoin\'s: every 2016 blocks, towards 10 min per block, at most 4× either way';
  }

  secs(s: number): string {
    const a = Math.abs(s);
    const t = a >= 3600 ? +(a / 3600).toFixed(1) + ' h' : a >= 60 ? +(a / 60).toFixed(1) + ' min' : a.toFixed(0) + ' s';
    return t;
  }

  windowLabel(): string {
    const w = WINDOWS.find(x => x.blocks === this.window);
    return w ? (w.blocks ? 'last ' + w.label : 'everything indexed') : `last ${this.window} blocks`;
  }

  private axis() {
    return { axisLine: { lineStyle: { color: '#ffffff33' } }, axisLabel: { color: '#ffffff99', fontSize: 11 }, splitLine: { lineStyle: { color: '#ffffff12' } } };
  }

  private tooltip(extra: any = {}) {
    return { trigger: 'axis', backgroundColor: 'rgba(17,19,31,0.95)', borderColor: '#000', textStyle: { color: '#fff', fontSize: 12 }, confine: true, ...extra };
  }

  /**
   * The pools as an "onion" donut (as on mempool.guide/mining): one wedge per pool, its angle the pool's share of the
   * blocks; a DATUM pool's wedge is split into concentric bands from the hole outward, one per DATUM miner, each band's
   * AREA its share of the pool's blocks (r_i = sqrt(r0² + (R² − r0²) · cumulative share)). An ECharts custom series
   * draws the annular sectors; a transparent pie of the same values on top carries the labels and their leader lines.
   */
  private onion(pools: any[]): any {
    const R0 = 0.16;
    const R1 = 0.62;
    const total = pools.reduce((a, p) => a + (p.blocks || 0), 0) || 1;
    // value: [start, end] as fractions of the circle, [inner, outer] as fractions of the pool's blocks
    const items: { value: number[]; fill: string; tip: string }[] = [];
    let acc = 0;
    for (const p of pools) {
      const color = this.colorOf(p.tag);
      const name = p.name || this.nameOf(p.tag);
      const a0 = acc / total;
      acc += p.blocks || 0;
      const a1 = acc / total;
      const poolTip = `<b>${escapeHtml(name)}</b><br>${p.blocks} blocks (${this.pct(p.share, 1)})`;
      const bands: { label: string; blocks: number; tagged: boolean }[] = [];
      if (p.datum && p.miners?.length) {
        const miners = [...p.miners].sort((x: any, y: any) => y.blocks - x.blocks);
        for (const m of miners) {
          bands.push({ label: m.name || m.tag, blocks: m.blocks, tagged: true });
        }
        const known = miners.reduce((x: number, m: any) => x + m.blocks, 0);
        if (p.blocks > known) {
          bands.push({ label: 'no miner tag', blocks: p.blocks - known, tagged: false });
        }
      }
      if (!bands.length || !p.blocks) {
        items.push({ value: [a0, a1, 0, 1], fill: color, tip: poolTip });
        continue;
      }
      let cum = 0;
      bands.forEach((b, i) => {
        const f0 = Math.min(1, cum / p.blocks);
        cum += b.blocks;
        const f1 = Math.min(1, cum / p.blocks);
        // lighter and darker steps of the pool's colour, alternating so that neighbouring bands stay apart
        const step = bands.length > 1 ? i / (bands.length - 1) : 0;
        items.push({
          value: [a0, a1, f0, f1],
          fill: b.tagged ? mix(color, i % 2 ? '#000000' : '#ffffff', 0.06 + 0.4 * step) : mix(color, '#11131f', 0.6),
          tip: `${poolTip}<br>${b.tagged ? 'DATUM miner ' : ''}<b>${escapeHtml(b.label)}</b>: ${b.blocks} block${b.blocks === 1 ? '' : 's'} (${this.pct(b.blocks / p.blocks, 1)} of the pool)`,
        });
      });
    }
    return {
      animation: false, backgroundColor: 'transparent',
      tooltip: { trigger: 'item', backgroundColor: 'rgba(17,19,31,0.95)', borderColor: '#000', textStyle: { color: '#fff', fontSize: 12 }, confine: true,
        formatter: (x: any) => x.seriesType === 'custom' ? (items[x.dataIndex]?.tip ?? '') : '' },
      series: [
        {
          type: 'custom', coordinateSystem: 'none', data: items.map(it => it.value),
          renderItem: (params: any, api: any) => {
            const it = items[params.dataIndex];
            const [a0, a1, f0, f1] = it.value;
            const w = api.getWidth();
            const h = api.getHeight();
            const size = Math.min(w, h) / 2;
            const r0 = R0 * size;
            const r1 = R1 * size;
            const radius = (f: number) => Math.sqrt(r0 * r0 + (r1 * r1 - r0 * r0) * f);
            return {
              type: 'sector',
              shape: { cx: w / 2, cy: h / 2, r0: radius(f0), r: radius(f1),
                startAngle: -Math.PI / 2 + 2 * Math.PI * a0, endAngle: -Math.PI / 2 + 2 * Math.PI * a1, clockwise: true },
              style: { fill: it.fill, stroke: '#11131f', lineWidth: f0 === 0 && f1 === 1 ? 1.2 : 0.5 },
              emphasis: { style: { stroke: '#ffffff', lineWidth: 1.2 } },
            };
          },
        },
        {
          // the labels and their leader lines: a pie of the same angles that draws nothing else
          type: 'pie', silent: true, tooltip: { show: false }, radius: [`${R0 * 100}%`, `${R1 * 100}%`], center: ['50%', '50%'],
          startAngle: 90, clockwise: true, minAngle: 0, avoidLabelOverlap: true, emphasis: { disabled: true }, z: 3,
          itemStyle: { color: 'transparent', borderWidth: 0 },
          label: { color: '#ffffffcc', fontSize: 11, alignTo: 'edge', edgeDistance: 6, overflow: 'truncate', formatter: (x: any) => `${x.name}  ${x.percent}%` },
          labelLine: { length: 10, length2: 0, lineStyle: { color: '#ffffff55' } },
          data: pools.map(p => {
            const show = (p.blocks || 0) / total >= 0.012;
            return { name: p.name || this.nameOf(p.tag), value: p.blocks, label: { show }, labelLine: { show } };
          }),
        },
      ],
    };
  }

  private build(): void {
    const d = this.data;
    const pools: any[] = d.pools;
    this.charts.donut = this.onion(pools);

    const s: any[] = d.series;
    const x = s.map(b => b.from === b.to ? `${b.to}` : `${b.from}-${b.to}`);
    const xAxis = { type: 'category', data: x, ...this.axis(), axisLabel: { color: '#ffffff99', fontSize: 10, hideOverlap: true } };
    const yv = (name: string, extra: any = {}) => ({ type: 'value', name, nameTextStyle: { color: '#ffffff88', fontSize: 10 }, ...this.axis(), ...extra });
    const tags = [...d.topTags, ...(s.some(b => b.pools.Other) ? ['Other'] : [])];

    this.charts.dominance = {
      animation: false, backgroundColor: 'transparent', grid: { left: 44, right: 12, top: 22, bottom: 28 },
      // the legend is the page's own (three rows above the chart, .dom-legend); the chart keeps one, hidden, for toggling
      legend: { show: false, selected: Object.fromEntries([...this.domHidden].map(n => [n, false])) },
      tooltip: this.tooltip({ valueFormatter: (v: number) => (v ?? 0).toFixed(1) + '%' }), xAxis, yAxis: yv('%', { max: 100 }),
      series: tags.map(t => ({ name: this.nameOf(t), type: 'line', stack: 'dom', symbol: 'none', areaStyle: { opacity: 0.8, color: this.colorOf(t) }, lineStyle: { width: 0 }, itemStyle: { color: this.colorOf(t) },
        data: s.map(b => b.blocks ? 100 * (b.pools[t] ?? 0) / b.blocks : 0) })),
    };
    this.domLegend = tags.map(t => ({ name: this.nameOf(t), color: this.colorOf(t) }));
    this.domHidden = new Set([...this.domHidden].filter(n => this.domLegend.some(l => l.name === n)));

    this.charts.hashrate = {
      animation: false, backgroundColor: 'transparent', grid: { left: 60, right: 60, top: 30, bottom: 28 },
      legend: { top: 0, textStyle: { color: '#ffffffcc', fontSize: 11 } },
      tooltip: this.tooltip(), xAxis,
      yAxis: [yv('hashrate', { axisLabel: { color: '#ffffff99', fontSize: 10, formatter: (v: number) => this.hashrate(v) } }),
        yv('difficulty', { position: 'right', splitLine: { show: false }, axisLabel: { color: '#ffffff99', fontSize: 10, formatter: (v: number) => this.diff(v) } })],
      series: [
        { name: 'Hashrate', type: 'line', smooth: true, symbol: 'none', lineStyle: { width: 2, color: PROFILE.color }, itemStyle: { color: PROFILE.color }, areaStyle: { opacity: 0.12, color: PROFILE.color },
          data: s.map(b => b.hashrate), tooltip: { valueFormatter: (v: number) => this.hashrate(v) } },
        { name: 'Difficulty', type: 'line', yAxisIndex: 1, step: 'end', symbol: 'none', lineStyle: { width: 2, color: '#5aa6ff' }, itemStyle: { color: '#5aa6ff' },
          data: s.map(b => b.difficulty), tooltip: { valueFormatter: (v: number) => this.diff(v) } },
      ],
    };

    // difficulty per block, the min-difficulty blocks apart
    const pts: any[] = d.difficulty;
    this.charts.difficulty = {
      animation: false, backgroundColor: 'transparent', grid: { left: 60, right: 16, top: 30, bottom: 28 },
      legend: { top: 0, textStyle: { color: '#ffffffcc', fontSize: 11 } },
      tooltip: { trigger: 'item', backgroundColor: 'rgba(17,19,31,0.95)', textStyle: { color: '#fff', fontSize: 12 }, formatter: (p: any) => `block ${Number(p.value[0])}<br>difficulty ${escapeHtml(this.diff(p.value[1]))}` },
      xAxis: { type: 'value', min: 'dataMin', max: 'dataMax', ...this.axis() },
      yAxis: { type: 'log', ...this.axis(), axisLabel: { color: '#ffffff99', fontSize: 10, formatter: (v: number) => this.diff(v) } },
      series: [
        { name: 'difficulty', type: 'scatter', symbolSize: 3, itemStyle: { color: '#5aa6ff' }, data: pts.filter(p => !p[2]).map(p => [p[0], p[1]]) },
        { name: 'min-difficulty (testnet rule)', type: 'scatter', symbolSize: 5, itemStyle: { color: '#ff8a3d' }, data: pts.filter(p => p[2]).map(p => [p[0], p[1]]) },
      ],
    };

    const h: any[] = d.histogram;
    this.charts.blocktimes = {
      animation: false, backgroundColor: 'transparent', grid: { left: 44, right: 12, top: 20, bottom: 28 },
      tooltip: this.tooltip({ axisPointer: { type: 'shadow' } }),
      xAxis: { type: 'category', data: h.map(b => b.to === null ? `> ${this.secs(b.from)}` : `≤ ${this.secs(b.to)}`), ...this.axis() },
      yAxis: yv('blocks'),
      series: [{ type: 'bar', barMaxWidth: 34, data: h.map(b => ({ value: b.count, itemStyle: { color: b.to !== null && b.to <= 600 ? PROFILE.color : b.to !== null && b.to <= 1200 ? '#5aa6ff' : '#ff8a3d' } })) }],
    };

    this.charts.fees = {
      animation: false, backgroundColor: 'transparent', grid: { left: 60, right: 12, top: 20, bottom: 28 },
      tooltip: this.tooltip({ valueFormatter: (v: number) => (v ?? 0).toFixed(8) + ' ' + PROFILE.unit }), xAxis,
      yAxis: yv(PROFILE.unit),
      series: [{ type: 'bar', barMaxWidth: 16, itemStyle: { color: '#f5b83d' }, data: s.map(b => b.fees / 1e8) }],
    };
  }
}

/** #rrggbb mixed towards another #rrggbb by t (0..1) */
function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (n: number, sh: number) => (n >> sh) & 255;
  const c = [16, 8, 0].map(sh => Math.round(ch(pa, sh) * (1 - t) + ch(pb, sh) * t));
  return '#' + c.map(x => x.toString(16).padStart(2, '0')).join('');
}
