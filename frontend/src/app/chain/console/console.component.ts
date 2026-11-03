import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Inject, OnDestroy, OnInit, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, Subscription, catchError, forkJoin, map, of, switchMap, timer } from 'rxjs';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { SeoService } from '@app/services/seo.service';
import { parseAgent, chainKind, shortAddress } from '@app/chain/nodes/nodes.component';
import { GlobeNode } from '@app/chain/nodes/nodes-globe.component';

/** the networks the console watches: each explorer's path on this site, its colour */
const NETS = [
  { id: 'ecash', name: 'eCash', base: '', color: '#f5a623' },
  { id: 'flush', name: 'Flush', base: '/flush', color: '#3bd1c4' },
  { id: 'thunder', name: 'Thunder', base: '/thunder', color: '#a585ff' },
  { id: 'freebank', name: 'FreeBank', base: '/freebank', color: '#5aa6ff' },
];
const GREEN = '#3bd16f';
const RED = '#ff6b6b';
/** the X accounts whose timelines the console embeds (X's own widget: no API key) */
export const X_ACCOUNTS = ['truthcoin', 'btcdrivechains'];
/** a node's hosting, by the end of its reverse DNS name */
const HOSTS: [RegExp, string][] = [
  [/your-server\.de$|hetzner/, 'Hetzner'], [/contaboserver\.net$/, 'Contabo'], [/amazonaws\.com$/, 'AWS'],
  [/googleusercontent\.com$/, 'Google Cloud'], [/linode|akamai/, 'Akamai (Linode)'], [/poneytelecom\.eu$|scaleway/, 'Scaleway'],
  [/lunanode/, 'LunaNode'], [/vultr/, 'Vultr'], [/ovh\./, 'OVH'], [/digitalocean/, 'DigitalOcean'], [/azure|microsoft/, 'Azure'],
  [/blockfab\.org$/, 'Blockfab'], [/(dsl|cable|dyn|pool|dhcp|cpe|res|fiber|ftth|broadband|customer|client)/, 'Residential ISP'],
];

interface FeedItem { time: number; kind: string; net: string; color: string; text: string; link?: string; ext?: boolean }

function hostOf(rdns: string | null): string {
  if (!rdns) {
    return 'No reverse DNS';
  }
  for (const [re, name] of HOSTS) {
    if (re.test(rdns)) {
      return name;
    }
  }
  return rdns.split('.').slice(-2).join('.');
}

/**
 * The console (/console, eCash mainnet's explorer): one screen over eCash and its sidechains, their markets and
 * mining. Every number is one of this site's explorers' (their /api, same origin) or the eCash backend's outside data
 * (chain/intel: markets on Solana and neoxa.exchange, ecash.com's news); X's timelines as X's pages in sandboxed frames.
 */
