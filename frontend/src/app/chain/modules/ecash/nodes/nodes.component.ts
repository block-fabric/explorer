import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription, catchError, of, switchMap, timer } from 'rxjs';
import { ChainApiService } from '@app/chain/chain-api.service';
import { PROFILE } from '@app/chain/profiles';
import { CxColumn, CxFilter } from '@app/chain/components/chain-table/chain-table.component';
import { SeoService } from '@app/services/seo.service';

const PALETTE = [PROFILE.color, '#5aa6ff', '#ff8a3d', '#f26b9c', '#a585ff', '#2bc79a', '#f5b83d', '#9aa4b2'];

/** the service bits a node advertises in its version message, as the table shows them */
const SERVICES: { bit: number; label: string; title: string }[] = [
  { bit: 1, label: 'full', title: 'NODE_NETWORK: serves the whole chain' },
  { bit: 1024, label: 'limited', title: 'NODE_NETWORK_LIMITED: serves the last 288 blocks (a pruned node, unless it is full too)' },
  { bit: 8, label: 'witness', title: 'NODE_WITNESS' },
  { bit: 4, label: 'bloom', title: 'NODE_BLOOM: BIP37 filters' },
  { bit: 64, label: 'filters', title: 'NODE_COMPACT_FILTERS: BIP157/158' },
  { bit: 2048, label: 'v2', title: 'NODE_P2P_V2: BIP324 encrypted transport' },
];

