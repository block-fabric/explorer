import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { Observable, Subscription, catchError, map, of, switchMap, timer } from 'rxjs';
import { ChainApiService } from '@app/chain/chain-api.service';
import { PROFILE } from '@app/chain/profiles';
import { CxColumn, CxFilter } from '@app/chain/components/chain-table/chain-table.component';
import { SeoService } from '@app/services/seo.service';

const PALETTE = [PROFILE.color, '#5aa6ff', '#ff8a3d', '#f26b9c', '#a585ff', '#2bc79a', '#f5b83d', '#9aa4b2'];

/** the service bits a node advertises in its version message, as the table shows them (its chain: chainKind) */
const SERVICES: { bit: number; label: string; title: string }[] = [
  { bit: 8, label: 'witness', title: 'NODE_WITNESS' },
  { bit: 4, label: 'bloom', title: 'NODE_BLOOM: BIP37 filters' },
  { bit: 64, label: 'filters', title: 'NODE_COMPACT_FILTERS: BIP157/158' },
  { bit: 2048, label: 'v2', title: 'NODE_P2P_V2: BIP324 encrypted transport' },
];
const NODE_NETWORK = 1;
const NODE_NETWORK_LIMITED = 1024;

export interface NodeAgent {
  /** "Backbone 0.2.5", "eCash 1.2.0" (eCash's client calls itself "eCash Satoshi") */
  node: string;
  backbone: boolean;
  comments: string[];
  /** the Node column's order: Backbone first (the network's newest client), newest first; then the other clients from
   * the newest Bitcoin Core they build on; the unknown last (Backbone's app, src/webui/app/src/lib/peers.ts) */
  order: number;
}

/** a user agent, "/eCash Satoshi:1.2.0(Bitcoin Core 32.1.0; BitWindow-0.2)/": its node, comments and order */
export function parseAgent(ua: string | null): NodeAgent {
  const m = /^\/?([^:/()]+):([0-9][0-9.]*)(?:\(([^)]*)\))?/.exec(ua ?? '');
  if (!m) {
    return { node: (ua ?? '').replace(/^\/|\/$/g, '') || 'unknown', backbone: false, comments: [], order: 3e9 };
  }
  const product = m[1].trim();
  const backbone = /\bBackbone\b/.test(product);
  const comments = (m[3] ?? '').split(';').map(c => c.trim()).filter(Boolean);
  const core = /Bitcoin Core ([0-9][0-9.]*)/.exec(m[3] ?? '')?.[1];
  const [a = 0, b = 0, c = 0] = (core ?? m[2]).split('.').map(x => Number(x) || 0);
  const newer = Math.min(a, 999) * 1e6 + Math.min(b, 999) * 1e3 + Math.min(c, 999);
  const name = backbone ? 'Backbone' : product.replace(/^eCash Satoshi$/, 'eCash');
  return { node: `${name} ${m[2]}`, backbone, comments, order: (backbone ? 1e9 : 2e9) - newer };
}

/** an address to fit the table: an IPv6 one as its first two groups … its last ("[2a01:e0a:…:b43a]:8533") */
export function shortAddress(ip: string, port: number): string {
  if (!ip.includes(':')) {
    return `${ip}:${port}`;
  }
  const g = ip.split(':').filter(Boolean);
  return g.length > 3 ? `[${g[0]}:${g[1]}:…:${g[g.length - 1]}]:${port}` : `[${ip}]:${port}`;
}

