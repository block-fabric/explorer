import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subscription, catchError, forkJoin, map, of, switchMap, timer } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { parseAgent, chainKind, hostName, shortAddress } from '@app/chain/nodes/nodes.component';
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
const AMBER = '#f5b83d';
const POOL_COLORS = ['#f5a623', '#5aa6ff', '#3bd1c4', '#f26b9c', '#a585ff', '#f5b83d', '#9aa4b2', '#8fe3a8'];
/** the mining window the console's mining, decentralisation and difficulty panes cover: a week of eCash's blocks */
const WINDOW = 1008;

interface FeedItem { time: number; kind: string; net: string; color: string; text: string; link?: string; ext?: boolean }

const AXIS = { axisLine: { lineStyle: { color: '#ffffff26' } }, axisLabel: { color: '#ffffff80', fontSize: 10 }, splitLine: { lineStyle: { color: '#ffffff0d' } } };
const TOOLTIP = { backgroundColor: 'rgba(10,12,20,0.95)', borderColor: '#000', textStyle: { color: '#fff', fontSize: 11 }, confine: true };

/**
 * The console (/console, eCash mainnet's explorer): one screen over eCash and its sidechains, their markets and
 * mining. Every number is one of this site's explorers' (their /api, same origin) or the eCash backend's outside data
 * (chain/intel: markets on Solana and neoxa.exchange, wECX on Solana, Bitcoin's mining from mempool.space, eCash's activity).
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
  chartInit = { renderer: 'svg' };

  // eCash, now
  tip: number | null = null;
  adjustment: any = null;
  mempool: any = null;
  pools24: { name: string; blocks: number; share: number }[] = [];
  blocks24 = 0;
  // the mining window (drivechain/mining, cockpit)
  mining: any = null;
  cockpit: any = null;
  decent: { nakamoto: number; hhi: number; top: { name: string; share: number } | null; pools: number; datum: number; datumMiners: number;
    empty: number; grade: 'Healthy' | 'Concentrated' | 'Critical'; why: string } | null = null;
  shareChart: any = null;
  diffChart: any = null;
  histChart: any = null;
  // economics
  efficiency = 17.5; // J/TH: a current SHA-256 machine's
  power = 0.05; // $/kWh
  bitcoin: any = null;
  bch: any = null;
  econ: {
    rows: { label: string; ecash: string; btc: string; bch: string; note?: string; good?: boolean | null }[]; share: number | null; shareBch: number | null;
    /** the overview: a card per chain, the best paying first-class */
    cards: { name: string; color: string; hashprice: number | null; rent: number | null; coinCost: number | null;
      price: number | null; unit: string; best: boolean; width: number }[];
    verdict: string | null;
  } | null = null;
  /** the economics pane's tab */
  econTab: 'overview' | 'details' = 'overview';
  hashprice: { ecash: number | null; btc: number | null; bch: number | null; ratio: number | null; ratioBch: number | null; ecxPerPh: number | null; btcPerPh: number | null } | null = null;
  hashpriceChart: any = null;
  attack: {
    level: 'Critical' | 'High' | 'Moderate' | 'Low'; why: string; perHour: number | null; perBlock: number | null; blockTime: number | null;
    volumeHours: number | null; majority: { name: string; share: number } | null;
    escrow: { usd: number | null; ecx: number; blocks: number; cost: number | null } | null;
  } | null = null;
  /** the drivechain's constants (bundle threshold, max age) */
  dcInfo: any = null;
  // sidechains, the peg's actors
  sidechains: { slot: number; name: string; color: string; tip: number | null; escrow: number | null; deposits: number; depositAmount: number;
    withdrawals: number; bmmBlocks: number; lastBmm: number | null; pending: number; link: string | null }[] = [];
  bmmMiners: { name: string; blocks: number; accepts: number; bids: number; perBlock: number }[] = [];
  bidders: { name: string; color: string; requests: number; accepts: number; bids: number; avg: number | null; max: number | null; coverage: number }[] = [];
  users: { chain: string; color: string; address: string; count: number; amount: number }[] = [];
  // big moves
  whales: any = null;
  // nodes
  globeNodes: GlobeNode[] = [];
  links: [string, string][] = [];
  netColors: Record<string, string> = Object.fromEntries(NETS.map(n => [n.name, n.color]));
  nodeCounts: Record<string, number> = {};
  hosts: { name: string; count: number; title: string }[] = [];
  countries: { name: string; count: number }[] = [];
  clients: { name: string; count: number; color: string }[] = [];
  /** each sidechain's BMM over the window: the share of eCash blocks carrying it, its longest gap, last carried, contested */
  liveness: { name: string; color: string; coverage: number; longestGap: number | null; lastHeight: number | null; contested: number }[] = [];
  // markets, events
  markets: any = null;
  candles: any[] = [];
  priceChart: any = null;
  solana: any = null;
  supplyChart: any = null;
  activityChart: any = null;
  /** miners' revenue over the window, by source: the subsidy, the transactions' fees, the sidechains' BMM bids (sats) */
  revenue: { subsidy: number; fees: number; bids: number; total: number } | null = null;
  /** each pool over the window: its blocks, fees, and revenue (subsidy, fees and the BMM bids it took, sats) */
  feePools: { name: string; fees: number; blocks: number; perBlock: number; revenue: number }[] = [];
  feed: FeedItem[] = [];

  private feedData: any = null;
  private subs: Subscription[] = [];

  constructor(private http: HttpClient, private cd: ChangeDetectorRef, private seo: SeoService) {}

  ngOnInit(): void {
    this.seo.setTitle('Console');
    this.subs.push(timer(0, 1000).subscribe(() => { this.now = Date.now() / 1000; this.cd.markForCheck(); }));
    this.subs.push(timer(0, 30_000).subscribe(() => this.loadChains()));
    this.subs.push(timer(0, 60_000).subscribe(() => { this.loadMarkets(); this.loadSolana(); }));
    this.subs.push(timer(0, 120_000).subscribe(() => { this.loadNodes(); this.loadWhales(); }));
    this.subs.push(timer(0, 5 * 60_000).subscribe(() => this.loadMining()));
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
  }

  private get<T = any>(url: string): Observable<T | null> {
    return this.http.get<T>(url).pipe(catchError(() => of(null)));
  }

  // --- loading ------------------------------------------------------------------------------------------------------

  private loadChains(): void {
    forkJoin({
      blocks: this.get<any[]>('/api/v1/blocks'),
      pools: this.get<any>('/api/v1/mining/pools/24h'),
      adjustment: this.get<any>('/api/v1/difficulty-adjustment'),
      mempool: this.get<any>('/api/mempool'),
      summary: this.get<any>('/api/v1/drivechain/summary'),
      deposits: this.get<any[]>('/api/v1/drivechain/events/deposits?limit=500'),
      withdrawals: this.get<any[]>('/api/v1/drivechain/events/withdrawals?limit=50'),
      bundles: this.get<any[]>('/api/v1/drivechain/events/bundles?limit=20'),
      // (an explorer whose chain has no block past genesis answers tip/height 503, FreeBank's: its newest block then)
      tips: forkJoin(NETS.map(n => this.get<number>(`${n.base}/api/blocks/tip/height`).pipe(
        switchMap(t => typeof t === 'number' ? of(t) : this.get<any[]>(`${n.base}/api/v1/blocks`).pipe(map(b => b?.[0]?.height ?? null)))))),
      thunderBlocks: this.get<any[]>('/thunder/api/v1/l2/blocks?limit=10'),
    }).subscribe((d) => {
      if (d.blocks?.length) {
        this.tip = d.blocks[0].height;
      }
      if (d.pools?.pools) {
        const total = d.pools.pools.reduce((s: number, p: any) => s + p.blockCount, 0) || 1;
        this.blocks24 = total;
        this.pools24 = d.pools.pools.slice(0, 8).map((p: any) => ({ name: p.name, blocks: p.blockCount, share: p.blockCount / total }));
      }
      this.adjustment = d.adjustment ?? this.adjustment;
      this.mempool = d.mempool ?? this.mempool;
      this.dcInfo = d.summary?.info ?? this.dcInfo;
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
      if (d.deposits) {
        this.users = this.topUsers(d.deposits);
      }
      this.feedData = d;
      this.buildFeed();
      this.econ = this.economics();
      this.cd.markForCheck();
    });
  }

  private loadMining(): void {
    forkJoin({
      mining: this.get<any>(`/api/v1/drivechain/mining?window=${WINDOW}`),
      cockpit: this.get<any>(`/api/v1/drivechain/cockpit?window=${WINDOW}`),
    }).subscribe(({ mining, cockpit }) => {
      if (mining) {
        this.mining = mining;
        this.decent = this.decentralisation(mining);
        this.shareChart = this.buildShareChart(mining);
        this.diffChart = this.buildDiffChart(mining);
        this.histChart = this.buildHistChart(mining);
      }
      if (mining?.totals && cockpit?.totals) {
        const t = mining.totals;
        const fees = t.fees ?? 0;
        const bids = cockpit.totals.bids ?? 0; // (paid to miners in the BMM transactions: not in the coinbase's fees)
        const subsidy = Math.max(0, (t.reward ?? 0) - fees);
        this.revenue = { subsidy, fees, bids, total: subsidy + fees + bids };
      }
      if (cockpit) {
        this.cockpit = cockpit;
        this.feePools = (cockpit.miners ?? []).filter((m: any) => m.blocks > 0)
          .map((m: any) => ({ name: m.name ?? m.tag, fees: m.fees ?? 0, blocks: m.blocks, perBlock: (m.fees ?? 0) / m.blocks,
            revenue: (m.subsidy ?? 0) + (m.fees ?? 0) + (m.bids ?? 0) }))
          .sort((a: any, b: any) => b.revenue - a.revenue).slice(0, 8);
        this.bmmMiners = (cockpit.miners ?? []).filter((m: any) => m.accepts > 0 || m.bids > 0)
          .map((m: any) => ({ name: m.name ?? m.tag, blocks: m.blocks, accepts: m.accepts, bids: m.bids, perBlock: m.acceptsPerBlock ?? 0 }))
          .sort((a: any, b: any) => b.bids - a.bids).slice(0, 8);
        this.bidders = (cockpit.slots ?? []).filter((s: any) => s.requests > 0)
          .map((s: any) => ({ name: s.name, color: NETS.find(n => n.id === s.profile)?.color ?? '#9aa4b2', requests: s.requests, accepts: s.accepts,
            bids: s.bids, avg: s.bidAvg, max: s.bidMax, coverage: s.coverage }))
          .sort((a: any, b: any) => b.bids - a.bids);
        this.liveness = (cockpit.slots ?? []).filter((s: any) => s.profile || s.accepts > 0)
          .map((s: any) => ({ name: s.name, color: NETS.find(n => n.id === s.profile)?.color ?? '#9aa4b2', coverage: s.coverage ?? 0,
            longestGap: s.longestGap ?? null, lastHeight: s.lastAcceptHeight ?? null, contested: s.contested ?? 0 }))
          .sort((a: any, b: any) => b.coverage - a.coverage);
      }
      this.econ = this.economics();
      this.hashpriceChart = this.buildHashpriceChart();
      this.cd.markForCheck();
    });
  }

  private loadMarkets(): void {
    forkJoin({
      m: this.get<any>('/api/v1/chain/intel/markets'),
      c: this.get<any[]>('/api/v1/chain/intel/candles/ECX_USDC'),
      b: this.get<any>('/api/v1/chain/intel/bitcoin'),
      h: this.get<any>('/api/v1/chain/intel/bch'),
    }).subscribe(({ m, c, b, h }) => {
      this.bch = h ?? this.bch;
      this.markets = m ?? this.markets;
      if (c?.length) {
        this.candles = c;
      }
      this.bitcoin = b ?? this.bitcoin;
      this.priceChart = this.buildPriceChart();
      this.econ = this.economics();
      this.hashpriceChart = this.buildHashpriceChart();
      this.cd.markForCheck();
    });
  }

  private loadWhales(): void {
    this.get<any>('/api/v1/chain/intel/whales?limit=15').subscribe((w) => {
      if (w) {
        this.whales = w;
        this.activityChart = this.buildActivityChart(w.daily ?? []);
        this.buildFeed();
        this.cd.markForCheck();
      }
    });
  }

  private loadNodes(): void {
    forkJoin(NETS.map(n => this.get<any>(`${n.base}/api/v1/chain/nodes`))).subscribe((all) => {
      const globe: GlobeNode[] = [];
      const counts: Record<string, number> = {};
      const hosts = new Map<string, { count: number; asns: Set<number> }>();
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
            address: n.address, short: shortAddress(n.ip, n.port), rdns: n.rdns ?? null, up: true, agent, asn: n.asn ?? null,
            chain: d.quic ? '' : chainKind(n.services), height: n.height, behind: n.height !== null && tip ? Math.max(0, tip - n.height) : null,
            latency: n.latency, uptime: n.recent ? [...n.recent].filter((c: string) => c === '1').length / n.recent.length : 0,
            lastSeen: n.lastSeen, geo: n.geo ?? null, group: net.name,
          });
          const client = agent.node.replace(/ [0-9][0-9.]*$/, '');
          clients.set(client, (clients.get(client) ?? 0) + 1);
          if (i === 0) {
            // who hosts it: its network's holder (AS), by DB-IP's database
            const org = hostName(n.asn) || 'Unknown network';
            const h = hosts.get(org) ?? { count: 0, asns: new Set<number>() };
            h.count++;
            if (n.asn) {
              h.asns.add(n.asn.number);
            }
            hosts.set(org, h);
            if (n.geo?.country) {
              countries.set(n.geo.country, (countries.get(n.geo.country) ?? 0) + 1);
            }
          }
        }
      });
      const top = (m: Map<string, number>, k: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([name, count]) => ({ name, count }));
      this.globeNodes = globe;
      this.nodeCounts = counts;
      this.hosts = [...hosts.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 8)
        .map(([name, h]) => ({ name, count: h.count, title: [...h.asns].map(a => 'AS' + a).join(', ') }));
      this.countries = top(countries, 8);
      this.clients = top(clients, 8).map(c => ({ ...c, color: /Backbone/.test(c.name) ? GREEN : '#9aa4b2' }));
      this.cd.markForCheck();
    });
  }

  private loadSolana(): void {
    this.get<any>('/api/v1/chain/intel/solana').subscribe((s) => {
      if (s) {
        this.solana = s;
        this.supplyChart = this.buildSupplyChart(s.supplyHistory ?? []);
        this.buildFeed();
        this.cd.markForCheck();
      }
    });
  }


  // --- derived ------------------------------------------------------------------------------------------------------

  private buildFeed(): void {
    const d = this.feedData ?? {};
    const items: FeedItem[] = [];
    for (const b of (d.blocks ?? []).slice(0, 12)) {
      const pool = b.extras?.pool?.name && b.extras.pool.name !== 'Unknown' ? b.extras.pool.name : 'an unknown miner';
      items.push({ time: b.timestamp, kind: 'block', net: 'eCash', color: NETS[0].color, link: `/block/${b.id}`,
        text: `Block ${b.height.toLocaleString()} by ${pool} · ${b.tx_count.toLocaleString()} txs` });
    }
    for (const e of (d.deposits ?? []).slice(0, 15)) {
      items.push({ time: e.time, kind: 'deposit', net: e.name ?? `slot ${e.slot}`, color: GREEN, link: `/tx/${e.txid}`,
        text: `Deposit of ${this.ecx(e.amount)} to ${e.name ?? 'slot ' + e.slot}` });
    }
    for (const e of d.withdrawals ?? []) {
      items.push({ time: e.time, kind: 'withdrawal', net: e.name ?? `slot ${e.slot}`, color: RED, link: e.txid ? `/tx/${e.txid}` : undefined,
        text: `Withdrawal bundle paid out of ${e.name ?? 'slot ' + e.slot}${e.amount ? ': ' + this.ecx(e.amount) : ''}` });
    }
    for (const e of d.bundles ?? []) {
      items.push({ time: e.time, kind: 'bundle', net: e.name ?? `slot ${e.slot}`, color: AMBER,
        text: `Withdrawal bundle ${e.status ? e.status.toLowerCase() + ' ' : ''}on ${e.name ?? 'slot ' + e.slot}` });
    }
    for (const b of d.thunderBlocks ?? []) {
      items.push({ time: b.time, kind: 'block', net: 'Thunder', color: NETS[2].color, link: `/thunder/block/${b.hash}`, ext: true,
        text: `Thunder block ${b.height} · ${b.txCount} txs, BMM bid ${b.bmm?.bid ?? '–'} sats` });
    }
    for (const e of (this.solana?.events ?? []).slice(0, 20)) {
      const what = e.kind === 'mint' ? `${this.coins(e.amount)} wECX minted on Solana` : e.kind === 'burn' ? `${this.coins(e.amount)} wECX burned (back to eCash)`
        : e.kind === 'add' ? `Liquidity added to Orca's wECX/USDC: ${this.coins(e.amount)} wECX` : `Liquidity taken from Orca's wECX/USDC: ${this.coins(e.amount)} wECX`;
      items.push({ time: e.time, kind: e.kind, net: 'Solana', color: e.kind === 'mint' || e.kind === 'add' ? GREEN : RED,
        text: what + (e.usd !== null ? ` (${this.usd(e.usd, 0)})` : '') });
    }
    for (const f of (this.whales?.flows ?? []).slice(0, 20)) {
      items.push({ time: f.time, kind: 'flow', net: f.name, color: '#5aa6ff', link: `/tx/${f.txid}`,
        text: `${this.coins(f.value)} ECX to ${f.name} (${f.kind})` });
    }
    this.feed = items.filter(i => i.time).sort((a, b) => b.time - a.time).slice(0, 60);
  }

  /** the deposits' destinations: who uses each sidechain (by amount brought in) */
  private topUsers(deposits: any[]): ChainConsoleComponent['users'] {
    const by = new Map<string, { chain: string; color: string; address: string; count: number; amount: number }>();
    for (const e of deposits) {
      if (!e.destination) {
        continue;
      }
      const chain = e.name ?? `slot ${e.slot}`;
      const key = chain + ' ' + e.destination;
      const u = by.get(key) ?? { chain, color: NETS.find(n => n.name === chain)?.color ?? '#9aa4b2', address: e.destination, count: 0, amount: 0 };
      u.count++;
      u.amount += e.amount ?? 0;
      by.set(key, u);
    }
    return [...by.values()].sort((a, b) => b.amount - a.amount).slice(0, 8);
  }

  /**
   * How spread the hashrate is over the window: the Nakamoto coefficient (the fewest pools over half the work), the
   * HHI (sum of squared shares, x10,000: above 2,500 is concentrated), the largest pool, DATUM (miners building their
   * own templates) and empty blocks.
   */
  private decentralisation(m: any): ChainConsoleComponent['decent'] {
    const pools = (m.pools ?? []).map((p: any) => ({ name: p.name ?? p.tag, share: p.workShare ?? p.share ?? 0 }))
      .sort((a: any, b: any) => b.share - a.share);
    if (!pools.length) {
      return null;
    }
    let sum = 0;
    let nakamoto = 0;
    for (const p of pools) {
      sum += p.share;
      nakamoto++;
      if (sum > 0.5) {
        break;
      }
    }
    const hhi = Math.round(pools.reduce((s: number, p: any) => s + (p.share * 100) ** 2, 0));
    const top = pools[0];
    const grade = nakamoto <= 1 ? 'Critical' : nakamoto === 2 || top.share > 0.33 ? 'Concentrated' : 'Healthy';
    const why = nakamoto <= 1 ? `${top.name} alone mined over half the work: it could reorganise the chain`
      : nakamoto === 2 ? 'two pools together mine over half the work'
      : top.share > 0.33 ? `${top.name} has over a third of the work: enough to withhold blocks profitably`
      : 'no pool near a third of the work';
    return {
      nakamoto, hhi, top, pools: pools.length, datum: m.totals?.datumShare ?? 0, datumMiners: m.totals?.datumMiners ?? 0,
      empty: (m.blocks ?? m.totals?.blocks) ? (m.totals?.emptyBlocks ?? 0) / (m.blocks ?? m.totals.blocks) : 0, grade, why,
    };
  }

  /**
   * Mining eCash, Bitcoin and Bitcoin Cash, with the same machines: each chain's revenue per petahash a day (its
   * hashprice), what that hashrate costs in power at the efficiency and price set above, the power price at which mining
   * breaks even, what a coin costs to mine, and what renting eCash's whole hashrate for an hour would cost at Bitcoin's
   * hashprice (a 51% attack's floor, if hashrate can be rented).
   */
  economics(): ChainConsoleComponent['econ'] {
    const m = this.mining?.totals;
    const n = this.mining?.blocks ?? m?.blocks ?? 0; // (the window's block count is the answer's, not its totals')
    const b = this.bitcoin;
    const c = this.bch;
    const ecxUsd = this.markets?.ecx?.priceUsd ?? null;
    if (!m || !b) {
      return null;
    }
    const PH = 1e15;
    const costPerPhDay = this.efficiency * 24 * this.power; // E J/TH: 1 PH = E kW; a day = 24 E kWh
    type Chain = { hashrate: number | null; difficulty: number | null; price: number | null; blockTime: number | null; reward: number | null; fees: number | null };
    const ecash: Chain = {
      hashrate: m.hashrate ?? null, difficulty: this.mining?.node?.difficulty ?? m.difficulty ?? null, price: ecxUsd, blockTime: m.avgBlockTime ?? null,
      reward: n ? (m.reward ?? 0) / n / 1e8 : null, fees: n ? (m.fees ?? 0) / n / 1e8 : null,
    };
    const btc: Chain = {
      hashrate: b.hashrate, difficulty: b.difficulty, price: b.priceUsd, blockTime: b.avgBlockTime ?? 600,
      reward: b.reward144 !== null ? b.reward144 / 144 / 1e8 : null, fees: b.fees144 !== null ? b.fees144 / 144 / 1e8 : null,
    };
    const bch: Chain = {
      hashrate: c?.hashrate ?? null, difficulty: c?.difficulty ?? null, price: c?.priceUsd ?? null, blockTime: c?.avgBlockTime ?? null,
      reward: c?.rewardPerBlock ?? null, fees: c?.feesPerBlock ?? null,
    };
    // A miner's hashprice is what its hashes earn at the current difficulty: a block takes difficulty x 2^32 hashes
    // on average, so a petahash for a day (8.64e19 hashes) finds 8.64e19 / (difficulty x 2^32) blocks. (Not the
    // window's rewards over its hashrate: eCash's difficulty lags its hashrate since the fork, its blocks came faster
    // than 10 minutes, and that is not what a miner joining now earns.) A coin's power cost likewise: the hashes a
    // coin takes at this difficulty, at the efficiency and power price set.
    const derive = (x: Chain) => {
      const perDay = x.blockTime ? 86400 / x.blockTime : null;
      const revenue = x.reward !== null && x.price !== null && perDay !== null ? x.reward * x.price * perDay : null;
      const hashesPerBlock = x.difficulty ? x.difficulty * 2 ** 32 : null;
      const hashprice = hashesPerBlock && x.reward !== null && x.price !== null ? x.reward * x.price * (PH * 86400) / hashesPerBlock : null;
      const cost = x.hashrate ? (x.hashrate / PH) * costPerPhDay : null;
      const kwhPerCoin = hashesPerBlock && x.reward ? hashesPerBlock / x.reward * (this.efficiency / 1e12) / 3.6e6 : null;
      return { perDay, revenue, hashprice, cost, coinCost: kwhPerCoin !== null ? kwhPerCoin * this.power : null,
        breakeven: hashprice !== null ? hashprice / (this.efficiency * 24) : null };
    };
    const e = derive(ecash);
    const t = derive(btc);
    const h = derive(bch);
    const rent = ecash.hashrate && t.hashprice !== null ? (ecash.hashrate / PH) * t.hashprice / 24 : null;
    const ratio = e.hashprice !== null && t.hashprice !== null && t.hashprice > 0 ? e.hashprice / t.hashprice : null;
    const ratioBch = e.hashprice !== null && h.hashprice !== null && h.hashprice > 0 ? e.hashprice / h.hashprice : null;
    this.hashprice = {
      ecash: e.hashprice, btc: t.hashprice, bch: h.hashprice, ratio, ratioBch,
      ecxPerPh: ecash.reward !== null && ecash.difficulty ? ecash.reward * (PH * 86400) / (ecash.difficulty * 2 ** 32) : null,
      btcPerPh: btc.reward !== null && btc.difficulty ? btc.reward * (PH * 86400) / (btc.difficulty * 2 ** 32) : null,
    };
    this.attack = this.attackCost(rent, ecash.blockTime, ecxUsd);
    const coin = (x: Chain, unit: string) => x.reward !== null ? x.reward.toFixed(3) + ' ' + unit : '–';
    const feeShare = (x: Chain) => x.fees !== null && x.reward ? (x.fees / x.reward * 100).toFixed(2) + '%' : '–';
    const kwh = (v: number | null) => v !== null ? '$' + v.toFixed(3) + '/kWh' : '–';
    const best = Math.max(...[e.hashprice, t.hashprice, h.hashprice].map(v => v ?? -Infinity));
    const rows = [
      { label: 'Hashrate', ecash: this.hash(ecash.hashrate), btc: this.hash(btc.hashrate), bch: this.hash(bch.hashrate) },
      { label: 'Difficulty', ecash: this.big(ecash.difficulty), btc: this.big(btc.difficulty), bch: this.big(bch.difficulty) },
      { label: 'Block time', ecash: this.secs(ecash.blockTime), btc: this.secs(btc.blockTime), bch: this.secs(bch.blockTime) },
      { label: 'Reward per block', ecash: coin(ecash, 'ECX'), btc: coin(btc, 'BTC'), bch: coin(bch, 'BCH'),
        note: `fees: ${feeShare(ecash)} · ${feeShare(btc)} · ${feeShare(bch)}` },
      { label: 'Coin price', ecash: this.usd(ecash.price), btc: this.usd(btc.price, 0), bch: this.usd(bch.price) },
      { label: 'Miners\' revenue a day', ecash: this.usd(e.revenue, 0), btc: this.usd(t.revenue, 0), bch: this.usd(h.revenue, 0) },
      { label: 'Hashprice ($/PH/day)', ecash: this.usd(e.hashprice), btc: this.usd(t.hashprice), bch: this.usd(h.hashprice),
        good: e.hashprice !== null ? e.hashprice >= best : null,
        note: ratio !== null ? `eCash pays ${ratio.toFixed(2)}x Bitcoin${ratioBch !== null ? `, ${ratioBch.toFixed(2)}x Bitcoin Cash` : ''} per hash` : undefined },
      { label: 'Power cost ($/PH/day)', ecash: this.usd(costPerPhDay), btc: this.usd(costPerPhDay), bch: this.usd(costPerPhDay), note: 'the same machines' },
      { label: 'Margin ($/PH/day)', ecash: this.usd(e.hashprice !== null ? e.hashprice - costPerPhDay : null), btc: this.usd(t.hashprice !== null ? t.hashprice - costPerPhDay : null),
        bch: this.usd(h.hashprice !== null ? h.hashprice - costPerPhDay : null), good: e.hashprice !== null ? e.hashprice > costPerPhDay : null },
      { label: 'Break-even power price', ecash: kwh(e.breakeven), btc: kwh(t.breakeven), bch: kwh(h.breakeven) },
      { label: 'Power cost of a coin', ecash: this.usd(e.coinCost), btc: this.usd(t.coinCost, 0), bch: this.usd(h.coinCost),
        note: e.coinCost !== null && ecash.price ? `${(e.coinCost / ecash.price * 100).toFixed(0)}% of ECX's price` : undefined },
      { label: 'Network power cost a day', ecash: this.usd(e.cost, 0), btc: this.usd(t.cost, 0), bch: this.usd(h.cost, 0) },
      { label: 'Rent the hashrate for 1 h', ecash: this.usd(rent, 0), btc: '–',
        bch: bch.hashrate && t.hashprice !== null ? this.usd((bch.hashrate / PH) * t.hashprice / 24, 0) : '–', note: 'at Bitcoin\'s hashprice: a 51% attack\'s floor' },
    ];
    const total = (ecash.hashrate ?? 0) + (btc.hashrate ?? 0) + (bch.hashrate ?? 0);
    const top = Math.max(1e-9, ...[e.hashprice, t.hashprice, h.hashprice].map(v => v ?? 0));
    // (rental: the chain's whole hashrate for an hour, at Bitcoin's hashprice: SHA-256 work's market price)
    const card = (name: string, color: string, x: Chain, d: ReturnType<typeof derive>, unit: string) => ({
      name, color, hashprice: d.hashprice, rent: x.hashrate && t.hashprice !== null ? (x.hashrate / PH) * t.hashprice / 24 : null,
      coinCost: d.coinCost, price: x.price, unit, best: d.hashprice !== null && d.hashprice >= best, width: d.hashprice !== null ? d.hashprice / top * 100 : 0,
    });
    const cards = [card('eCash', NETS[0].color, ecash, e, 'ECX'), card('Bitcoin', '#f7931a', btc, t, 'BTC'), card('Bitcoin Cash', '#0ac18e', bch, h, 'BCH')];
    const verdict = ratio === null ? null : ratio >= 1
      ? `eCash pays ${this.pctMore(ratio)} more per hash than Bitcoin${ratioBch !== null ? ` and ${this.pctMore(ratioBch)} more than Bitcoin Cash` : ''}.`
      : `eCash pays ${this.pctMore(1 / ratio)} less per hash than Bitcoin${ratioBch !== null ? `, ${ratioBch >= 1 ? this.pctMore(ratioBch) + ' more' : this.pctMore(1 / ratioBch) + ' less'} than Bitcoin Cash` : ''}.`;
    return { rows, cards, verdict, share: ecash.hashrate && total ? ecash.hashrate / total : null, shareBch: bch.hashrate && total ? bch.hashrate / total : null };
  }

  /**
   * What a 51% attack on eCash costs, and who could make one. Renting eCash's whole hashrate (doubling it: the attacker
   * then mines as fast as everyone else together) is priced at Bitcoin's hashprice, the market value of SHA-256 work
   * (a rental service adds its margin): per hour and per block. Stealing a
   * sidechain's escrow takes a withdrawal bundle's acks (the drivechain's threshold, in blocks) under the attacker's
   * majority. A pool with the majority already needs no rental at all.
   */
  private attackCost(perHour: number | null, blockTime: number | null, ecxUsd: number | null): ChainConsoleComponent['attack'] {
    const top = this.decent?.top ?? null;
    const majority = top && top.share > 0.5 ? top : null;
    const perBlock = perHour !== null && blockTime ? perHour * blockTime / 3600 : null;
    const volume = this.markets?.ecx?.volume24hUsd ?? null;
    const escrowSats = this.sidechains.reduce((sum, c) => sum + (c.escrow ?? 0), 0);
    const threshold = this.dcInfo?.bundleThreshold ?? null;
    const escrow = threshold ? {
      ecx: escrowSats / 1e8, usd: ecxUsd !== null ? escrowSats / 1e8 * ecxUsd : null, blocks: threshold,
      cost: perBlock !== null ? perBlock * threshold : null,
    } : null;
    const level = majority ? 'Critical' : perHour === null ? 'High' : perHour < 10_000 ? 'High' : perHour < 100_000 ? 'Moderate' : 'Low';
    const why = majority ? `${majority.name} alone has ${this.pct(majority.share)} of the work: it can reorganise eCash without renting anything`
      : perHour !== null && perHour < 10_000 ? `an hour of eCash's whole hashrate rents for ${this.usd(perHour, 0)}: within reach of one actor`
      : perHour !== null ? `an hour of eCash's whole hashrate rents for ${this.usd(perHour, 0)}` : 'Bitcoin\'s hashprice is not known yet';
    return {
      level, why, perHour, perBlock, blockTime, majority, escrow,
      volumeHours: perHour && volume ? volume / perHour : null,
    };
  }

  setEfficiency(v: string): void {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0 && n < 1000) {
      this.efficiency = n;
      this.econ = this.economics();
    }
  }

  setPower(v: string): void {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0 && n < 10) {
      this.power = n;
      this.econ = this.economics();
    }
  }

  // --- charts -------------------------------------------------------------------------------------------------------

  private buildPriceChart(): any {
    const ours = (this.markets?.history ?? []).map((h: any) => [h.time * 1000, h.priceUsd]);
    const neoxa = this.candles.map(k => [k.time * 1000, k.close]);
    if (ours.length < 2 && neoxa.length < 2) {
      return null;
    }
    return {
      animation: false, grid: { left: 44, right: 10, top: 22, bottom: 22 },
      legend: { top: 0, right: 0, textStyle: { color: '#ffffffaa', fontSize: 10 }, itemWidth: 10, itemHeight: 6 },
      tooltip: { trigger: 'axis', ...TOOLTIP, valueFormatter: (v: number) => '$' + v?.toFixed(2) },
      xAxis: { type: 'time', ...AXIS, splitLine: { show: false } },
      yAxis: { type: 'value', scale: true, ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => '$' + v } },
      series: [
        { name: 'neoxa ECX/USDC (1 h)', type: 'line', showSymbol: false, data: neoxa, lineStyle: { width: 1.5, color: '#5aa6ff' }, itemStyle: { color: '#5aa6ff' } },
        ...(ours.length >= 2 ? [{ name: 'ECX, all venues', type: 'line', showSymbol: false, data: ours, lineStyle: { width: 2, color: '#f5a623' }, itemStyle: { color: '#f5a623' },
          areaStyle: { color: '#f5a62318' } }] : []),
      ],
    };
  }

  /**
   * eCash's hashprice bucket by bucket over the window: a block's reward (subsidy and the bucket's fees) at ECX's price
   * then (neoxa's hourly close nearest it; none before its candles), at the bucket's difficulty; Bitcoin's now beside
   */
  private buildHashpriceChart(): any {
    const m = this.mining;
    if (!m?.series?.length || !this.candles.length) {
      return null;
    }
    const subsidy = m.halving?.subsidy ?? 3.125;
    const closes = this.candles.map(k => [k.time, k.close] as [number, number]);
    const priceAt = (t: number): number | null => {
      let best: [number, number] | null = null;
      for (const c of closes) {
        if (!best || Math.abs(c[0] - t) < Math.abs(best[0] - t)) {
          best = c;
        }
      }
      return best && Math.abs(best[0] - t) <= 2 * 3600 ? best[1] : null;
    };
    // (at each bucket's difficulty: what a petahash earned then, as the economics count it now)
    const data = m.series.map((b: any) => {
      const price = priceAt(b.time);
      if (price === null || !b.difficulty || !b.blocks) {
        return null;
      }
      const reward = subsidy + (b.fees ?? 0) / 1e8 / b.blocks;
      return [b.time * 1000, reward * price * (1e15 * 86400) / (b.difficulty * 2 ** 32)];
    }).filter((x: any) => x !== null);
    if (data.length < 2) {
      return null;
    }
    const btc = this.hashprice?.btc ?? null;
    return {
      animation: false, grid: { left: 44, right: 10, top: 24, bottom: 22 },
      legend: { top: 0, right: 0, textStyle: { color: '#ffffffaa', fontSize: 10 }, itemWidth: 10, itemHeight: 6 },
      tooltip: { trigger: 'axis', ...TOOLTIP, valueFormatter: (v: number) => '$' + v?.toFixed(2) + '/PH/day' },
      xAxis: { type: 'time', ...AXIS, splitLine: { show: false } },
      yAxis: { type: 'value', scale: true, ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => '$' + v } },
      series: [
        { name: 'eCash', type: 'line', showSymbol: false, smooth: 0.3, data, lineStyle: { width: 1.5, color: '#f5a623' }, itemStyle: { color: '#f5a623' }, areaStyle: { color: '#f5a62314' },
          ...(btc !== null ? { markLine: { symbol: 'none', silent: true, label: { color: '#ffffffaa', fontSize: 10, formatter: 'Bitcoin now', position: 'insideEndTop' },
            lineStyle: { color: '#5aa6ff', type: 'dashed' }, data: [{ yAxis: btc }] } } : {}) },
      ],
    };
  }

  /** each pool's share of the blocks, bucket by bucket over the window (stacked) */
  private buildShareChart(m: any): any {
    const series: any[] = m.series ?? [];
    if (series.length < 2) {
      return null;
    }
    const names = new Map<string, string>((m.pools ?? []).map((p: any) => [p.tag, p.name ?? p.tag]));
    const tags: string[] = (m.topTags ?? []).slice(0, 6);
    const lines = [...tags, '~other'].map((tag, i) => ({
      name: tag === '~other' ? 'Others' : names.get(tag) ?? tag, type: 'line', stack: 'share', showSymbol: false, smooth: 0.2,
      lineStyle: { width: 0 }, areaStyle: { color: POOL_COLORS[i % POOL_COLORS.length] + 'cc' }, itemStyle: { color: POOL_COLORS[i % POOL_COLORS.length] },
      data: series.map((b: any) => {
        const n = tag === '~other' ? Object.entries(b.pools ?? {}).filter(([t]) => !tags.includes(t)).reduce((s, [, c]) => s + Number(c), 0) : Number(b.pools?.[tag] ?? 0);
        return [b.time * 1000, b.blocks ? n / b.blocks * 100 : 0];
      }),
    }));
    return {
      animation: false, grid: { left: 34, right: 8, top: 26, bottom: 22 },
      legend: { top: 0, left: 0, textStyle: { color: '#ffffffaa', fontSize: 10 }, itemWidth: 8, itemHeight: 8, type: 'scroll' },
      tooltip: { trigger: 'axis', ...TOOLTIP, valueFormatter: (v: number) => v?.toFixed(0) + '%' },
      xAxis: { type: 'time', ...AXIS, splitLine: { show: false } },
      yAxis: { type: 'value', max: 100, ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: '{value}%' } },
      series: lines,
    };
  }

  /** the difficulty block by block, and the hashrate bucket by bucket, over the window */
  private buildDiffChart(m: any): any {
    const diff: [number, number][] = (m.difficulty ?? []).map((x: any[]) => [x[0], x[1]]);
    if (diff.length < 2) {
      return null;
    }
    const hash = (m.series ?? []).map((b: any) => [Math.round((b.from + b.to) / 2), b.hashrate]);
    return {
      animation: false, grid: { left: 52, right: 56, top: 24, bottom: 24 },
      legend: { top: 0, right: 0, textStyle: { color: '#ffffffaa', fontSize: 10 }, itemWidth: 10, itemHeight: 6 },
      tooltip: { trigger: 'axis', ...TOOLTIP },
      xAxis: { type: 'value', min: 'dataMin', max: 'dataMax', ...AXIS, splitLine: { show: false }, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => v.toLocaleString() } },
      yAxis: [
        { type: 'value', scale: true, ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => this.big(v) } },
        { type: 'value', scale: true, ...AXIS, splitLine: { show: false }, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => this.hash(v).replace(/(\.\d)\d+ /, '$1 ') } },
      ],
      series: [
        { name: 'Difficulty', type: 'line', step: 'end', showSymbol: false, data: diff, lineStyle: { width: 1.5, color: '#5aa6ff' }, itemStyle: { color: '#5aa6ff' },
          tooltip: { valueFormatter: (v: number) => this.big(v) } },
        { name: 'Hashrate', type: 'line', yAxisIndex: 1, showSymbol: false, smooth: 0.3, data: hash, lineStyle: { width: 1.5, color: '#f5a623' }, itemStyle: { color: '#f5a623' },
          areaStyle: { color: '#f5a62314' }, tooltip: { valueFormatter: (v: number) => this.hash(v) } },
      ],
    };
  }

  /** how long blocks took over the window */
  private buildHistChart(m: any): any {
    const h: any[] = m.histogram ?? [];
    if (!h.length) {
      return null;
    }
    const label = (b: any) => b.to === null ? `${b.from / 60}m+` : b.to <= 120 ? `${b.from}-${b.to}s` : `${b.from / 60}-${b.to / 60}m`;
    return {
      animation: false, grid: { left: 34, right: 8, top: 10, bottom: 22 },
      tooltip: { trigger: 'axis', ...TOOLTIP },
      xAxis: { type: 'category', data: h.map(label), ...AXIS, axisLabel: { ...AXIS.axisLabel, fontSize: 9, interval: 0 } },
      yAxis: { type: 'value', ...AXIS },
      series: [{ name: 'Blocks', type: 'bar', data: h.map(b => b.count), itemStyle: { color: '#5aa6ff', borderRadius: [3, 3, 0, 0] }, barWidth: '60%' }],
    };
  }

  /** eCash's ECX moved and transactions a day */
  private buildActivityChart(daily: any[]): any {
    if (daily.length < 2) {
      return null;
    }
    return {
      animation: false, grid: { left: 48, right: 50, top: 24, bottom: 22 },
      legend: { top: 0, right: 0, textStyle: { color: '#ffffffaa', fontSize: 10 }, itemWidth: 10, itemHeight: 6 },
      tooltip: { trigger: 'axis', ...TOOLTIP },
      xAxis: { type: 'time', ...AXIS, splitLine: { show: false } },
      yAxis: [
        { type: 'value', ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => this.big(v) } },
        { type: 'value', ...AXIS, splitLine: { show: false }, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => this.big(v) } },
      ],
      series: [
        { name: 'ECX moved', type: 'bar', data: daily.map(d => [d.day * 1000 + 43_200_000, d.volume]), itemStyle: { color: '#f5a623cc', borderRadius: [3, 3, 0, 0] }, barMaxWidth: 26,
          tooltip: { valueFormatter: (v: number) => Math.round(v).toLocaleString() + ' ECX' } },
        { name: 'Transactions', type: 'line', yAxisIndex: 1, data: daily.map(d => [d.day * 1000 + 43_200_000, d.txs]), lineStyle: { width: 2, color: '#5aa6ff' }, itemStyle: { color: '#5aa6ff' },
          tooltip: { valueFormatter: (v: number) => Math.round(v).toLocaleString() } },
      ],
    };
  }

  /** wECX's supply on Solana over time (the snapshots) */
  private buildSupplyChart(h: any[]): any {
    if (h.length < 2) {
      return null;
    }
    return {
      animation: false, grid: { left: 52, right: 8, top: 10, bottom: 22 },
      tooltip: { trigger: 'axis', ...TOOLTIP, valueFormatter: (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' wECX' },
      xAxis: { type: 'time', ...AXIS, splitLine: { show: false } },
      yAxis: { type: 'value', scale: true, ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => this.big(v) } },
      series: [{ name: 'Supply', type: 'line', step: 'end', showSymbol: false, data: h.map(x => [x.time * 1000, x.supply]), lineStyle: { width: 1.5, color: '#3bd1c4' },
        itemStyle: { color: '#3bd1c4' }, areaStyle: { color: '#3bd1c414' } }],
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

  /** a value in ECX (not sats) */
  coins(v: number): string {
    return v >= 100 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  usd(v: number | null | undefined, digits = 2): string {
    if (v === null || v === undefined || !Number.isFinite(v)) {
      return '–';
    }
    const a = Math.abs(v);
    const s = a >= 1e9 ? (a / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(2) + 'M' : a >= 1e4 ? (a / 1e3).toFixed(1) + 'k'
      : a.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    return (v < 0 ? '−$' : '$') + s;
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

  big(v: number | null): string {
    if (v === null || v === undefined || !Number.isFinite(v)) {
      return '–';
    }
    const u = ['', 'k', 'M', 'G', 'T', 'P', 'E'];
    let i = 0;
    while (Math.abs(v) >= 1000 && i < u.length - 1) {
      v /= 1000;
      i++;
    }
    return (i ? v.toFixed(2) : v.toFixed(0)) + u[i];
  }

  secs(s: number | null): string {
    if (!s) {
      return '–';
    }
    const r = Math.round(s); // (rounded first: 179.6 s is 3m 0s, not 2m 60s)
    return `${Math.floor(r / 60)}m ${r % 60}s`;
  }

  ago(t: number): string {
    const s = Math.max(0, this.now - t);
    return s < 60 ? `${Math.floor(s)}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
  }

  until(t: number | null): string {
    if (!t) {
      return '–';
    }
    const s = Math.max(0, t - this.now);
    return s < 3600 ? `${Math.floor(s / 60)}m` : s < 172800 ? `${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m` : `${Math.floor(s / 86400)}d`;
  }

  clock(): string {
    return new Date(this.now * 1000).toISOString().slice(11, 19) + ' UTC';
  }

  short(a: string | null): string {
    return !a ? '–' : a.length > 18 ? a.slice(0, 9) + '…' + a.slice(-6) : a;
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

  ecxPairs(): any[] {
    // the venues counted in the price first, by volume; then the others (Jupiter's aggregate)
    return (this.markets?.pairs ?? []).filter((p: any) => p.asset === 'ECX')
      .sort((a: any, b: any) => Number(b.counted) - Number(a.counted) || (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0));
  }

  /** a venue's name as it writes it ("orca" is Orca) */
  venueName(v: string): string {
    const names: Record<string, string> = { orca: 'Orca', neoxa: 'Neoxa', jupiter: 'Jupiter', raydium: 'Raydium', meteora: 'Meteora' };
    return names[v] ?? (v ? v[0].toUpperCase() + v.slice(1) : v);
  }

  /** a ratio above 1 as "26%" */
  pctMore(r: number): string {
    return Math.round((r - 1) * 100) + '%';
  }

  share(part: number, total: number): string {
    return total ? (part / total * 100).toFixed(part / total < 0.01 ? 3 : 1) + '%' : '–';
  }

  levelColor(level: string | undefined): string {
    return level === 'Low' ? GREEN : level === 'Moderate' ? AMBER : RED;
  }

  /** a duration in seconds, short */
  span(s: number | null): string {
    if (s === null) {
      return '–';
    }
    return s < 3600 ? `${Math.round(s / 60)} min` : s < 172800 ? `${(s / 3600).toFixed(1)} h` : `${(s / 86400).toFixed(1)} d`;
  }

  gradeColor(): string {
    return this.decent?.grade === 'Healthy' ? GREEN : this.decent?.grade === 'Concentrated' ? AMBER : RED;
  }
}
