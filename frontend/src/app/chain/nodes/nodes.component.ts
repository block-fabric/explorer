import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { Observable, Subscription, catchError, map, of, switchMap, timer } from 'rxjs';
import { ChainApiService } from '@app/chain/chain-api.service';
import { PROFILE } from '@app/chain/profiles';
import { CxColumn, CxFilter } from '@app/chain/components/chain-table/chain-table.component';
import { SeoService } from '@app/services/seo.service';

const PALETTE = [PROFILE.color, '#5aa6ff', '#ff8a3d', '#f26b9c', '#a585ff', '#f5b83d', '#9aa4b2'];
/** a Backbone build's colours, its most run version first: green, which no other client gets */
const BACKBONE = ['#3bd16f', '#8fe3a8', '#1f9e4f', '#c4f1d2'];

const NODE_NETWORK = 1;
const NODE_NETWORK_LIMITED = 1024;

export interface NodeAgent {
  /** "eCash Backbone 0.2.5", "eCash Satoshi 1.2.0", "Backbone Flush 8.3.7": the client's whole name and version */
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
  // the client's whole name, as it gives it: eCash Backbone, Backbone Flush, Thunder Backbone, eCash Satoshi
  return { node: `${product} ${m[2]}`, backbone, comments, order: (backbone ? 1e9 : 2e9) - newer };
}

/** the hosting companies whose AS holder's name says little ("The Constant Company, LLC" is Vultr), by AS number */
const HOSTERS: Record<number, string> = {
  20473: 'Vultr', 24940: 'Hetzner', 213230: 'Hetzner', 16509: 'AWS', 14618: 'AWS', 8987: 'AWS', 51167: 'Contabo', 141995: 'Contabo',
  63949: 'Akamai (Linode)', 12876: 'Scaleway', 16276: 'OVH', 14061: 'DigitalOcean', 15169: 'Google Cloud', 396982: 'Google Cloud',
  8075: 'Microsoft Azure', 13335: 'Cloudflare', 31898: 'Oracle Cloud', 45102: 'Alibaba Cloud', 132203: 'Tencent Cloud', 197540: 'netcup',
  60068: 'Datacamp (CDN77)', 9009: 'M247', 62240: 'Clouvider', 212238: 'Datacamp', 53667: 'FranTech (BuyVM)', 36352: 'ColoCrossing',
};

/** who hosts an address: the company of its AS, by name */
export function hostName(asn: { number: number; org: string } | null | undefined): string | null {
  if (!asn) {
    return null;
  }
  return HOSTERS[asn.number] ?? asn.org.replace(/,?\s+(LLC|L\.L\.C\.|Inc\.?|Ltd\.?|Limited|GmbH|S\.?A\.?S?|B\.V\.|AG|Co\.?|Corp\.?|Corporation|SAS)\.?$/i, '').trim();
}