@Component({
  selector: 'app-chain-console',
  standalone: false,
  templateUrl: './console.component.html',
  styleUrls: ['./console.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChainConsoleComponent implements OnInit, OnDestroy {

  nets = NETS;
  now = Date.now() / 1000;

  // eCash
  tip: number | null = null;
  hashrate: number | null = null;
  hashSeries: [number, number][] = [];
  difficulty: any = null;
  mempool: any = null;
  pools: { name: string; blocks: number; share: number; empty: number }[] = [];
  poolBlocks = 0;
  blocks: any[] = [];
  // sidechains
  sidechains: { slot: number; name: string; color: string; tip: number | null; escrow: number | null; deposits: number; depositAmount: number;
    withdrawals: number; bmmBlocks: number; lastBmm: number | null; pending: number; link: string | null }[] = [];
  // nodes
  globeNodes: GlobeNode[] = [];
  links: [string, string][] = [];
  netColors: Record<string, string> = Object.fromEntries(NETS.map(n => [n.name, n.color]));
  nodeCounts: Record<string, number> = {};
  hosts: { name: string; count: number }[] = [];
  countries: { name: string; count: number }[] = [];
  clients: { name: string; count: number; color: string }[] = [];
  // markets
  markets: any = null;
  candles: any[] = [];
  priceChart: any = null;
  hashChart: any = null;
  // holders, news, events
  holders: { address: string; balance: number; share: number }[] = [];
  news: { title: string; link: string; time: number }[] = [];
  feed: FeedItem[] = [];
  chartInit = { renderer: 'svg' };

  /** X's embedded timeline of each account, as a frame of X's origin (what X's widget script would put in the page) */
  xFrames: { account: string; url: SafeResourceUrl }[];
  private subs: Subscription[] = [];
  private browser: boolean;

  constructor(private http: HttpClient, private cd: ChangeDetectorRef, private seo: SeoService, sanitizer: DomSanitizer, @Inject(PLATFORM_ID) platformId: object) {
    this.browser = isPlatformBrowser(platformId);
    // fixed accounts only (X_ACCOUNTS): nothing from the page or a request reaches these URLs
    this.xFrames = X_ACCOUNTS.map(account => ({
      account, url: sanitizer.bypassSecurityTrustResourceUrl(`https://syndication.twitter.com/srv/timeline-profile/screen-name/${account}?dnt=true&theme=dark`),
    }));
  }

  ngOnInit(): void {
    this.seo.setTitle('Console');
    this.subs.push(timer(0, 1000).subscribe(() => { this.now = Date.now() / 1000; this.cd.markForCheck(); }));
    this.subs.push(timer(0, 30_000).subscribe(() => this.loadChains()));
    this.subs.push(timer(0, 60_000).subscribe(() => this.loadMarkets()));
    this.subs.push(timer(0, 120_000).subscribe(() => this.loadNodes()));
    this.subs.push(timer(0, 15 * 60_000).subscribe(() => this.loadSlow()));
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
  }

  private get<T = any>(url: string): Observable<T | null> {
    return this.http.get<T>(url).pipe(catchError(() => of(null)));
  }

  private loadChains(): void {
    forkJoin({
      blocks: this.get<any[]>('/api/v1/blocks'),
      pools: this.get<any>('/api/v1/mining/pools/24h'),
      hash: this.get<any>('/api/v1/mining/hashrate/1m'),
      diff: this.get<any>('/api/v1/difficulty-adjustment'),
      mempool: this.get<any>('/api/mempool'),
      summary: this.get<any>('/api/v1/drivechain/summary'),
      deposits: this.get<any[]>('/api/v1/drivechain/events/deposits?limit=15'),
      withdrawals: this.get<any[]>('/api/v1/drivechain/events/withdrawals?limit=10'),
      bundles: this.get<any[]>('/api/v1/drivechain/events/bundles?limit=10'),
      // (an explorer whose chain has no block past genesis answers tip/height 503, FreeBank's: its newest block then)
      tips: forkJoin(NETS.map(n => this.get<number>(`${n.base}/api/blocks/tip/height`).pipe(
        switchMap(t => typeof t === 'number' ? of(t) : this.get<any[]>(`${n.base}/api/v1/blocks`).pipe(map(b => b?.[0]?.height ?? null)))))),
      thunderBlocks: this.get<any[]>('/thunder/api/v1/l2/blocks?limit=10'),
    }).subscribe((d) => {
      if (d.blocks?.length) {
        this.blocks = d.blocks;
        this.tip = d.blocks[0].height;
      }
      if (d.pools?.pools) {
        const total = d.pools.pools.reduce((s: number, p: any) => s + p.blockCount, 0) || 1;
        this.poolBlocks = total;
        this.pools = d.pools.pools.slice(0, 8).map((p: any) => ({ name: p.name, blocks: p.blockCount, share: p.blockCount / total, empty: p.emptyBlocks }));
      }
      if (d.hash?.hashrates?.length) {
        this.hashrate = d.hash.currentHashrate ?? d.hash.hashrates[d.hash.hashrates.length - 1].avgHashrate;
        // eCash's own days only: before its fork the index holds Bitcoin's hashrate, hundreds of times eCash's
        const cap = (this.hashrate ?? 0) * 50;
        const all = d.hash.hashrates.map((h: any) => [h.timestamp * 1000, h.avgHashrate] as [number, number]);
        const last = all.map((x: [number, number]) => x[1] > cap).lastIndexOf(true);
        this.hashSeries = cap > 0 ? all.slice(last + 1) : all;
        this.hashChart = this.buildHashChart();
      }
      this.difficulty = d.diff ?? this.difficulty;
      this.mempool = d.mempool ?? this.mempool;
      if (d.summary?.sidechains) {
        this.sidechains = d.summary.sidechains.filter((s: any) => s.profile).map((s: any) => {
          const net = NETS.find(n => n.id === s.profile);
          return {
            slot: s.slot, name: s.title, color: net?.color ?? '#9aa4b2', link: s.explorer,
            tip: net ? d.tips[NETS.indexOf(net)] ?? null : null, escrow: s.escrow?.amount ?? null,
            deposits: s.stats?.deposits ?? 0, depositAmount: s.stats?.depositAmount ?? 0, withdrawals: s.stats?.withdrawals ?? 0,
            bmmBlocks: s.stats?.bmmBlocks ?? 0, lastBmm: s.stats?.lastBmmHeight ?? null, pending: s.pendingbundles ?? 0,
          };
        });
      }
      this.buildFeed(d);
      this.cd.markForCheck();
    });
  }

  private buildFeed(d: any): void {
    const items: FeedItem[] = [];
    for (const b of (d.blocks ?? []).slice(0, 12)) {
      const pool = b.extras?.pool?.name && b.extras.pool.name !== 'Unknown' ? b.extras.pool.name : 'an unknown miner';
      items.push({ time: b.timestamp, kind: 'block', net: 'eCash', color: NETS[0].color, link: `/block/${b.id}`,
        text: `Block ${b.height.toLocaleString()} by ${pool} · ${b.tx_count.toLocaleString()} txs` });
    }
    for (const e of d.deposits ?? []) {
      items.push({ time: e.time, kind: 'deposit', net: e.name ?? `slot ${e.slot}`, color: GREEN, link: `/tx/${e.txid}`,
        text: `Deposit of ${this.ecx(e.amount)} to ${e.name ?? 'slot ' + e.slot}` });
    }
    for (const e of d.withdrawals ?? []) {
      items.push({ time: e.time, kind: 'withdrawal', net: e.name ?? `slot ${e.slot}`, color: RED, link: e.txid ? `/tx/${e.txid}` : undefined,
        text: `Withdrawal bundle paid out of ${e.name ?? 'slot ' + e.slot}${e.amount ? ': ' + this.ecx(e.amount) : ''}` });
    }
    for (const e of d.bundles ?? []) {
      items.push({ time: e.time, kind: 'bundle', net: e.name ?? `slot ${e.slot}`, color: '#f5b83d',
        text: `Withdrawal bundle ${e.status ? e.status.toLowerCase() + ' ' : ''}on ${e.name ?? 'slot ' + e.slot}` });
    }
    for (const b of d.thunderBlocks ?? []) {
      items.push({ time: b.time, kind: 'block', net: 'Thunder', color: NETS[2].color, link: `/thunder/block/${b.hash}`, ext: true,
        text: `Thunder block ${b.height} · ${b.txCount} txs, BMM bid ${b.bmm?.bid ?? '–'} sats` });
    }
    for (const n of this.news.slice(0, 5)) {
      items.push({ time: n.time, kind: 'news', net: 'ecash.com', color: '#ffffff', link: n.link, ext: true, text: n.title });
    }
    this.feed = items.filter(i => i.time).sort((a, b) => b.time - a.time).slice(0, 60);
  }

  private loadNodes(): void {
    forkJoin(NETS.map(n => this.get<any>(`${n.base}/api/v1/chain/nodes`))).subscribe((all) => {
      const globe: GlobeNode[] = [];
      const counts: Record<string, number> = {};
      const hosts = new Map<string, number>();
      const countries = new Map<string, number>();
      const clients = new Map<string, number>();
      all.forEach((d, i) => {
        const net = NETS[i];
        if (!d?.nodes) {
          return;
        }
        const up = d.nodes.filter((n: any) => n.up);
        counts[net.name] = up.length;
        if (i === 0) {
          this.links = d.links ?? [];
        }
        for (const n of up) {
          const agent = parseAgent(n.userAgent);
          const tip = n.tip ?? d.tip;
          globe.push({
            address: n.address, short: shortAddress(n.ip, n.port), rdns: n.rdns ?? null, up: true, agent,
            chain: d.quic ? '' : chainKind(n.services), height: n.height, behind: n.height !== null && tip ? Math.max(0, tip - n.height) : null,
            latency: n.latency, uptime: n.recent ? [...n.recent].filter((c: string) => c === '1').length / n.recent.length : 0,
            lastSeen: n.lastSeen, geo: n.geo ?? null, group: net.name,
          });
          clients.set(agent.node.replace(/ [0-9][0-9.]*$/, ''), (clients.get(agent.node.replace(/ [0-9][0-9.]*$/, '')) ?? 0) + 1);
          if (i === 0) {
            hosts.set(hostOf(n.rdns), (hosts.get(hostOf(n.rdns)) ?? 0) + 1);
            if (n.geo?.country) {
              countries.set(n.geo.country, (countries.get(n.geo.country) ?? 0) + 1);
            }
          }
        }
      });
      const top = (m: Map<string, number>, k: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([name, count]) => ({ name, count }));
      this.globeNodes = globe;
      this.nodeCounts = counts;
      this.hosts = top(hosts, 8);
      this.countries = top(countries, 8);
      this.clients = top(clients, 8).map(c => ({ ...c, color: /Backbone/.test(c.name) ? GREEN : '#9aa4b2' }));
      this.cd.markForCheck();
    });
  }

  private loadMarkets(): void {
    forkJoin({ m: this.get<any>('/api/v1/chain/intel/markets'), c: this.get<any[]>('/api/v1/chain/intel/candles/ECX_USDC') }).subscribe(({ m, c }) => {
      if (m) {
        this.markets = m;
      }
      if (c?.length) {
        this.candles = c;
      }
      this.priceChart = this.buildPriceChart();
      this.cd.markForCheck();
    });
  }

  private loadSlow(): void {
    forkJoin({
      news: this.get<any>('/api/v1/chain/intel/news'),
      rich: this.get<any>('/thunder/api/v1/l2/feature/richlist'),
    }).subscribe(({ news, rich }) => {
      this.news = news?.items ?? this.news;
      this.holders = (rich?.items ?? []).slice(0, 6).map((r: any) => ({ address: r.address, balance: r.balance, share: r.share }));
      this.cd.markForCheck();
    });
  }

  /** eCash's daily hashrate over the last month */
  private buildHashChart(): any {
    if (this.hashSeries.length < 2) {
      return null;
    }
    const axis = { axisLine: { lineStyle: { color: '#ffffff26' } }, axisLabel: { color: '#ffffff80', fontSize: 10 }, splitLine: { lineStyle: { color: '#ffffff0d' } } };
    return {
      animation: false, grid: { left: 52, right: 10, top: 10, bottom: 22 },
      tooltip: { trigger: 'axis', backgroundColor: 'rgba(10,12,20,0.95)', borderColor: '#000', textStyle: { color: '#fff', fontSize: 11 }, confine: true,
        valueFormatter: (v: number) => this.hash(v) },
      xAxis: { type: 'time', ...axis, splitLine: { show: false } },
      yAxis: { type: 'value', scale: true, ...axis, axisLabel: { ...axis.axisLabel, formatter: (v: number) => this.hash(v).replace(/(\.\d)\d+ /, '$1 ') } },
      series: [{ name: 'Hashrate', type: 'line', showSymbol: false, data: this.hashSeries, lineStyle: { width: 1.5, color: '#f5a623' }, itemStyle: { color: '#f5a623' },
        areaStyle: { color: '#f5a62318' } }],
    };
  }

  private buildPriceChart(): any {
    const ours = (this.markets?.history ?? []).map((h: any) => [h.time * 1000, h.priceUsd]);
    const neoxa = this.candles.map(k => [k.time * 1000, k.close]);
    if (ours.length < 2 && neoxa.length < 2) {
      return null;
    }
    const axis = { axisLine: { lineStyle: { color: '#ffffff26' } }, axisLabel: { color: '#ffffff80', fontSize: 10 }, splitLine: { lineStyle: { color: '#ffffff0d' } } };
    return {
      animation: false, grid: { left: 44, right: 10, top: 22, bottom: 22 },
      legend: { top: 0, right: 0, textStyle: { color: '#ffffffaa', fontSize: 10 }, itemWidth: 10, itemHeight: 6 },
      tooltip: { trigger: 'axis', backgroundColor: 'rgba(10,12,20,0.95)', borderColor: '#000', textStyle: { color: '#fff', fontSize: 11 }, confine: true,
        valueFormatter: (v: number) => '$' + v?.toFixed(2) },
      xAxis: { type: 'time', ...axis, splitLine: { show: false } },
      yAxis: { type: 'value', scale: true, ...axis, axisLabel: { ...axis.axisLabel, formatter: (v: number) => '$' + v } },
      series: [
        { name: 'neoxa ECX/USDC (1 h)', type: 'line', showSymbol: false, data: neoxa, lineStyle: { width: 1.5, color: '#5aa6ff' }, itemStyle: { color: '#5aa6ff' } },
        ...(ours.length >= 2 ? [{ name: 'ECX, all venues', type: 'line', showSymbol: false, data: ours, lineStyle: { width: 2, color: '#f5a623' }, itemStyle: { color: '#f5a623' },
          areaStyle: { color: '#f5a62318' } }] : []),
      ],
    };
  }

  // --- formatting ---------------------------------------------------------------------------------------------------

  ecx(sats: number | null): string {
    if (sats === null || sats === undefined) {
      return '–';
    }
    if (sats > 0 && sats < 10_000) {
      return `${sats.toLocaleString()} sats`; // (a deposit of a few hundred sats is not "0 ECX")
    }
    const v = sats / 1e8;
    return (v >= 100 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : v.toLocaleString(undefined, { maximumFractionDigits: 4 })) + ' ECX';
  }

  usd(v: number | null | undefined, digits = 2): string {
    if (v === null || v === undefined || !Number.isFinite(v)) {
      return '–';
    }
    return v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M' : v >= 1e4 ? '$' + (v / 1e3).toFixed(1) + 'k' : '$' + v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  hash(h: number | null): string {
    if (!h) {
      return '–';
    }
    const u = ['H/s', 'kH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s', 'EH/s', 'ZH/s'];
    let i = 0;
    while (h >= 1000 && i < u.length - 1) {
      h /= 1000;
      i++;
    }
    return h.toFixed(2) + ' ' + u[i];
  }

  ago(t: number): string {
    const s = Math.max(0, this.now - t);
    return s < 60 ? `${Math.floor(s)}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
  }

  clock(): string {
    return new Date(this.now * 1000).toISOString().slice(11, 19) + ' UTC';
  }

  short(a: string): string {
    return a.length > 16 ? a.slice(0, 8) + '…' + a.slice(-6) : a;
  }

  pct(x: number, d = 0): string {
    return ((x || 0) * 100).toFixed(d) + '%';
  }

  maxOf(list: { count: number }[]): number {
    return Math.max(1, ...list.map(x => x.count));
  }

  totalNodes(): number {
    return Object.values(this.nodeCounts).reduce((s, x) => s + x, 0);
  }

  avgBlock(): string {
    const ms = this.difficulty?.timeAvg;
    if (!ms) {
      return '–';
    }
    const s = ms / 1000;
    return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
  }

  ecxPairs(): any[] {
    return (this.markets?.pairs ?? []).filter((p: any) => p.asset === 'ECX').sort((a: any, b: any) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0));
  }

  otherPairs(): any[] {
    return (this.markets?.pairs ?? []).filter((p: any) => p.asset !== 'ECX');
  }
}
