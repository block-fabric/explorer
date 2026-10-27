import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, Subscription, catchError, of, switchMap, timer, merge } from 'rxjs';
import { ChainApiService } from '@app/chain/chain-api.service';
import { PROFILE, slotColor, slotMarkId } from '@app/chain/profiles';
import { cockpitCharts } from '@app/chain/pages/cockpit/cockpit-charts';
import { CxColumn, CxFilter } from '@app/chain/components/chain-table/chain-table.component';
import { SeoService } from '@app/services/seo.service';
import { StateService } from '@app/services/state.service';

/**
 * The cockpit (/drivechain): the drivechain of eCash at a glance, for every sidechain or one slot.
 *
 * Live state from the enforcer (escrows, supply locked in sidechains, pending bundles with their votes against the
 * threshold, sidechain proposals), statistics over a window of blocks (BMM coverage and bids, miner revenue, flows, votes, miners) and
 * the event feeds, all from /api/v1/drivechain/cockpit and /api/v1/drivechain/events/*.
 */

// eCash blocks, at 10 minutes each
const WINDOWS = [
  { label: '6h', blocks: 36 },
  { label: '1d', blocks: 144 },
  { label: '1w', blocks: 1008 },
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

/** the event log's two feed-specific columns: their heads, and what they sort by */
const FEED_COLS: Record<string, [string, string, ((e: any) => number | string | null) | null]> = {
  'bmm': ['Side block', 'Bid', e => e.bid ?? null],
  'bmm-requests': ['Side block', 'Bid', e => e.bid ?? null],
  'deposits': ['Destination', 'Amount', e => e.amount],
  'withdrawals': ['Bundle', 'Amount', e => e.amount],
  'bundles': ['Bundle', 'Status', e => e.type],
  'proposals': ['Proposal', 'Hash', null],
};
const FEED_FILTERS: Record<string, CxFilter[] | undefined> = {
  'bmm-requests': [{ options: [{ label: 'accepted', test: e => !!e.accepted }, { label: 'not accepted', test: e => !e.accepted }] }],
  'bundles': [{ options: ['proposed', 'paid', 'failed'].map(t => ({ label: t, test: (e: any) => e.type === t })) }],
  'proposals': [{ options: [{ label: 'proposed', test: e => e.type === 'M1' }, { label: 'ack', test: e => e.type !== 'M1' }] }],
};

@Component({
  selector: 'app-chain-cockpit',
  templateUrl: './cockpit.component.html',
  styleUrls: ['./cockpit.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChainCockpitComponent implements OnInit, OnDestroy {
  profile = PROFILE;
  windows = WINDOWS;
  feeds = FEEDS;
  window = 144;
  slot: number | null = null;
  feed = 'bmm';

  data: any = null;
  error: string | null = null;
  feedItems: any[] | null = null;
  slotList: { slot: number; name: string; color: string }[] = [];

  charts: Record<string, any> = {};
  chartInitOptions = { renderer: 'svg' };

  // --- the tables -----------------------------------------------------------------------------------

  bidCols: CxColumn[] = [
    { key: 'name', label: 'Sidechain', sort: r => (r.name ?? '').toLowerCase() },
    { key: 'lastBid', label: 'Current bid', align: 'right', sort: true, nowrap: true },
    { key: 'block', label: 'Block', align: 'right', sort: r => r.lastBidHeight, nowrap: true },
    { key: 'bidMedian', label: 'Median', align: 'right', sort: true, hide: 'sm' },
    { key: 'range', label: 'Range', align: 'right', sort: r => r.bidMax, hide: 'md', nowrap: true },
    { key: 'coverage', label: 'Coverage', align: 'right', sort: true, hide: 'md' },
  ];

  marketCols: CxColumn[] = [
    { key: 'name', label: 'Sidechain', sort: r => (r.name ?? '').toLowerCase() },
    { key: 'bids', label: 'Bids paid', align: 'right', sort: true, nowrap: true },
    { key: 'share', label: 'Share of bids', sort: r => r.bids, hide: 'sm' },
    { key: 'accepts', label: 'Blocks', align: 'right', sort: true },
    { key: 'bidAvg', label: 'Avg', align: 'right', sort: true, hide: 'md' },
    { key: 'spread', label: 'P10 · median · P90', align: 'right', sort: r => r.bidMedian, nowrap: true, title: 'The 10th percentile, median and 90th percentile bids, sats' },
    { key: 'bidMax', label: 'Max', align: 'right', sort: true, hide: 'md' },
    { key: 'rejected', label: 'Beaten', align: 'right', sort: true, hide: 'lg', title: 'Its BMM requests that another request for the slot beat' },
    { key: 'contested', label: 'Contested', align: 'right', sort: true, hide: 'lg', title: 'eCash blocks with more than one request for the slot' },
  ];
  marketSearch = (r: any, q: string): boolean => (r.name ?? '').toLowerCase().includes(q) || String(r.slot) === q;

  bundleCols: CxColumn[] = [
    { key: 'name', label: 'Sidechain', sort: r => (r.name ?? '').toLowerCase() },
    { key: 'hash', label: 'Bundle' },
    { key: 'votes', label: 'Votes', sort: r => r.score },
    { key: 'blocksleft', label: 'Blocks left', align: 'right', sort: true, hide: 'lg' },
    { key: 'height', label: 'Proposed at', align: 'right', sort: true, hide: 'md' },
    { key: 'state', label: 'Status', align: 'right' },
  ];
  bundleFilters: CxFilter[] = [{ options: [
    { label: 'payable', test: b => !!b.payable },
    { label: 'on track', test: b => !b.payable && this.bundleProgress(b).canMake },
    { label: 'out of time', test: b => !this.bundleProgress(b).canMake },
  ] }];

  ledgerCols: CxColumn[] = [
    { key: 'name', label: 'Sidechain', sort: r => (r.name ?? '').toLowerCase() },
    { key: 'accepts', label: 'BMM blocks', align: 'right', sort: true },
    { key: 'coverage', label: 'Coverage', align: 'right', sort: true },
    { key: 'requests', label: 'Requests', align: 'right', sort: true, hide: 'lg' },
    { key: 'rejected', label: 'Rejected', align: 'right', sort: true, hide: 'lg' },
    { key: 'bidMedian', label: 'Median bid', align: 'right', sort: true },
    { key: 'bidMax', label: 'Max bid', align: 'right', sort: true, hide: 'md' },
    { key: 'bids', label: 'Bids total', align: 'right', sort: true },
    { key: 'deposits', label: 'Deposits', align: 'right', sort: r => r.depositAmount, nowrap: true },
    { key: 'withdrawals', label: 'Withdrawals', align: 'right', sort: r => r.withdrawalAmount, nowrap: true },
    { key: 'netFlow', label: 'Net', align: 'right', sort: true },
    { key: 'votes', label: '▲ / ▼ / –', align: 'right', sort: r => r.upvotes, nowrap: true, title: 'upvotes / downvotes / abstains', hide: 'lg' },
    { key: 'bundles', label: 'Bundles P/✓/✗', align: 'right', sort: r => r.bundlesProposed, nowrap: true, title: 'proposed / paid / failed', hide: 'lg' },
  ];

  minerCols: CxColumn[] = [
    { key: 'name', label: 'Miner', sort: r => (r.name || r.tag || '').toLowerCase() },
    { key: 'blocks', label: 'Blocks', align: 'right', sort: true },
    { key: 'share', label: 'Share', align: 'right', sort: true },
    { key: 'acceptsPerBlock', label: 'BMM / block', align: 'right', sort: true, hide: 'sm' },
    { key: 'bids', label: 'Bids earned', align: 'right', sort: true },
    { key: 'voted', label: 'Voted', align: 'right', sort: r => r.blocks ? r.voteBlocks / r.blocks : 0, hide: 'sm' },
  ];
  matchMiner = (m: any, q: string) => (m.name ?? '').toLowerCase().includes(q) || (m.tag ?? '').toLowerCase().includes(q);

  proposalCols: CxColumn[] = [
    { key: 'title', label: 'Sidechain', sort: r => (r.title ?? '').toLowerCase() },
    { key: 'slot', label: 'Slot', align: 'right', sort: true },
    { key: 'description', label: 'Description', hide: 'md' },
    { key: 'voteCount', label: 'Acks', align: 'right', sort: true },
    { key: 'proposalHeight', label: 'Proposed at', align: 'right', sort: true, nowrap: true },
  ];
  matchProposal = (p: any, q: string) => (p.title ?? '').toLowerCase().includes(q) || String(p.slot) === q
    || (p.description ?? '').toLowerCase().includes(q);

  feedCols: Record<string, CxColumn[]> = Object.fromEntries(Object.entries(FEED_COLS).map(([id, [a, b, sortB]]) => [id, [
    { key: 'height', label: 'Height', sort: true },
    { key: 'age', label: 'Age', sort: (e: any) => e.time, nowrap: true, hide: 'md' },
    { key: 'sidechain', label: 'Sidechain', sort: (e: any) => e.slot },
    { key: 'a', label: a },
    { key: 'b', label: b, align: 'right', sort: sortB ?? undefined, nowrap: true },
    { key: 'tx', label: 'Transaction', align: 'right', hide: 'lg' },
  ]]));
  feedFilters = FEED_FILTERS;
  matchEvent = (e: any, q: string) => String(e.height).includes(q)
    || [e.txid, e.requestTxid, e.sideBlock, e.destination, e.bundle, e.hash, e.name, e.title]
      .some(x => typeof x === 'string' && x.toLowerCase().includes(q));

  trackSlotRow = (s: any) => s.slot;
  trackHash = (b: any) => b.hash;

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
    this.seo.setTitle('Drivechain cockpit');
    const q = this.route.snapshot.queryParamMap;
    if (q.get('window') !== null) { this.window = Number(q.get('window')); }
    if (q.get('slot') !== null) { this.slot = Number(q.get('slot')); }
    if (q.get('feed')) { this.feed = q.get('feed') as string; }

    this.subs.push(merge(timer(0, 30000), this.reload$, this.stateService.blocks$.pipe()).pipe(
      switchMap(() => this.api.get<any>('drivechain/cockpit', { window: this.window, slot: this.slot }).pipe(
        catchError((e) => { this.error = e?.error?.error || e?.message || 'unavailable'; return of(null); }),
      )),
    ).subscribe((d) => {
      if (d) {
        this.data = d;
        this.error = null;
        if (this.slot === null) {
          this.slotList = d.live.sidechains.map((s: any) => ({ slot: s.slot, name: s.title ?? `Slot ${s.slot}`, color: this.colorOf(s.slot) }));
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
      queryParams: { window: this.window, slot: this.slot, feed: this.feed },
      queryParamsHandling: 'merge', replaceUrl: true,
    });
  }

  setWindow(w: number): void {
    this.window = w;
    this.syncUrl();
    this.reload$.next();
  }

  setSlot(slot: number | null): void {
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

  logoUrl(logo: string): string {
    return `/resources/pool-logos/${logo}`;
  }

  hideLogo(event: Event): void {
    (event.target as HTMLElement).style.display = 'none';
  }

  colorOf(slot: number): string {
    return slotColor(slot);
  }

  markId(slot: number, name?: string | null): string {
    return slotMarkId(slot, name);
  }

  nameOf(slot: number): string {
    return this.data?.live?.allSidechains?.find((s: any) => s.slot === slot)?.title ?? `Slot ${slot}`;
  }

  pct(x: number, digits = 1): string {
    return (x * 100).toFixed(digits) + '%';
  }

  short(h: string): string {
    return h ? h.slice(0, 8) + '…' + h.slice(-6) : '';
  }

  /** the sidechains with a bid accepted in the window, their newest bid first by amount */
  currentBids(d: any): any[] {
    if (this.bidsFor !== d) {
      this.bidsFor = d;
      this.bids = (d?.slots ?? []).filter((s: any) => s.lastBid !== null && s.lastBid !== undefined)
        .sort((a: any, b: any) => b.lastBid - a.lastBid || a.slot - b.slot);
    }
    return this.bids;
  }
  private bidsFor: any = null;
  private bids: any[] = [];

  /** the BMM fee market over the window: the sidechains that bid, and what the bids are to eCash miners */
  market(d: any): { rows: any[]; total: number; perDay: number | null; perBlock: number } {
    if (this.marketFor !== d) {
      this.marketFor = d;
      const rows = (d?.slots ?? []).filter((s: any) => s.bids > 0 || s.requests > 0);
      const total = rows.reduce((a: number, s: any) => a + s.bids, 0);
      const t = d?.totals ?? {};
      const days = t.firstTime && t.lastTime && t.lastTime > t.firstTime ? (t.lastTime - t.firstTime) / 86400 : null;
      this.marketData = {
        rows: rows.map((s: any) => ({ ...s, share: total ? s.bids / total : 0 })),
        total, perDay: days ? total / days : null, perBlock: t.blocks ? (t.accepts ?? 0) / t.blocks : 0,
      };
    }
    return this.marketData;
  }
  private marketFor: any = null;
  private marketData: { rows: any[]; total: number; perDay: number | null; perBlock: number } = { rows: [], total: 0, perDay: null, perBlock: 0 };

  slotStats(slot: number): any {
    return this.data?.slots?.find((s: any) => s.slot === slot);
  }

  /** a bundle's path to payout: votes / threshold, and whether it can still make it in the blocks it has left */
  bundleProgress(b: any): { pct: number; needed: number; canMake: boolean } {
    const min = b.threshold || 1;
    const needed = Math.max(0, min - b.score);
    return { pct: Math.min(1, b.score / min), needed, canMake: needed <= b.blocksleft };
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

  private buildCharts(): void {
    this.charts = cockpitCharts(this.data, { colorOf: s => this.colorOf(s), nameOf: s => this.nameOf(s) });
  }
}