/** a user agent's comments, as the Node column's small print: about "Bitcoin Core 32.1.0" long (the whole on hover) */
export function shortNote(comments: string[], max = 22): string {
  const t = comments.join('; ');
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

/** whether a node keeps the whole chain: Full (NODE_NETWORK), Pruned (NODE_NETWORK_LIMITED alone: the last 288
 * blocks), or No blocks */
export function chainKind(services: string | null): 'Full' | 'Pruned' | 'No blocks' {
  const v = BigInt(services || '0');
  return (v & BigInt(NODE_NETWORK)) !== BigInt(0) ? 'Full' : (v & BigInt(NODE_NETWORK_LIMITED)) !== BigInt(0) ? 'Pruned' : 'No blocks';
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
  /** the figures of the page's tiles and breakdowns (the reachable nodes of the last crawl) */
  stats: any = {};
  breakdowns: { title: string; sub: string; rows: { label: string; count: number; share: number; color: string; title?: string }[] }[] = [];
  chart: any = null;
  chartInitOptions = { renderer: 'svg' };
  /** the time, every second (the countdowns) */
  clock$: Observable<number> = timer(0, 1000).pipe(map(() => Date.now() / 1000));
  private sub: Subscription;

  cols: CxColumn[] = [
    { key: 'address', label: 'Address', sort: r => r.ip },
    { key: 'node', label: 'Node', sort: r => r.agent.order, title: 'Backbone first, newest first; then the clients from the newest Bitcoin Core they build on' },
    { key: 'chain', label: 'Chain', sort: r => ['Full', 'Pruned', 'No blocks'].indexOf(r.chain), title: 'Full: serves every block; Pruned: the last 288 only' },
    { key: 'height', label: 'Height', align: 'right', sort: true },
    { key: 'services', label: 'Services', hide: 'md' },
    { key: 'protocol', label: 'Protocol', align: 'right', sort: true, hide: 'lg' },
    { key: 'latency', label: 'Latency', align: 'right', sort: true, hide: 'sm', title: 'the handshake, from the explorer\'s server' },
    { key: 'uptime', label: 'Uptime (24h)', sort: true, nowrap: true, title: 'reached in the crawls of the last day (one every 10 minutes), hour by hour' },
    { key: 'firstSeen', label: 'First seen', align: 'right', sort: true, hide: 'md' },
    { key: 'lastSeen', label: 'Last seen', align: 'right', sort: true },
  ];
  filters: CxFilter[] = [];
  match = (r: any, q: string) => [r.address, r.userAgent].some(x => typeof x === 'string' && x.toLowerCase().includes(q));
  trackAddress = (r: any) => r.address;

  constructor(private api: ChainApiService, private cd: ChangeDetectorRef, private seo: SeoService) {}

  ngOnInit(): void {
    this.seo.setTitle('Nodes');
    this.sub = timer(0, 20_000).pipe(
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
      chain: chainKind(n.services),
      // behind the tip when its height was read (a crawl, or a check between crawls), not the tip now
      behind: n.height !== null && (n.tip ?? tip) ? Math.max(0, (n.tip ?? tip) - n.height) : null,
      short: shortAddress(n.ip, n.port),
      note: shortNote(parseAgent(n.userAgent).comments),
      uptime: n.recent ? [...n.recent].filter(c => c === '1').length / n.recent.length : 0,
    })).sort((a: any, b: any) => a.agent.order - b.agent.order || Number(b.up) - Number(a.up) || b.lastSeen - a.lastSeen);
    const up = this.rows.filter(r => r.up);
    // at the tip in the last crawl, as the crawl counted it (within 2 blocks of the tip when reached)
    this.synced = d.last?.atTip ?? up.filter(r => r.behind !== null && r.behind <= 2).length;

    const byVersion = new Map<string, number>();
    for (const r of up) {
      byVersion.set(r.agent.node, (byVersion.get(r.agent.node) ?? 0) + 1);
    }
    this.versions = [...byVersion.entries()].sort((a, b) => b[1] - a[1])
      .map(([label, count], i) => ({ label, count, share: up.length ? count / up.length : 0, color: PALETTE[i % PALETTE.length] }));
    this.latest = this.versions[0]?.label ?? ''; // the most run (versions do not order across clients, nor across eCash's own renumbering)

    this.filters = [
      { label: 'Status', options: [{ label: 'reachable', test: r => r.up }, { label: 'gone', test: r => !r.up }] },
      { label: 'Chain', options: ['Full', 'Pruned', 'No blocks'].map(k => ({ label: k, test: (r: any) => r.chain === k })) },
      { label: 'Node', options: this.versions.map(v => ({ label: v.label, test: (r: any) => r.agent.node === v.label })) },
    ];
    this.chart = this.historyChart(d.history ?? []);
    this.buildStats(d, up);
  }

  private buildStats(d: any, up: any[]): void {
    const n = up.length || 1;
    const now = d.last.time;
    const lat = up.map(r => r.latency).filter((x: any) => x !== null).sort((a: number, b: number) => a - b);
    const hist = d.history ?? [];
    const dayAgo = [...hist].reverse().find((c: any) => c.time <= now - 86400) ?? hist[0];
    const count = (f: (r: any) => boolean) => up.filter(f).length;
    const svc = (bit: number) => count(r => !!r.services && (BigInt(r.services) & BigInt(bit)) !== BigInt(0));
    this.stats = {
      avgUptime: up.length ? up.reduce((a, r) => a + r.uptime, 0) / up.length : 0,
      stable: count(r => r.uptime >= 0.99),
      full: count(r => r.chain === 'Full'),
      pruned: count(r => r.chain === 'Pruned'),
      ipv6: count(r => r.ip.includes(':')),
      medianLatency: lat.length ? lat[Math.floor(lat.length / 2)] : null,
      fresh: count(r => r.firstSeen >= now - 86400),
      gone: this.rows.length - up.length,
      peak: Math.max(0, ...hist.map((c: any) => c.reachable)),
      change: dayAgo && dayAgo.time < now ? up.length - dayAgo.reachable : null,
      changeSince: dayAgo?.time ?? null,
    };
    const bars = (rows: [string, number, string, string?][]) => rows.filter(r => r[1] > 0)
      .map(([label, c, color, title]) => ({ label, count: c, share: c / n, color, title }));
    this.breakdowns = [
      { title: 'Chain', sub: 'what the nodes serve', rows: bars([
        ['Full', this.stats.full, '#3bd16f', 'every block (NODE_NETWORK)'],
        ['Pruned', this.stats.pruned, '#f5b83d', 'the last 288 blocks (NODE_NETWORK_LIMITED)'],
        ['No blocks', up.length - this.stats.full - this.stats.pruned, '#9aa4b2']]) },
      { title: 'Network', sub: 'how they are reached', rows: bars([
        ['IPv4', up.length - this.stats.ipv6, '#5aa6ff'], ['IPv6', this.stats.ipv6, '#a585ff'],
        [`port ${d.port}`, count(r => r.port === d.port), PROFILE.color, 'the network\'s default port'],
        ['other ports', count(r => r.port !== d.port), '#ff8a3d']]) },
      { title: 'Services', sub: 'the features they advertise', rows: bars([
        ['witness', svc(8), '#2bc79a', 'NODE_WITNESS'], ['v2 transport', svc(2048), '#5aa6ff', 'NODE_P2P_V2: BIP324 encryption'],
        ['compact filters', svc(64), '#f26b9c', 'NODE_COMPACT_FILTERS: BIP157/158'], ['bloom', svc(4), '#a585ff', 'NODE_BLOOM: BIP37']]) },
    ];
  }

  /** a node's last day as 24 hourly cells: the share of its crawls it was reached in, null before it was seen */
  strip(recent: string): (number | null)[] {
    const per = 6; // crawls an hour (every 10 minutes)
    const cells: (number | null)[] = [];
    for (let h = 23; h >= 0; h--) {
      const end = recent.length - h * per;
      const part = recent.slice(Math.max(0, end - per), Math.max(0, end));
      cells.push(part.length ? [...part].filter(c => c === '1').length / part.length : null);
    }
    return cells;
  }

  /** a countdown to `at` (unix seconds), as m:ss; and how far the interval before it has run, 0..1 */
  countdown(at: number | null, now: number): string {
    const t = Math.max(0, Math.round((at ?? now) - now));
    return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  }

  elapsed(at: number | null, every: number, now: number): number {
    return at ? Math.min(1, Math.max(0, 1 - (at - now) / every)) : 1;
  }

  cellColor(x: number | null): string {
    return x === null ? '#ffffff10' : x >= 0.99 ? '#3bd16f' : x >= 0.5 ? '#f5b83d' : '#ff6b6b';
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
    return SERVICES.filter(x => (v & BigInt(x.bit)) !== BigInt(0));
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
