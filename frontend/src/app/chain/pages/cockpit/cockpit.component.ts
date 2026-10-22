import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, Subscription, catchError, of, switchMap, timer, merge } from 'rxjs';
import { ChainApiService } from '@app/chain/chain-api.service';
import { PROFILE, slotColor, slotMarkId } from '@app/chain/profiles';
import { cockpitCharts } from '@app/chain/pages/cockpit/cockpit-charts';
import { SeoService } from '@app/services/seo.service';
import { StateService } from '@app/services/state.service';

/**
 * The cockpit (/drivechain): the drivechain of eCash at a glance, for every sidechain or one slot.
 *
 * Live state from the enforcer (escrows, supply locked in sidechains, pending bundles with their votes against the
 * threshold, sidechain proposals), statistics over a window of blocks (BMM coverage and bids, miner revenue, flows, votes, miners) and
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
  profile = PROFILE;
  windows = WINDOWS;
  feeds = FEEDS;
  window = 1440;
  slot: number | null = null;
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
