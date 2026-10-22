import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, Subscription, catchError, merge, of, switchMap, timer } from 'rxjs';
import { ChainApiService } from '@app/chain/chain-api.service';
import { PROFILE } from '@app/chain/profiles';
import { escapeHtml } from '@app/chain/escape-html';
import { SeoService } from '@app/services/seo.service';
import { StateService } from '@app/services/state.service';

const WINDOWS = [{ label: '6h', blocks: 360 }, { label: '1d', blocks: 1440 }, { label: '1w', blocks: 10080 }, { label: 'All', blocks: 0 }];
const PALETTE = [PROFILE.color, '#5aa6ff', '#ff8a3d', '#f26b9c', '#a585ff', '#2bc79a', '#f5b83d', '#9aa4b2'];

/**
 * eCash mining (/mining): pools by coinbase tag with DATUM pools split into their miners, hashrate and difficulty,
 * the 2016-block retarget and the estimated next difficulty, block times, halving epochs
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
  window = 1440;
  data: any = null;
  error: string | null = null;
  charts: Record<string, any> = {};
  chartInitOptions = { renderer: 'svg' };
  private reload$ = new Subject<void>();
  private sub: Subscription;

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

  private build(): void {
    const d = this.data;
    const pools: any[] = d.pools;
    // the donut: pools inside; DATUM pools split into their miners outside
    const inner = pools.map(p => ({ name: p.tag, value: p.blocks, itemStyle: { color: this.colorOf(p.tag) } }));
    const outer: any[] = [];
    for (const p of pools) {
      if (p.datum && p.miners.length) {
        const known = p.miners.reduce((a: number, m: any) => a + m.blocks, 0);
        p.miners.forEach((m: any, i: number) => outer.push({
          name: `${m.tag} (${p.tag})`, value: m.blocks,
          itemStyle: { color: this.colorOf(p.tag), opacity: 0.45 + 0.55 * (1 - i / Math.max(1, p.miners.length)) },
        }));
        if (p.blocks > known) { outer.push({ name: `${p.tag}: no miner tag`, value: p.blocks - known, itemStyle: { color: '#ffffff18' } }); }
      } else {
        outer.push({ name: p.tag, value: p.blocks, itemStyle: { color: this.colorOf(p.tag), opacity: 0.25 } });
      }
    }
    this.charts.donut = {
      animation: false, backgroundColor: 'transparent',
      tooltip: { trigger: 'item', backgroundColor: 'rgba(17,19,31,0.95)', textStyle: { color: '#fff', fontSize: 12 }, formatter: (x: any) => `${escapeHtml(x.name)}<br>${x.value} blocks (${x.percent}%)` },
      series: [
        { type: 'pie', radius: ['0%', '48%'], center: ['50%', '50%'], label: { position: 'inner', color: '#11131f', fontSize: 11, fontWeight: 700, formatter: (x: any) => x.percent > 6 ? x.name : '' },
          itemStyle: { borderColor: '#11131f', borderWidth: 2 }, data: inner },
        { type: 'pie', radius: ['55%', '78%'], center: ['50%', '50%'], label: { color: '#ffffffcc', fontSize: 11, formatter: (x: any) => x.percent > 3 ? `${x.name}\n${x.percent}%` : '' },
          labelLine: { lineStyle: { color: '#ffffff44' } }, itemStyle: { borderColor: '#11131f', borderWidth: 1 }, data: outer },
      ],
    };

    const s: any[] = d.series;
    const x = s.map(b => b.from === b.to ? `${b.to}` : `${b.from}-${b.to}`);
    const xAxis = { type: 'category', data: x, ...this.axis(), axisLabel: { color: '#ffffff99', fontSize: 10, hideOverlap: true } };
    const yv = (name: string, extra: any = {}) => ({ type: 'value', name, nameTextStyle: { color: '#ffffff88', fontSize: 10 }, ...this.axis(), ...extra });
    const tags = [...d.topTags, ...(s.some(b => b.pools.Other) ? ['Other'] : [])];

    this.charts.dominance = {
      animation: false, backgroundColor: 'transparent', grid: { left: 44, right: 12, top: 30, bottom: 28 },
      legend: { top: 0, textStyle: { color: '#ffffffcc', fontSize: 11 }, icon: 'roundRect', itemWidth: 10, itemHeight: 10 },
      tooltip: this.tooltip({ valueFormatter: (v: number) => (v ?? 0).toFixed(1) + '%' }), xAxis, yAxis: yv('%', { max: 100 }),
      series: tags.map(t => ({ name: t, type: 'line', stack: 'dom', symbol: 'none', areaStyle: { opacity: 0.8, color: this.colorOf(t) }, lineStyle: { width: 0 }, itemStyle: { color: this.colorOf(t) },
        data: s.map(b => b.blocks ? 100 * (b.pools[t] ?? 0) / b.blocks : 0) })),
    };

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