/** an address to fit the table: an IPv6 one as its first three groups … its last two ("[2a01:e0a:1f3:…:5e1:b43a]:8533") */
export function shortAddress(ip: string, port: number): string {
  if (!ip.includes(':')) {
    return `${ip}:${port}`;
  }
  const g = ip.split(':').filter(Boolean);
  return g.length > 5 ? `[${g.slice(0, 3).join(':')}:…:${g.slice(-2).join(':')}]:${port}` : `[${ip}]:${port}`;
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
 * A chain's network (/nodes, on eCash, Flush, FreeBank and Thunder): the reachable nodes the backend's crawler found on its P2P network, their clients and
 * versions, chain kind, heights and uptime, and the count over time (GET /api/v1/chain/nodes).
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
  /** the figures of the page's tiles (the reachable nodes of the last crawl) */
  stats: any = {};
  chart: any = null;
  chartInitOptions = { renderer: 'svg' };
  /** the time, every second (the countdowns) */
  clock$: Observable<number> = timer(0, 1000).pipe(map(() => Date.now() / 1000));
  private sub: Subscription;

  private allCols: CxColumn[] = [
    { key: 'address', label: 'Address', sort: r => r.ip },
    { key: 'node', label: 'Node', sort: r => r.agent.node },
    { key: 'host', label: 'Host', sort: r => r.host ?? '~', hide: 'md', title: 'who holds the address\'s network (its AS), by DB-IP' },
    { key: 'chain', label: 'Chain', sort: r => ['Full', 'Pruned', 'No blocks'].indexOf(r.chain), title: 'Full: serves every block; Pruned: the last 288 only' },
    { key: 'height', label: 'Height', align: 'right', sort: true },
    { key: 'protocol', label: 'Protocol', align: 'right', sort: true, hide: 'lg' },
    { key: 'latency', label: 'Latency', align: 'right', sort: true, hide: 'sm', title: 'the handshake, from the explorer\'s server' },
    { key: 'uptime', label: 'Uptime (24h)', sort: true, nowrap: true, title: 'reached in the crawls of the last day (one every 10 minutes), hour by hour' },
    { key: 'firstSeen', label: 'First seen', align: 'right', sort: true, hide: 'md' },
    { key: 'lastSeen', label: 'Last seen', align: 'right', sort: true },
  ];
  /** a LayerTwo chain's nodes (Thunder: QUIC) tell no services nor protocol number: no Chain, Protocol */
  private static readonly BITCOIN_ONLY = ['chain', 'protocol'];
  cols: CxColumn[] = this.allCols;
  filters: CxFilter[] = [];
  /** a client's colour (Versions card, map) */
  colorMap: Record<string, string> = {};
  match = (r: any, q: string) => [r.address, r.rdns, r.userAgent, r.host, r.asn?.org, r.asn ? 'AS' + r.asn.number : null].some(x => typeof x === 'string' && x.toLowerCase().includes(q));
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
    this.cols = d.quic ? this.allCols.filter(c => !ChainNodesComponent.BITCOIN_ONLY.includes(c.key)) : this.allCols;
    const tip = d.tip ?? Math.max(0, ...d.nodes.map((n: any) => n.height ?? 0));
    this.rows = d.nodes.map((n: any) => ({
      ...n,
      agent: parseAgent(n.userAgent),
      chain: chainKind(n.services),
      // behind the tip when its height was read (a crawl, or a check between crawls), not the tip now
      behind: n.height !== null && (n.tip ?? tip) ? Math.max(0, (n.tip ?? tip) - n.height) : null,
      short: shortAddress(n.ip, n.port),
      host: hostName(n.asn),
      note: shortNote(parseAgent(n.userAgent).comments),
      uptime: n.recent ? [...n.recent].filter(c => c === '1').length / n.recent.length : 0,
    })).sort((a: any, b: any) => Number(b.up) - Number(a.up) || b.lastSeen - a.lastSeen || a.ip.localeCompare(b.ip));
    const up = this.rows.filter(r => r.up);
    // at the tip in the last crawl, as the crawl counted it (within 2 blocks of the tip when reached)
    this.synced = d.last?.atTip ?? up.filter(r => r.behind !== null && r.behind <= 2).length;

    const byVersion = new Map<string, number>();
    for (const r of up) {
      byVersion.set(r.agent.node, (byVersion.get(r.agent.node) ?? 0) + 1);
    }
    let others = 0;
    let backbones = 0;
    this.versions = [...byVersion.entries()].sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({
        label, count, share: up.length ? count / up.length : 0,
        color: /\bBackbone\b/.test(label) ? BACKBONE[backbones++ % BACKBONE.length] : PALETTE[others++ % PALETTE.length],
      }));
    this.colorMap = Object.fromEntries(this.versions.map(v => [v.label, v.color]));
    this.latest = this.versions[0]?.label ?? ''; // the most run (versions do not order across clients, nor across eCash's own renumbering)

    this.filters = [
      { label: 'Status', options: [{ label: 'reachable', test: r => r.up }, { label: 'gone', test: r => !r.up }] },
      ...(d.quic ? [] : [{ label: 'Chain', options: ['Full', 'Pruned', 'No blocks'].map(k => ({ label: k, test: (r: any) => r.chain === k })) }]),
      { label: 'Node', options: this.versions.map(v => ({ label: v.label, test: (r: any) => r.agent.node === v.label })) },
    ];
    this.chart = this.historyChart(d.history ?? []);
    this.buildStats(d, up);
  }

  private buildStats(d: any, up: any[]): void {
    const now = d.last.time;
    const hist = d.history ?? [];
    const dayAgo = [...hist].reverse().find((c: any) => c.time <= now - 86400) ?? hist[0];
    this.stats = {
      avgUptime: up.length ? up.reduce((a, r) => a + r.uptime, 0) / up.length : 0,
      stable: up.filter(r => r.uptime >= 0.99).length,
      peak: Math.max(0, ...hist.map((c: any) => c.reachable)),
      change: dayAgo && dayAgo.time < now ? up.length - dayAgo.reachable : null,
    };
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