/** a user agent, "/eCash Satoshi:1.2.0(Bitcoin Core 32.1.0; BitWindow-0.2)/": its client, version and comments */
export function parseAgent(ua: string | null): { client: string; version: string; comments: string[]; label: string } {
  const m = (ua ?? '').match(/^\/?([^:/(]+)(?::([^(/]+))?(?:\(([^)]*)\))?/);
  const client = m?.[1]?.trim() || ua || 'unknown';
  const version = m?.[2]?.trim() || '';
  const comments = (m?.[3] ?? '').split(';').map(s => s.trim()).filter(Boolean);
  return { client, version, comments, label: version ? `${client} ${version}` : client };
}

/**
 * eCash's network (/nodes): the reachable nodes the backend's crawler found on the P2P network, their clients and
 * versions, services, heights and uptime, and the count over time (GET /api/v1/chain/nodes).
 */
@Component({
  selector: 'app-chain-nodes',
  templateUrl: './nodes.component.html',
  styleUrls: ['./nodes.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChainNodesComponent implements OnInit, OnDestroy {
  profile = PROFILE;
  data: any = null;
  error: string | null = null;
  rows: any[] = [];
  versions: { label: string; count: number; share: number; color: string }[] = [];
  latest = '';
  synced = 0;
  chart: any = null;
  chartInitOptions = { renderer: 'svg' };
  private sub: Subscription;

  cols: CxColumn[] = [
    { key: 'address', label: 'Address', sort: r => r.ip },
    { key: 'agent', label: 'Client', sort: r => r.agent.label },
    { key: 'height', label: 'Height', align: 'right', sort: true },
    { key: 'services', label: 'Services', hide: 'md' },
    { key: 'protocol', label: 'Protocol', align: 'right', sort: true, hide: 'lg' },
    { key: 'latency', label: 'Latency', align: 'right', sort: true, hide: 'sm', title: 'the handshake, from the explorer\'s server' },
    { key: 'uptime', label: 'Uptime', align: 'right', sort: true, title: 'reached in the crawls of the last day (one every 30 minutes)' },
    { key: 'firstSeen', label: 'First seen', align: 'right', sort: true, hide: 'md' },
    { key: 'lastSeen', label: 'Last seen', align: 'right', sort: true },
  ];
  filters: CxFilter[] = [];
  match = (r: any, q: string) => [r.address, r.userAgent].some(x => typeof x === 'string' && x.toLowerCase().includes(q));
  trackAddress = (r: any) => r.address;

  constructor(private api: ChainApiService, private cd: ChangeDetectorRef, private seo: SeoService) {}

  ngOnInit(): void {
    this.seo.setTitle('Nodes');
    this.sub = timer(0, 60_000).pipe(
      switchMap(() => this.api.get<any>('chain/nodes').pipe(catchError((e) => { this.error = e?.error?.error || 'unavailable'; return of(null); }))),
    ).subscribe((d) => {
      if (d) { this.data = d; this.error = null; this.build(d); }
      this.cd.markForCheck();
    });
  }

  ngOnDestroy(): void { this.sub?.unsubscribe(); }

  private build(d: any): void {
    const tip = d.tip ?? Math.max(0, ...d.nodes.map((n: any) => n.height ?? 0));
    this.rows = d.nodes.map((n: any) => ({
      ...n,
      agent: parseAgent(n.userAgent),
      behind: n.height !== null && tip ? tip - n.height : null,
      uptime: n.recent ? [...n.recent].filter(c => c === '1').length / n.recent.length : 0,
    })).sort((a: any, b: any) => Number(b.up) - Number(a.up) || b.lastSeen - a.lastSeen);
    const up = this.rows.filter(r => r.up);
    // a node's height is the one it had when the crawler reached it: synced, within 2 blocks of the tip then
    this.synced = up.filter(r => r.behind !== null && r.behind <= 2).length;

    const byVersion = new Map<string, number>();
    for (const r of up) {
      byVersion.set(r.agent.label, (byVersion.get(r.agent.label) ?? 0) + 1);
    }
    this.versions = [...byVersion.entries()].sort((a, b) => b[1] - a[1])
      .map(([label, count], i) => ({ label, count, share: up.length ? count / up.length : 0, color: PALETTE[i % PALETTE.length] }));
    this.latest = this.newest(this.versions.map(v => v.label));

    this.filters = [
      { label: 'Status', options: [{ label: 'reachable', test: r => r.up }, { label: 'gone', test: r => !r.up }] },
      { label: 'Version', options: this.versions.map(v => ({ label: v.label, test: (r: any) => r.agent.label === v.label })) },
    ];
    this.chart = this.historyChart(d.history ?? []);
  }

  /** the highest version among the clients' (by numeric parts), as "client version" */
  private newest(labels: string[]): string {
    const num = (l: string) => (l.match(/(\d+(?:\.\d+)*)\s*$/)?.[1] ?? '0').split('.').map(Number);
    return labels.reduce((best, l) => {
      const a = num(l), b = num(best);
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if ((a[i] ?? 0) !== (b[i] ?? 0)) { return (a[i] ?? 0) > (b[i] ?? 0) ? l : best; }
      }
      return best;
    }, labels[0] ?? '');
  }

  latestShare(): number {
    return this.versions.find(v => v.label === this.latest)?.share ?? 0;
  }

  reachable(): number {
    return this.rows.filter(r => r.up).length;
  }

  services(s: string | null): { label: string; title: string }[] {
    if (!s) { return []; }
    const v = BigInt(s);
    const on = SERVICES.filter(x => (v & BigInt(x.bit)) !== BigInt(0));
    // full and limited: a full node (limited is its promise for the recent blocks only)
    return on.some(x => x.bit === 1) ? on.filter(x => x.bit !== 1024) : on;
  }

  pct(x: number, d = 0): string { return ((x || 0) * 100).toFixed(d) + '%'; }

  private historyChart(h: any[]): any {
    if (h.length < 2) {
      return null;
    }
    const axis = { axisLine: { lineStyle: { color: '#ffffff33' } }, axisLabel: { color: '#ffffff99', fontSize: 11 }, splitLine: { lineStyle: { color: '#ffffff12' } } };
    return {
      animation: false,
      grid: { left: 40, right: 12, top: 24, bottom: 28 },
      tooltip: { trigger: 'axis', backgroundColor: 'rgba(17,19,31,0.95)', borderColor: '#000', textStyle: { color: '#fff', fontSize: 12 }, confine: true },
      legend: { top: 0, right: 0, textStyle: { color: '#ffffffaa', fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
      xAxis: { type: 'time', ...axis, splitLine: { show: false } },
      yAxis: { type: 'value', minInterval: 1, ...axis },
      series: [
        { name: 'Reachable', type: 'line', showSymbol: false, step: 'end', data: h.map(c => [c.time * 1000, c.reachable]),
          lineStyle: { color: PROFILE.color, width: 2 }, itemStyle: { color: PROFILE.color }, areaStyle: { color: PROFILE.color + '22' } },
        { name: 'Addresses heard of', type: 'line', showSymbol: false, step: 'end', data: h.map(c => [c.time * 1000, c.known]),
          lineStyle: { color: '#5aa6ff', width: 1.5, type: 'dashed' }, itemStyle: { color: '#5aa6ff' } },
      ],
    };
  }
}
